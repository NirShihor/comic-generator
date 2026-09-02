import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

// Marketing hub: sub-tabs for content production. "Posters" is live (the
// canonical mini-movie-poster template); the other sub-tabs are placeholders
// for the content-generator phases to come.
export default function Marketing() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('posters');

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
        <h1 style={{ marginRight: 'auto' }}>Marketing</h1>
        <button className="btn btn-secondary" onClick={() => navigate('/')} style={{ padding: '0.4rem 1rem' }}>
          ← My Comics
        </button>
      </div>
      <p style={{ color: '#888', marginTop: 0 }}>
        Publish interesting things — every post is entertainment first. No CTAs on images, hashtags live in the caption.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', margin: '1rem 0 1.5rem', flexWrap: 'wrap' }}>
        <button className={`btn ${tab === 'posters' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTab('posters')} style={{ padding: '0.5rem 1.1rem' }}>
          🎬 Posters
        </button>
        <button className={`btn ${tab === 'clips' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTab('clips')} style={{ padding: '0.5rem 1.1rem' }}>
          🎞 Reels
        </button>
        <button className={`btn ${tab === 'carousel' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTab('carousel')} style={{ padding: '0.5rem 1.1rem' }}>
          🎠 Carousels
        </button>
        {['🗂 Word cards', '🗓 Calendar'].map(label => (
          <button key={label} className="btn btn-secondary" disabled
                  title="Coming with the next content-generator phase"
                  style={{ padding: '0.5rem 1.1rem', opacity: 0.45, cursor: 'not-allowed' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'posters' && <Posters />}
      {tab === 'clips' && <Reels />}
      {tab === 'carousel' && <Carousel />}
    </div>
  );
}

// Carousel: a tiny story the viewer swipes through — a 15-second comic
// trailer. Story Hook shape: big opening panel + hook, zoomed bubbles with
// Spanish and a small English echo, an atmosphere beat with no translation,
// then the Comigo sign-off (in-world, never an advert).
function Carousel() {
  const [comics, setComics] = useState([]);
  const [comicId, setComicId] = useState('');
  const [images, setImages] = useState([]);
  const [slides, setSlides] = useState([{ imageFile: '', title: '', es: '', en: '', artPrompt: '' }]);
  const [active, setActive] = useState(0);
  const [logoOn, setLogoOn] = useState(true);
  const [logoLine1, setLogoLine1] = useState('Spanish.');
  const [logoLine2, setLogoLine2] = useState('One comic at a time.');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState([]);

  useEffect(() => {
    api.get('/comics').then(r => setComics(Array.isArray(r.data) ? r.data : r.data.comics || []));
  }, []);
  useEffect(() => {
    setImages([]); setOut([]); setSlides([{ imageFile: '', title: '', es: '', en: '', artPrompt: '' }]); setActive(0);
    if (!comicId) return;
    api.get(`/marketing/${comicId}/images`).then(r => setImages(r.data.images)).catch(e => alert(e.response?.data?.error || e.message));
  }, [comicId]);

  const upd = (i, k, v) => setSlides(ss => ss.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const addSlide = () => { setSlides(ss => [...ss, { imageFile: '', title: '', es: '', en: '', artPrompt: '' }]); setActive(slides.length); };
  const removeSlide = i => {
    if (slides.length === 1) return;
    setSlides(ss => ss.filter((_, j) => j !== i));
    setActive(a => Math.max(0, a - (i <= a ? 1 : 0)));
  };
  const move = (i, d) => {
    const j = i + d; if (j < 0 || j >= slides.length) return;
    setSlides(ss => { const n = [...ss]; [n[i], n[j]] = [n[j], n[i]]; return n; });
    setActive(j);
  };
  const assignImage = file => upd(active, 'imageFile', slides[active]?.imageFile === file ? '' : file);

  const generate = async () => {
    setBusy(true); setOut([]);
    try {
      const r = await api.post('/marketing/carousel', {
        comicId, slides, logo: { enabled: logoOn, line1: logoLine1, line2: logoLine2 },
      });
      setOut(r.data.urls || []);
    } catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };

  const [suggesting, setSuggesting] = useState(false);
  // GPT drafts the whole story from the selected ref images (it sees them) +
  // the comic's real dialogue. Fills the text fields; everything stays editable.
  const suggest = async () => {
    setSuggesting(true);
    try {
      const r = await api.post('/marketing/carousel-suggest', {
        comicId, slides: slides.map(s => ({ imageFile: s.imageFile })),
      });
      const sug = r.data.slides || [];
      setSlides(ss => ss.map((s, i) => ({ ...s, title: sug[i]?.title ?? s.title, es: sug[i]?.es ?? s.es, en: sug[i]?.en ?? s.en })));
    } catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setSuggesting(false); }
  };

  const [genUrls, setGenUrls] = useState({});
  const [genBusy, setGenBusy] = useState(-1);
  // The clips principle, for stills: the slide's assigned image is the
  // reference, your prompt describes the shot, gpt-image-2 paints a NEW image
  // in the comic's style and it lands straight on the slide.
  const genArt = async i => {
    setGenBusy(i);
    try {
      const s = slides[i];
      const r = await api.post('/marketing/carousel-image', {
        comicId, prompt: s.artPrompt, refImageFiles: s.imageFile ? [s.imageFile] : [],
      });
      setGenUrls(m => ({ ...m, [r.data.file]: r.data.url }));
      upd(i, 'imageFile', r.data.file);
    } catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setGenBusy(-1); }
  };

  const input = { width: '100%', padding: '0.5rem 0.7rem', borderRadius: 6, border: '1px solid #555', background: '#1a1332', color: '#e9e4ff', fontSize: '0.95rem' };

  return (
    <div>
      <p style={{ color: '#888', fontSize: '0.88rem', marginTop: 0 }}>
        A carousel is not five random images — it's a tiny story the viewer controls by swiping.
        Big opening panel + hook, zoomed bubbles with the Spanish (small English underneath),
        an atmosphere beat with no translation, then the Comigo sign-off. Every field is optional per slide.
      </p>
      <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: 4 }}>1 · Comic</label>
      <select value={comicId} onChange={e => setComicId(e.target.value)} style={{ ...input, maxWidth: 420 }}>
        <option value="">Choose a comic…</option>
        {comics.map(c => <option key={c.id} value={c.id}>{c.title}{c.collectionTitle ? ` — ${c.collectionTitle}` : ''}</option>)}
      </select>

      {images.length > 0 && (
        <>
          <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', margin: '1rem 0 4px' }}>
            2 · Click an image to put it on the highlighted slide (click again to clear). "no_text" versions work well for zoomed beats.
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8, maxHeight: 260, overflowY: 'auto', padding: 4, border: '1px solid #333', borderRadius: 8 }}>
            {images.map(img => {
              const used = slides.map((s, i) => (s.imageFile === img.file ? i + 1 : 0)).filter(Boolean);
              return (
                <div key={img.file} style={{ position: 'relative' }}>
                  <img src={img.url} alt={img.file} title={img.file}
                       onClick={() => assignImage(img.file)}
                       style={{ width: '100%', borderRadius: 4, cursor: 'pointer',
                                outline: slides[active]?.imageFile === img.file ? '3px solid #8e6bf0' : used.length ? '2px solid #5a4a99' : '1px solid #444' }} />
                  {used.length > 0 && <span style={{ position: 'absolute', top: 4, left: 4, background: '#8e6bf0', color: '#fff',
                      borderRadius: 10, padding: '1px 7px', fontSize: 12 }}>{used.join(',')}</span>}
                </div>
              );
            })}
          </div>

          <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', margin: '1rem 0 4px' }}>
            3 · Slides — click a card to make it the target for image clicks
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {slides.map((s, i) => (
              <div key={i} onClick={() => setActive(i)}
                   style={{ border: active === i ? '2px solid #8e6bf0' : '1px solid #444', borderRadius: 10, padding: 10, cursor: 'pointer' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: '0.85rem' }}>
                  <strong style={{ color: '#c9bfff' }}>Slide {i + 1}</strong>
                  <span style={{ color: '#888', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.imageFile || 'no image — text beat'}
                  </span>
                  <button className="btn btn-secondary" onClick={e => { e.stopPropagation(); move(i, -1); }} style={{ padding: '0.15rem 0.45rem' }}>↑</button>
                  <button className="btn btn-secondary" onClick={e => { e.stopPropagation(); move(i, 1); }} style={{ padding: '0.15rem 0.45rem' }}>↓</button>
                  <button className="btn btn-secondary" onClick={e => { e.stopPropagation(); removeSlide(i); }} style={{ padding: '0.15rem 0.45rem', color: '#f88' }}>✕</button>
                </div>
                <input style={input} placeholder="Hook / title (white, top) — optional" value={s.title} onChange={e => upd(i, 'title', e.target.value)} />
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <input style={input} placeholder="Spanish line (yellow) — optional" value={s.es} onChange={e => upd(i, 'es', e.target.value)} />
                  <input style={input} placeholder="English echo (small, under) — optional" value={s.en} onChange={e => upd(i, 'en', e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                  {(genUrls[s.imageFile] || images.find(im => im.file === s.imageFile)) && (
                    <img src={genUrls[s.imageFile] || images.find(im => im.file === s.imageFile)?.url} alt=""
                         style={{ width: 46, height: 58, objectFit: 'cover', borderRadius: 4, border: '1px solid #555', flex: 'none' }} />
                  )}
                  <input style={input} value={s.artPrompt || ''} onChange={e => upd(i, 'artPrompt', e.target.value)}
                         placeholder="Or describe NEW art for this slide — the assigned image becomes the style/scene reference" />
                  <button className="btn btn-secondary" disabled={genBusy !== -1 || !s.artPrompt}
                          onClick={e => { e.stopPropagation(); genArt(i); }}
                          style={{ padding: '0.3rem 0.8rem', whiteSpace: 'nowrap' }}
                          title="Generates a new still with the comic image model (gpt-image-2), guided by the assigned reference image + this prompt">
                    {genBusy === i ? 'Painting…' : '🎨 Generate art'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={addSlide} disabled={slides.length >= 9} style={{ padding: '0.35rem 1rem' }}>
              ＋ Add slide
            </button>
            <button className="btn btn-secondary" onClick={suggest} disabled={suggesting || !slides.some(s => s.imageFile)} style={{ padding: '0.35rem 1rem' }}
                    title="GPT looks at your selected images and the comic's real dialogue, then drafts every slide's text — all editable">
              {suggesting ? 'Thinking…' : '✨ Suggest text from images (GPT)'}
            </button>
          </div>

          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem', color: '#ccc', marginTop: 14 }}>
            <input type="checkbox" checked={logoOn} onChange={e => setLogoOn(e.target.checked)} />
            End with the Comigo sign-off slide — keep it in-world, never "download now"
          </label>
          {logoOn && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6, maxWidth: 640 }}>
              <input style={input} value={logoLine1} onChange={e => setLogoLine1(e.target.value)} placeholder="Line 1 (white)" />
              <input style={input} value={logoLine2} onChange={e => setLogoLine2(e.target.value)} placeholder="Line 2 (yellow)" />
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <button className="btn btn-primary" disabled={busy} onClick={generate} style={{ padding: '0.55rem 1.4rem' }}>
              {busy ? 'Rendering…' : '🎠 Render carousel'}
            </button>
          </div>

          {out.length > 0 && (
            <>
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', margin: '1.2rem 0 4px' }}>
                Rendered slides — post in this order
              </label>
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: 4 }}>
                {out.map((u, i) => (
                  <div key={u} style={{ flex: '0 0 180px', textAlign: 'center' }}>
                    <img src={u} alt={`slide ${i + 1}`} style={{ width: '100%', borderRadius: 8, border: '1px solid #444' }} />
                    <a className="btn btn-secondary" href={u} download style={{ display: 'inline-block', padding: '0.25rem 0.8rem', marginTop: 6, fontSize: '0.8rem', textDecoration: 'none' }}>
                      ⬇ Slide {i + 1}
                    </a>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Posters() {
  const [comics, setComics] = useState([]);
  const [comicId, setComicId] = useState('');
  const [images, setImages] = useState([]);
  const [imageFile, setImageFile] = useState('');
  const [line1, setLine1] = useState('');
  const [brightness, setBrightness] = useState(1);
  const [saturation, setSaturation] = useState(1);
  const [line2, setLine2] = useState('');
  const [hooks, setHooks] = useState([]);
  const [busy, setBusy] = useState('');
  const [poster, setPoster] = useState(null);
  const [caption, setCaption] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get('/comics').then(r => {
      const list = Array.isArray(r.data) ? r.data : r.data.comics || [];
      setComics(list);
    }).catch(e => console.error(e));
  }, []);

  useEffect(() => {
    setImages([]); setImageFile(''); setPoster(null); setCaption(''); setHooks([]);
    if (!comicId) return;
    api.get(`/marketing/${comicId}/images`)
      .then(r => setImages(r.data.images))
      .catch(e => alert(e.response?.data?.error || e.message));
  }, [comicId]);

  const suggestHooks = async () => {
    setBusy('hooks');
    try {
      const r = await api.post('/marketing/hooks', { comicId });
      setHooks(r.data.hooks || []);
    } catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setBusy(''); }
  };

  const render = async () => {
    setBusy('poster');
    setPoster(null);
    try {
      const r = await api.post('/marketing/poster', { comicId, imageFile, line1, line2, brightness, saturation });
      setPoster(r.data.url);
    } catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setBusy(''); }
  };

  const genCaption = async () => {
    setBusy('caption');
    try {
      const r = await api.post('/marketing/caption', { comicId, line1, line2 });
      setCaption(r.data.caption);
    } catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setBusy(''); }
  };

  const input = { width: '100%', padding: '0.5rem 0.7rem', borderRadius: 6, border: '1px solid #555', background: '#1a1332', color: '#e9e4ff', fontSize: '0.95rem' };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: '1.5rem', alignItems: 'start' }}>
      <div>
        {/* 1. comic */}
        <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: 4 }}>1 · Comic</label>
        <select value={comicId} onChange={e => setComicId(e.target.value)} style={{ ...input, maxWidth: 420 }}>
          <option value="">Choose a comic…</option>
          {comics.map(c => <option key={c.id} value={c.id}>{c.title}{c.collectionTitle ? ` — ${c.collectionTitle}` : ''}</option>)}
        </select>

        {/* 2. art */}
        {images.length > 0 && (
          <>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', margin: '1rem 0 4px' }}>
              2 · Art ({images.length} images — pages first, then panels)
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8, maxHeight: 340, overflowY: 'auto', padding: 4, border: '1px solid #333', borderRadius: 8 }}>
              {images.map(img => (
                <img key={img.file} src={img.url} alt={img.file} title={img.file}
                     onClick={() => setImageFile(img.file)}
                     style={{ width: '100%', borderRadius: 4, cursor: 'pointer',
                              outline: imageFile === img.file ? '3px solid #8e6bf0' : '1px solid #444' }} />
              ))}
            </div>
          </>
        )}

        {/* 2b. art adjustments — CSS preview mirrors what sharp will do */}
        {imageFile && (
          <>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', margin: '1rem 0 4px' }}>
              Adjust art &mdash; brightness {brightness.toFixed(2)} &middot; colour {saturation.toFixed(2)}
            </label>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <img src={images.find(i => i.file === imageFile)?.url} alt="preview"
                   style={{ width: 130, borderRadius: 6, border: '1px solid #555',
                            filter: `brightness(${brightness}) saturate(${saturation})` }} />
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: '0.78rem', color: '#888' }}>Brightness</div>
                <input type="range" min="0.7" max="1.7" step="0.05" value={brightness}
                       onChange={e => setBrightness(Number(e.target.value))} style={{ width: '100%' }} />
                <div style={{ fontSize: '0.78rem', color: '#888', marginTop: 6 }}>Colour</div>
                <input type="range" min="0.5" max="1.6" step="0.05" value={saturation}
                       onChange={e => setSaturation(Number(e.target.value))} style={{ width: '100%' }} />
                <button className="btn btn-secondary" onClick={() => { setBrightness(1); setSaturation(1); }}
                        style={{ padding: '0.25rem 0.7rem', fontSize: '0.78rem', marginTop: 6 }}>Reset</button>
              </div>
            </div>
          </>
        )}

        {/* 3. text */}
        {imageFile && (
          <>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', margin: '1rem 0 4px' }}>3 · Poster text</label>
            <input style={input} placeholder="Hook line — no full stop (white)" value={line1} onChange={e => setLine1(e.target.value)} />
            <input style={{ ...input, marginTop: 8 }} placeholder="The question? (yellow, biggest)" value={line2} onChange={e => setLine2(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" disabled={busy !== ''} onClick={suggestHooks} style={{ padding: '0.45rem 1rem' }}>
                {busy === 'hooks' ? 'Thinking…' : '✨ Suggest hooks'}
              </button>
              <button className="btn btn-primary" disabled={busy !== '' || !line1 || !line2} onClick={render} style={{ padding: '0.45rem 1.2rem' }}>
                {busy === 'poster' ? 'Rendering…' : 'Render poster'}
              </button>
            </div>
            {hooks.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                {hooks.map((h, i) => (
                  <button key={i} className="btn btn-secondary" onClick={() => { setLine1(h.line1); setLine2(h.line2); }}
                          style={{ padding: '0.4rem 0.8rem', textAlign: 'left', fontSize: '0.88rem' }}>
                    {h.line1} — <strong>{h.line2}</strong>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* preview column */}
      <div>
        {poster ? (
          <>
            <img src={poster} alt="Poster preview" style={{ width: '100%', borderRadius: 10, border: '1px solid #444' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <a className="btn btn-primary" href={poster} download style={{ padding: '0.45rem 1.1rem', textDecoration: 'none' }}>⬇ Download</a>
              <button className="btn btn-secondary" disabled={busy !== ''} onClick={genCaption} style={{ padding: '0.45rem 1.1rem' }}>
                {busy === 'caption' ? 'Writing…' : '📝 Caption'}
              </button>
            </div>
            {caption && (
              <>
                <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={9}
                          style={{ ...input, marginTop: 10, resize: 'vertical', fontFamily: 'inherit' }} />
                <button className="btn btn-secondary" style={{ padding: '0.4rem 1rem', marginTop: 6 }}
                        onClick={() => { navigator.clipboard.writeText(caption); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  {copied ? 'Copied ✓' : 'Copy caption'}
                </button>
              </>
            )}
          </>
        ) : (
          <div style={{ border: '2px dashed #444', borderRadius: 10, padding: '3rem 1rem', textAlign: 'center', color: '#777', fontSize: '0.9rem' }}>
            Poster preview appears here<br />1080 × 1350 · Instagram portrait
          </div>
        )}
      </div>
    </div>
  );
}

function Reels() {
  const [comics, setComics] = useState([]);
  const [comicId, setComicId] = useState('');
  const [images, setImages] = useState([]);
  const [refs, setRefs] = useState([]);          // up to 3 directional images
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('fast');
  const [mode, setMode] = useState('refs');
  const [busy, setBusy] = useState(false);
  const [clip, setClip] = useState(null);
  const [clipFile, setClipFile] = useState(null);
  const [error, setError] = useState('');
  const [audios, setAudios] = useState([]);
  const [question, setQuestion] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [cast, setCast] = useState([]);
  const [lineVoice, setLineVoice] = useState('');
  const [lineEn, setLineEn] = useState('');
  const [lineEs, setLineEs] = useState('');
  const [lineOrder, setLineOrder] = useState('en-es');
  const [lineBusy, setLineBusy] = useState('');
  const [endCard, setEndCard] = useState(true);
  const [voices, setVoices] = useState([]);      // [{file, label, es, en, lang}]
  const [ambient, setAmbient] = useState('duck');
  const [subtitles, setSubtitles] = useState('none'); // 'none' | 'es' | 'en' | 'match'
  const [durationSeconds, setDurationSeconds] = useState(8); // Veo: 4 | 6 | 8
  const [questionSec, setQuestionSec] = useState(2);
  const [endSec, setEndSec] = useState(1.8);
  const [endCaption, setEndCaption] = useState('');
  const [endMidCaption, setEndMidCaption] = useState('');

  useEffect(() => {
    api.get('/comics').then(r => setComics(Array.isArray(r.data) ? r.data : r.data.comics || []));
  }, []);
  useEffect(() => {
    setImages([]); setRefs([]); setClip(null); setClipFile(null); setError(''); setAudios([]); setVoices([]);
    if (!comicId) return;
    api.get(`/marketing/${comicId}/images`).then(r => setImages(r.data.images)).catch(e => alert(e.response?.data?.error || e.message));
    api.get(`/marketing/${comicId}/audios`).then(r => setAudios(r.data.audios)).catch(() => setAudios([]));
    api.get(`/marketing/${comicId}/voices`).then(r => { setCast(r.data.voices); if (r.data.voices[0]) setLineVoice(r.data.voices[0].voiceId); }).catch(() => setCast([]));
  }, [comicId]);

  // One option per language per sentence, labelled with its text.
  const voiceOptions = audios.flatMap(a => [
    { file: a.file, lang: 'es', es: a.text, en: a.translation || '', label: `🇪🇸 p${a.page} · ${a.text}` },
    ...(a.translationFile ? [{ file: a.translationFile, lang: 'en', es: a.text, en: a.translation || a.text, label: `🇬🇧 p${a.page} · ${a.translation || a.text}` }] : []),
  ]);
  const addVoice = file => {
    const opt = voiceOptions.find(o => o.file === file);
    if (opt) setVoices([...voices, opt]);
  };
  const removeVoice = i => setVoices(voices.filter((_, j) => j !== i));
  const moveVoice = (i, d) => {
    const j = i + d; if (j < 0 || j >= voices.length) return;
    const next = [...voices]; [next[i], next[j]] = [next[j], next[i]]; setVoices(next);
  };

  const translateLine = async () => {
    if (!lineEn) return;
    setLineBusy('translate');
    try { const r = await api.post('/marketing/translate-line', { text: lineEn }); setLineEs(r.data.spanish); }
    catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setLineBusy(''); }
  };

  // House English narrator — every English take uses this voice regardless of
  // the cast selection (which picks the SPANISH voice).
  const ENGLISH_VOICE_ID = 'GP1bgf0sjoFuuHkyrg8E';

  const generateLines = async () => {
    const v = cast.find(c => c.voiceId === lineVoice);
    if (!v) return;
    setLineBusy('gen');
    try {
      const make = async (text, languageCode, flag) => {
        const english = languageCode === 'en';
        const r = await api.post('/marketing/reel-line-audio', {
          comicId, voiceId: english ? ENGLISH_VOICE_ID : v.voiceId, text, languageCode,
          stability: v.settings?.stability ?? 0.5,
          similarityBoost: v.settings?.similarity_boost ?? v.settings?.similarityBoost ?? 0.75,
          speed: v.settings?.speed ?? 1.0,
          ...(v.settings?.model ? { modelId: v.settings.model } : {}),
        });
        return { file: r.data.file, lang: languageCode, es: lineEs, en: lineEn, label: `${flag} ${english ? 'English' : v.name}: ${r.data.label}` };
      };
      const items = [];
      if (lineOrder !== 'es-only' && lineEn) items.push(await make(lineEn, 'en', '🇬🇧'));
      if (lineOrder !== 'en-only' && lineEs) items.push(await make(lineEs, 'es', '🇪🇸'));
      if (lineOrder === 'es-en') items.reverse();
      setVoices(vs => [...vs, ...items]);
    } catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setLineBusy(''); }
  };

  const remix = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.post('/marketing/veo-remix', { comicId, file: clipFile, voiceAudio: voices.map(v => ({ file: v.file, es: v.es || '', en: v.en || '', lang: v.lang || 'es' })), ambient, subtitles, question, endCard, questionSeconds: questionSec, endCardSeconds: endSec, endCardCaption: endCaption, endCardMidCaption: endMidCaption });
      setClip(r.data.url);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };

  const toggleRef = file => {
    if (refs.includes(file)) setRefs(refs.filter(f => f !== file));
    else if (refs.length < 3) setRefs([...refs, file]);
  };

  const generate = async () => {
    setBusy(true); setClip(null); setError('');
    try {
      const r = await api.post('/marketing/veo-clip', { comicId, prompt, imageFiles: refs, model, mode, aspectRatio: '9:16',
        voiceAudio: voices.map(v => ({ file: v.file, es: v.es || '', en: v.en || '', lang: v.lang || 'es' })), ambient, subtitles, question, endCard, negativePrompt,
        durationSeconds, questionSeconds: questionSec, endCardSeconds: endSec, endCardCaption: endCaption, endCardMidCaption: endMidCaption });
      setClip(r.data.url); setClipFile(r.data.file);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };

  const input = { width: '100%', padding: '0.5rem 0.7rem', borderRadius: 6, border: '1px solid #555', background: '#1a1332', color: '#e9e4ff', fontSize: '0.95rem' };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: '1.5rem', alignItems: 'start' }}>
      <div>
        <p style={{ color: '#888', fontSize: '0.88rem', marginTop: 0 }}>
          Generates a real video clip with Veo (the video sibling of the comic image model).
          Pick up to 3 directional images to guide style and content, then describe the shot.
        </p>
        <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: 4 }}>1 · Comic</label>
        <select value={comicId} onChange={e => setComicId(e.target.value)} style={{ ...input, maxWidth: 420 }}>
          <option value="">Choose a comic…</option>
          {comics.map(c => <option key={c.id} value={c.id}>{c.title}{c.collectionTitle ? ` — ${c.collectionTitle}` : ''}</option>)}
        </select>

        {images.length > 0 && (
          <>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', margin: '1rem 0 4px' }}>
              2 · Images ({refs.length}/{mode === 'frames' ? 2 : 3}) — click to select, click again to remove.
              For a clip WITHOUT speech bubbles, pick the "no_text" versions (hover shows filenames).
            </label>
            <div style={{ display: 'flex', gap: 14, margin: '2px 0 8px', fontSize: '0.85rem', color: '#ccc', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="radio" checked={mode === 'refs'} onChange={() => setMode('refs')} />
                Style references — Veo repaints the world (up to 3)
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="radio" checked={mode === 'frames'} onChange={() => setMode('frames')} />
                Exact frames — image 1 = start, image 2 = end; Veo animates between
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8, maxHeight: 280, overflowY: 'auto', padding: 4, border: '1px solid #333', borderRadius: 8 }}>
              {images.map(img => {
                const idx = refs.indexOf(img.file);
                return (
                  <div key={img.file} style={{ position: 'relative' }}>
                    <img src={img.url} alt={img.file} title={img.file}
                         onClick={() => toggleRef(img.file)}
                         style={{ width: '100%', borderRadius: 4, cursor: 'pointer',
                                  outline: idx >= 0 ? '3px solid #8e6bf0' : '1px solid #444' }} />
                    {idx >= 0 && <span style={{ position: 'absolute', top: 4, left: 4, background: '#8e6bf0', color: '#fff',
                        borderRadius: '50%', width: 20, height: 20, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{idx + 1}</span>}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {comicId && (
          <>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', margin: '1rem 0 4px' }}>3 · Describe the clip</label>
            <textarea style={{ ...input, resize: 'vertical' }} rows={5} value={prompt} onChange={e => setPrompt(e.target.value)}
              placeholder="e.g. Slow cinematic push-in on the lone rider approaching the town of Santa Roja at dusk, hand-drawn western comic style matching the reference art, dust drifting, tense and quiet, no text on screen" />
            <input style={{ ...input, marginTop: 8 }} value={negativePrompt} onChange={e => setNegativePrompt(e.target.value)}
                   placeholder="Avoid (negative prompt) — e.g. speech bubbles, text, lettering, captions" />
            <div style={{ display: 'flex', gap: 12, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={model} onChange={e => setModel(e.target.value)} style={{ ...input, width: 220 }}>
                <option value="fast">Veo 3.1 Fast (default)</option>
                <option value="quality">Veo 3.1 Quality (slower, dearer)</option>
                <option value="lite">Veo 3.1 Lite (cheapest)</option>
              </select>
              <label style={{ fontSize: '0.8rem', color: '#888' }}>Length:</label>
              <select value={durationSeconds} onChange={e => setDurationSeconds(Number(e.target.value))} style={{ ...input, width: 90 }}>
                <option value={4}>4s</option>
                <option value={6}>6s</option>
                <option value={8}>8s</option>
              </select>
              <span style={{ color: '#888', fontSize: '0.8rem' }}>
                9:16 · total ≈ {(durationSeconds + (question ? questionSec : 0) + (endCard ? endSec : 0)).toFixed(1)}s
                {' '}({durationSeconds}s clip{question ? ` + ${questionSec}s question` : ''}{endCard ? ` + ${endSec}s logo` : ''}) · costs real money per run
              </span>
              <button className="btn btn-primary" disabled={busy || !prompt} onClick={generate} style={{ padding: '0.55rem 1.4rem' }}>
                {busy ? 'Generating… (1–4 min)' : '🎞 Generate clip'}
              </button>
            </div>
            {error && <p style={{ color: '#f88', fontSize: '0.85rem' }}>{error}</p>}

            <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', margin: '1.2rem 0 4px' }}>
              4 · Voice lines (optional) — the comic's own ElevenLabs audio, in order
            </label>
            <select value="" onChange={e => e.target.value && addVoice(e.target.value)} style={input}>
              <option value="">Add a line…</option>
              {voiceOptions.map((o, i) => <option key={i} value={o.file}>{o.label}</option>)}
            </select>
            {cast.length > 0 && (
              <div style={{ border: '1px solid #444', borderRadius: 8, padding: 10, marginTop: 10 }}>
                <div style={{ fontSize: '0.85rem', color: '#aaa', marginBottom: 6 }}>🎤 Speak a line — pick the Spanish voice; English always uses the house English voice</div>
                <select value={lineVoice} onChange={e => setLineVoice(e.target.value)} style={{ ...input, marginBottom: 6 }}>
                  {cast.map(v => <option key={v.voiceId} value={v.voiceId}>{v.name}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={input} placeholder="English line" value={lineEn} onChange={e => setLineEn(e.target.value)} />
                  <button className="btn btn-secondary" disabled={lineBusy !== '' || !lineEn} onClick={translateLine} style={{ padding: '0.3rem 0.8rem', whiteSpace: 'nowrap' }}>
                    {lineBusy === 'translate' ? '…' : '→ ES'}
                  </button>
                </div>
                <input style={{ ...input, marginTop: 6 }} placeholder="Spanish line (edit freely)" value={lineEs} onChange={e => setLineEs(e.target.value)} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select value={lineOrder} onChange={e => setLineOrder(e.target.value)} style={{ ...input, width: 200 }}>
                    <option value="en-es">English then Spanish</option>
                    <option value="es-en">Spanish then English</option>
                    <option value="es-only">Spanish only</option>
                    <option value="en-only">English only</option>
                  </select>
                  <button className="btn btn-primary" disabled={lineBusy !== '' || (!lineEn && !lineEs)} onClick={generateLines} style={{ padding: '0.35rem 1rem' }}>
                    {lineBusy === 'gen' ? 'Generating…' : 'Generate & add'}
                  </button>
                </div>
              </div>
            )}
            <label className="btn btn-secondary" style={{ display: 'inline-block', padding: '0.35rem 0.9rem', marginTop: 8, cursor: 'pointer', fontSize: '0.85rem' }}>
              🎵 Or upload audio
              <input type="file" accept=".mp3,.m4a,.wav,.aac,.ogg" style={{ display: 'none' }}
                onChange={async e => {
                  const f = e.target.files?.[0]; if (!f) return;
                  const fd = new FormData(); fd.append('comicId', comicId); fd.append('audio', f);
                  try {
                    const r = await api.post('/marketing/upload-audio', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                    setVoices(vs => [...vs, { file: r.data.file, label: `🎵 ${r.data.label}` }]);
                  } catch (err) { alert(err.response?.data?.error || err.message); }
                  e.target.value = '';
                }} />
            </label>
            {voices.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {voices.map((v, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', border: '1px solid #444', borderRadius: 8, padding: '4px 8px', fontSize: '0.85rem' }}>
                    <span style={{ color: '#888', width: 16 }}>{i + 1}</span>
                    <span style={{ flex: 1 }}>{v.label}</span>
                    <button className="btn btn-secondary" onClick={() => moveVoice(i, -1)} style={{ padding: '0.15rem 0.45rem' }}>↑</button>
                    <button className="btn btn-secondary" onClick={() => moveVoice(i, 1)} style={{ padding: '0.15rem 0.45rem' }}>↓</button>
                    <button className="btn btn-secondary" onClick={() => removeVoice(i)} style={{ padding: '0.15rem 0.45rem', color: '#f88' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', margin: '1rem 0 4px' }}>
              5 · Finish — question card + Comigo sign-off
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input style={input} placeholder="Question card (yellow) — leave empty to skip" value={question} onChange={e => setQuestion(e.target.value)} />
              <input type="number" min={0.5} max={10} step={0.5} value={questionSec} title="How long the question card shows"
                     onChange={e => setQuestionSec(Number(e.target.value) || 2)} style={{ ...input, width: 80 }} disabled={!question} />
              <span style={{ color: '#888', fontSize: '0.8rem' }}>s</span>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem', color: '#ccc', marginTop: 8 }}>
              <input type="checkbox" checked={endCard} onChange={e => setEndCard(e.target.checked)} />
              End with the Comigo logo card, shown for
              <input type="number" min={0.5} max={30} step={0.1} value={endSec} title="How long the logo card shows"
                     onChange={e => setEndSec(Number(e.target.value) || 1.8)} style={{ ...input, width: 80 }} disabled={!endCard} />
              <span style={{ color: '#888', fontSize: '0.8rem' }}>s</span>
            </label>
            <input style={{ ...input, marginTop: 6 }} disabled={!endCard} value={endMidCaption} onChange={e => setEndMidCaption(e.target.value)}
                   placeholder="Caption between the logo and comigo.net — shows the whole card (optional)" />
            <input style={{ ...input, marginTop: 6 }} disabled={!endCard} value={endCaption} onChange={e => setEndCaption(e.target.value)}
                   placeholder="Caption under comigo.net — appears only in the last 2s of the logo card (optional)" />
            <div style={{ display: 'flex', gap: 12, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontSize: '0.8rem', color: '#888' }}>Veo's own audio:</label>
              <select value={ambient} onChange={e => setAmbient(e.target.value)} style={{ ...input, width: 220 }}>
                <option value="keep">Keep as generated</option>
                <option value="duck">Duck under the voices</option>
                <option value="mute">Mute — voices only</option>
              </select>
              <label style={{ fontSize: '0.8rem', color: '#888' }}>Subtitles:</label>
              <select value={subtitles} onChange={e => setSubtitles(e.target.value)} style={{ ...input, width: 220 }}
                      title="Burned-in text synced to each voice line — e.g. English audio with Spanish subtitles, or the other way around">
                <option value="none">None</option>
                <option value="es">🇪🇸 Spanish</option>
                <option value="en">🇬🇧 English</option>
                <option value="match">Match the audio</option>
              </select>
              {clipFile && (
                <button className="btn btn-secondary" disabled={busy} onClick={remix} style={{ padding: '0.45rem 1rem' }}
                        title="Re-apply audio to the last generated clip without paying for a new generation">
                  {busy ? 'Mixing…' : '🔁 Apply audio to last clip'}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div>
        {clip ? (
          <>
            <video src={clip} controls playsInline style={{ width: '100%', borderRadius: 10, border: '1px solid #444', background: '#000' }} />
            <a className="btn btn-primary" href={clip} download style={{ display: 'inline-block', padding: '0.45rem 1.1rem', textDecoration: 'none', marginTop: 10 }}>⬇ Download</a>
          </>
        ) : (
          <div style={{ border: '2px dashed #444', borderRadius: 10, padding: '3rem 1rem', textAlign: 'center', color: '#777', fontSize: '0.9rem' }}>
            {busy ? 'Veo is working…' : 'Generated clip appears here'}<br />1080 × 1920 · 9:16
          </div>
        )}
      </div>
    </div>
  );
}

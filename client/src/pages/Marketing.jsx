import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

// Marketing hub: sub-tabs for content production. "Posters" is live (the
// canonical mini-movie-poster template); the other sub-tabs are placeholders
// for the content-generator phases to come.
export default function Marketing() {
  const navigate = useNavigate();
  const [tab, setTab] = useState(() => { const t = new URLSearchParams(window.location.search).get('tab'); return t === 'reels' ? 'clips' : (t || 'posters'); });

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
        <button className={`btn ${tab === 'motion' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTab('motion')} style={{ padding: '0.5rem 1.1rem' }}>
          🎬 Motion comic
        </button>
        <button className={`btn ${tab === 'artwork' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTab('artwork')} style={{ padding: '0.5rem 1.1rem' }}>
          🎨 Artwork
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
      {tab === 'artwork' && <Artwork />}
      {tab === 'motion' && <MotionComic />}
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
  const [slides, setSlides] = useState([{ imageFile: '', title: '', es: '', en: '', artPrompt: '', brightness: 1, saturation: 1, history: [] }]);
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
    setImages([]); setOut([]); setCaption(''); setSlides([{ imageFile: '', title: '', es: '', en: '', artPrompt: '', brightness: 1, saturation: 1, history: [] }]); setActive(0);
    if (!comicId) return;
    api.get(`/marketing/${comicId}/images`).then(r => setImages(r.data.images)).catch(e => alert(e.response?.data?.error || e.message));
  }, [comicId]);

  const upd = (i, k, v) => setSlides(ss => ss.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const addSlide = () => { setSlides(ss => [...ss, { imageFile: '', title: '', es: '', en: '', artPrompt: '', brightness: 1, saturation: 1, history: [] }]); setActive(slides.length); };
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
  // Image changes go through setImage so the old image lands on the slide's
  // history stack — the ↩ Revert button walks back through it.
  const setImage = (i, file) => setSlides(ss => ss.map((s, j) => j === i
    ? { ...s, imageFile: file, history: s.imageFile && s.imageFile !== file ? [...(s.history || []), s.imageFile] : (s.history || []) }
    : s));
  const revertImage = i => setSlides(ss => ss.map((s, j) => {
    if (j !== i) return s;
    const h = [...(s.history || [])];
    if (!h.length) return s;
    return { ...s, imageFile: h.pop(), history: h };
  }));
  const assignImage = file => setImage(active, slides[active]?.imageFile === file ? '' : file);

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
  const [viewer, setViewer] = useState(null); // url shown large in the popup
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
      setImage(i, r.data.file);
    } catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setGenBusy(-1); }
  };

  const [caption, setCaption] = useState('');
  const [captionBusy, setCaptionBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // Caption from the slides' own text — the swipe is the entertainment, the
  // caption carries the comic's name and the hashtags.
  const genCaption = async () => {
    setCaptionBusy(true);
    try {
      const r = await api.post('/marketing/carousel-caption', {
        comicId, slides: slides.map(s => ({ title: s.title, es: s.es, en: s.en })),
      });
      setCaption(r.data.caption || '');
    } catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setCaptionBusy(false); }
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

          <ExtraImages comicId={comicId} selected={[slides[active]?.imageFile]} onToggle={(t, u) => { setGenUrls(m => ({ ...m, [t]: u })); assignImage(t); }} />

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
                    <img src={genUrls[s.imageFile] || images.find(im => im.file === s.imageFile)?.url} alt="" title="Click to view large"
                         onClick={e => { e.stopPropagation(); setViewer({ url: genUrls[s.imageFile] || images.find(im => im.file === s.imageFile)?.url, filter: `brightness(${s.brightness ?? 1}) saturate(${s.saturation ?? 1})` }); }}
                         style={{ width: 46, height: 58, objectFit: 'cover', borderRadius: 4, border: '1px solid #555', flex: 'none', cursor: 'zoom-in',
                                  filter: `brightness(${s.brightness ?? 1}) saturate(${s.saturation ?? 1})` }} />
                  )}
                  <input style={input} value={s.artPrompt || ''} onChange={e => upd(i, 'artPrompt', e.target.value)}
                         placeholder="Or describe NEW art for this slide — the assigned image becomes the style/scene reference" />
                  <button className="btn btn-secondary" disabled={genBusy !== -1 || !s.artPrompt}
                          onClick={e => { e.stopPropagation(); genArt(i); }}
                          style={{ padding: '0.3rem 0.8rem', whiteSpace: 'nowrap' }}
                          title="Generates a new still with the comic image model (gpt-image-2), guided by the assigned reference image + this prompt">
                    {genBusy === i ? 'Painting…' : '🎨 Generate art'}
                  </button>
                  <label className="btn btn-secondary" onClick={e => e.stopPropagation()}
                         title="Upload your own image for this slide"
                         style={{ padding: '0.3rem 0.7rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    🖼 Upload
                    <input type="file" accept=".jpg,.jpeg,.png,.webp" style={{ display: 'none' }}
                      onChange={async e => {
                        const f = e.target.files?.[0]; if (!f) return;
                        const fd = new FormData(); fd.append('comicId', comicId); fd.append('image', f);
                        try {
                          const r = await api.post('/marketing/upload-image', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                          setGenUrls(m => ({ ...m, [r.data.file]: r.data.url }));
                          setImage(i, r.data.file);
                        } catch (err) { alert(err.response?.data?.error || err.message); }
                        e.target.value = '';
                      }} />
                  </label>
                  {(s.history || []).length > 0 && (
                    <button className="btn btn-secondary" onClick={e => { e.stopPropagation(); revertImage(i); }}
                            title={`Back to the previous image (${(s.history || []).length} step${(s.history || []).length > 1 ? 's' : ''} available)`}
                            style={{ padding: '0.3rem 0.7rem', whiteSpace: 'nowrap' }}>
                      ↩ Revert
                    </button>
                  )}
                </div>
                {s.imageFile && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', fontSize: '0.8rem', color: '#888' }}>
                    <span title="Brightness">☀</span>
                    <input type="range" min={0.5} max={1.8} step={0.05} value={s.brightness ?? 1}
                           onChange={e => upd(i, 'brightness', Number(e.target.value))} style={{ flex: 1 }} />
                    <span style={{ width: 36 }}>{(s.brightness ?? 1).toFixed(2)}</span>
                    <span title="Colour saturation">🎨</span>
                    <input type="range" min={0.3} max={1.8} step={0.05} value={s.saturation ?? 1}
                           onChange={e => upd(i, 'saturation', Number(e.target.value))} style={{ flex: 1 }} />
                    <span style={{ width: 36 }}>{(s.saturation ?? 1).toFixed(2)}</span>
                  </div>
                )}
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
                    <img src={u} alt={`slide ${i + 1}`} title="Click to view large" onClick={() => setViewer({ url: u })}
                         style={{ width: '100%', borderRadius: 8, border: '1px solid #444', cursor: 'zoom-in' }} />
                    <a className="btn btn-secondary" href={u} download style={{ display: 'inline-block', padding: '0.25rem 0.8rem', marginTop: 6, fontSize: '0.8rem', textDecoration: 'none' }}>
                      ⬇ Slide {i + 1}
                    </a>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-secondary" disabled={captionBusy} onClick={genCaption} style={{ padding: '0.45rem 1.1rem' }}
                        title="GPT writes the Instagram caption from the slides' text — comic name, house lines, hashtags">
                  {captionBusy ? 'Writing…' : '📝 Caption'}
                </button>
                {caption && (
                  <button className="btn btn-secondary" style={{ padding: '0.45rem 1rem' }}
                          onClick={() => { navigator.clipboard.writeText(caption); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                    {copied ? 'Copied ✓' : 'Copy caption'}
                  </button>
                )}
              </div>
              {caption && (
                <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={9}
                          style={{ ...input, marginTop: 8, maxWidth: 640, resize: 'vertical', fontFamily: 'inherit' }} />
              )}
            </>
          )}
        </>
      )}
      {viewer && (
        <div onClick={() => setViewer(null)}
             style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
          <img src={viewer.url} alt="" style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 8, boxShadow: '0 8px 40px rgba(0,0,0,0.8)', filter: viewer.filter || 'none' }} />
        </div>
      )}
    </div>
  );
}

// Style sheets, character/location references, and marketing images generated
// or uploaded so far — pickable in every sub-tab. Tokens: ref:/gen:/upload:.
function ExtraImages({ comicId, selected = [], onToggle, onDeleted, refreshKey = 0, title = 'Style sheets, characters, locations & generated art' }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    setData(null);
    if (!comicId) return;
    api.get(`/marketing/${comicId}/style-images`).then(r => setData(r.data)).catch(() => setData({ groups: [] }));
  }, [comicId, refreshKey]);
  if (!comicId || !data || !data.groups?.some(g => g.images.length)) return null;
  const sel = selected.filter(Boolean);
  const remove = async (img) => {
    if (!window.confirm(`Delete ${img.name}? This removes the file.`)) return;
    try {
      await api.delete(`/marketing/${comicId}/image`, { data: { file: img.file } });
      setData(d => ({ groups: d.groups.map(g => ({ ...g, images: g.images.filter(i => i.file !== img.file) })) }));
      onDeleted && onDeleted(img.file);
    } catch (e) { alert(e.response?.data?.error || e.message); }
  };
  return (
    <div style={{ marginTop: 10 }}>
      <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: 4 }}>{title}</label>
      {data.groups.filter(g => g.images.length > 0).map(g => (
        <div key={g.kind} style={{ marginBottom: 6 }}>
          <div style={{ fontSize: '0.75rem', color: '#777', margin: '4px 0 3px' }}>{g.label} ({g.images.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 6, maxHeight: 190, overflowY: 'auto', padding: 4, border: '1px solid #333', borderRadius: 8 }}>
            {g.images.map(img => {
              const idx = sel.indexOf(img.file);
              return (
                <div key={img.file} style={{ position: 'relative' }}>
                  <img src={img.url} alt={img.name} title={img.name} loading="lazy"
                       onClick={() => onToggle(img.file, img.url)}
                       style={{ width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: 4, cursor: 'pointer',
                                outline: idx >= 0 ? '3px solid #8e6bf0' : '1px solid #444' }} />
                  {idx >= 0 && <span style={{ position: 'absolute', top: 4, left: 4, background: '#8e6bf0', color: '#fff',
                      borderRadius: '50%', width: 20, height: 20, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{sel.length > 1 ? idx + 1 : '✓'}</span>}
                  {(g.kind === 'generated' || g.kind === 'uploads') && (
                    <button onClick={(e) => { e.stopPropagation(); remove(img); }} title="Delete this image"
                            style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.7)', color: '#f88', fontSize: 12, cursor: 'pointer', lineHeight: '20px', padding: 0 }}>✕</button>
                  )}
                  <div style={{ fontSize: '0.65rem', color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{img.name}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// Artwork: the panel generator's toolset for marketing stills — generate from
// style/character/location/page references, MODIFY an image with a prompt,
// INPAINT a dragged region — with the provider and quality chosen per run.
// Everything produced is kept in the comic's marketing folder and shows up in
// the Posters / Reels / Carousels pickers.
function Artwork() {
  const [comics, setComics] = useState([]);
  const [comicId, setComicId] = useState('');
  const [images, setImages] = useState([]);
  const [refs, setRefs] = useState([]);
  const [refUrls, setRefUrls] = useState({});
  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState('openai');
  const [quality, setQuality] = useState('high');
  const [aspect, setAspect] = useState('portrait');
  const [busy, setBusy] = useState('');
  const [work, setWork] = useState(null);          // { url, path, file } — the image being edited
  const [history, setHistory] = useState([]);      // previous `work`s (undo)
  const [results, setResults] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [viewer, setViewer] = useState(null);
  const [inpaintOn, setInpaintOn] = useState(false);
  const [rect, setRect] = useState(null);
  const [drag, setDrag] = useState(null);
  const [inpaintPrompt, setInpaintPrompt] = useState('');
  const [settings, setSettings] = useState(null);   // the comic's prompt settings (style bible etc.)
  const [useBible, setUseBible] = useState(true);

  useEffect(() => {
    api.get('/comics').then(r => setComics(Array.isArray(r.data) ? r.data : r.data.comics || []));
  }, []);
  useEffect(() => {
    setImages([]); setRefs([]); setRefUrls({}); setResults([]); setWork(null); setHistory([]); setRect(null); setInpaintOn(false); setSettings(null);
    if (!comicId) return;
    api.get(`/marketing/${comicId}/images`).then(r => setImages(r.data.images)).catch(() => setImages([]));
    api.get(`/comics/${comicId}/prompt-settings`).then(r => setSettings(r.data.promptSettings || {})).catch(() => setSettings({}));
  }, [comicId]);

  // The panel generator never sends a bare prompt: it wraps the scene in the
  // comic's STYLE BIBLE, the descriptions of the selected style/character
  // references, camera + inks and the do-nots, and always attaches the master
  // style image first. Without that wrapping the image model paints photos.
  const clip = t => { const x = String(t || '').trim(); return x.length > 700 ? x.slice(0, 700) + '…' : x; };
  const masterPath = () => (useBible && settings?.masterStyleImage) ? settings.masterStyleImage : '';
  // Style refs (master style image + style-bible/location sheets) are "match the
  // technique, don't copy the content". Everything else — character sheets,
  // pages, panels, earlier generations, uploads — goes as CONTINUITY refs, whose
  // subjects must appear exactly as drawn. That split is what the panel
  // generator does; sending everything as style refs told the model NOT to
  // reproduce the robot it was being asked to draw.
  const splitRefs = (extraContinuity = []) => {
    const stylePaths = new Set((settings?.styleBibleImages || []).map(i => i.image));
    const style = [], continuity = [...extraContinuity];
    for (const t of refs) {
      const pth = pathOf(t); if (!pth || continuity.includes(pth)) continue;
      (t.startsWith('ref:') && stylePaths.has(pth) ? style : continuity).push(pth);
    }
    const m = masterPath();
    if (m && !style.includes(m) && !continuity.includes(m)) style.unshift(m);
    return { style, continuity };
  };
  const styledPrompt = (content, { modify = false } = {}) => {
    if (!useBible || !settings) return content;
    let out = '';
    if (settings.styleBible) out += `🎨 STYLE BIBLE\n${settings.styleBible}\n\n`;
    const paths = refs.map(pathOf);
    const styleImgs = (settings.styleBibleImages || []).filter(i => paths.includes(i.image));
    if (styleImgs.length) {
      out += `🎨 STYLE REFERENCE DESCRIPTIONS\n`;
      styleImgs.forEach((i, k) => { out += `\nStyle Reference ${k + 1} (${i.name || 'style'}):\n${clip(i.description)}\n`; });
      out += '\n';
    }
    if (settings.cameraInks) out += `CAMERA + INKS\n${settings.cameraInks}\n\n`;
    const chars = (settings.characters || []).filter(c => paths.includes(c.image));
    if (chars.length) {
      out += `CHARACTER BIBLE (MAINTAIN CONSISTENCY)\n`;
      chars.forEach(c => { out += `\nCharacter: ${c.name}\n${clip(c.description)}\n`; });
      out += '\n';
    }
    if (settings.globalDoNot) out += `GLOBAL DO NOT\n${settings.globalDoNot}\n\n`;
    if (settings.hardNegatives) out += `HARD NEGATIVES\n${settings.hardNegatives}\n\n`;
    out += `SINGLE PANEL IMAGE\n\nThis is a standalone MARKETING illustration for the comic, drawn in exactly the comic's style above. Full-bleed: the artwork must FILL THE ENTIRE FRAME edge to edge, with no borders, frames, panel gutters or empty space.\n\n`;
    out += modify
      ? `Panel Content (MODIFY the first attached image as described — keep its composition, characters, colours and drawing style exactly as they are apart from this change):\n${content}\n\n`
      : `Panel Content (THE IMAGE TO DRAW — this OVERRIDES any locations or scenes mentioned in the style/character sections above; those are style and lore reference only):\n${content}\n\nIMPORTANT: EVERY character, person, animal and action listed above MUST be clearly VISIBLE in the image.\n\n`;
    out += `No text, lettering, captions or speech bubbles unless the content asks for them.`;
    return out;
  };

  // Token -> server path (what the image routes take as referenceImages).
  const pathOf = token => {
    if (!token) return '';
    if (token.startsWith('ref:')) return token.slice(4);
    if (token.startsWith('gen:')) return `/projects/${comicId}/marketing/${token.slice(4)}`;
    if (token.startsWith('upload:')) return `/projects/${comicId}/marketing/uploads/${token.slice(7)}`;
    return images.find(im => im.file === token)?.url || '';
  };
  const urlOf = token => refUrls[token] || pathOf(token);
  const parse = r => (typeof r.data === 'string' ? JSON.parse(r.data.trim()) : r.data);

  const toggle = (token, url) => {
    if (refs.includes(token)) setRefs(refs.filter(t => t !== token));
    else if (refs.length < 3) { setRefs([...refs, token]); if (url) setRefUrls(m => ({ ...m, [token]: url })); }
    else alert('Up to 3 reference images');
  };
  const openInWorkspace = (token, url) => {
    if (work) setHistory(h => [...h, work]);
    setWork({ url: url || urlOf(token), path: pathOf(token), file: token });
    setRect(null);
    setInpaintOn(false);
  };
  const deleteImage = async (file) => {
    if (!file || !(file.startsWith('gen:') || file.startsWith('upload:'))) return;
    if (!window.confirm('Delete this image? This removes the file.')) return;
    try {
      await api.delete(`/marketing/${comicId}/image`, { data: { file } });
      forget(file);
      setRefreshKey(x => x + 1);
    } catch (e) { alert(e.response?.data?.error || e.message); }
  };
  // Drop every local trace of a deleted image.
  const forget = (file) => {
    setResults(rs => rs.filter(r => r.file !== file));
    setRefs(rs => rs.filter(t => t !== file));
    setHistory(h => h.filter(w => w.file !== file));
    setWork(w => (w?.file === file ? null : w));
  };
  // Persist a fresh output into the comic's marketing folder, then make it the workspace image.
  const keep = async (outPath, note) => {
    const k = await api.post('/marketing/keep-image', { comicId, path: outPath });
    const item = { url: k.data.url, path: k.data.url, file: k.data.file, note };
    setResults(rs => [item, ...rs]);
    setRefreshKey(x => x + 1);
    if (work) setHistory(h => [...h, work]);
    setWork(item);
    setRect(null);
    return item;
  };

  const generate = async () => {
    setBusy('generate');
    try {
      const { style, continuity } = splitRefs();
      const r = await api.post('/images/generate-panel', {
        prompt: styledPrompt(prompt), panelContent: prompt, panelId: `marketing-${Date.now()}`,
        provider, aspectRatio: aspect, openaiQuality: quality, hasMasterStyleImage: !!masterPath(),
        referenceImages: style, linkedPanelImages: continuity,
      }, { timeout: 600000 });
      const d = parse(r); if (d.error) throw new Error(d.error);
      await keep(d.path, prompt);
    } catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setBusy(''); }
  };
  const modify = async () => {
    if (!work) return;
    setBusy('modify');
    try {
      // The image being modified is continuity reference #1 (attached first).
      const { style, continuity } = splitRefs([work.path]);
      const r = await api.post('/images/generate-panel', {
        prompt: styledPrompt(prompt, { modify: true }), panelContent: `Modify the first attached image: ${prompt}`, panelId: `marketing-${Date.now()}`,
        provider, aspectRatio: aspect, openaiQuality: quality, hasMasterStyleImage: !!masterPath(),
        referenceImages: style, linkedPanelImages: continuity,
      }, { timeout: 600000 });
      const d = parse(r); if (d.error) throw new Error(d.error);
      await keep(d.path, `modify: ${prompt}`);
    } catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setBusy(''); }
  };
  const inpaint = async () => {
    if (!work || !rect || rect.width < 0.02 || rect.height < 0.02 || !inpaintPrompt.trim()) return;
    setBusy('inpaint');
    try {
      const styleLine = (useBible && settings?.styleBible) ? `Match the comic's drawing style exactly (${clip(settings.styleBible).slice(0, 300)}). ` : '';
      const r = await api.post('/images/inpaint-region', {
        sourceImagePath: work.path, rect, prompt: styleLine + inpaintPrompt, panelId: 'marketing',
        referenceImages: [...splitRefs().continuity, ...splitRefs().style], provider, openaiQuality: quality,
      }, { timeout: 600000 });
      const d = parse(r); if (d.error) throw new Error(d.error);
      await keep(d.path, `inpaint: ${inpaintPrompt}`);
      setInpaintPrompt('');
    } catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setBusy(''); }
  };
  const undo = () => { setHistory(h => { if (!h.length) return h; const prev = h[h.length - 1]; setWork(prev); setRect(null); return h.slice(0, -1); }); };

  const norm = (e, el) => { const b = el.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)), y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)) }; };
  const input = { width: '100%', padding: '0.5rem 0.7rem', borderRadius: 6, border: '1px solid #555', background: '#1a1332', color: '#e9e4ff', fontSize: '0.95rem' };
  const small = { padding: '0.3rem 0.7rem', fontSize: '0.8rem' };

  return (
    <div>
      <p style={{ color: '#888', fontSize: '0.88rem', marginTop: 0 }}>
        The panel generator's tools, for marketing stills. Pick references (style sheets, characters, locations, pages,
        earlier generations), then <strong>Generate</strong> a new image, <strong>Modify</strong> the image in the workspace
        with a prompt, or <strong>Inpaint</strong> a dragged region. Every result is kept with the comic and offered in
        Posters, Reels and Carousels.
      </p>
      <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: 4 }}>1 · Comic</label>
      <select value={comicId} onChange={e => setComicId(e.target.value)} style={{ ...input, maxWidth: 420 }}>
        <option value="">Choose a comic…</option>
        {comics.map(c => <option key={c.id} value={c.id}>{c.title}{c.collectionTitle ? ` — ${c.collectionTitle}` : ''}</option>)}
      </select>

      {comicId && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: '1.5rem', alignItems: 'start', marginTop: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', margin: '0 0 4px' }}>
              2 · References ({refs.length}/3) — click to select as a reference; ✎ opens an image in the workspace
            </label>
            <ExtraImages comicId={comicId} selected={refs} onToggle={toggle} onDeleted={forget} refreshKey={refreshKey} title="" />
            {images.length > 0 && (
              <>
                <div style={{ fontSize: '0.75rem', color: '#777', margin: '6px 0 3px' }}>Pages & panels ({images.length})</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 6, maxHeight: 190, overflowY: 'auto', padding: 4, border: '1px solid #333', borderRadius: 8 }}>
                  {images.map(img => {
                    const idx = refs.indexOf(img.file);
                    return (
                      <div key={img.file} style={{ position: 'relative' }}>
                        <img src={img.url} alt={img.file} title={img.file} loading="lazy" onClick={() => toggle(img.file, img.url)}
                             style={{ width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: 4, cursor: 'pointer', outline: idx >= 0 ? '3px solid #8e6bf0' : '1px solid #444' }} />
                        {idx >= 0 && <span style={{ position: 'absolute', top: 4, left: 4, background: '#8e6bf0', color: '#fff', borderRadius: '50%', width: 20, height: 20, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{idx + 1}</span>}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {refs.length > 0 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{ color: '#aaa', fontSize: '0.85rem' }}>Selected:</span>
                {refs.map((t, i) => (
                  <div key={t} style={{ display: 'flex', gap: 6, alignItems: 'center', border: '1px solid #444', borderRadius: 8, padding: '3px 6px', fontSize: '0.8rem' }}>
                    <span style={{ background: '#8e6bf0', color: '#fff', borderRadius: '50%', width: 18, height: 18, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                    {urlOf(t) && <img src={urlOf(t)} alt="" style={{ width: 36, height: 48, objectFit: 'cover', borderRadius: 3 }} />}
                    <button className="btn btn-secondary" onClick={() => openInWorkspace(t)} style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem' }} title="Open in the workspace (right) to modify or inpaint">✎ Edit</button>
                    <button className="btn btn-secondary" onClick={() => toggle(t)} style={{ padding: '0.1rem 0.4rem', color: '#f88' }}>✕</button>
                  </div>
                ))}
              </div>
            )}

            <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', margin: '1rem 0 4px' }}>3 · Prompt</label>
            <textarea style={{ ...input, resize: 'vertical' }} rows={3} value={prompt} onChange={e => setPrompt(e.target.value)}
                      placeholder="Generate: describe the new image.  Modify: describe the change to the workspace image (e.g. 'make it night, lamp lit, rain')." />
            <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={provider} onChange={e => setProvider(e.target.value)} style={{ ...input, width: 170 }} title="Which image model">
                <option value="openai">ChatGPT (gpt-image-2)</option>
                <option value="gemini">Gemini</option>
              </select>
              {provider === 'openai' && (
                <select value={quality} onChange={e => setQuality(e.target.value)} style={{ ...input, width: 150 }} title="ChatGPT quality">
                  <option value="high">High (slow)</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low (fast)</option>
                </select>
              )}
              <select value={aspect} onChange={e => setAspect(e.target.value)} style={{ ...input, width: 150 }}>
                <option value="portrait">Portrait</option>
                <option value="square">Square</option>
                <option value="landscape">Landscape</option>
              </select>
              <button className="btn btn-primary" disabled={!!busy || !prompt} onClick={generate} style={{ padding: '0.5rem 1.2rem' }}>
                {busy === 'generate' ? 'Painting…' : '🎨 Generate'}
              </button>
              <button className="btn btn-secondary" disabled={!!busy || !prompt || !work} onClick={modify} style={{ padding: '0.5rem 1.2rem' }}
                      title={work ? 'Re-render the workspace image with this change' : 'Open an image in the workspace first (✎)'}>
                {busy === 'modify' ? 'Modifying…' : '✎ Modify workspace image'}
              </button>
              <span style={{ color: '#888', fontSize: '0.8rem' }}>costs real money per run</span>
            </div>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, fontSize: '0.82rem', color: settings?.styleBible ? '#9fd' : '#e67e22' }}
                   title="Wraps your prompt in the comic's style bible, camera & inks, character/location descriptions and do-nots, and attaches the master style image first — exactly what the panel generator does">
              <input type="checkbox" checked={useBible} onChange={e => setUseBible(e.target.checked)} />
              {settings === null ? 'Loading comic style…'
                : settings.styleBible ? `Comic style bible applied (${settings.styleBible.length} chars${settings.masterStyleImage ? ', master style image attached' : ''}). Style sheets steer the look; characters, pages and generated images are drawn as-is.`
                : 'This comic has no style bible in its prompt settings — results will drift towards photos'}
            </label>

            {results.length > 0 && (
              <>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', margin: '1.2rem 0 4px' }}>Results this session — newest first</label>
                <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: 4 }}>
                  {results.map(r => (
                    <div key={r.file} style={{ flex: '0 0 170px', textAlign: 'center' }}>
                      <img src={r.url} alt="" title={r.note} onClick={() => setViewer(r.url)} style={{ width: '100%', borderRadius: 8, border: work?.file === r.file ? '2px solid #8e6bf0' : '1px solid #444', cursor: 'zoom-in' }} />
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginTop: 6 }}>
                        <button className="btn btn-secondary" onClick={() => openInWorkspace(r.file, r.url)} style={small} title="Open in the workspace (right) to modify or inpaint">✎ Edit</button>
                        <button className="btn btn-secondary" onClick={() => toggle(r.file, r.url)} style={small} title="Use as a reference">↩ ref</button>
                        <a className="btn btn-secondary" href={r.url} download style={{ ...small, textDecoration: 'none' }}>⬇</a>
                        <button className="btn btn-secondary" onClick={() => deleteImage(r.file)} style={{ ...small, color: '#f88' }} title="Delete this image">🗑</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Workspace */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: '0.85rem', color: '#aaa' }}>Workspace</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-secondary" disabled={!history.length || !!busy} onClick={undo} style={small} title="Back to the previous image">↶ Undo</button>
                <button className={`btn ${inpaintOn ? 'btn-primary' : 'btn-secondary'}`} disabled={!work || !!busy} onClick={() => { setInpaintOn(v => !v); setRect(null); }} style={small}
                        title="Drag a rectangle on the image, describe what should be there, and only that region is repainted">
                  🖌 Inpaint
                </button>
              </div>
            </div>
            {work ? (
              <div style={{ position: 'relative', userSelect: 'none' }}>
                <img src={work.url} alt="" draggable={false}
                     onClick={() => { if (!inpaintOn) setViewer(work.url); }}
                     onMouseDown={inpaintOn ? e => { const p = norm(e, e.currentTarget); setDrag(p); setRect({ x: p.x, y: p.y, width: 0, height: 0 }); } : undefined}
                     onMouseMove={inpaintOn && drag ? e => { const p = norm(e, e.currentTarget); setRect({ x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), width: Math.abs(p.x - drag.x), height: Math.abs(p.y - drag.y) }); } : undefined}
                     onMouseUp={inpaintOn ? () => setDrag(null) : undefined}
                     onMouseLeave={inpaintOn ? () => setDrag(null) : undefined}
                     style={{ width: '100%', borderRadius: 10, border: '1px solid #444', cursor: inpaintOn ? 'crosshair' : 'zoom-in', display: 'block' }} />
                {inpaintOn && rect && rect.width > 0 && (
                  <div style={{ position: 'absolute', left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`,
                                border: '2px dashed #FFD23F', background: 'rgba(255,210,63,0.15)', pointerEvents: 'none', borderRadius: 4 }} />
                )}
              </div>
            ) : (
              <div style={{ border: '2px dashed #444', borderRadius: 10, padding: '3rem 1rem', textAlign: 'center', color: '#777', fontSize: '0.9rem' }}>
                Nothing in the workspace yet.<br />Generate an image, or press ✎ on a reference or result.
              </div>
            )}
            {work && inpaintOn && (
              <div style={{ marginTop: 8 }}>
                <input style={input} value={inpaintPrompt} onChange={e => setInpaintPrompt(e.target.value)}
                       onKeyDown={e => { if (e.key === 'Enter') inpaint(); }}
                       placeholder={rect && rect.width > 0.02 ? 'What should be in the selected region?' : 'Drag a rectangle on the image first'} />
                <button className="btn btn-primary" disabled={!!busy || !rect || rect.width < 0.02 || rect.height < 0.02 || !inpaintPrompt.trim()} onClick={inpaint} style={{ ...small, marginTop: 6 }}>
                  {busy === 'inpaint' ? 'Repainting region…' : '🖌 Repaint region'}
                </button>
              </div>
            )}
            {work && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <a className="btn btn-secondary" href={work.url} download style={{ ...small, textDecoration: 'none' }}>⬇ Download</a>
                <button className="btn btn-secondary" onClick={() => toggle(work.file, work.url)} style={small}>↩ Use as reference</button>
                {(work.file?.startsWith('gen:') || work.file?.startsWith('upload:')) && (
                  <button className="btn btn-secondary" onClick={() => deleteImage(work.file)} style={{ ...small, color: '#f88' }}>🗑 Delete</button>
                )}
                <span style={{ color: '#777', fontSize: '0.75rem', alignSelf: 'center' }}>{work.file?.startsWith('gen:') ? 'kept in this comic’s marketing images' : ''}</span>
              </div>
            )}
          </div>
        </div>
      )}
      {viewer && (
        <div onClick={() => setViewer(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
          <img src={viewer} alt="" style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 8, boxShadow: '0 8px 40px rgba(0,0,0,0.8)' }} />
        </div>
      )}
    </div>
  );
}

// Motion comic: finished art + camera moves + atmosphere + real voice lines.
// Nothing is regenerated — the viewer never wonders if the movement is AI.
function MotionComic() {
  const [comics, setComics] = useState([]);
  const [comicId, setComicId] = useState('');
  const [images, setImages] = useState([]);
  const [audios, setAudios] = useState([]);
  const [shots, setShots] = useState([]);              // [{ id, imageFile, url, move, seconds, voiceFile }]
  const [extraUrls, setExtraUrls] = useState({});
  const [subtitles, setSubtitles] = useState('es');
  const [fx, setFx] = useState({ dust: true, flicker: false, vignette: true, grain: false });
  const [volume, setVolume] = useState(130);   // loudness of the voice lines, % (ElevenLabs lines are on the quiet side)
  const [openingLine1, setOpeningLine1] = useState('');
  const [openingLine2, setOpeningLine2] = useState('');
  const [openingSec, setOpeningSec] = useState(2);
  const [openingHold, setOpeningHold] = useState(0);
  const [openingAnim, setOpeningAnim] = useState(OPENING_ANIM_DEFAULT);
  const [question, setQuestion] = useState('');
  const [questionSec, setQuestionSec] = useState(2);
  const [endCard, setEndCard] = useState(true);
  const [endSec, setEndSec] = useState(1.8);
  const [coversCard, setCoversCard] = useState(false);
  const [coversSec, setCoversSec] = useState(3.5);
  const [endMidCaption, setEndMidCaption] = useState('');
  const [endCaption, setEndCaption] = useState('');
  const [endAnim, setEndAnim] = useState(END_ANIM_DEFAULT);
  const [busy, setBusy] = useState(false);
  const [clip, setClip] = useState(null);
  const [clipFile, setClipFile] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { api.get('/comics').then(r => setComics(Array.isArray(r.data) ? r.data : r.data.comics || [])); }, []);
  useEffect(() => {
    setImages([]); setAudios([]); setShots([]); setClip(null); setError('');
    if (!comicId) return;
    api.get(`/marketing/${comicId}/images`).then(r => setImages(r.data.images)).catch(() => setImages([]));
    api.get(`/marketing/${comicId}/audios`).then(r => setAudios(r.data.audios)).catch(() => setAudios([]));
  }, [comicId]);

  const voiceOptions = audios.flatMap(a => [
    { file: a.file, lang: 'es', es: a.text, en: a.translation || '', label: `🇪🇸 p${a.page} · ${a.text}` },
    ...(a.translationFile ? [{ file: a.translationFile, lang: 'en', es: a.text, en: a.translation || a.text, label: `🇬🇧 p${a.page} · ${a.translation || a.text}` }] : []),
  ]);
  const addShot = (imageFile, url) => {
    if (shots.length >= 10) return alert('Max 10 shots');
    // Full pages default to "fit" (whole page visible over a blurred copy);
    // panels and stills default to "fill" (cover-crop to 9:16).
    const isPanel = /_s\d+/.test(imageFile) || /^(gen|upload|ref):/.test(imageFile);
    setShots(ss => [...ss, { id: `${Date.now()}-${ss.length}`, imageFile, url, move: ['in', 'out', 'left', 'right', 'drift'][ss.length % 5], seconds: 3, voiceFile: '', fit: isPanel ? 'fill' : 'fit' }]);
  };
  const upd = (id, k, v) => setShots(ss => ss.map(sh => (sh.id === id ? { ...sh, [k]: v } : sh)));
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= shots.length) return; setShots(ss => { const n = [...ss]; [n[i], n[j]] = [n[j], n[i]]; return n; }); };
  const total = shots.reduce((t, sh) => t + (Number(sh.seconds) || 3), 0) + ((openingLine1 || openingLine2) ? openingSec : 0) + (question ? questionSec : 0) + (endCard ? endSec : 0);

  const render = async () => {
    setBusy(true); setError(''); setClip(null);
    try {
      const r = await api.post('/marketing/motion-comic', {
        comicId, subtitles, fx, volume,
        shots: shots.map(sh => { const v = voiceOptions.find(o => o.file === sh.voiceFile); return { imageFile: sh.imageFile, move: sh.move, fit: sh.fit, seconds: Number(sh.seconds) || 3, ...(v ? { voice: { file: v.file, es: v.es, en: v.en, lang: v.lang } } : {}) }; }),
        openingLine1, openingLine2, openingSeconds: openingSec, openingHold, question, questionSeconds: questionSec, endCard, endCardSeconds: endSec, endCardMidCaption: endMidCaption, endCardCaption: endCaption,
        endAnim: endAnimFor(endAnim, endSec), coversCard, coversSeconds: coversSec, openingAnim,
      }, { timeout: 600000 });
      setClip(r.data.url); setClipFile(r.data.file);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };
  const input = { width: '100%', padding: '0.5rem 0.7rem', borderRadius: 6, border: '1px solid #555', background: '#1a1332', color: '#e9e4ff', fontSize: '0.95rem' };
  const MOVES = [['in', 'Push in'], ['out', 'Pull out'], ['left', 'Pan left'], ['right', 'Pan right'], ['up', 'Tilt up'], ['down', 'Tilt down'], ['drift', 'Drift'], ['still', 'Hold']];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: '1.5rem', alignItems: 'start' }}>
      <div>
        <p style={{ color: '#888', fontSize: '0.88rem', marginTop: 0 }}>
          A motion comic: your finished art, untouched. Each shot is a still with a slow camera move while its real voice line
          plays, with optional dust, flicker, vignette and grain laid over. No AI video — nothing morphs.
          For a reel where the page's own speech bubbles pop in one by one with their audio, build a <strong>Story reel</strong> in the comic editor's Challenge Reels tab and finish it here.
        </p>
        <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: 4 }}>1 · Comic</label>
        <select value={comicId} onChange={e => setComicId(e.target.value)} style={{ ...input, maxWidth: 420 }}>
          <option value="">Choose a comic…</option>
          {comics.map(c => <option key={c.id} value={c.id}>{c.title}{c.collectionTitle ? ` — ${c.collectionTitle}` : ''}</option>)}
        </select>

        {comicId && (
          <>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', margin: '1rem 0 4px' }}>
              2 · Click images to add shots, in order ({shots.length}/10). Panels and generated stills work best; "no_text" versions if you'll add subtitles.
            </label>
            {images.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 6, maxHeight: 220, overflowY: 'auto', padding: 4, border: '1px solid #333', borderRadius: 8 }}>
                {images.map(img => (
                  <img key={img.file} src={img.url} alt={img.file} title={img.file} loading="lazy" onClick={() => addShot(img.file, img.url)}
                       style={{ width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: '1px solid #444' }} />
                ))}
              </div>
            )}
            <ExtraImages comicId={comicId} selected={[]} onToggle={(t, u) => { setExtraUrls(m => ({ ...m, [t]: u })); addShot(t, u); }} />

            {shots.length > 0 && (
              <>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', margin: '1rem 0 4px' }}>3 · Shots</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {shots.map((sh, i) => (
                    <div key={sh.id} style={{ display: 'grid', gridTemplateColumns: '54px 1fr', gap: 10, border: '1px solid #444', borderRadius: 10, padding: 8, alignItems: 'center' }}>
                      <img src={sh.url || extraUrls[sh.imageFile]} alt="" style={{ width: 54, height: 72, objectFit: 'cover', borderRadius: 4 }} />
                      <div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <strong style={{ color: '#c9bfff', fontSize: '0.85rem' }}>Shot {i + 1}</strong>
                          <select value={sh.move} onChange={e => upd(sh.id, 'move', e.target.value)} style={{ ...input, width: 130, padding: '0.3rem 0.5rem' }}>
                            {MOVES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                          <select value={sh.fit || 'fill'} onChange={e => upd(sh.id, 'fit', e.target.value)} style={{ ...input, width: 150, padding: '0.3rem 0.5rem' }}
                                  title="Fill: cover-crop to 9:16 (panels). Fit: the whole image, centred over a blurred copy (full pages, landscape art)">
                            <option value="fill">Fill frame (crop)</option>
                            <option value="fit">Fit whole image</option>
                          </select>
                          <input type="number" min={1.5} max={15} step={0.5} value={sh.seconds} onChange={e => upd(sh.id, 'seconds', Number(e.target.value) || 3)} style={{ ...input, width: 70, padding: '0.3rem 0.5rem' }} title="Seconds (a voice line extends it if longer)" />
                          <span style={{ color: '#888', fontSize: '0.8rem' }}>s</span>
                          <span style={{ flex: 1 }} />
                          <button className="btn btn-secondary" onClick={() => move(i, -1)} style={{ padding: '0.15rem 0.45rem' }}>↑</button>
                          <button className="btn btn-secondary" onClick={() => move(i, 1)} style={{ padding: '0.15rem 0.45rem' }}>↓</button>
                          <button className="btn btn-secondary" onClick={() => setShots(ss => ss.filter(x => x.id !== sh.id))} style={{ padding: '0.15rem 0.45rem', color: '#f88' }}>✕</button>
                        </div>
                        <select value={sh.voiceFile} onChange={e => upd(sh.id, 'voiceFile', e.target.value)} style={{ ...input, marginTop: 6, padding: '0.3rem 0.5rem' }}>
                          <option value="">No voice line — silent shot</option>
                          {voiceOptions.map((o, k) => <option key={k} value={o.file}>{o.label}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 14, marginTop: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85rem', color: '#ccc' }}>
                  <span style={{ color: '#888' }}>Subtitles:</span>
                  <select value={subtitles} onChange={e => setSubtitles(e.target.value)} style={{ ...input, width: 170 }}>
                    <option value="none">None</option>
                    <option value="es">🇪🇸 Spanish</option>
                    <option value="en">🇬🇧 English</option>
                    <option value="match">Match the audio</option>
                  </select>
                  <span style={{ color: '#888' }}>Atmosphere:</span>
                  {[['dust', '✨ Dust'], ['flicker', '🔆 Light flicker'], ['vignette', '🌑 Vignette'], ['grain', '🎞 Grain']].map(([k, l]) => (
                    <label key={k} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input type="checkbox" checked={!!fx[k]} onChange={e => setFx(f => ({ ...f, [k]: e.target.checked }))} /> {l}
                    </label>
                  ))}
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center' }} title="Loudness of the voice lines: 100 = as recorded; boosted audio is limited so it never clips">
                    <span style={{ color: '#888' }}>Volume:</span>
                    <input type="range" min={30} max={300} step={10} value={volume} onChange={e => setVolume(Number(e.target.value))} style={{ width: 120 }} />
                    <input type="number" min={30} max={300} step={10} value={volume} onChange={e => setVolume(Math.min(300, Math.max(30, Number(e.target.value) || 100)))} style={{ ...input, width: 70 }} /> %
                  </label>
                </div>

                <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', margin: '1rem 0 4px' }}>4 · Finish — opening card, question card + Comigo sign-off</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <input style={input} placeholder="Opening card line 1 (white) — empty for none" value={openingLine1} onChange={e => setOpeningLine1(e.target.value)} />
                  <input style={input} placeholder="Opening card line 2 (yellow)" value={openingLine2} onChange={e => setOpeningLine2(e.target.value)} />
                  <input type="number" min={0.5} max={10} step={0.5} value={openingSec} onChange={e => setOpeningSec(Number(e.target.value) || 2)} style={{ ...input, width: 80 }} disabled={!openingLine1 && !openingLine2} />
                  <span style={{ color: '#888', fontSize: '0.8rem' }}>s</span>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.8rem', color: '#aaa', whiteSpace: 'nowrap' }} title="Pause on the finished card after its animation, so the caption can be read (the card then lasts animation + this)">then hold
                    <input type="number" min={0} max={15} step={0.5} value={openingHold} onChange={e => setOpeningHold(Number(e.target.value) || 0)} style={{ ...input, width: 70 }} /> s</label>
                </div>
                {(openingLine1 || openingLine2) && <OpeningCardAnim value={openingAnim} onChange={setOpeningAnim} secs={openingSec} />}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input style={input} placeholder="Question card (yellow) — empty to skip" value={question} onChange={e => setQuestion(e.target.value)} />
                  <input type="number" min={0.5} max={10} step={0.5} value={questionSec} onChange={e => setQuestionSec(Number(e.target.value) || 2)} style={{ ...input, width: 80 }} disabled={!question} />
                  <span style={{ color: '#888', fontSize: '0.8rem' }}>s</span>
                </div>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem', color: '#ccc', marginTop: 8 }}>
                  <input type="checkbox" checked={endCard} onChange={e => setEndCard(e.target.checked)} />
                  End with the Comigo logo card, shown for
                  <input type="number" min={0.5} max={30} step={0.1} value={endSec} onChange={e => setEndSec(Number(e.target.value) || 1.8)} style={{ ...input, width: 80 }} disabled={!endCard} />
                  <span style={{ color: '#888', fontSize: '0.8rem' }}>s</span>
                </label>
                <input style={{ ...input, marginTop: 6 }} disabled={!endCard} value={endMidCaption} onChange={e => setEndMidCaption(e.target.value)} placeholder="Caption between the logo and comigo.net (optional)" />
                <input style={{ ...input, marginTop: 6 }} disabled={!endCard} value={endCaption} onChange={e => setEndCaption(e.target.value)} placeholder="Caption under comigo.net — last 2s of the logo card (optional)" />
                {endCard && <EndCardAnim value={endAnim} onChange={setEndAnim} endSec={endSec} />}
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem', color: '#ccc', marginTop: 8 }} title="A violet page on which every published comic's cover tiles in one after another, shown just before the logo card">
                  <input type="checkbox" checked={coversCard} onChange={e => setCoversCard(e.target.checked)} disabled={!endCard} />
                  Before the logo card, tile all published covers, for
                  <input type="number" min={1} max={15} step={0.5} value={coversSec} onChange={e => setCoversSec(Number(e.target.value) || 3.5)} style={{ ...input, width: 80 }} disabled={!endCard || !coversCard} />
                  <span style={{ color: '#888', fontSize: '0.8rem' }}>s</span>
                </label>

                <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" disabled={busy} onClick={render} style={{ padding: '0.55rem 1.4rem' }}>
                    {busy ? 'Rendering… (about a minute)' : '🎬 Render motion comic'}
                  </button>
                  <span style={{ color: '#888', fontSize: '0.8rem' }}>9:16 · ≈ {total.toFixed(1)}s (voice lines may lengthen shots) · no AI cost</span>
                </div>
                {error && <p style={{ color: '#f88', fontSize: '0.85rem' }}>{error}</p>}
              </>
            )}
          </>
        )}
      </div>
      <div>
        {clip ? (
          <>
            <video src={clip} controls playsInline style={{ width: '100%', borderRadius: 10, border: '1px solid #444', background: '#000' }} />
            <a className="btn btn-primary" href={clip} download style={{ display: 'inline-block', padding: '0.45rem 1.1rem', textDecoration: 'none', marginTop: 10 }}>⬇ Download</a>
            <InsetControls comicId={comicId} file={clipFile} onDone={(u, f) => { setClip(u); setClipFile(f); }} />
          </>
        ) : (
          <div style={{ border: '2px dashed #444', borderRadius: 10, padding: '3rem 1rem', textAlign: 'center', color: '#777', fontSize: '0.9rem' }}>
            {busy ? 'Rendering…' : 'Motion comic appears here'}<br />1080 × 1920 · 9:16
          </div>
        )}
      </div>
    </div>
  );
}

// Safe-margin inset for a finished reel: shrink the picture inside the 9:16
// frame so Instagram's buttons and caption don't cover it.
function InsetControls({ comicId, file, onDone }) {
  const [margin, setMargin] = useState(8);
  const [background, setBackground] = useState('violet');
  const [offset, setOffset] = useState(0);
  const [frame, setFrame] = useState('plain');   // 'plain' border | 'iphone' mockup
  const [phoneStatus, setPhoneStatus] = useState(true);
  const [phoneColor, setPhoneColor] = useState('black');   // Apple's iPhone 17 bezel colour
  const [phoneFit, setPhoneFit] = useState('fit');         // 'fit' whole reel (bars top/bottom) | 'fill' the screen (crops the sides)
  const [phoneSwing, setPhoneSwing] = useState(true);      // the phone swings in from an angle at the start
  const [phoneSwingSec, setPhoneSwingSec] = useState(1.2);
  const [busy, setBusy] = useState(false);
  if (!file) return null;
  const apply = async () => {
    setBusy(true);
    try {
      const r = await api.post(frame === 'iphone' ? '/marketing/phone-frame' : '/marketing/inset', { comicId, file, margin, background, offset, statusBar: phoneStatus, phoneColor, fit: phoneFit, entrance: phoneSwing ? 'swing' : 'none', entranceSeconds: phoneSwingSec }, { timeout: 600000 });
      onDone(r.data.url, r.data.file);
    } catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };
  const input = { padding: '0.3rem 0.5rem', borderRadius: 6, border: '1px solid #555', background: '#1a1332', color: '#e9e4ff', fontSize: '0.85rem' };
  return (
    <div style={{ border: '1px solid #444', borderRadius: 8, padding: 10, marginTop: 12 }}>
      <div style={{ fontSize: '0.85rem', color: '#aaa', marginBottom: 6 }}>Safe margins — shrink the picture so Instagram's controls stay off it</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85rem', color: '#ccc' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>Margin
          <input type="range" min={0} max={20} step={1} value={margin} onChange={e => setMargin(Number(e.target.value))} style={{ width: 120 }} />
          <span style={{ width: 34 }}>{margin}%</span>
        </label>
        <select value={frame} onChange={e => setFrame(e.target.value)} style={input} title="Plain border, or the reel playing inside an iPhone">
          <option value="plain">Plain border</option>
          <option value="iphone">Inside an iPhone</option>
        </select>
        {frame === 'iphone' && (
          <select value={phoneColor} onChange={e => setPhoneColor(e.target.value)} style={input} title="The phone's colour (Apple's official iPhone 17 bezel)">
            <option value="black">Black iPhone 17</option>
            <option value="lavender">Lavender</option>
            <option value="mist-blue">Mist blue</option>
            <option value="sage">Sage</option>
            <option value="white">White</option>
          </select>
        )}
        {frame === 'iphone' && (
          <select value={phoneFit} onChange={e => setPhoneFit(e.target.value)} style={input} title="The iPhone 17 screen is taller than 9:16: show the whole reel with black above and below, or fill the screen and crop the sides">
            <option value="fit">Whole reel, nothing cropped</option>
            <option value="fill">Fill the screen (crops the sides)</option>
          </select>
        )}
        {frame === 'iphone' && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }} title="The phone swings in from the right at an angle, then straightens into place">
            <input type="checkbox" checked={phoneSwing} onChange={e => setPhoneSwing(e.target.checked)} /> swings in over
            <input type="number" min={0.3} max={4} step={0.1} value={phoneSwingSec} onChange={e => setPhoneSwingSec(Number(e.target.value) || 1.2)} style={{ ...input, width: 62 }} disabled={!phoneSwing} /> s
          </label>
        )}
        {frame === 'iphone' && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }} title="9:41, signal, Wi-Fi and battery over the top of the reel"><input type="checkbox" checked={phoneStatus} onChange={e =>setPhoneStatus(e.target.checked)} /> status bar</label>
        )}

        <select value={background} onChange={e => setBackground(e.target.value)} style={input} title="What fills the border">
          <option value="blur">Blurred copy</option>
          <option value="violet">Comigo violet</option>
          <option value="black">Black</option>
        </select>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }} title="0 = centred top to bottom; negative raises the picture, positive lowers it">Vertical
          <input type="range" min={-15} max={15} step={1} value={offset} onChange={e => setOffset(Number(e.target.value))} style={{ width: 110 }} />
          <span style={{ width: 64 }}>{offset === 0 ? 'centred' : offset < 0 ? `up ${-offset}%` : `down ${offset}%`}</span>
        </label>
        <button className="btn btn-secondary" disabled={busy || margin === 0} onClick={apply} style={{ padding: '0.3rem 0.8rem' }}>
          {busy ? 'Applying…' : '⤢ Apply margins'}
        </button>
      </div>
      <div style={{ color: '#777', fontSize: '0.75rem', marginTop: 6 }}>Aspect ratio is kept; a new file is made each time, so you can try values. 8% clears the right-hand buttons; 12% also clears most caption overlap. Margins always apply to the original reel, so changing the value replaces the border rather than adding to it.</div>
    </div>
  );
}

// Server wants absolute starts; a negative bottom-caption start means "before the end".
const endAnimFor = (anim, endSec) => Object.fromEntries(Object.entries(anim || {}).map(([k, v]) => [k, { ...v, start: (v.start ?? 0) < 0 ? Math.max(0, endSec + v.start) : v.start }]));

// Sign-off card animation: per element, how it enters and when.
const END_ANIM_DEFAULT = {
  logo: { effect: 'pop', start: 0, dur: 0.5 },
  tagline: { effect: 'fade', start: 0.35, dur: 0.4 },
  caption: { effect: 'slide-up', start: 0.6, dur: 0.45 },
  net: { effect: 'fade', start: 0.9, dur: 0.5 },
  bottom: { effect: 'fade', start: -2, dur: 0.4 },   // -2 = two seconds before the end (server default)
};
const END_ANIM_PRESETS = {
  lively: END_ANIM_DEFAULT,
  calm: { logo: { effect: 'fade', start: 0, dur: 0.6 }, tagline: { effect: 'fade', start: 0.4, dur: 0.6 }, caption: { effect: 'fade', start: 0.8, dur: 0.6 }, net: { effect: 'fade', start: 1.2, dur: 0.6 }, bottom: { effect: 'fade', start: -2, dur: 0.6 } },
  static: { logo: { effect: 'none', start: 0, dur: 0.1 }, tagline: { effect: 'none', start: 0, dur: 0.1 }, caption: { effect: 'none', start: 0, dur: 0.1 }, net: { effect: 'none', start: 0, dur: 0.1 }, bottom: { effect: 'none', start: -2, dur: 0.1 } },
};
const OPENING_ANIM_DEFAULT = {
  logo: { effect: 'pop', start: 0, dur: 0.5 },
  line1: { effect: 'slide-up', start: 0.35, dur: 0.45 },
  squiggle: { effect: 'typewriter', start: 0.75, dur: 0.9 },
  line2: { effect: 'fade', start: 1.6, dur: 0.5 },
};
const OPENING_ANIM_PRESETS = {
  lively: OPENING_ANIM_DEFAULT,
  calm: { logo: { effect: 'fade', start: 0, dur: 0.6 }, line1: { effect: 'fade', start: 0.4, dur: 0.6 }, squiggle: { effect: 'typewriter', start: 0.9, dur: 1.0 }, line2: { effect: 'fade', start: 1.8, dur: 0.6 } },
  static: { logo: { effect: 'none', start: 0, dur: 0.1 }, line1: { effect: 'none', start: 0, dur: 0.1 }, squiggle: { effect: 'none', start: 0, dur: 0.1 }, line2: { effect: 'none', start: 0, dur: 0.1 } },
};
function OpeningCardAnim({ value, onChange, secs }) {
  return <CardAnim title="Opening card animation" rows={[['logo', 'Logo'], ['line1', 'Line 1 (white)'], ['squiggle', 'Squiggle under line 1'], ['line2', 'Line 2 (yellow)']]}
                   presets={OPENING_ANIM_PRESETS} value={value} onChange={onChange} secs={secs}
                   note={`Card lasts ${secs}s — make sure the last start + length fits inside it.`} />;
}
function EndCardAnim({ value, onChange, endSec }) {
  return <CardAnim title="Sign-off card animation" rows={[['logo', 'Logo'], ['tagline', 'Interactive Comics'], ['caption', 'Yellow caption'], ['net', 'comigo.net'], ['bottom', 'Bottom caption']]}
                   presets={END_ANIM_PRESETS} value={value} onChange={onChange} secs={endSec}
                   note={`Card lasts ${endSec}s — make sure the last start + length fits inside it. Bottom caption: negative start counts back from the end.`} />;
}
function CardAnim({ title, rows, presets, value, onChange, secs, note }) {
  const input = { padding: '0.25rem 0.4rem', borderRadius: 6, border: '1px solid #555', background: '#1a1332', color: '#e9e4ff', fontSize: '0.8rem' };
  const effects = [['none', 'Appear'], ['fade', 'Fade in'], ['pop', 'Pop (grow in)'], ['slide-up', 'Slide up'], ['slide-down', 'Slide down'], ['slide-left', 'Slide from right'], ['slide-right', 'Slide from left'], ['typewriter', 'Typewriter']];
  const set = (k, f, v) => onChange({ ...value, [k]: { ...value[k], [f]: v } });
  return (
    <div style={{ border: '1px solid #444', borderRadius: 8, padding: 8, marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: '0.82rem', color: '#aaa', flexWrap: 'wrap' }}>
        {title}
        <span style={{ flex: 1 }} />
        {Object.keys(presets).map(k => (
          <button key={k} className="btn btn-secondary" onClick={() => onChange(presets[k])} style={{ padding: '0.15rem 0.6rem', fontSize: '0.75rem' }}>{k}</button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 70px 70px', gap: '4px 8px', alignItems: 'center', fontSize: '0.8rem', color: '#ccc' }}>
        <span style={{ color: '#777' }}></span><span style={{ color: '#777' }}>Entrance</span><span style={{ color: '#777' }}>Start s</span><span style={{ color: '#777' }}>Length s</span>
        {rows.map(([k, label]) => (
          <React.Fragment key={k}>
            <span>{label}</span>
            <select value={value[k]?.effect || 'fade'} onChange={e => set(k, 'effect', e.target.value)} style={input}>
              {effects.filter(([v]) => v !== 'typewriter' || k !== 'logo').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input type="number" step={0.1} min={-10} max={30} value={value[k]?.start ?? 0} onChange={e => set(k, 'start', Number(e.target.value))} style={input}
                   title={k === 'bottom' ? 'Negative = seconds before the end of the card' : 'Seconds after the card begins'} />
            <input type="number" step={0.1} min={0.05} max={5} value={value[k]?.dur ?? 0.4} onChange={e => set(k, 'dur', Number(e.target.value))} style={input} />
          </React.Fragment>
        ))}
      </div>
      <div style={{ color: '#777', fontSize: '0.72rem', marginTop: 6 }}>{note}</div>
    </div>
  );
}

function Posters() {
  const [comics, setComics] = useState([]);
  const [comicId, setComicId] = useState('');
  const [images, setImages] = useState([]);
  const [imageFile, setImageFile] = useState('');
  const [extraUrls, setExtraUrls] = useState({});
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
            <ExtraImages comicId={comicId} selected={[imageFile]} onToggle={(t, u) => { setImageFile(t); setExtraUrls(m => ({ ...m, [t]: u })); }} />
          </>
        )}

        {/* 2b. art adjustments — CSS preview mirrors what sharp will do */}
        {imageFile && (
          <>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', margin: '1rem 0 4px' }}>
              Adjust art &mdash; brightness {brightness.toFixed(2)} &middot; colour {saturation.toFixed(2)}
            </label>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <img src={extraUrls[imageFile] || images.find(i => i.file === imageFile)?.url} alt="preview"
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
  const initial = new URLSearchParams(window.location.search);   // handed over from the comic's Challenge Reels tab
  const [comicId, setComicId] = useState(initial.get('comicId') || '');
  const [images, setImages] = useState([]);
  const [refs, setRefs] = useState([]);          // up to 3 directional images (tokens: file | upload:name | comic:id:file)
  const [refUrls, setRefUrls] = useState({});     // token -> preview url
  const [extraComicId, setExtraComicId] = useState('');
  const [extraImages, setExtraImages] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('fast');
  const [mode, setMode] = useState('refs');
  const [busy, setBusy] = useState(false);
  const [clip, setClip] = useState(initial.get('clip') && initial.get('comicId') ? `/projects/${initial.get('comicId')}/marketing/${initial.get('clip')}` : null);
  const [clipFile, setClipFile] = useState(initial.get('clip') || null);
  const handoffRef = useRef(initial.get('clip') && initial.get('comicId') ? initial.get('comicId') : '');
  const [error, setError] = useState('');
  const [audios, setAudios] = useState([]);
  const [question, setQuestion] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [styleLock, setStyleLock] = useState(false);   // off: the plain request produced better comic-style clips
  const [resolution, setResolution] = useState('720p');
  const [extendPrompt, setExtendPrompt] = useState('');
  const [extending, setExtending] = useState(false);
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
  const [coversCard, setCoversCard] = useState(false);
  const [coversSec, setCoversSec] = useState(3.5);
  const [endCaption, setEndCaption] = useState('');
  const [endMidCaption, setEndMidCaption] = useState('');
  const [endAnim, setEndAnim] = useState(END_ANIM_DEFAULT);
  const [openingLine1, setOpeningLine1] = useState('');
  const [openingLine2, setOpeningLine2] = useState('');
  const [openingSec, setOpeningSec] = useState(2);
  const [openingHold, setOpeningHold] = useState(0);
  const [openingAnim, setOpeningAnim] = useState(OPENING_ANIM_DEFAULT);

  useEffect(() => {
    api.get('/comics').then(r => setComics(Array.isArray(r.data) ? r.data : r.data.comics || []));
  }, []);
  useEffect(() => {
    setImages([]); setRefs([]); setRefUrls({}); setExtraComicId(''); setExtraImages([]); setError(''); setAudios([]); setVoices([]);
    // Keep a clip handed over from the comic's Challenge Reels tab while that
    // comic is still the selected one (React dev mode runs this effect twice).
    if (!(handoffRef.current && comicId === handoffRef.current)) { setClip(null); setClipFile(null); }
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
      const r = await api.post('/marketing/veo-remix', { comicId, file: clipFile, voiceAudio: voices.map(v => ({ file: v.file, es: v.es || '', en: v.en || '', lang: v.lang || 'es' })), ambient, subtitles, question, endCard, questionSeconds: questionSec, endCardSeconds: endSec, endCardCaption: endCaption, endCardMidCaption: endMidCaption, openingLine1, openingLine2, openingSeconds: openingSec, openingHold, endAnim: endAnimFor(endAnim, endSec), coversCard, coversSeconds: coversSec, openingAnim });
      setClip(r.data.url);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };

  const toggleRef = (token, url) => {
    if (refs.includes(token)) setRefs(refs.filter(f => f !== token));
    else if (refs.length < 3) { setRefs([...refs, token]); if (url) setRefUrls(m => ({ ...m, [token]: url })); }
  };
  const refUrlFor = token => refUrls[token] || images.find(i => i.file === token)?.url || '';
  const refLabel = token => token.startsWith('upload:') ? `📁 ${token.slice(7).replace(/^\d+-/, '')}`
    : token.startsWith('ref:') ? `🎨 ${token.split('/').pop()}`
    : token.startsWith('gen:') ? `✨ ${token.slice(4)}`
    : token.startsWith('comic:') ? `📚 ${comics.find(c => c.id === token.split(':')[1])?.title || 'other comic'} · ${token.split(':').slice(2).join(':')}`
    : token;
  useEffect(() => {
    setExtraImages([]);
    if (!extraComicId) return;
    api.get(`/marketing/${extraComicId}/images`).then(r => setExtraImages(r.data.images)).catch(e => alert(e.response?.data?.error || e.message));
  }, [extraComicId]);

  const generate = async () => {
    setBusy(true); setClip(null); setError('');
    try {
      const r = await api.post(model.startsWith('sora') ? '/marketing/sora-clip' : '/marketing/veo-clip', { comicId, prompt, imageFiles: refs, model, mode, aspectRatio: '9:16', styleLock, resolution,
        voiceAudio: voices.map(v => ({ file: v.file, es: v.es || '', en: v.en || '', lang: v.lang || 'es' })), ambient, subtitles, question, endCard, negativePrompt,
        durationSeconds, questionSeconds: questionSec, endCardSeconds: endSec, endCardCaption: endCaption, endCardMidCaption: endMidCaption, openingLine1, openingLine2, openingSeconds: openingSec, openingHold, endAnim: endAnimFor(endAnim, endSec), coversCard, coversSeconds: coversSec, openingAnim });
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
                         onClick={() => toggleRef(img.file, img.url)}
                         style={{ width: '100%', borderRadius: 4, cursor: 'pointer',
                                  outline: idx >= 0 ? '3px solid #8e6bf0' : '1px solid #444' }} />
                    {idx >= 0 && <span style={{ position: 'absolute', top: 4, left: 4, background: '#8e6bf0', color: '#fff',
                        borderRadius: '50%', width: 20, height: 20, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{idx + 1}</span>}
                  </div>
                );
              })}
            </div>

            {/* More sources: your own files, and pages from another comic */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <label className="btn btn-secondary" title="Use an image from your computer as a reference" style={{ padding: '0.3rem 0.8rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                📁 Add image from computer
                <input type="file" accept=".jpg,.jpeg,.png,.webp" style={{ display: 'none' }}
                  onChange={async e => {
                    const f = e.target.files?.[0]; if (!f) return;
                    const fd = new FormData(); fd.append('comicId', comicId); fd.append('image', f);
                    try {
                      const r = await api.post('/marketing/upload-image', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                      toggleRef(r.data.file, r.data.url);
                    } catch (err) { alert(err.response?.data?.error || err.message); }
                    e.target.value = '';
                  }} />
              </label>
              <span style={{ color: '#888', fontSize: '0.85rem' }}>or from another comic:</span>
              <select value={extraComicId} onChange={e => setExtraComicId(e.target.value)} style={{ ...input, width: 300 }}>
                <option value="">Choose a comic…</option>
                {comics.filter(c => c.id !== comicId).map(c => <option key={c.id} value={c.id}>{c.title}{c.collectionTitle ? ` — ${c.collectionTitle}` : ''}</option>)}
              </select>
            </div>
            {extraImages.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8, maxHeight: 200, overflowY: 'auto', padding: 4, marginTop: 6, border: '1px solid #333', borderRadius: 8 }}>
                {extraImages.map(img => {
                  const token = `comic:${extraComicId}:${img.file}`;
                  const idx = refs.indexOf(token);
                  return (
                    <div key={token} style={{ position: 'relative' }}>
                      <img src={img.url} alt={img.file} title={img.file}
                           onClick={() => toggleRef(token, img.url)}
                           style={{ width: '100%', borderRadius: 4, cursor: 'pointer',
                                    outline: idx >= 0 ? '3px solid #8e6bf0' : '1px solid #444' }} />
                      {idx >= 0 && <span style={{ position: 'absolute', top: 4, left: 4, background: '#8e6bf0', color: '#fff',
                          borderRadius: '50%', width: 20, height: 20, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{idx + 1}</span>}
                    </div>
                  );
                })}
              </div>
            )}
            <ExtraImages comicId={comicId} selected={refs} onToggle={(t, u) => toggleRef(t, u)} />
            {refs.length > 0 && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{ color: '#aaa', fontSize: '0.85rem' }}>Selected:</span>
                {refs.map((token, i) => (
                  <div key={token} style={{ display: 'flex', gap: 6, alignItems: 'center', border: '1px solid #444', borderRadius: 8, padding: '3px 6px', fontSize: '0.8rem' }} title={refLabel(token)}>
                    <span style={{ background: '#8e6bf0', color: '#fff', borderRadius: '50%', width: 18, height: 18, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                    {refUrlFor(token) && <img src={refUrlFor(token)} alt="" style={{ width: 36, height: 48, objectFit: 'cover', borderRadius: 3 }} />}
                    <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#ccc' }}>{refLabel(token)}</span>
                    <button className="btn btn-secondary" onClick={() => toggleRef(token)} style={{ padding: '0.1rem 0.4rem', color: '#f88' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {comicId && (
          <>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', margin: '1rem 0 4px' }}>3 · Describe the clip</label>
            <textarea style={{ ...input, resize: 'vertical' }} rows={5} value={prompt} onChange={e => setPrompt(e.target.value)}
              placeholder="e.g. Slow cinematic push-in on the lone rider approaching the town of Santa Roja at dusk, hand-drawn western comic style matching the reference art, dust drifting, tense and quiet, no text on screen" />
            <input style={{ ...input, marginTop: 8 }} value={negativePrompt} onChange={e => setNegativePrompt(e.target.value)}
                   placeholder="Avoid (negative prompt) — e.g. speech bubbles, text, lettering, captions" />
            <div style={{ display: 'flex', gap: 16, marginTop: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85rem', color: '#ccc' }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }} title="Prepends a firm 'this is a hand-drawn comic illustration, the references define the rendering' clause and adds photorealism to the negatives. Veo drifts to live action without it.">
                <input type="checkbox" checked={styleLock} onChange={e => setStyleLock(e.target.checked)} />
                🎨 Comic style lock (experimental — made clips worse in testing)
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ color: '#888' }}>Resolution:</span>
                <select value={resolution} onChange={e => setResolution(e.target.value)} style={{ ...input, width: 190 }} title="Veo can only EXTEND 720p clips; 1080p looks sharper on Instagram">
                  <option value="1080p">1080p (sharper)</option>
                  <option value="720p">720p (extendable)</option>
                </select>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={model} onChange={e => setModel(e.target.value)} style={{ ...input, width: 220 }}>
                <option value="fast">Veo 3.1 Fast (default)</option>
                <option value="quality">Veo 3.1 Quality (slower, dearer)</option>
                <option value="lite">Veo 3.1 Lite (cheapest)</option>
                <option value="sora">Sora 2 (OpenAI) — image 1 becomes the OPENING FRAME</option>
                <option value="sora-pro">Sora 2 Pro (OpenAI, dearer) — image 1 becomes the OPENING FRAME</option>
              </select>
              <label style={{ fontSize: '0.8rem', color: '#888' }}>Length:</label>
              <select value={durationSeconds} onChange={e => setDurationSeconds(Number(e.target.value))} style={{ ...input, width: 90 }}>
                <option value={4}>4s</option>
                {!model.startsWith('sora') && <option value={6}>6s</option>}
                <option value={8}>8s</option>
                {model.startsWith('sora') && <option value={12}>12s</option>}
              </select>
              {model.startsWith('sora') && (
                <span style={{ color: '#e6a23c', fontSize: '0.8rem', flexBasis: '100%' }}>
                  Sora takes ONE image and animates it as the first frame — pick the exact picture the clip should start from (a finished page or generated still, not a character sheet); images 2–3 are ignored.
                </span>
              )}
              <span style={{ color: '#888', fontSize: '0.8rem' }}>
                9:16 · total ≈ {(((openingLine1 || openingLine2) ? openingSec : 0) + durationSeconds + (question ? questionSec : 0) + (endCard ? endSec : 0)).toFixed(1)}s
                {' '}({(openingLine1 || openingLine2) ? `${openingSec}s opening + ` : ''}{durationSeconds}s clip{question ? ` + ${questionSec}s question` : ''}{endCard ? ` + ${endSec}s logo` : ''}) · costs real money per run
              </span>
              <button className="btn btn-primary" disabled={busy || !prompt} onClick={generate} style={{ padding: '0.55rem 1.4rem' }}>
                {busy ? 'Generating… (1–6 min)' : `🎞 Generate clip${model.startsWith('sora') ? ' (Sora)' : ''}`}
              </button>
              <label className="btn btn-secondary" title="Use a video of your own as the base instead of generating one — then add voices, subtitles and the cards below with 'Apply audio & cards'" style={{ padding: '0.55rem 1rem', cursor: busy ? 'default' : 'pointer' }}>
                {busy ? '…' : '📼 Or use my own clip'}
                <input type="file" accept=".mp4,.mov,.m4v,.webm" style={{ display: 'none' }} disabled={busy}
                  onChange={async e => {
                    const f = e.target.files?.[0]; if (!f) return;
                    const fd = new FormData(); fd.append('comicId', comicId); fd.append('clip', f);
                    setBusy(true); setError(''); setClip(null);
                    try {
                      const r = await api.post('/marketing/upload-clip', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600000 });
                      setClip(r.data.url); setClipFile(r.data.file);
                    } catch (err) { setError(err.response?.data?.error || err.message); }
                    finally { setBusy(false); e.target.value = ''; }
                  }} />
              </label>
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
              5 · Finish — opening card, question card + Comigo sign-off
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <input style={input} placeholder="Opening card line 1 (white) — leave empty for no opening card" value={openingLine1} onChange={e => setOpeningLine1(e.target.value)} />
              <input style={input} placeholder="Opening card line 2 (yellow, biggest)" value={openingLine2} onChange={e => setOpeningLine2(e.target.value)} />
              <input type="number" min={0.5} max={10} step={0.5} value={openingSec} title="How long the opening card shows"
                     onChange={e => setOpeningSec(Number(e.target.value) || 2)} style={{ ...input, width: 80 }} disabled={!openingLine1 && !openingLine2} />
              <span style={{ color: '#888', fontSize: '0.8rem' }}>s</span>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.8rem', color: '#aaa', whiteSpace: 'nowrap' }} title="Pause on the finished card after its animation, so the caption can be read (the card then lasts animation + this)">then hold
                <input type="number" min={0} max={15} step={0.5} value={openingHold} onChange={e => setOpeningHold(Number(e.target.value) || 0)} style={{ ...input, width: 70 }} /> s</label>
            </div>
            {(openingLine1 || openingLine2) && <OpeningCardAnim value={openingAnim} onChange={setOpeningAnim} secs={openingSec} />}
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
            {endCard && <EndCardAnim value={endAnim} onChange={setEndAnim} endSec={endSec} />}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem', color: '#ccc', marginTop: 8 }} title="A violet page on which every published comic's cover tiles in one after another, shown just before the logo card">
              <input type="checkbox" checked={coversCard} onChange={e => setCoversCard(e.target.checked)} disabled={!endCard} />
              Before the logo card, tile all published covers, for
              <input type="number" min={1} max={15} step={0.5} value={coversSec} onChange={e => setCoversSec(Number(e.target.value) || 3.5)} style={{ ...input, width: 80 }} disabled={!endCard || !coversCard} />
              <span style={{ color: '#888', fontSize: '0.8rem' }}>s</span>
            </label>
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
                  {busy ? 'Mixing…' : (/^(own-|challenge-|demo-)/.test(clipFile || '') ? '🔁 Apply audio & cards to this clip' : '🔁 Apply audio to last clip')}
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
            <InsetControls comicId={comicId} file={clipFile} onDone={(u, f) => { setClip(u); setClipFile(f); }} />
            {clipFile && (
              <div style={{ border: '1px solid #444', borderRadius: 8, padding: 10, marginTop: 12 }}>
                <div style={{ fontSize: '0.85rem', color: '#aaa', marginBottom: 6 }}>Improve on this clip</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  {[['first', 'first frame', 0], ['last', 'last frame', 'last']].map(([k, label, at]) => (
                    <button key={k} className="btn btn-secondary" disabled={busy || extending} style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}
                            title={`Save the clip's ${label} as a reference image and switch to Exact-frames mode — a new generation then starts from it`}
                            onClick={async () => {
                              try {
                                const r = await api.post('/marketing/clip-frame', { comicId, file: clipFile, at });
                                setMode('frames'); setRefs([r.data.file]); setRefUrls(m => ({ ...m, [r.data.file]: r.data.url }));
                              } catch (e) { alert(e.response?.data?.error || e.message); }
                            }}>
                      📸 Start next clip from its {label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={input} value={extendPrompt} onChange={e => setExtendPrompt(e.target.value)}
                         placeholder="Extend: what happens next (Veo continues this clip, +~7s) — needs a 720p clip" />
                  <button className="btn btn-secondary" disabled={busy || extending || !extendPrompt} style={{ padding: '0.3rem 0.8rem', whiteSpace: 'nowrap' }}
                          onClick={async () => {
                            setExtending(true); setError('');
                            try {
                              const r = await api.post('/marketing/veo-extend', { comicId, file: clipFile, prompt: extendPrompt, styleLock });
                              setClip(r.data.url); setClipFile(r.data.file); setExtendPrompt('');
                            } catch (e) { setError(e.response?.data?.error || e.message); }
                            finally { setExtending(false); }
                          }}>
                    {extending ? 'Extending… (1–4 min)' : '➕ Extend'}
                  </button>
                </div>
                <div style={{ color: '#777', fontSize: '0.75rem', marginTop: 6 }}>An extended clip is raw — use "Apply audio to last clip" to add voices and cards, then Download.</div>
              </div>
            )}
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

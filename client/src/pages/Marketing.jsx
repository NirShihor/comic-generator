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
        {['🎞 Clips', '🗂 Word cards', '🗓 Calendar'].map(label => (
          <button key={label} className="btn btn-secondary" disabled
                  title="Coming with the next content-generator phase"
                  style={{ padding: '0.5rem 1.1rem', opacity: 0.45, cursor: 'not-allowed' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'posters' && <Posters />}
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

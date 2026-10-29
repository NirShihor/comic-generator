import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

const STAGE_LABEL = {
  concept: 'Concept', development: 'Story development', script: 'English script', review: 'Editorial review',
  adaptation: 'Spanish adaptation', spanishReview: 'Spanish review', artwork: 'Artwork'
};

export default function StoryList() {
  const navigate = useNavigate();
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ title: '', kind: 'collection' });
  const [error, setError] = useState('');

  const load = async () => {
    try { const r = await api.get('/stories'); setStories(r.data); }
    catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!draft.title.trim()) return;
    try {
      const r = await api.post('/stories', draft);
      navigate(`/story/${r.data.id}`);
    } catch (e) { setError(e.response?.data?.error || e.message); }
  };

  const remove = async (s) => {
    if (!window.confirm(`Delete the story "${s.title}" and its whole conversation? This cannot be undone.`)) return;
    try { await api.delete(`/stories/${s.id}`); load(); }
    catch (e) { setError(e.response?.data?.error || e.message); }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Stories</h1>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ New story</button>
      </div>
      <p style={{ color: '#666', marginTop: '-0.5rem' }}>
        The story workshop: develop a collection's story with an AI co-writer before any page is drawn.
        Concept → Story development → English script → Editorial review → Spanish adaptation → Spanish review → Artwork.
      </p>
      {error && <p style={{ color: '#c0392b' }}>{error}</p>}
      {loading ? <p>Loading…</p> : stories.length === 0 ? (
        <p style={{ color: '#888' }}>No stories yet.</p>
      ) : (
        <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {stories.map(s => (
            <div key={s.id} className="comic-card" style={{ cursor: 'pointer', padding: '1rem' }} onClick={() => navigate(`/story/${s.id}`)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong style={{ fontSize: '1.05rem' }}>{s.title}</strong>
                <span style={{ fontSize: '0.8rem', color: '#888' }}>{s.kind === 'standalone' ? 'standalone' : 'collection'}{s.cefr ? ` · ${s.cefr}` : ''}</span>
              </div>
              <div style={{ fontSize: '0.85rem', color: '#555', marginTop: '0.35rem' }}>
                {s.genre ? `${s.genre} · ` : ''}Stage: {STAGE_LABEL[s.stage] || s.stage}
                {s.approvals?.development ? ' · foundation approved' : ''}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '0.35rem' }}>
                Bible {s.counts.bibleApproved} approved{s.counts.bibleProposed ? ` (${s.counts.bibleProposed} proposed)` : ''} · {s.counts.decisionsApproved} decisions · {s.counts.messages} messages
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.6rem', fontSize: '0.75rem', color: '#999' }}>
                <span>updated {new Date(s.updatedAt).toLocaleString()}</span>
                <button className="btn btn-secondary" style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem' }} onClick={(e) => { e.stopPropagation(); remove(s); }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>New story</h2>
            <div className="form-group">
              <label>Working title</label>
              <input autoFocus value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') create(); }} placeholder="e.g. The Black Cards" />
            </div>
            <div className="form-group">
              <label>What is it?</label>
              <select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value })}>
                <option value="collection">A collection of connected comics</option>
                <option value="standalone">A standalone comic</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={create} disabled={!draft.title.trim()}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

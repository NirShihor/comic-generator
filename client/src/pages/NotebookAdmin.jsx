import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

// Render note text with ==highlights== shown as yellow marker spans.
function renderHighlighted(text) {
  const parts = [];
  const regex = /==(.+?)==/g;
  let last = 0, m, key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<mark key={key++} style={{ background: '#fff176', padding: '0 2px', borderRadius: '2px' }}>{m[1]}</mark>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// Global admin notebook editor. Notes here ship to all readers via
// GET /api/reader/notebook and appear in the app's Notebook tab (read-only).
function NotebookAdmin() {
  const navigate = useNavigate();
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const bodyRefs = useRef({});

  // Wrap the current textarea selection in ==…== (the highlight marker).
  const highlightSelection = (note) => {
    const ta = bodyRefs.current[note.id];
    if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    if (start === end) { alert('Select some text first, then click Highlight.'); return; }
    const body = note.body || '';
    const newBody = body.slice(0, start) + '==' + body.slice(start, end) + '==' + body.slice(end);
    editLocal(note.id, 'body', newBody);
    persist({ ...note, body: newBody });
  };

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/notebook');
      setNotes(res.data.notes || []);
    } catch (e) {
      alert('Failed to load notes: ' + (e.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  };

  const addNote = async () => {
    try {
      const res = await api.post('/notebook', { title: '', body: '' });
      setNotes(prev => [...prev, res.data]);
    } catch (e) {
      alert('Failed to add note: ' + (e.response?.data?.error || e.message));
    }
  };

  // Update local state immediately; persist on blur.
  const editLocal = (id, field, value) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, [field]: value } : n));
  };

  const persist = async (note) => {
    setSavingId(note.id);
    try {
      await api.put(`/notebook/${note.id}`, { title: note.title, body: note.body });
    } catch (e) {
      alert('Failed to save: ' + (e.response?.data?.error || e.message));
    } finally {
      setSavingId(null);
    }
  };

  const removeNote = async (id) => {
    if (!window.confirm('Delete this note? It will be removed from the reader app on next refresh.')) return;
    try {
      await api.delete(`/notebook/${id}`);
      setNotes(prev => prev.filter(n => n.id !== id));
    } catch (e) {
      alert('Failed to delete: ' + (e.response?.data?.error || e.message));
    }
  };

  const move = async (index, dir) => {
    const target = index + dir;
    if (target < 0 || target >= notes.length) return;
    const reordered = [...notes];
    const [item] = reordered.splice(index, 1);
    reordered.splice(target, 0, item);
    setNotes(reordered);
    try {
      await api.post('/notebook/reorder', { ids: reordered.map(n => n.id) });
    } catch (e) {
      alert('Failed to reorder: ' + (e.response?.data?.error || e.message));
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <h1 style={{ margin: 0 }}>📓 Admin Notes</h1>
        <button className="btn btn-secondary" onClick={() => navigate('/')} style={{ padding: '0.4rem 0.9rem' }}>← Back</button>
      </div>
      <p style={{ color: '#888', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
        These grammar pages ship to every reader (read-only) and appear in the app’s Notebook tab.
        Edits save automatically and reach users on their next app launch — no new app build needed.
      </p>

      <button className="btn btn-primary" onClick={addNote} style={{ padding: '0.5rem 1rem', marginBottom: '1.25rem' }}>
        + New Note
      </button>

      {loading ? (
        <p style={{ color: '#888' }}>Loading…</p>
      ) : notes.length === 0 ? (
        <p style={{ color: '#888', fontStyle: 'italic' }}>No notes yet. Add your first grammar page.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {notes.map((note, idx) => (
            <div key={note.id} style={{ border: '1px solid #ddd', borderRadius: '10px', padding: '1rem', background: '#fff' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                <input
                  type="text"
                  value={note.title}
                  onChange={(e) => editLocal(note.id, 'title', e.target.value)}
                  onBlur={() => persist(note)}
                  placeholder="Title (e.g. Ser vs. Estar)"
                  style={{ flex: 1, padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', fontSize: '1rem', fontWeight: 'bold' }}
                />
                <button onClick={() => move(idx, -1)} disabled={idx === 0} className="btn btn-secondary" style={{ padding: '0.35rem 0.6rem' }} title="Move up">↑</button>
                <button onClick={() => move(idx, 1)} disabled={idx === notes.length - 1} className="btn btn-secondary" style={{ padding: '0.35rem 0.6rem' }} title="Move down">↓</button>
                <button onClick={() => removeNote(note.id)} className="btn btn-danger" style={{ padding: '0.35rem 0.6rem' }} title="Delete">🗑</button>
              </div>
              <textarea
                ref={(el) => { bodyRefs.current[note.id] = el; }}
                value={note.body}
                onChange={(e) => editLocal(note.id, 'body', e.target.value)}
                onBlur={() => persist(note)}
                placeholder="Write the grammar explanation here. Plain text, line breaks preserved."
                rows={6}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #ccc', fontSize: '0.95rem', resize: 'vertical', fontFamily: 'inherit' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.4rem' }}>
                <button onClick={() => highlightSelection(note)} className="btn btn-secondary" style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }} title="Select text in the box above, then click to highlight">
                  🖍 Highlight selection
                </button>
                {savingId === note.id && <span style={{ fontSize: '0.75rem', color: '#27ae60' }}>Saving…</span>}
              </div>
              {(note.body || '').includes('==') && (
                <div style={{ marginTop: '0.5rem', padding: '0.6rem', background: '#fafafa', border: '1px dashed #ddd', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.7rem', color: '#999', marginBottom: '0.25rem' }}>Preview</div>
                  <div style={{ fontSize: '0.95rem', whiteSpace: 'pre-wrap' }}>{renderHighlighted(note.body)}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default NotebookAdmin;

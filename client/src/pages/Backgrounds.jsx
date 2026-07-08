import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

// Global background library. Upload once, label, optionally tag with a
// collection, and reuse across comics (dropped in as a page image from the
// Page Editor). Stored via /api/backgrounds; images live under /uploads.
function Backgrounds() {
  const [backgrounds, setBackgrounds] = useState([]);
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [filterCollection, setFilterCollection] = useState('');
  const fileRef = useRef(null);

  const load = async () => {
    try {
      const [bgRes, colRes] = await Promise.all([
        api.get('/backgrounds'),
        api.get('/collections')
      ]);
      setBackgrounds(bgRes.data);
      setCollections(colRes.data);
    } catch (err) {
      console.error('Failed to load backgrounds:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { alert('Choose an image first.'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const up = await api.post('/images/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const col = collections.find(c => c.id === collectionId);
      await api.post('/backgrounds', {
        name: name.trim() || file.name.replace(/\.[^.]+$/, ''),
        image: up.data.path,
        collectionId,
        collectionTitle: col?.title || ''
      });
      setName('');
      setCollectionId('');
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (err) {
      alert('Upload failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setUploading(false);
    }
  };

  const updateBackground = async (bg, patch) => {
    // Optimistic — reflect immediately, then persist.
    setBackgrounds(prev => prev.map(b => b.id === bg.id ? { ...b, ...patch } : b));
    try {
      await api.put(`/backgrounds/${bg.id}`, patch);
    } catch (err) {
      console.error('Failed to update background:', err);
      load();
    }
  };

  const deleteBackground = async (bg) => {
    if (!window.confirm(`Delete background "${bg.name}"? Pages already using it keep their copy.`)) return;
    try {
      await api.delete(`/backgrounds/${bg.id}`);
      setBackgrounds(prev => prev.filter(b => b.id !== bg.id));
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const shown = filterCollection
    ? backgrounds.filter(b => b.collectionId === filterCollection)
    : backgrounds;

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <Link to="/" style={{ color: '#007bff', textDecoration: 'none' }}>← Comics</Link>
        <h1 style={{ margin: 0, fontSize: '1.4rem' }}>Background Library</h1>
      </div>
      <p style={{ color: '#666', marginTop: 0 }}>
        Store background images once and reuse them across comics. Drop one into a page
        from the Page Editor (“From Backgrounds”). Label them and optionally tag a
        collection to keep things organised.
      </p>

      {/* Upload form */}
      <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem', background: '#fafafa' }}>
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Add a background</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#555', marginBottom: '0.2rem' }}>Image</label>
            <input type="file" accept="image/*" ref={fileRef} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#555', marginBottom: '0.2rem' }}>Label</label>
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Rocky prehistoric hillside"
              style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc', minWidth: '240px' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#555', marginBottom: '0.2rem' }}>Collection (optional)</label>
            <select
              value={collectionId} onChange={e => setCollectionId(e.target.value)}
              style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }}
            >
              <option value="">— none —</option>
              {collections.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          <button
            className="btn btn-primary" onClick={handleUpload} disabled={uploading}
            style={{ padding: '0.45rem 1rem', background: '#007bff', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
          >
            {uploading ? 'Uploading…' : '+ Add background'}
          </button>
        </div>
      </div>

      {/* Filter */}
      <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '0.85rem', color: '#555' }}>Filter by collection:</span>
        <select
          value={filterCollection} onChange={e => setFilterCollection(e.target.value)}
          style={{ padding: '0.3rem', borderRadius: '4px', border: '1px solid #ccc' }}
        >
          <option value="">All</option>
          {collections.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <span style={{ fontSize: '0.8rem', color: '#999' }}>({shown.length})</span>
      </div>

      {loading ? (
        <p style={{ color: '#888' }}>Loading…</p>
      ) : shown.length === 0 ? (
        <p style={{ color: '#888' }}>No backgrounds yet. Add one above.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' }}>
          {shown.map(bg => (
            <div key={bg.id} style={{ border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden', background: '#fff' }}>
              <img
                src={bg.image} alt={bg.name}
                style={{ width: '100%', height: '140px', objectFit: 'cover', display: 'block', background: '#f0f0f0' }}
              />
              <div style={{ padding: '0.6rem' }}>
                <input
                  type="text" value={bg.name || ''}
                  onChange={e => setBackgrounds(prev => prev.map(b => b.id === bg.id ? { ...b, name: e.target.value } : b))}
                  onBlur={e => updateBackground(bg, { name: e.target.value })}
                  style={{ width: '100%', padding: '0.3rem', borderRadius: '4px', border: '1px solid #eee', fontSize: '0.85rem', marginBottom: '0.4rem', boxSizing: 'border-box' }}
                />
                <select
                  value={bg.collectionId || ''}
                  onChange={e => {
                    const col = collections.find(c => c.id === e.target.value);
                    updateBackground(bg, { collectionId: e.target.value, collectionTitle: col?.title || '' });
                  }}
                  style={{ width: '100%', padding: '0.3rem', borderRadius: '4px', border: '1px solid #eee', fontSize: '0.8rem', marginBottom: '0.4rem', boxSizing: 'border-box' }}
                >
                  <option value="">— no collection —</option>
                  {collections.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
                <button
                  onClick={() => deleteBackground(bg)}
                  style={{ fontSize: '0.75rem', color: '#c0392b', background: 'none', border: '1px solid #f0c0bb', borderRadius: '4px', padding: '0.2rem 0.5rem', cursor: 'pointer' }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Backgrounds;

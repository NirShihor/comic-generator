import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

// Drag-to-reorder the published comics. The unit is an "item": either a
// standalone comic or a whole collection (which moves as one block — issues
// within it stay ordered by episode number). The saved order drives the
// top-to-bottom order users see in the reader app's Store and Library.
function ReorderComics() {
  const [items, setItems] = useState([]);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const navigate = useNavigate();

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const res = await api.get('/comics');
      const published = res.data.filter(c => c.published);

      // Group into items: standalone comics + collections.
      const collectionMap = {};
      const built = [];
      for (const comic of published) {
        if (comic.collectionId) {
          if (!collectionMap[comic.collectionId]) {
            collectionMap[comic.collectionId] = {
              type: 'collection',
              id: comic.collectionId,
              title: comic.collectionTitle || comic.collectionId,
              comics: [],
            };
            built.push(collectionMap[comic.collectionId]);
          }
          collectionMap[comic.collectionId].comics.push(comic);
        } else {
          built.push({ type: 'standalone', id: comic.id, title: comic.title, comics: [comic] });
        }
      }

      // Episodes within a collection: order by episode number.
      for (const item of built) {
        if (item.type === 'collection') {
          item.comics.sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0));
        }
      }

      // Items: order by the lowest saved order in the item, then title.
      const itemOrder = (item) => Math.min(...item.comics.map(c => c.order || 0));
      built.sort((a, b) => itemOrder(a) - itemOrder(b) || a.title.localeCompare(b.title));

      setItems(built);
    } catch (e) {
      console.error('Failed to load comics:', e);
    }
    setLoading(false);
  };

  const onDragStart = (i) => setDragIndex(i);

  const onDragOver = (e, i) => {
    e.preventDefault();
    setOverIndex(i);
    if (dragIndex === null || dragIndex === i) return;
    setItems(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(i, 0, moved);
      return next;
    });
    setDragIndex(i);
    setDirty(true);
  };

  const onDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      // Every comic in an item shares that item's position, so a collection
      // moves as one block. Issue order inside a collection stays by episode.
      const orders = items.flatMap((item, i) =>
        item.comics.map(c => ({ id: c.id, order: i }))
      );
      await api.post('/comics/reorder', { orders });
      setDirty(false);
      setSavedAt(new Date());
    } catch (e) {
      console.error('Failed to save order:', e);
      alert('Failed to save order');
    }
    setSaving(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <button className="btn btn-secondary" onClick={() => navigate('/')} style={{ marginBottom: '0.5rem' }}>
            ← Back
          </button>
          <h1 style={{ margin: 0 }}>Reader Order</h1>
          <p style={{ color: '#888', marginTop: '0.25rem' }}>
            Drag to set the order comics and collections appear, top to bottom, in the app.
            A collection moves as one block; issues inside it stay ordered by episode number.
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={saving || !dirty}
            style={{ padding: '0.5rem 1.25rem' }}
          >
            {saving ? 'Saving…' : 'Save order'}
          </button>
          {savedAt && !dirty && (
            <div style={{ fontSize: '0.8rem', color: '#28a745', marginTop: '0.25rem' }}>Saved ✓</div>
          )}
          {dirty && (
            <div style={{ fontSize: '0.8rem', color: '#dc3545', marginTop: '0.25rem' }}>Unsaved changes</div>
          )}
        </div>
      </div>

      {loading ? (
        <p style={{ color: '#888' }}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ color: '#888' }}>No published comics yet. Publish comics to order them here.</p>
      ) : (
        <div style={{ marginTop: '1rem', maxWidth: '720px' }}>
          {items.map((item, i) => (
            <div
              key={item.type + '-' + item.id}
              draggable
              onDragStart={() => onDragStart(i)}
              onDragOver={(e) => onDragOver(e, i)}
              onDragEnd={onDragEnd}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                marginBottom: '0.5rem',
                background: dragIndex === i ? '#eef4ff' : 'white',
                border: `1px solid ${overIndex === i && dragIndex !== i ? '#007bff' : '#e0e0e0'}`,
                borderRadius: '8px',
                cursor: 'grab',
                boxShadow: dragIndex === i ? '0 4px 12px rgba(0,0,0,0.12)' : 'none',
                userSelect: 'none'
              }}
            >
              <span style={{ color: '#bbb', fontSize: '1.2rem', cursor: 'grab', paddingTop: '0.1rem' }}>⠿</span>
              <span style={{ color: '#999', width: '1.5rem', textAlign: 'right', paddingTop: '0.1rem' }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {item.type === 'collection' ? (
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      📚 {item.title}
                      <span style={{ color: '#999', fontWeight: 'normal', fontSize: '0.85em' }}>
                        {'  '}({item.comics.length} episode{item.comics.length !== 1 ? 's' : ''})
                      </span>
                    </div>
                    <div style={{ marginTop: '0.35rem', paddingLeft: '0.5rem', borderLeft: '2px solid #eee' }}>
                      {item.comics.map(c => (
                        <div key={c.id} style={{ fontSize: '0.8rem', color: '#888' }}>
                          {c.episodeNumber != null ? `Ep ${c.episodeNumber}: ` : ''}{c.title}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontWeight: 600 }}>{item.title}</div>
                    <div style={{ fontSize: '0.8rem', color: '#aaa' }}>
                      {item.comics[0].pages?.length || 0} pages • {item.comics[0].level}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ReorderComics;

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

function ComicList() {
  const [comics, setComics] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [comicToDelete, setComicToDelete] = useState(null);
  const [newComic, setNewComic] = useState({ title: '', description: '', level: 'beginner' });
  const [collapsedCollections, setCollapsedCollections] = useState({});
  const [renamingComic, setRenamingComic] = useState(null);
  const [renameTitle, setRenameTitle] = useState('');
  const navigate = useNavigate();

  // Group comics: collections grouped together, standalone comics separate
  const { collections, standaloneComics } = (() => {
    const collectionMap = {};
    const standalone = [];
    for (const comic of comics) {
      if (comic.collectionId) {
        if (!collectionMap[comic.collectionId]) {
          collectionMap[comic.collectionId] = {
            id: comic.collectionId,
            title: comic.collectionTitle || comic.collectionId,
            comics: []
          };
        }
        collectionMap[comic.collectionId].comics.push(comic);
      } else {
        standalone.push(comic);
      }
    }
    // Sort episodes within each collection
    for (const col of Object.values(collectionMap)) {
      col.comics.sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0));
    }
    return { collections: Object.values(collectionMap), standaloneComics: standalone };
  })();

  const toggleCollection = (collectionId) => {
    setCollapsedCollections(prev => ({ ...prev, [collectionId]: !prev[collectionId] }));
  };

  const toggleLock = async (e, comic) => {
    e.stopPropagation();
    try {
      const response = await api.patch(`/comics/${comic.id}/lock`);
      setComics(comics.map(c => c.id === comic.id ? { ...c, locked: response.data.locked } : c));
    } catch (error) {
      console.error('Failed to toggle lock:', error);
    }
  };

  const handleDeleteClick = (e, comic) => {
    e.stopPropagation();
    setComicToDelete(comic);
    setShowDeleteModal(true);
  };

  const deleteComic = async () => {
    if (!comicToDelete) return;
    try {
      await api.delete(`/comics/${comicToDelete.id}`);
      setComics(comics.filter(c => c.id !== comicToDelete.id));
      setShowDeleteModal(false);
      setComicToDelete(null);
    } catch (error) {
      console.error('Failed to delete comic:', error);
    }
  };

  const handleRenameClick = (e, comic) => {
    e.stopPropagation();
    setRenamingComic(comic);
    setRenameTitle(comic.title);
  };

  const renameComic = async () => {
    if (!renamingComic || !renameTitle.trim()) return;
    try {
      const response = await api.put(`/comics/${renamingComic.id}`, { title: renameTitle.trim() });
      setComics(comics.map(c => c.id === renamingComic.id ? { ...c, title: response.data.title } : c));
      setRenamingComic(null);
      setRenameTitle('');
    } catch (error) {
      console.error('Failed to rename comic:', error);
    }
  };

  useEffect(() => {
    loadComics();
  }, []);

  const loadComics = async () => {
    try {
      const response = await api.get('/comics');
      setComics(response.data);
    } catch (error) {
      console.error('Failed to load comics:', error);
    }
  };

  const createComic = async () => {
    try {
      const response = await api.post('/comics', newComic);
      setComics([...comics, response.data]);
      setShowModal(false);
      setNewComic({ title: '', description: '', level: 'beginner' });
      navigate(`/comic/${response.data.id}`);
    } catch (error) {
      console.error('Failed to create comic:', error);
    }
  };

  const renderComicCard = (comic, isInCollection) => (
    <div
      key={comic.id}
      className="comic-card"
      onClick={() => navigate(`/comic/${comic.id}`)}
      style={{ position: 'relative' }}
    >
      <button
        onClick={(e) => toggleLock(e, comic)}
        title={comic.locked !== false ? 'Locked — click to unlock for deletion' : 'Unlocked — click to lock'}
        style={{
          position: 'absolute',
          top: '8px',
          left: '8px',
          background: 'transparent',
          color: comic.locked !== false ? '#ffc107' : '#666',
          border: 'none',
          fontSize: '1.1rem',
          cursor: 'pointer',
          padding: '2px 6px'
        }}
      >
        {comic.locked !== false ? '\uD83D\uDD12' : '\uD83D\uDD13'}
      </button>
      {comic.locked === false && (
        <div style={{ position: 'absolute', top: '8px', right: '8px', display: 'flex', gap: '4px' }}>
          <button
            onClick={(e) => handleRenameClick(e, comic)}
            style={{
              background: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '0.75rem',
              cursor: 'pointer'
            }}
          >
            Rename
          </button>
          <button
            onClick={(e) => handleDeleteClick(e, comic)}
            style={{
              background: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '0.75rem',
              cursor: 'pointer'
            }}
          >
            Delete
          </button>
        </div>
      )}
      <h3>
        {isInCollection && comic.episodeNumber != null && (
          <span style={{ color: '#999', fontWeight: 'normal', fontSize: '0.85em' }}>
            Ep {comic.episodeNumber}:{' '}
          </span>
        )}
        {comic.title}
      </h3>
      <p>{comic.description || 'No description'}</p>
      <p style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
        {comic.pages?.length || 0} pages • {comic.level}
      </p>
    </div>
  );

  return (
    <div>
      <div>
        <h1>My Comics</h1>
        <button
          className="btn btn-primary"
          onClick={() => setShowModal(true)}
          style={{ padding: '0.5rem 1rem', fontSize: '0.9rem', marginTop: '0.5rem' }}
        >
          + New Comic
        </button>
      </div>

      <div className="comic-list">
        {/* Collection groups */}
        {collections.map(collection => (
          <div key={collection.id} style={{
            border: '2px solid #e0e0e0',
            borderRadius: '10px',
            marginBottom: '1.5rem',
            overflow: 'hidden'
          }}>
            {/* Collection header */}
            <div
              onClick={() => toggleCollection(collection.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.75rem 1rem',
                background: '#f5f5f5',
                cursor: 'pointer',
                userSelect: 'none'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.1rem' }}>{collapsedCollections[collection.id] ? '\u25B6' : '\u25BC'}</span>
                <h3 style={{ margin: 0, fontSize: '1rem', color: '#555' }}>
                  {collection.title}
                </h3>
                <span style={{ fontSize: '0.8rem', color: '#999' }}>
                  ({collection.comics.length} episode{collection.comics.length !== 1 ? 's' : ''})
                </span>
              </div>
            </div>

            {/* Collection comics */}
            {!collapsedCollections[collection.id] && (
              <div style={{ padding: '0.5rem' }}>
                {collection.comics.map(comic => renderComicCard(comic, true))}
              </div>
            )}
          </div>
        ))}

        {/* Standalone comics */}
        {standaloneComics.map(comic => renderComicCard(comic, false))}

        {comics.length === 0 && (
          <p style={{ color: '#888' }}>No comics yet. Create your first one!</p>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Create New Comic</h2>

            <div className="form-group">
              <label>Title</label>
              <input
                type="text"
                value={newComic.title}
                onChange={e => setNewComic({ ...newComic, title: e.target.value })}
                placeholder="e.g., El Superviviente"
              />
            </div>

            <div className="form-group">
              <label>Description</label>
              <textarea
                value={newComic.description}
                onChange={e => setNewComic({ ...newComic, description: e.target.value })}
                placeholder="Brief description of the comic..."
                rows={3}
              />
            </div>

            <div className="form-group">
              <label>Level</label>
              <select
                value={newComic.level}
                onChange={e => setNewComic({ ...newComic, level: e.target.value })}
              >
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={createComic}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && comicToDelete && (
        <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Delete Comic</h2>
            <p>Are you sure you want to delete "{comicToDelete.title}"?</p>
            <p style={{ color: '#dc3545', fontSize: '0.9rem', marginTop: '0.5rem' }}>
              This will permanently delete all pages, images, and audio files.
            </p>
            <div className="modal-actions" style={{ marginTop: '1.5rem' }}>
              <button className="btn btn-secondary" onClick={() => setShowDeleteModal(false)}>
                Cancel
              </button>
              <button
                className="btn"
                style={{ background: '#dc3545', color: 'white' }}
                onClick={deleteComic}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {renamingComic && (
        <div className="modal-overlay" onClick={() => setRenamingComic(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Rename Comic</h2>
            <div className="form-group">
              <label>Title</label>
              <input
                type="text"
                value={renameTitle}
                onChange={e => setRenameTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && renameComic()}
                autoFocus
              />
            </div>
            <div className="modal-actions" style={{ marginTop: '1.5rem' }}>
              <button className="btn btn-secondary" onClick={() => setRenamingComic(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={renameComic}
                disabled={!renameTitle.trim()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ComicList;

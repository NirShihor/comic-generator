import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

function ComicList() {
  const [comics, setComics] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [comicToDelete, setComicToDelete] = useState(null);
  const [newComic, setNewComic] = useState({ title: '', description: '', level: 'beginner' });
  const navigate = useNavigate();

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
        {comics.map(comic => (
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
              <button
                onClick={(e) => handleDeleteClick(e, comic)}
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
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
            )}
            <h3>{comic.title}</h3>
            <p>{comic.description || 'No description'}</p>
            <p style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
              {comic.pages?.length || 0} pages • {comic.level}
            </p>
          </div>
        ))}

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
    </div>
  );
}

export default ComicList;

import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../services/api';

const DEFAULT_SETTINGS = {
  styleBible: `• Page ratio is A4.
• Speech and thinking bubbles should be contained in the panel and not spill over the edges of the panel.
• Black & white only. Human-drawn underground horror comic. Rough ink on paper.
• Uneven line weight, occasional wobble.
• Visible pencil under-sketch lines.
• Messy cross-hatching (inconsistent spacing/direction).
• Heavy contrast.
• Slight line wobble (human-made feel)
• Flat black shadows with imperfect fills (tiny white pinholes).
• Light paper grain only.
• Subtle ink texture only.
• No blotchy grey stains.
• No circular mottling.
• No sponge-like texture.
• No hyperrealism
• No digital polish look

IMPORTANT
Keep it looking like a human-drawn comic page, not glossy AI.
No photorealism. No hyper-detail. No horror gore.`,

  cameraInks: `Bold silhouettes and strong negative space.
Slightly imperfect anatomy and perspective (human-made).
Hand-drawn panel borders, slightly wobbly.
Keep lighting high-contrast with clear shadow shapes (no gradients).`,

  characters: [],

  textLettering: `Hand-lettered captions (not a font), slightly uneven baseline.
Spanish captions exactly as written.
Captions should always appear inside the panels.
All text must be perfectly spelled Spanish. If unsure, leave the caption box blank.`,

  globalDoNot: `Do NOT draw rounded corners.
Do NOT draw an outer page border or white frame.
Do NOT show a page on a background (no table/photo/scan framing).
No vignette, no drop shadow.
The artwork itself is the page, filling the entire canvas edge-to-edge (only a tiny safe margin).`,

  hardNegatives: `No clean vector lines.
No digital polish.
No extra panels beyond the layout.
No inset panels.
No split panels.
No decorative borders that look like panels.`,

  firstPageTemplate: `PAGE 1 ONLY — This is the first page of the comic. Set the scene and introduce the story.`,

  otherPagesTemplate: `Continue the story from the previous page. Maintain character consistency.`
};

function ComicEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [comic, setComic] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pages');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsTab, setSettingsTab] = useState('style');
  const [saving, setSaving] = useState(false);
  const [newCharacter, setNewCharacter] = useState({ name: '', description: '' });

  useEffect(() => {
    loadComic();
  }, [id]);

  const loadComic = async () => {
    try {
      const response = await api.get(`/comics/${id}`);
      setComic(response.data);
      if (response.data.promptSettings) {
        setSettings({ ...DEFAULT_SETTINGS, ...response.data.promptSettings });
      }
    } catch (error) {
      console.error('Failed to load comic:', error);
    } finally {
      setLoading(false);
    }
  };

  const addPage = async () => {
    try {
      const response = await api.post(`/comics/${id}/pages`);
      const newPage = response.data;
      setComic({
        ...comic,
        pages: [...comic.pages, newPage]
      });
      navigate(`/comic/${id}/page/${newPage.id}`);
    } catch (error) {
      console.error('Failed to add page:', error);
    }
  };

  const exportComic = async () => {
    try {
      const response = await api.get(`/comics/${id}/export`);
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${comic.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export comic:', error);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const updatedComic = {
        ...comic,
        promptSettings: settings
      };
      await api.put(`/comics/${id}`, updatedComic);
      setComic(updatedComic);
      alert('Settings saved!');
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const addCharacter = () => {
    if (!newCharacter.name.trim()) return;
    setSettings(prev => ({
      ...prev,
      characters: [...prev.characters, { ...newCharacter, id: Date.now() }]
    }));
    setNewCharacter({ name: '', description: '' });
  };

  const removeCharacter = (charId) => {
    setSettings(prev => ({
      ...prev,
      characters: prev.characters.filter(c => c.id !== charId)
    }));
  };

  const updateCharacter = (charId, field, value) => {
    setSettings(prev => ({
      ...prev,
      characters: prev.characters.map(c =>
        c.id === charId ? { ...c, [field]: value } : c
      )
    }));
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!comic) {
    return <div>Comic not found</div>;
  }

  const settingsTabs = [
    { id: 'style', label: 'Style Bible' },
    { id: 'camera', label: 'Camera & Inks' },
    { id: 'characters', label: 'Characters' },
    { id: 'text', label: 'Text & Lettering' },
    { id: 'donot', label: 'Do Not / Negatives' },
    { id: 'templates', label: 'Page Templates' }
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/" style={{ color: '#888', textDecoration: 'none', marginBottom: '0.5rem', display: 'block' }}>
            ← Back to Comics
          </Link>
          <h1>{comic.title}</h1>
          <p style={{ color: '#888' }}>{comic.description}</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={exportComic}>
            Export JSON
          </button>
          <button className="btn btn-primary" onClick={addPage}>
            + Add Page
          </button>
        </div>
      </div>

      {/* Main Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '2px solid #16213e', paddingBottom: '0.5rem' }}>
        <button
          className={`btn ${activeTab === 'pages' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('pages')}
          style={{ padding: '0.6rem 1.2rem' }}
        >
          Pages ({comic.pages.length})
        </button>
        <button
          className={`btn ${activeTab === 'prompt' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('prompt')}
          style={{ padding: '0.6rem 1.2rem' }}
        >
          Prompt Settings
        </button>
      </div>

      {/* Pages Tab */}
      {activeTab === 'pages' && (
        <div>
          <div className="page-grid">
            {comic.pages.map((page) => (
              <div
                key={page.id}
                className="page-thumbnail"
                onClick={() => navigate(`/comic/${id}/page/${page.id}`)}
              >
                {page.masterImage ? (
                  <img
                    src={`http://localhost:3001${page.masterImage}`}
                    alt={`Page ${page.pageNumber}`}
                  />
                ) : (
                  <div style={{
                    aspectRatio: '2/3',
                    background: '#0f3460',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#666'
                  }}>
                    No Image
                  </div>
                )}
                <p>Page {page.pageNumber}</p>
                <small style={{ color: '#666' }}>
                  {page.panels?.length || 0} panels
                </small>
              </div>
            ))}

            {comic.pages.length === 0 && (
              <p style={{ color: '#888' }}>No pages yet. Click "Add Page" to start.</p>
            )}
          </div>
        </div>
      )}

      {/* Prompt Settings Tab */}
      {activeTab === 'prompt' && (
        <div>
          {/* Settings Sub-tabs */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            {settingsTabs.map(tab => (
              <button
                key={tab.id}
                className={`btn ${settingsTab === tab.id ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setSettingsTab(tab.id)}
                style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
              >
                {tab.label}
              </button>
            ))}
            <button
              className="btn btn-primary"
              onClick={saveSettings}
              disabled={saving}
              style={{ marginLeft: 'auto', padding: '0.4rem 1rem', fontSize: '0.85rem' }}
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>

          {/* Settings Content */}
          <div style={{ background: '#0f3460', borderRadius: '8px', padding: '1.5rem' }}>
            {settingsTab === 'style' && (
              <div>
                <h2 style={{ marginBottom: '0.5rem' }}>Style Bible</h2>
                <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Define the visual style for all pages in this comic
                </p>
                <textarea
                  value={settings.styleBible}
                  onChange={(e) => updateSetting('styleBible', e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: '400px',
                    padding: '1rem',
                    borderRadius: '4px',
                    border: '1px solid #16213e',
                    background: '#1a1a2e',
                    color: '#fff',
                    fontSize: '0.9rem',
                    fontFamily: 'monospace',
                    resize: 'vertical'
                  }}
                />
              </div>
            )}

            {settingsTab === 'camera' && (
              <div>
                <h2 style={{ marginBottom: '0.5rem' }}>Camera & Inks</h2>
                <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Lighting, composition, and ink style rules
                </p>
                <textarea
                  value={settings.cameraInks}
                  onChange={(e) => updateSetting('cameraInks', e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: '200px',
                    padding: '1rem',
                    borderRadius: '4px',
                    border: '1px solid #16213e',
                    background: '#1a1a2e',
                    color: '#fff',
                    fontSize: '0.9rem',
                    fontFamily: 'monospace',
                    resize: 'vertical'
                  }}
                />
              </div>
            )}

            {settingsTab === 'characters' && (
              <div>
                <h2 style={{ marginBottom: '0.5rem' }}>Character Bible</h2>
                <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Define characters to maintain consistency across pages
                </p>

                {settings.characters.map((char) => (
                  <div
                    key={char.id}
                    style={{
                      background: '#1a1a2e',
                      borderRadius: '8px',
                      padding: '1rem',
                      marginBottom: '1rem'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <input
                        type="text"
                        value={char.name}
                        onChange={(e) => updateCharacter(char.id, 'name', e.target.value)}
                        placeholder="Character name"
                        style={{
                          padding: '0.5rem',
                          borderRadius: '4px',
                          border: '1px solid #16213e',
                          background: '#0f3460',
                          color: '#fff',
                          fontSize: '1rem',
                          fontWeight: 'bold',
                          flex: 1,
                          marginRight: '1rem'
                        }}
                      />
                      <button
                        onClick={() => removeCharacter(char.id)}
                        style={{
                          padding: '0.4rem 0.8rem',
                          background: '#c0392b',
                          border: 'none',
                          borderRadius: '4px',
                          color: '#fff',
                          cursor: 'pointer',
                          fontSize: '0.85rem'
                        }}
                      >
                        Remove
                      </button>
                    </div>
                    <textarea
                      value={char.description}
                      onChange={(e) => updateCharacter(char.id, 'description', e.target.value)}
                      placeholder="Character description (gender, age, build, face anchors, hair, clothing, props, condition...)"
                      style={{
                        width: '100%',
                        minHeight: '150px',
                        padding: '0.75rem',
                        borderRadius: '4px',
                        border: '1px solid #16213e',
                        background: '#0f3460',
                        color: '#fff',
                        fontSize: '0.85rem',
                        fontFamily: 'monospace',
                        resize: 'vertical'
                      }}
                    />
                  </div>
                ))}

                <div style={{ background: '#1a1a2e', borderRadius: '8px', padding: '1rem', border: '2px dashed #16213e' }}>
                  <h4 style={{ marginBottom: '0.5rem' }}>Add New Character</h4>
                  <input
                    type="text"
                    value={newCharacter.name}
                    onChange={(e) => setNewCharacter(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Character name"
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #16213e',
                      background: '#0f3460',
                      color: '#fff',
                      marginBottom: '0.5rem'
                    }}
                  />
                  <textarea
                    value={newCharacter.description}
                    onChange={(e) => setNewCharacter(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Character description..."
                    style={{
                      width: '100%',
                      minHeight: '100px',
                      padding: '0.75rem',
                      borderRadius: '4px',
                      border: '1px solid #16213e',
                      background: '#0f3460',
                      color: '#fff',
                      fontSize: '0.85rem',
                      marginBottom: '0.5rem',
                      resize: 'vertical'
                    }}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={addCharacter}
                    style={{ padding: '0.5rem 1rem' }}
                  >
                    + Add Character
                  </button>
                </div>
              </div>
            )}

            {settingsTab === 'text' && (
              <div>
                <h2 style={{ marginBottom: '0.5rem' }}>Text & Lettering</h2>
                <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Rules for captions, speech bubbles, and text styling
                </p>
                <textarea
                  value={settings.textLettering}
                  onChange={(e) => updateSetting('textLettering', e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: '200px',
                    padding: '1rem',
                    borderRadius: '4px',
                    border: '1px solid #16213e',
                    background: '#1a1a2e',
                    color: '#fff',
                    fontSize: '0.9rem',
                    fontFamily: 'monospace',
                    resize: 'vertical'
                  }}
                />
              </div>
            )}

            {settingsTab === 'donot' && (
              <div>
                <h2 style={{ marginBottom: '1rem' }}>Global Do Not</h2>
                <textarea
                  value={settings.globalDoNot}
                  onChange={(e) => updateSetting('globalDoNot', e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: '180px',
                    padding: '1rem',
                    borderRadius: '4px',
                    border: '1px solid #16213e',
                    background: '#1a1a2e',
                    color: '#fff',
                    fontSize: '0.9rem',
                    fontFamily: 'monospace',
                    resize: 'vertical',
                    marginBottom: '1.5rem'
                  }}
                />

                <h2 style={{ marginBottom: '1rem' }}>Hard Negatives</h2>
                <textarea
                  value={settings.hardNegatives}
                  onChange={(e) => updateSetting('hardNegatives', e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: '150px',
                    padding: '1rem',
                    borderRadius: '4px',
                    border: '1px solid #16213e',
                    background: '#1a1a2e',
                    color: '#fff',
                    fontSize: '0.9rem',
                    fontFamily: 'monospace',
                    resize: 'vertical'
                  }}
                />
              </div>
            )}

            {settingsTab === 'templates' && (
              <div>
                <h2 style={{ marginBottom: '0.5rem' }}>First Page Template</h2>
                <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Special instructions for Page 1 only
                </p>
                <textarea
                  value={settings.firstPageTemplate}
                  onChange={(e) => updateSetting('firstPageTemplate', e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: '150px',
                    padding: '1rem',
                    borderRadius: '4px',
                    border: '1px solid #16213e',
                    background: '#1a1a2e',
                    color: '#fff',
                    fontSize: '0.9rem',
                    fontFamily: 'monospace',
                    resize: 'vertical',
                    marginBottom: '1.5rem'
                  }}
                />

                <h2 style={{ marginBottom: '0.5rem' }}>Other Pages Template</h2>
                <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Instructions for pages 2 and onwards
                </p>
                <textarea
                  value={settings.otherPagesTemplate}
                  onChange={(e) => updateSetting('otherPagesTemplate', e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: '150px',
                    padding: '1rem',
                    borderRadius: '4px',
                    border: '1px solid #16213e',
                    background: '#1a1a2e',
                    color: '#fff',
                    fontSize: '0.9rem',
                    fontFamily: 'monospace',
                    resize: 'vertical'
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ComicEditor;

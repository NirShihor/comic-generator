import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
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

function ComicSettings() {
  const { id } = useParams();
  const [comic, setComic] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState('style');
  const [newCharacter, setNewCharacter] = useState({
    name: '',
    description: ''
  });
  const [saving, setSaving] = useState(false);

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

  if (!comic) {
    return <div>Loading...</div>;
  }

  const tabs = [
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
          <Link to={`/comic/${id}`} style={{ color: '#888', textDecoration: 'none', marginBottom: '0.5rem', display: 'block' }}>
            ← Back to {comic.title}
          </Link>
          <h1>Prompt Settings</h1>
          <p style={{ color: '#888', fontSize: '0.9rem' }}>
            Configure the AI prompt templates for generating comic pages
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={saveSettings}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`btn ${activeTab === tab.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab(tab.id)}
            style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ background: '#0f3460', borderRadius: '8px', padding: '1.5rem' }}>
        {activeTab === 'style' && (
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

        {activeTab === 'camera' && (
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

        {activeTab === 'characters' && (
          <div>
            <h2 style={{ marginBottom: '0.5rem' }}>Character Bible</h2>
            <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Define characters to maintain consistency across pages
            </p>

            {/* Existing Characters */}
            {settings.characters.map((char, idx) => (
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

            {/* Add New Character */}
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

        {activeTab === 'text' && (
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

        {activeTab === 'donot' && (
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

        {activeTab === 'templates' && (
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
  );
}

export default ComicSettings;

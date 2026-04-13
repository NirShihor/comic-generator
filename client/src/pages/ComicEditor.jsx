import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../services/api';

const DEFAULT_SETTINGS = {
  styleBible: '',
  styleBibleImages: [],
  cameraInks: '',
  characters: [],
  globalDoNot: '',
  hardNegatives: ''
};

function ComicEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [comic, setComic] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pages');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsSource, setSettingsSource] = useState('comic'); // 'comic' or 'collection'
  const [settingsCollectionId, setSettingsCollectionId] = useState(null);
  const [settingsTab, setSettingsTab] = useState('style');
  const [saving, setSaving] = useState(false);
  const [newCharacter, setNewCharacter] = useState({ name: '', description: '' });
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [deleteModal, setDeleteModal] = useState({ show: false, page: null });
  const [deleting, setDeleting] = useState(false);
  const [wordAudioVoiceId, setWordAudioVoiceId] = useState('');
  const [wordAudioModel, setWordAudioModel] = useState('eleven_v3');
  const [wordAudioGenerating, setWordAudioGenerating] = useState(false);
  const [wordAudioProgress, setWordAudioProgress] = useState(null);
  const [wordAudioForceRegenerate, setWordAudioForceRegenerate] = useState(false);

  // Reference builder state
  const [refImage, setRefImage] = useState(null);
  const [refMessages, setRefMessages] = useState([]);
  const [refInput, setRefInput] = useState('');
  const [refLoading, setRefLoading] = useState(false);
  const refFileInputRef = useRef(null);
  const refMessagesEndRef = useRef(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState(() => {
    try {
      const saved = localStorage.getItem(`comic-chat-${id}`);
      if (saved) {
        return JSON.parse(saved).map(msg => ({
          role: msg.role,
          content: msg.content,
          hadImages: msg.hadImages
        }));
      }
      return [];
    } catch (e) {
      localStorage.removeItem(`comic-chat-${id}`);
      return [];
    }
  });
  const [chatInput, setChatInput] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [chatImages, setChatImages] = useState([]);
  const chatFileInputRef = useRef(null);
  const chatMessagesEndRef = useRef(null);
  const chatMessagesRef = useRef(chatMessages);

  useEffect(() => {
    if (chatMessages.length > 0) {
      const messagesWithoutImages = chatMessages.map(msg => ({
        role: msg.role,
        content: msg.content,
        hadImages: msg.images && msg.images.length > 0
      }));
      try {
        localStorage.setItem(`comic-chat-${id}`, JSON.stringify(messagesWithoutImages));
      } catch (e) {}
    }
    chatMessagesRef.current = chatMessages;
  }, [chatMessages, id]);

  useEffect(() => {
    loadComic();
  }, [id]);

  const loadComic = async () => {
    try {
      const response = await api.get(`/comics/${id}`);
      setComic(response.data);

      // Load prompt settings from resolver (collection or comic)
      try {
        const settingsRes = await api.get(`/comics/${id}/prompt-settings`);
        const { source, collectionId, promptSettings } = settingsRes.data;
        setSettingsSource(source);
        setSettingsCollectionId(collectionId);
        if (promptSettings) {
          const loadedSettings = { ...DEFAULT_SETTINGS, ...promptSettings };
          if (loadedSettings.characters) {
            loadedSettings.characters = loadedSettings.characters.map((char, idx) => ({
              ...char,
              id: char.id || `char-${Date.now()}-${idx}`
            }));
          }
          setSettings(loadedSettings);
        }
      } catch (settingsErr) {
        console.error('Failed to load prompt settings, falling back to comic:', settingsErr);
        // Fallback to comic-level settings
        if (response.data.promptSettings) {
          const loadedSettings = { ...DEFAULT_SETTINGS, ...response.data.promptSettings };
          if (loadedSettings.characters) {
            loadedSettings.characters = loadedSettings.characters.map((char, idx) => ({
              ...char,
              id: char.id || `char-${Date.now()}-${idx}`
            }));
          }
          setSettings(loadedSettings);
        }
      }
    } catch (error) {
      console.error('Failed to load comic:', error);
    } finally {
      setLoading(false);
    }
  };

  const addPage = async (afterPageNumber = null) => {
    try {
      const response = await api.post(`/comics/${id}/pages`, afterPageNumber != null ? { afterPageNumber } : {});
      const newPage = response.data;
      // Reload comic to ensure fresh data
      await loadComic();
      navigate(`/comic/${id}/page/${newPage.id}`);
    } catch (error) {
      console.error('Failed to add page:', error);
    }
  };

  const handleDeletePage = async (archive = false) => {
    if (!deleteModal.page) return;

    setDeleting(true);
    try {
      await api.delete(`/comics/${id}/pages/${deleteModal.page.id}?archive=${archive}&deleteAudio=${!archive}`);
      setDeleteModal({ show: false, page: null });
      // Reload comic from server to ensure fresh data
      await loadComic();
    } catch (error) {
      console.error('Failed to delete page:', error);
      alert('Failed to delete page: ' + error.message);
    } finally {
      setDeleting(false);
    }
  };

  const downloadWordList = () => {
    if (!comic) return;
    const rows = [];
    for (const page of (comic.pages || [])) {
      // Bubbles live at the page level
      for (const bubble of (page.bubbles || [])) {
        for (const sentence of (bubble.sentences || [])) {
          for (const word of (sentence.words || [])) {
            if (!word.text || word.text.trim() === '') continue;
            rows.push({
              word: word.text,
              meaning: word.meaning || '',
              baseForm: word.baseForm || '',
              page: page.pageNumber || '',
              sentence: sentence.text || ''
            });
          }
        }
      }
    }

    // Deduplicate by word text (keep first occurrence for context)
    const seen = new Map();
    const unique = [];
    for (const row of rows) {
      const key = row.word.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, true);
        unique.push(row);
      }
    }

    unique.sort((a, b) => a.word.localeCompare(b.word));

    const csvHeader = 'Word,Meaning,Base Form,Page,Sentence';
    const csvRows = unique.map(r =>
      `"${r.word.replace(/"/g, '""')}","${r.meaning.replace(/"/g, '""')}","${r.baseForm.replace(/"/g, '""')}",${r.page},"${r.sentence.replace(/"/g, '""')}"`
    );
    const csv = [csvHeader, ...csvRows].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${comic.title.toLowerCase().replace(/\s+/g, '_')}_words.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportComicJson = async () => {
    try {
      const response = await api.get(`/comics/${id}/export`);
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${comic.title.toLowerCase().replace(/\s+/g, '_')}_comic.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export comic:', error);
      alert('Failed to export comic JSON');
    }
  };

  const exportComicFull = async () => {
    setExporting(true);
    setExportResult(null);
    try {
      const response = await api.post(`/comics/${id}/export-full`, {});
      setExportResult(response.data);
    } catch (error) {
      console.error('Failed to export comic:', error);
      alert('Failed to export comic: ' + error.message);
    } finally {
      setExporting(false);
    }
  };

  const saveSettings = async (settingsToSave, silent = false) => {
    const data = settingsToSave || settings;
    setSaving(true);
    try {
      if (settingsSource === 'collection' && settingsCollectionId) {
        await api.put(`/collections/${settingsCollectionId}`, {
          title: comic.collectionTitle || '',
          promptSettings: data
        });
        if (!silent) alert('Collection settings saved! (shared across all episodes)');
      } else if (comic.collectionId && settingsSource === 'comic') {
        await api.put(`/collections/${comic.collectionId}`, {
          title: comic.collectionTitle || '',
          promptSettings: data
        });
        setSettingsSource('collection');
        setSettingsCollectionId(comic.collectionId);
        if (!silent) alert('Collection created and settings saved! (now shared across all episodes)');
      } else {
        await api.put(`/comics/${id}`, { promptSettings: data });
        setComic({ ...comic, promptSettings: data });
        if (!silent) alert('Settings saved!');
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      if (!silent) alert('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const addCharacter = () => {
    if (!newCharacter.name.trim()) return;
    setSettings(prev => {
      const updated = {
        ...prev,
        characters: [...prev.characters, { ...newCharacter, id: `char-${Date.now()}` }]
      };
      saveSettings(updated, true);
      return updated;
    });
    setNewCharacter({ name: '', description: '' });
  };

  const removeCharacter = (index) => {
    setSettings(prev => {
      const updated = {
        ...prev,
        characters: prev.characters.filter((_, i) => i !== index)
      };
      saveSettings(updated, true);
      return updated;
    });
  };

  const updateCharacter = (index, field, value) => {
    setSettings(prev => ({
      ...prev,
      characters: prev.characters.map((c, i) =>
        i === index ? { ...c, [field]: value } : c
      )
    }));
  };

  // Chat handlers
  const scrollToBottomOfChat = () => {
    chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const clearChat = () => {
    setChatMessages([]);
    chatMessagesRef.current = [];
    localStorage.removeItem(`comic-chat-${id}`);
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() && chatImages.length === 0) return;
    const userMessage = { role: 'user', content: chatInput, images: chatImages.map(img => img.preview) };
    const newMessages = [...chatMessagesRef.current, userMessage];
    chatMessagesRef.current = newMessages;
    setChatMessages(newMessages);
    const messageText = chatInput;
    setChatInput('');
    const imagesToSend = [...chatImages];
    setChatImages([]);
    setIsSendingChat(true);
    try {
      const response = await api.post('/chat/message', {
        messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        images: imagesToSend.map(img => img.base64)
      });
      const assistantMessage = { role: 'assistant', content: response.data.message };
      const messagesWithResponse = [...chatMessagesRef.current, assistantMessage];
      chatMessagesRef.current = messagesWithResponse;
      setChatMessages(messagesWithResponse);
    } catch (error) {
      const errorMessage = { role: 'assistant', content: `Error: ${error.response?.data?.error || error.message}` };
      const messagesWithError = [...chatMessagesRef.current, errorMessage];
      chatMessagesRef.current = messagesWithError;
      setChatMessages(messagesWithError);
    } finally {
      setIsSendingChat(false);
      setTimeout(scrollToBottomOfChat, 100);
    }
  };

  const handleChatFileUpload = (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target.result.split(',')[1];
        setChatImages(prev => [...prev, { preview: event.target.result, base64, name: file.name }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removeChatImage = (index) => {
    setChatImages(prev => prev.filter((_, i) => i !== index));
  };

  // Reference builder handlers
  const handleRefImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target.result.split(',')[1];
      const newImage = { preview: event.target.result, base64 };
      setRefImage(newImage);
      setRefMessages([]);
      setRefInput('');
      // Auto-describe the image
      setRefLoading(true);
      try {
        const response = await api.post('/chat/describe-image', { image: base64 });
        const initialMessages = [
          { role: 'user', content: 'Describe this reference image in detail for use in comic book art direction prompts.', isInitial: true },
          { role: 'assistant', content: response.data.message }
        ];
        setRefMessages(initialMessages);
      } catch (error) {
        setRefMessages([
          { role: 'user', content: 'Describe this reference image.', isInitial: true },
          { role: 'assistant', content: `Error: ${error.response?.data?.error || error.message}` }
        ]);
      } finally {
        setRefLoading(false);
        setTimeout(() => refMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const sendRefMessage = async () => {
    if (!refInput.trim() || !refImage) return;
    const newMessages = [...refMessages, { role: 'user', content: refInput }];
    setRefMessages(newMessages);
    const messageText = refInput;
    setRefInput('');
    setRefLoading(true);
    try {
      const response = await api.post('/chat/describe-image', {
        image: refImage.base64,
        messages: newMessages
      });
      setRefMessages(prev => [...prev, { role: 'assistant', content: response.data.message }]);
    } catch (error) {
      setRefMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error.response?.data?.error || error.message}` }]);
    } finally {
      setRefLoading(false);
      setTimeout(() => refMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  const addRefToCharacterBible = async () => {
    // Get the last assistant message as the description
    const lastAssistant = [...refMessages].reverse().find(m => m.role === 'assistant');
    if (!lastAssistant || !refImage) return;
    const name = prompt('Enter a name for this entry (character, object, setting...):');
    if (!name || !name.trim()) return;

    try {
      // Save the reference image to the project (or collection)
      const savePayload = { image: refImage.base64 };
      if (settingsSource === 'collection' && settingsCollectionId) {
        savePayload.collectionId = settingsCollectionId;
      } else {
        savePayload.comicId = id;
      }
      const response = await api.post('/images/save-reference', savePayload);
      setSettings(prev => ({
        ...prev,
        characters: [...prev.characters, {
          id: `char-${Date.now()}`,
          name: name.trim(),
          description: lastAssistant.content,
          image: response.data.path
        }]
      }));
      setSettingsTab('characters');
    } catch (error) {
      console.error('Failed to save reference image:', error);
      // Still add the entry without the image
      setSettings(prev => ({
        ...prev,
        characters: [...prev.characters, {
          id: `char-${Date.now()}`,
          name: name.trim(),
          description: lastAssistant.content
        }]
      }));
      setSettingsTab('characters');
    }
  };

  const addRefToStyleBible = async () => {
    const lastAssistant = [...refMessages].reverse().find(m => m.role === 'assistant');
    if (!lastAssistant || !refImage) return;
    const name = prompt('Enter a name for this reference (e.g. landscape, building, prop...):');
    if (!name || !name.trim()) return;

    try {
      const savePayload = { image: refImage.base64 };
      if (settingsSource === 'collection' && settingsCollectionId) {
        savePayload.collectionId = settingsCollectionId;
      } else {
        savePayload.comicId = id;
      }
      const response = await api.post('/images/save-reference', savePayload);
      const newImage = {
        id: `style-img-${Date.now()}`,
        name: name.trim(),
        image: response.data.path,
        description: lastAssistant.content
      };
      setSettings(prev => {
        const updated = {
          ...prev,
          styleBibleImages: [...(prev.styleBibleImages || []), newImage]
        };
        saveSettings(updated, true);
        return updated;
      });
      setSettingsTab('style');
    } catch (error) {
      console.error('Failed to save reference image:', error);
    }
  };

  const clearRef = () => {
    setRefImage(null);
    setRefMessages([]);
    setRefInput('');
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
    { id: 'donot', label: 'Do Not / Negatives' },
    { id: 'reference', label: 'Reference Builder' }
  ];

  return (
    <div style={{ maxWidth: 'none', width: 'calc(100vw - 4rem)' }}>
      <div className="page-header">
        <div>
          <Link to="/" style={{ color: '#888', textDecoration: 'none', marginBottom: '0.5rem', display: 'block' }}>
            ← Back to Comics
          </Link>
          <h1>{comic.title}</h1>
          <p style={{ color: '#888' }}>{comic.description}</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button className="btn btn-primary" onClick={() => addPage()}>
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
        <button
          className={`btn ${activeTab === 'export' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('export')}
          style={{ padding: '0.6rem 1.2rem' }}
        >
          Export
        </button>
        <button
          className={`btn ${activeTab === 'voices' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('voices')}
          style={{ padding: '0.6rem 1.2rem' }}
        >
          Voices ({(comic.voices || []).length})
        </button>
      </div>

      {/* Prompt Settings Sub-tabs (outside flex row so chat aligns with content) */}
      {activeTab === 'prompt' && (
        <>
          {/* Collection settings banner */}
          {(settingsSource === 'collection' || comic.collectionId) && (
            <div style={{
              background: '#2d1f5e',
              border: '1px solid #7c3aed',
              borderRadius: '8px',
              padding: '0.75rem 1rem',
              marginBottom: '0.75rem',
              maxWidth: '700px',
              fontSize: '0.85rem',
              color: '#c4b5fd'
            }}>
              {settingsSource === 'collection'
                ? `Editing shared collection settings for "${comic.collectionTitle || settingsCollectionId}". Changes apply to all episodes.`
                : `This comic belongs to collection "${comic.collectionTitle || comic.collectionId}". Saving will create shared collection settings.`
              }
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', maxWidth: '700px' }}>
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
              {saving ? 'Saving...' : settingsSource === 'collection' || comic.collectionId ? 'Save to Collection' : 'Save Settings'}
            </button>
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'stretch' }}>
      {/* Left column: Tab Content */}
      <div style={{ width: '700px', flexShrink: 0 }}>

      {/* Pages Tab */}
      {activeTab === 'pages' && (
        <div>
          <div className="page-grid">
            {/* Cover */}
            <div
              className="page-thumbnail"
              style={{ border: '2px solid #e94560' }}
              onClick={() => navigate(`/comic/${id}/cover`)}
            >
              {comic.cover?.image ? (
                <img
                  src={`http://localhost:3001${comic.cover.image}`}
                  alt="Cover"
                />
              ) : (
                <div style={{
                  aspectRatio: '2/3',
                  background: '#f5f5f5',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#666'
                }}>
                  No Image
                </div>
              )}
              <p style={{ fontWeight: 'bold', color: '#e94560' }}>Cover</p>
            </div>

            {/* Regular Pages (sorted by pageNumber, with insert buttons between) */}
            {[...comic.pages].sort((a, b) => a.pageNumber - b.pageNumber).map((page) => (
              <React.Fragment key={page.id}>
                <div
                  className="page-thumbnail"
                  style={{ position: 'relative', cursor: 'pointer' }}
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
                      background: '#f5f5f5',
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
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteModal({ show: true, page });
                    }}
                    style={{
                      position: 'absolute',
                      top: '4px',
                      right: '4px',
                      background: 'rgba(192, 57, 43, 0.9)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '50%',
                      width: '24px',
                      height: '24px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title="Delete page"
                  >
                    ×
                  </button>
                  {/* Insert page after this page */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      addPage(page.pageNumber);
                    }}
                    style={{
                      position: 'absolute',
                      bottom: '4px',
                      right: '4px',
                      background: 'rgba(39, 174, 96, 0.9)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      cursor: 'pointer',
                      fontSize: '10px',
                    }}
                    title={`Insert new page after page ${page.pageNumber}`}
                  >
                    + Insert After
                  </button>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Prompt Settings Tab */}
      {activeTab === 'prompt' && (
        <div>
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

                {/* Style Bible Reference Images */}
                {settings.styleBibleImages && settings.styleBibleImages.length > 0 && (
                  <div style={{ marginTop: '1.5rem' }}>
                    <h3 style={{ marginBottom: '0.75rem', color: '#ccc' }}>Reference Images</h3>
                    {settings.styleBibleImages.map((item, index) => (
                      <div
                        key={item.id || `style-img-${index}`}
                        style={{
                          background: '#1a1a2e',
                          borderRadius: '8px',
                          padding: '1rem',
                          marginBottom: '1rem',
                          display: 'flex',
                          gap: '1rem',
                          alignItems: 'flex-start'
                        }}
                      >
                        <img
                          src={`http://localhost:3001${item.image}`}
                          alt="Style reference"
                          style={{ maxHeight: '150px', borderRadius: '6px', border: '1px solid #333', flexShrink: 0 }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                            <input
                              type="text"
                              value={item.name || ''}
                              onChange={(e) => {
                                setSettings(prev => ({
                                  ...prev,
                                  styleBibleImages: prev.styleBibleImages.map((img, i) =>
                                    i === index ? { ...img, name: e.target.value } : img
                                  )
                                }));
                              }}
                              placeholder="Name (e.g. landscape, building...)"
                              style={{
                                background: 'transparent',
                                border: '1px solid #333',
                                borderRadius: '4px',
                                color: '#fff',
                                padding: '0.3rem 0.5rem',
                                fontSize: '0.9rem',
                                fontWeight: 'bold',
                                flex: 1
                              }}
                            />
                            <button
                              onClick={() => {
                                setSettings(prev => {
                                  const updated = {
                                    ...prev,
                                    styleBibleImages: prev.styleBibleImages.filter((_, i) => i !== index)
                                  };
                                  saveSettings(updated, true);
                                  return updated;
                                });
                              }}
                              style={{
                                marginLeft: '0.5rem',
                                padding: '0.3rem 0.6rem',
                                background: '#c0392b',
                                border: 'none',
                                borderRadius: '4px',
                                color: '#fff',
                                cursor: 'pointer',
                                fontSize: '0.8rem'
                              }}
                            >
                              Remove
                            </button>
                          </div>
                          <p style={{
                            color: '#ddd',
                            fontSize: '0.85rem',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            margin: 0
                          }}>
                            {item.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
                  Define characters, objects, and settings to maintain consistency across pages
                </p>

                {settings.characters.map((char, index) => (
                  <div
                    key={char.id || `fallback-${index}`}
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
                        onChange={(e) => updateCharacter(index, 'name', e.target.value)}
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
                        onClick={() => removeCharacter(index)}
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
                    {char.image && (
                      <div style={{ marginBottom: '0.5rem' }}>
                        <img
                          src={`http://localhost:3001${char.image}`}
                          alt={char.name}
                          style={{ maxHeight: '150px', borderRadius: '6px', border: '1px solid #333' }}
                        />
                      </div>
                    )}
                    <textarea
                      value={char.description}
                      onChange={(e) => updateCharacter(index, 'description', e.target.value)}
                      placeholder="Description (appearance, build, clothing, distinguishing features, materials, colors...)"
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

            {settingsTab === 'donot' && (
              <div>
                <h2 style={{ marginBottom: '1rem', color: 'white' }}>Global Do Not</h2>
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

                <h2 style={{ marginBottom: '1rem', color: 'white' }}>Hard Negatives</h2>
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

            {settingsTab === 'reference' && (
              <div>
                <h2 style={{ marginBottom: '0.5rem' }}>Reference Builder</h2>
                <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Upload a reference image and let AI describe it. Refine until you're happy, then add it to the Character Bible.
                </p>

                {/* Upload area */}
                {!refImage ? (
                  <div
                    onClick={() => refFileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const file = e.dataTransfer.files[0];
                      if (file && file.type.startsWith('image/')) {
                        const fakeEvent = { target: { files: [file], value: '' } };
                        Object.defineProperty(fakeEvent.target, 'value', { set: () => {} });
                        handleRefImageUpload(fakeEvent);
                      }
                    }}
                    style={{
                      border: '2px dashed #16213e',
                      borderRadius: '8px',
                      padding: '3rem',
                      textAlign: 'center',
                      cursor: 'pointer',
                      background: '#1a1a2e',
                      color: '#888',
                      marginBottom: '1rem'
                    }}
                  >
                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>+</div>
                    <div>Click or drag an image here</div>
                  </div>
                ) : (
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginBottom: '1rem' }}>
                      <img
                        src={refImage.preview}
                        alt="Reference"
                        style={{ maxHeight: '200px', borderRadius: '8px', border: '1px solid #333' }}
                      />
                      <button
                        onClick={clearRef}
                        style={{
                          padding: '0.4rem 0.8rem',
                          background: '#c0392b',
                          border: 'none',
                          borderRadius: '4px',
                          color: '#fff',
                          cursor: 'pointer',
                          fontSize: '0.8rem'
                        }}
                      >
                        Clear
                      </button>
                    </div>

                    {/* Conversation */}
                    <div style={{
                      background: '#1a1a2e',
                      borderRadius: '8px',
                      padding: '1rem',
                      maxHeight: '400px',
                      overflowY: 'auto',
                      marginBottom: '0.75rem'
                    }}>
                      {refMessages.filter(m => m.role === 'assistant').length === 0 && refLoading && (
                        <div style={{ color: '#888', fontStyle: 'italic', fontSize: '0.85rem' }}>Analyzing image...</div>
                      )}
                      {refMessages.map((msg, idx) => (
                        <div key={idx} style={{
                          marginBottom: '0.5rem',
                          padding: '0.5rem',
                          borderRadius: '6px',
                          background: msg.role === 'user' ? '#16213e' : '#1e3a5f',
                          color: '#ddd',
                          fontSize: '0.85rem',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word'
                        }}>
                          <div style={{ fontSize: '0.65rem', color: '#888', marginBottom: '0.25rem', textTransform: 'uppercase' }}>
                            {msg.role === 'user' ? 'You' : 'AI'}
                          </div>
                          {msg.content}
                        </div>
                      ))}
                      {refLoading && refMessages.length > 0 && (
                        <div style={{ color: '#888', fontStyle: 'italic', fontSize: '0.85rem', padding: '0.5rem' }}>Thinking...</div>
                      )}
                      <div ref={refMessagesEndRef} />
                    </div>

                    {/* Refinement input */}
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                      <textarea
                        value={refInput}
                        onChange={(e) => setRefInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendRefMessage();
                          }
                        }}
                        placeholder="Ask for changes... (Enter to send)"
                        rows={2}
                        disabled={refLoading}
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          borderRadius: '4px',
                          border: '1px solid #16213e',
                          background: '#0f3460',
                          color: '#fff',
                          fontSize: '0.85rem',
                          resize: 'vertical'
                        }}
                      />
                      <button
                        onClick={sendRefMessage}
                        disabled={refLoading || !refInput.trim()}
                        style={{
                          padding: '0.5rem 1rem',
                          background: refLoading || !refInput.trim() ? '#555' : '#3498db',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: refLoading || !refInput.trim() ? 'default' : 'pointer',
                          fontSize: '0.85rem',
                          alignSelf: 'flex-end'
                        }}
                      >
                        {refLoading ? '...' : 'Send'}
                      </button>
                    </div>

                    {/* Add to Bible buttons */}
                    {refMessages.some(m => m.role === 'assistant') && (
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          className="btn btn-primary"
                          onClick={addRefToCharacterBible}
                          style={{ padding: '0.5rem 1rem' }}
                        >
                          + Add to Character Bible
                        </button>
                        <button
                          className="btn btn-primary"
                          onClick={addRefToStyleBible}
                          style={{ padding: '0.5rem 1rem', background: '#8e44ad' }}
                        >
                          + Add to Style Bible
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <input
                  type="file"
                  ref={refFileInputRef}
                  onChange={handleRefImageUpload}
                  accept="image/*"
                  style={{ display: 'none' }}
                />
              </div>
            )}

            </div>
        </div>
      )}

      {/* Export Tab */}
      {activeTab === 'export' && (
        <div style={{ maxWidth: '800px' }}>
          <h2 style={{ marginBottom: '1rem' }}>Export for Comic Reader App</h2>
          <p style={{ color: '#666', marginBottom: '1.5rem' }}>
            Export your comic in the format required by the Comic Reader iOS app.
            This will generate the comic.json file and copy all images (master pages and panel crops).
          </p>

          {/* Publish Toggle */}
          <div style={{
            background: comic.published ? '#d4edda' : '#f8f9fa',
            border: `1px solid ${comic.published ? '#c3e6cb' : '#ddd'}`,
            borderRadius: '8px',
            padding: '1.5rem',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div>
              <h3 style={{ margin: 0, color: '#333' }}>Publish to Reader App</h3>
              <p style={{ color: '#888', fontSize: '0.85rem', margin: '0.3rem 0 0' }}>
                {comic.published
                  ? 'This comic is visible in the Reader app store.'
                  : 'This comic is not yet visible in the Reader app store.'}
              </p>
            </div>
            <button
              style={{
                padding: '0.5rem 1.2rem',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 'bold',
                color: '#fff',
                background: comic.published ? '#dc3545' : '#28a745'
              }}
              onClick={async () => {
                try {
                  await api.put(`/comics/${id}`, { published: !comic.published });
                  setComic({ ...comic, published: !comic.published });
                } catch (error) {
                  alert('Failed to update publish status');
                }
              }}
            >
              {comic.published ? 'Unpublish' : 'Publish'}
            </button>
          </div>

          {/* Collection Settings */}
          <div style={{
            background: '#f8f9fa',
            border: '1px solid #ddd',
            borderRadius: '8px',
            padding: '1.5rem',
            marginBottom: '1.5rem'
          }}>
            <h3 style={{ marginBottom: '1rem', color: '#333' }}>Collection Settings</h3>
            <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Group this comic into a collection with other episodes. Leave empty for standalone comics.
            </p>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem', color: '#555' }}>Collection Title</label>
              <input
                type="text"
                value={comic.collectionTitle || ''}
                onChange={(e) => {
                  const title = e.target.value ? e.target.value.toUpperCase() : undefined;
                  const collectionId = title
                    ? title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
                    : undefined;
                  setComic({ ...comic, collectionTitle: title, collectionId });
                }}
                placeholder="e.g. EL VISITANTE"
                style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
              />
              {comic.collectionId && (
                <span style={{ fontSize: '0.75rem', color: '#999', marginTop: '0.3rem', display: 'block' }}>
                  ID: {comic.collectionId}
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'end' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem', color: '#555' }}>Episode Number</label>
                <input
                  type="number"
                  min="1"
                  value={comic.episodeNumber || ''}
                  onChange={(e) => setComic({ ...comic, episodeNumber: e.target.value ? parseInt(e.target.value) : undefined })}
                  placeholder="e.g. 1"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>
              <div>
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    try {
                      const collectionData = {};
                      if (comic.collectionId) collectionData.collectionId = comic.collectionId;
                      if (comic.collectionTitle) collectionData.collectionTitle = comic.collectionTitle;
                      if (comic.episodeNumber) collectionData.episodeNumber = comic.episodeNumber;
                      await api.put(`/comics/${id}`, collectionData);
                      alert('Collection settings saved!');
                    } catch (error) {
                      alert('Failed to save collection settings');
                    }
                  }}
                  style={{ padding: '0.5rem 1.5rem' }}
                >
                  Save Collection Settings
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary"
              onClick={exportComicJson}
              style={{ padding: '0.75rem 1.5rem' }}
            >
              Download JSON Only
            </button>
            <button
              className="btn btn-primary"
              onClick={exportComicFull}
              disabled={exporting}
              style={{ padding: '0.75rem 1.5rem' }}
            >
              {exporting ? 'Exporting...' : 'Export Full Package'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={downloadWordList}
              style={{ padding: '0.75rem 1.5rem' }}
            >
              Download Word List
            </button>
          </div>

          {exportResult && (
            <div style={{
              background: '#d4edda',
              border: '1px solid #c3e6cb',
              borderRadius: '8px',
              padding: '1.5rem',
              marginBottom: '1.5rem'
            }}>
              <h3 style={{ color: '#155724', marginBottom: '1rem' }}>Export Successful!</h3>
              <p style={{ color: '#155724', marginBottom: '0.5rem' }}>
                <strong>Location:</strong> {exportResult.exportDir}
              </p>
              <p style={{ color: '#155724', marginBottom: '0.5rem' }}>
                <strong>Images copied:</strong> {exportResult.copiedImages?.length || 0}
              </p>
              <p style={{ color: '#155724', marginBottom: '0.5rem' }}>
                <strong>Sentence audio copied:</strong> {exportResult.copiedAudio?.length || 0}
              </p>
              <p style={{ color: '#155724', marginBottom: '0.5rem' }}>
                <strong>Word audio copied:</strong> {exportResult.copiedWordAudio?.length || 0}
              </p>
              <details style={{ marginTop: '1rem' }}>
                <summary style={{ cursor: 'pointer', color: '#155724' }}>
                  View copied files ({(exportResult.copiedImages?.length || 0) + (exportResult.copiedAudio?.length || 0) + (exportResult.copiedWordAudio?.length || 0)})
                </summary>
                <ul style={{ marginTop: '0.5rem', color: '#155724', fontSize: '0.85rem' }}>
                  {exportResult.copiedImages?.map((img, i) => (
                    <li key={`img-${i}`}>{img}</li>
                  ))}
                  {exportResult.copiedAudio?.map((a, i) => (
                    <li key={`audio-${i}`}>{a}</li>
                  ))}
                  {exportResult.copiedWordAudio?.map((w, i) => (
                    <li key={`word-${i}`}>{w}</li>
                  ))}
                </ul>
              </details>
            </div>
          )}

          <div style={{
            background: '#f8f9fa',
            border: '1px solid #ddd',
            borderRadius: '8px',
            padding: '1.5rem'
          }}>
            <h3 style={{ marginBottom: '1rem', color: '#333' }}>Export Contents</h3>
            <ul style={{ color: '#666', lineHeight: '1.8' }}>
              <li><strong>comic.json</strong> - Comic data in Comic Reader format (pages, panels, bubbles, sentences, words)</li>
              <li><strong>images/</strong> - All page images and panel crops
                <ul style={{ marginLeft: '1.5rem', marginTop: '0.5rem' }}>
                  <li><code>{'{comic}'}_cover.png</code> - Cover image</li>
                  <li><code>{'{comic}'}_p{'{N}'}.png</code> - Master page images</li>
                  <li><code>{'{comic}'}_p{'{N}'}_s{'{M}'}.png</code> - Panel/scene crops</li>
                </ul>
              </li>
              <li><strong>audio/</strong> - (placeholder) Audio files would go here</li>
            </ul>
          </div>

          <div style={{
            background: '#fff3cd',
            border: '1px solid #ffc107',
            borderRadius: '8px',
            padding: '1rem',
            marginTop: '1.5rem'
          }}>
            <p style={{ color: '#856404', margin: 0 }}>
              <strong>Note:</strong> After exporting, copy the export folder to your Comic Reader app's
              <code style={{ background: '#fff', padding: '0.2rem 0.4rem', borderRadius: '3px', margin: '0 0.3rem' }}>
                ComicReader/BundledComics/
              </code>
              directory.
            </p>
          </div>
        </div>
      )}

      {/* Voices Tab */}
      {activeTab === 'voices' && (
        <div style={{ maxWidth: '800px' }}>
          <h2 style={{ marginBottom: '1rem' }}>Voice Configuration</h2>
          <p style={{ color: '#666', marginBottom: '1.5rem' }}>
            Configure character voices using ElevenLabs voice IDs. These will be available when generating audio for sentences.
          </p>

          {/* Existing voices */}
          <div style={{ marginBottom: '2rem' }}>
            {(comic.voices || []).length === 0 ? (
              <p style={{ color: '#888', fontStyle: 'italic' }}>No voices configured yet. Add your first voice below.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {(comic.voices || []).map((voice, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '1rem',
                      background: '#f8f9fa',
                      padding: '1rem',
                      borderRadius: '8px',
                      border: '1px solid #ddd'
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>{voice.name}</div>
                      <div style={{ fontSize: '0.85rem', color: '#666', fontFamily: 'monospace' }}>{voice.voiceId}</div>
                    </div>
                    <button
                      className="btn btn-danger"
                      onClick={async () => {
                        const updatedVoices = comic.voices.filter((_, i) => i !== idx);
                        try {
                          await api.put(`/comics/${id}`, { voices: updatedVoices });
                          setComic({ ...comic, voices: updatedVoices });
                        } catch (error) {
                          console.error('Failed to remove voice:', error);
                          alert('Failed to remove voice');
                        }
                      }}
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add new voice */}
          <div style={{
            background: '#e8f4fc',
            padding: '1.5rem',
            borderRadius: '8px',
            border: '1px solid #b8d4e3'
          }}>
            <h3 style={{ marginBottom: '1rem', color: '#2980b9' }}>Add New Voice</h3>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#666' }}>
                  Character Name
                </label>
                <input
                  type="text"
                  id="newVoiceName"
                  placeholder="e.g., Narrator, Javier, Diego"
                  style={{
                    width: '100%',
                    padding: '0.6rem',
                    borderRadius: '4px',
                    border: '1px solid #ccc',
                    fontSize: '1rem'
                  }}
                />
              </div>
              <div style={{ flex: 1.5 }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#666' }}>
                  ElevenLabs Voice ID
                </label>
                <input
                  type="text"
                  id="newVoiceId"
                  placeholder="e.g., EXAVITQu4vr4xnSDxMaL"
                  style={{
                    width: '100%',
                    padding: '0.6rem',
                    borderRadius: '4px',
                    border: '1px solid #ccc',
                    fontSize: '1rem',
                    fontFamily: 'monospace'
                  }}
                />
              </div>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const nameInput = document.getElementById('newVoiceName');
                  const idInput = document.getElementById('newVoiceId');
                  const name = nameInput.value.trim();
                  const voiceId = idInput.value.trim();

                  if (!name || !voiceId) {
                    alert('Please enter both a name and voice ID');
                    return;
                  }

                  // Check for duplicate voice ID
                  if ((comic.voices || []).some(v => v.voiceId === voiceId)) {
                    alert('This voice ID is already added');
                    return;
                  }

                  const updatedVoices = [...(comic.voices || []), { name, voiceId }];
                  try {
                    await api.put(`/comics/${id}`, { voices: updatedVoices });
                    setComic({ ...comic, voices: updatedVoices });
                    nameInput.value = '';
                    idInput.value = '';
                  } catch (error) {
                    console.error('Failed to add voice:', error);
                    alert('Failed to add voice');
                  }
                }}
                style={{ padding: '0.6rem 1.5rem', whiteSpace: 'nowrap' }}
              >
                Add Voice
              </button>
            </div>
          </div>

          {/* Help section */}
          <div style={{
            background: '#f8f9fa',
            border: '1px solid #ddd',
            borderRadius: '8px',
            padding: '1.5rem',
            marginTop: '1.5rem'
          }}>
            <h3 style={{ marginBottom: '1rem', color: '#333' }}>Finding Voice IDs</h3>
            <ol style={{ color: '#666', lineHeight: '1.8', paddingLeft: '1.25rem' }}>
              <li>Go to <a href="https://elevenlabs.io/app/voice-library" target="_blank" rel="noopener noreferrer" style={{ color: '#3498db' }}>ElevenLabs Voice Library</a></li>
              <li>Find a voice you want to use</li>
              <li>Click on the voice to open its details</li>
              <li>Copy the Voice ID from the URL or the voice settings</li>
              <li>The ID looks like: <code style={{ background: '#fff', padding: '0.2rem 0.4rem', borderRadius: '3px' }}>EXAVITQu4vr4xnSDxMaL</code></li>
            </ol>
          </div>

          {/* Word Audio Generation */}
          <div style={{
            background: '#f0f7ee',
            border: '1px solid #a8d5a2',
            borderRadius: '8px',
            padding: '1.5rem',
            marginTop: '1.5rem'
          }}>
            <h3 style={{ marginBottom: '0.5rem', color: '#2d6a2e' }}>Word Audio Generation</h3>
            <p style={{ color: '#666', marginBottom: '1rem', fontSize: '0.9rem' }}>
              Generate individual audio files for every unique word in this comic.
              Used by the reader app for word-level pronunciation playback.
            </p>

            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '180px' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#666' }}>Voice</label>
                <select
                  value={wordAudioVoiceId}
                  onChange={(e) => setWordAudioVoiceId(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '0.95rem' }}
                >
                  <option value="">Select voice...</option>
                  {(comic.voices || []).map((voice, idx) => (
                    <option key={`wa-${voice.voiceId}-${idx}`} value={voice.voiceId}>{voice.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#666' }}>Model</label>
                <select
                  value={wordAudioModel}
                  onChange={(e) => setWordAudioModel(e.target.value)}
                  style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '0.95rem' }}
                >
                  <option value="eleven_v3">V3 (Best)</option>
                  <option value="eleven_multilingual_v2">Multilingual V2</option>
                  <option value="eleven_turbo_v2_5">Turbo V2.5</option>
                </select>
              </div>
              <button
                onClick={async () => {
                  if (!wordAudioVoiceId) { alert('Please select a voice'); return; }
                  setWordAudioGenerating(true);
                  setWordAudioProgress(null);
                  try {
                    const countRes = await api.post('/audio/word-audio-count', { comicId: id, forceRegenerate: wordAudioForceRegenerate });
                    setWordAudioProgress({ ...countRes.data, generated: 0, failed: 0, done: false });
                    const genRes = await api.post('/audio/generate-word-audio', {
                      comicId: id,
                      voiceId: wordAudioVoiceId,
                      modelId: wordAudioModel,
                      forceRegenerate: wordAudioForceRegenerate
                    }, { timeout: 600000 });
                    setWordAudioProgress(prev => ({ ...prev, generated: genRes.data.generated, skipped: genRes.data.skipped, failed: genRes.data.failed, done: true }));
                  } catch (error) {
                    console.error('Word audio generation failed:', error);
                    alert('Word audio generation failed: ' + error.message);
                  } finally {
                    setWordAudioGenerating(false);
                  }
                }}
                disabled={wordAudioGenerating || !wordAudioVoiceId || (comic.voices || []).length === 0}
                style={{
                  padding: '0.5rem 1.2rem',
                  background: (wordAudioGenerating || !wordAudioVoiceId) ? '#95a5a6' : '#27ae60',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: (wordAudioGenerating || !wordAudioVoiceId) ? 'default' : 'pointer',
                  fontSize: '0.95rem',
                  whiteSpace: 'nowrap'
                }}
              >
                {wordAudioGenerating ? 'Generating...' : 'Generate Word Audio'}
              </button>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: '#666', marginBottom: '0.5rem' }}>
              <input
                type="checkbox"
                checked={wordAudioForceRegenerate}
                onChange={(e) => setWordAudioForceRegenerate(e.target.checked)}
              />
              Force regenerate all (overwrite existing files)
            </label>

            {wordAudioProgress && (
              <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: '4px', padding: '1rem' }}>
                <p style={{ margin: '0 0 0.3rem 0', fontSize: '0.9rem' }}><strong>Total unique words:</strong> {wordAudioProgress.totalUnique}</p>
                <p style={{ margin: '0 0 0.3rem 0', fontSize: '0.9rem' }}><strong>Already on disk:</strong> {wordAudioProgress.alreadyGenerated}</p>
                <p style={{ margin: '0 0 0.3rem 0', fontSize: '0.9rem' }}><strong>To generate:</strong> {wordAudioProgress.toGenerate}</p>
                {wordAudioGenerating && !wordAudioProgress.done && (
                  <p style={{ margin: '0.5rem 0 0 0', color: '#856404', fontSize: '0.85rem' }}>
                    Generating audio... This may take several minutes. Please do not close this page.
                  </p>
                )}
                {wordAudioProgress.done && (
                  <div style={{ background: '#d4edda', padding: '0.75rem', borderRadius: '4px', marginTop: '0.5rem' }}>
                    <p style={{ margin: 0, color: '#155724' }}>
                      Done! Generated {wordAudioProgress.generated} files, skipped {wordAudioProgress.skipped} existing.
                      {wordAudioProgress.failed > 0 && ` (${wordAudioProgress.failed} failed)`}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      </div>{/* End left column */}

      {/* Right column: Chat Sidebar */}
      <div style={{
        flex: 1,
        minWidth: 0,
        background: '#1a1a2e',
        border: '1px solid #16213e',
        borderRadius: '8px',
        padding: '1rem',
        position: 'sticky',
        top: '1rem',
        maxHeight: 'calc(100vh - 2rem)',
        display: 'flex',
        flexDirection: 'column'
      }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', color: '#ccc' }}>ChatGPT</h3>
            <button
              onClick={clearChat}
              style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', background: '#e74c3c', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
            >Clear</button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            marginBottom: '0.75rem',
            padding: '0.5rem',
            background: '#0f0f23',
            borderRadius: '6px',
            minHeight: '200px',
            maxHeight: 'calc(100vh - 250px)'
          }}>
            {chatMessages.length === 0 && (
              <div style={{ color: '#555', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0.5rem' }}>
                <p>Start a conversation with ChatGPT</p>
                <p style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>Chat persists across page editor sessions</p>
              </div>
            )}
            {chatMessages.map((msg, idx) => (
              <div key={idx} style={{
                marginBottom: '0.5rem',
                padding: '0.5rem',
                borderRadius: '6px',
                background: msg.role === 'user' ? '#16213e' : '#1e3a5f',
                color: '#ddd',
                fontSize: '0.85rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}>
                <div style={{ fontSize: '0.65rem', color: '#888', marginBottom: '0.25rem', textTransform: 'uppercase' }}>
                  {msg.role === 'user' ? 'You' : 'ChatGPT'}
                </div>
                {msg.images && msg.images.length > 0 && (
                  <div style={{ marginBottom: '0.5rem' }}>
                    {msg.images.map((img, imgIdx) => (
                      <img key={imgIdx} src={img} alt="Uploaded" style={{ maxHeight: '80px', borderRadius: '4px', marginRight: '0.25rem' }} />
                    ))}
                  </div>
                )}
                {msg.hadImages && !msg.images && (
                  <div style={{ fontSize: '0.7rem', color: '#666', fontStyle: 'italic', marginBottom: '0.25rem' }}>[image was attached]</div>
                )}
                <div>{msg.content || '[No content]'}</div>
              </div>
            ))}
            {isSendingChat && (
              <div style={{ padding: '0.5rem', borderRadius: '6px', background: '#1e3a5f', color: '#888', fontSize: '0.85rem', fontStyle: 'italic' }}>
                Thinking...
              </div>
            )}
            <div ref={chatMessagesEndRef} />
          </div>

          {/* Pending images */}
          {chatImages.length > 0 && (
            <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
              {chatImages.map((img, idx) => (
                <div key={idx} style={{ position: 'relative' }}>
                  <img src={img.preview} alt={img.name} style={{ height: '40px', borderRadius: '3px', border: '1px solid #333' }} />
                  <button
                    onClick={() => removeChatImage(idx)}
                    style={{ position: 'absolute', top: '-4px', right: '-4px', background: '#e74c3c', color: '#fff', border: 'none', borderRadius: '50%', width: '16px', height: '16px', fontSize: '10px', cursor: 'pointer', lineHeight: '16px', padding: 0 }}
                  >x</button>
                </div>
              ))}
            </div>
          )}

          {/* Input */}
          <textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage();
              }
            }}
            placeholder="Type a message... (Enter to send)"
            rows={3}
            disabled={isSendingChat}
            style={{
              width: '100%',
              padding: '0.5rem',
              borderRadius: '4px',
              border: '1px solid #333',
              background: '#0f0f23',
              color: '#ddd',
              fontSize: '0.85rem',
              resize: 'vertical',
              marginBottom: '0.5rem',
              boxSizing: 'border-box'
            }}
          />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={sendChatMessage}
              disabled={isSendingChat || (!chatInput.trim() && chatImages.length === 0)}
              style={{
                flex: 1,
                padding: '0.4rem',
                background: (isSendingChat || (!chatInput.trim() && chatImages.length === 0)) ? '#555' : '#3498db',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: (isSendingChat || (!chatInput.trim() && chatImages.length === 0)) ? 'default' : 'pointer',
                fontSize: '0.85rem'
              }}
            >{isSendingChat ? 'Sending...' : 'Send'}</button>
            <input
              type="file"
              ref={chatFileInputRef}
              onChange={handleChatFileUpload}
              accept="image/*"
              multiple
              style={{ display: 'none' }}
            />
            <button
              onClick={() => chatFileInputRef.current?.click()}
              disabled={isSendingChat}
              style={{
                padding: '0.4rem 0.6rem',
                background: '#555',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: isSendingChat ? 'default' : 'pointer',
                fontSize: '0.75rem'
              }}
            >Upload</button>
          </div>
      </div>
      </div>{/* End flex row */}

      {/* Delete Page Confirmation Modal */}
      {deleteModal.show && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: '#1a1a2e',
            borderRadius: '8px',
            padding: '2rem',
            maxWidth: '450px',
            width: '90%',
            border: '1px solid #16213e'
          }}>
            <h2 style={{ marginBottom: '1rem', color: '#e94560' }}>Delete Page {deleteModal.page?.pageNumber}?</h2>
            <p style={{ marginBottom: '1.5rem', color: '#ccc', lineHeight: '1.5' }}>
              Choose how you want to remove this page:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button
                onClick={() => handleDeletePage(true)}
                disabled={deleting}
                style={{
                  padding: '0.75rem 1rem',
                  background: '#2980b9',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: deleting ? 'wait' : 'pointer',
                  fontSize: '0.95rem',
                  textAlign: 'left'
                }}
              >
                <strong>Archive</strong>
                <br />
                <small style={{ opacity: 0.8 }}>Move to archive. Can be restored later.</small>
              </button>

              <button
                onClick={() => handleDeletePage(false)}
                disabled={deleting}
                style={{
                  padding: '0.75rem 1rem',
                  background: '#c0392b',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: deleting ? 'wait' : 'pointer',
                  fontSize: '0.95rem',
                  textAlign: 'left'
                }}
              >
                <strong>Delete Permanently</strong>
                <br />
                <small style={{ opacity: 0.8 }}>Remove forever including audio files.</small>
              </button>

              <button
                onClick={() => setDeleteModal({ show: false, page: null })}
                disabled={deleting}
                style={{
                  padding: '0.75rem 1rem',
                  background: 'transparent',
                  color: '#888',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.95rem',
                  marginTop: '0.5rem'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ComicEditor;

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../services/api';

const DEFAULT_SETTINGS = {
  styleBible: '',
  styleBibleImages: [],
  cameraInks: '',
  characters: [],
  globalDoNot: '',
  hardNegatives: '',
  masterStyleImage: '',
  styleSheetImages: []
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
  const [collectionDescription, setCollectionDescription] = useState('');
  const [collectionCoverImage, setCollectionCoverImage] = useState('');
  const [collectionCoverPrompt, setCollectionCoverPrompt] = useState('');
  const [collectionCoverGenerating, setCollectionCoverGenerating] = useState(false);
  const [collectionCoverRefs, setCollectionCoverRefs] = useState([]);
  const [collectionCoverLightbox, setCollectionCoverLightbox] = useState(false);
  const [collectionCoverBrightness, setCollectionCoverBrightness] = useState(1);
  const [collectionCoverContrast, setCollectionCoverContrast] = useState(1);
  const [collectionCoverSaturation, setCollectionCoverSaturation] = useState(1);
  const collectionCoverAdjTimer = useRef(null);
  // Per-comic landscape cover (reader detail-view banner)
  const [coverLandscapeImage, setCoverLandscapeImage] = useState('');
  const [coverLandscapePrompt, setCoverLandscapePrompt] = useState('');
  const [coverLandscapeGenerating, setCoverLandscapeGenerating] = useState(false);
  const [coverLandscapeRefs, setCoverLandscapeRefs] = useState([]);
  const [bannerTitlePosition, setBannerTitlePosition] = useState('bottomLeft');
  const [coverLandscapeBrightness, setCoverLandscapeBrightness] = useState(1);
  const [coverLandscapeContrast, setCoverLandscapeContrast] = useState(1);
  const [coverLandscapeSaturation, setCoverLandscapeSaturation] = useState(1);
  const [coverLandscapeLightbox, setCoverLandscapeLightbox] = useState(false);
  const [coverLandscapeZoom, setCoverLandscapeZoom] = useState(1);
  const [coverLandscapeCropX, setCoverLandscapeCropX] = useState(0);
  const [coverLandscapeCropY, setCoverLandscapeCropY] = useState(0);
  const [coverLandscapeRefinePrompt, setCoverLandscapeRefinePrompt] = useState('');
  const coverLandscapeAdjTimer = useRef(null);
  const [refLightbox, setRefLightbox] = useState(null);  // reference image path to enlarge
  const [settingsTab, setSettingsTab] = useState('style');
  const [saving, setSaving] = useState(false);
  const settingsRef = useRef(DEFAULT_SETTINGS);
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
  const [wordFormsForceRegenerate, setWordFormsForceRegenerate] = useState(false);
  const [wordFormsGenerating, setWordFormsGenerating] = useState(false);
  const [wordFormsResult, setWordFormsResult] = useState(null);
  const [grammarNotesGenerating, setGrammarNotesGenerating] = useState(false);
  const [grammarNotesResult, setGrammarNotesResult] = useState(null);
  const [fillMeaningsRunning, setFillMeaningsRunning] = useState(false);
  const [fillMeaningsResult, setFillMeaningsResult] = useState(null);

  // Reference builder state
  const [refImage, setRefImage] = useState(null);
  const [refMessages, setRefMessages] = useState([]);
  const [refInput, setRefInput] = useState('');
  const [refLoading, setRefLoading] = useState(false);
  const refFileInputRef = useRef(null);
  const refMessagesEndRef = useRef(null);

  // Style Enforcer state
  const [enforcerImages, setEnforcerImages] = useState([]);
  const [enforcerProfile, setEnforcerProfile] = useState(null);
  const [enforcerAnalyzing, setEnforcerAnalyzing] = useState(false);
  const [enforcerEnforcing, setEnforcerEnforcing] = useState(false);
  const [enforcerReverting, setEnforcerReverting] = useState(false);
  const [enforcerStrength, setEnforcerStrength] = useState(0.75);
  const [enforcerBrightness, setEnforcerBrightness] = useState(0);
  const [enforcerContrast, setEnforcerContrast] = useState(0);
  const [enforcerSaturation, setEnforcerSaturation] = useState(0);
  const enforcerFileInputRef = useRef(null);

  // Studio tab state
  const [studioPrompt, setStudioPrompt] = useState('');
  const [studioProvider, setStudioProvider] = useState('gemini');
  const [studioAspectRatio, setStudioAspectRatio] = useState('square');
  const [studioGenerating, setStudioGenerating] = useState(false);
  const [studioGallery, setStudioGallery] = useState([]);
  const [studioSelectedImage, setStudioSelectedImage] = useState(null);
  const [studioRefImages, setStudioRefImages] = useState([]);
  const [studioUploadedRefs, setStudioUploadedRefs] = useState([]);
  const [studioUseMasterStyle, setStudioUseMasterStyle] = useState(true);
  const [studioInpaintMode, setStudioInpaintMode] = useState(false);
  const [studioInpaintRect, setStudioInpaintRect] = useState(null);
  const [studioInpaintDrawing, setStudioInpaintDrawing] = useState(false);
  const [studioInpaintStart, setStudioInpaintStart] = useState(null);
  const [studioInpaintPrompt, setStudioInpaintPrompt] = useState('');
  const [studioInpaintGenerating, setStudioInpaintGenerating] = useState(null);
  const studioFileInputRef = useRef(null);
  const styleSheetFileInputRef = useRef(null);
  // Style Sheet generator state
  const [styleSheetMode, setStyleSheetMode] = useState('character'); // 'character' | 'location'
  const [styleSheetPrompt, setStyleSheetPrompt] = useState('');
  const [styleSheetProvider, setStyleSheetProvider] = useState('gemini');
  const [styleSheetQuality, setStyleSheetQuality] = useState('high'); // OpenAI: 'high' | 'medium'
  const [styleSheetAspect, setStyleSheetAspect] = useState('landscape');
  const [styleSheetGenerating, setStyleSheetGenerating] = useState(false);
  const [styleSheetGallery, setStyleSheetGallery] = useState([]);
  const [styleSheetDescribing, setStyleSheetDescribing] = useState([]); // ref paths currently being analyzed
  const styleSheetAbortRef = useRef(null); // cancels an in-flight generation
  // "From comics" picker: pull a panel/page image from a collection comic as a style ref
  const [styleSheetPickerOpen, setStyleSheetPickerOpen] = useState(false);
  const [styleSheetPickerComics, setStyleSheetPickerComics] = useState(null); // null = not fetched yet
  const [styleSheetPickerComicId, setStyleSheetPickerComicId] = useState(null);
  const [styleSheetPickerBusy, setStyleSheetPickerBusy] = useState(false);
  // Voice Library (browse ElevenLabs voices, preview, save to Voices)
  const [voiceLib, setVoiceLib] = useState([]);
  const [voiceLibLoaded, setVoiceLibLoaded] = useState(false);
  const [voiceLibLoading, setVoiceLibLoading] = useState(false);
  const [voiceLibError, setVoiceLibError] = useState(null);
  const [voiceLibSearch, setVoiceLibSearch] = useState('');
  const [voiceLibPlayingId, setVoiceLibPlayingId] = useState(null);
  const voiceLibAudioRef = useRef(null);
  const [voiceLibSource, setVoiceLibSource] = useState('mine'); // 'mine' | 'community'
  const [communityVoices, setCommunityVoices] = useState([]);
  const [communityLoaded, setCommunityLoaded] = useState(false);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState(null);
  const [communitySearch, setCommunitySearch] = useState('');
  const [communityLanguage, setCommunityLanguage] = useState('es');
  const [communityGender, setCommunityGender] = useState('');
  const [communityAccent, setCommunityAccent] = useState('');
  const [communityHasMore, setCommunityHasMore] = useState(false);
  const [communityPage, setCommunityPage] = useState(0);
  const [addingVoiceId, setAddingVoiceId] = useState(null);
  const [communityAdded, setCommunityAdded] = useState([]); // shared voice_ids added this session
  const studioImageRef = useRef(null);

  // Consistency tab state
  const [consistencyCharId, setConsistencyCharId] = useState(null);
  const [consistencyScope, setConsistencyScope] = useState('all');
  const [consistencyResults, setConsistencyResults] = useState([]);
  const [consistencyScanning, setConsistencyScanning] = useState(false);
  const [consistencyScanProgress, setConsistencyScanProgress] = useState({ current: 0, total: 0 });
  const [consistencySelected, setConsistencySelected] = useState({});
  const [consistencyAdjusting, setConsistencyAdjusting] = useState(false);
  const [consistencyAdjustProgress, setConsistencyAdjustProgress] = useState({ current: 0, total: 0 });
  const [consistencyBeforeAfter, setConsistencyBeforeAfter] = useState({});
  const [consistencyProvider, setConsistencyProvider] = useState('openai');
  const [consistencyIgnore, setConsistencyIgnore] = useState('');
  const [consistencyFocus, setConsistencyFocus] = useState('');
  const [consistencyLightbox, setConsistencyLightbox] = useState(null);

  // Language tab state
  const [languageResults, setLanguageResults] = useState([]);
  const [languageScanning, setLanguageScanning] = useState(false);
  const [languageScanProgress, setLanguageScanProgress] = useState({ current: 0, total: 0 });
  const [languageProvider, setLanguageProvider] = useState('openai');

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

  useEffect(() => { settingsRef.current = settings; }, [settings]);
  // Lazily load the ElevenLabs voice library the first time its tab is opened.
  useEffect(() => {
    if (activeTab === 'voicelibrary' && !voiceLibLoaded && !voiceLibLoading) loadVoiceLibrary();
  }, [activeTab]);

  // Studio inpaint: global mouseup listener
  useEffect(() => {
    if (!studioInpaintDrawing) return;
    const handleMouseUp = () => setStudioInpaintDrawing(false);
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [studioInpaintDrawing]);

  useEffect(() => {
    loadComic();
  }, [id]);

  const loadComic = async () => {
    try {
      const response = await api.get(`/comics/${id}`);
      setComic(response.data);

      // Load the per-comic landscape cover (reader detail-view banner)
      setCoverLandscapeImage(response.data.cover?.landscapeImage || '');
      setCoverLandscapePrompt(response.data.cover?.landscapePrompt || '');
      setBannerTitlePosition(response.data.cover?.bannerTitlePosition || 'bottomLeft');
      setCoverLandscapeBrightness(response.data.cover?.landscapeBrightness ?? 1);
      setCoverLandscapeContrast(response.data.cover?.landscapeContrast ?? 1);
      setCoverLandscapeSaturation(response.data.cover?.landscapeSaturation ?? 1);
      setCoverLandscapeZoom(response.data.cover?.landscapeZoom ?? 1);
      setCoverLandscapeCropX(response.data.cover?.landscapeCropX ?? 0);
      setCoverLandscapeCropY(response.data.cover?.landscapeCropY ?? 0);

      // Load style enforcer data
      if (response.data.styleEnforcer) {
        setEnforcerImages(response.data.styleEnforcer.referenceImages || []);
        setEnforcerProfile(response.data.styleEnforcer.profile || null);
      }

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

      // Load collection metadata (description, coverImage)
      if (response.data.collectionId) {
        try {
          const colRes = await api.get(`/collections/${response.data.collectionId}`);
          if (colRes.data.titleEn) {
            setComic(prev => ({ ...prev, collectionTitleEn: colRes.data.titleEn }));
          }
          setCollectionDescription(colRes.data.description || '');
          setCollectionCoverImage(colRes.data.coverImage || '');
          setCollectionCoverPrompt(colRes.data.coverPrompt || '');
          setCollectionCoverBrightness(colRes.data.coverBrightness ?? 1);
          setCollectionCoverContrast(colRes.data.coverContrast ?? 1);
          setCollectionCoverSaturation(colRes.data.coverSaturation ?? 1);
        } catch (colErr) {
          // Collection may not exist yet
        }
      }
    } catch (error) {
      console.error('Failed to load comic:', error);
    } finally {
      setLoading(false);
    }
  };

  // Drag-and-drop page reordering (Pages tab)
  const [dragPageId, setDragPageId] = useState(null);
  const [dragOverPageId, setDragOverPageId] = useState(null);

  const reorderPages = async (draggedId, targetId) => {
    if (!draggedId || !targetId || draggedId === targetId) return;
    const ordered = [...comic.pages].sort((a, b) => a.pageNumber - b.pageNumber).map(p => p.id);
    const from = ordered.indexOf(draggedId);
    const to = ordered.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ordered.splice(to, 0, ordered.splice(from, 1)[0]);
    try {
      await api.post(`/comics/${id}/pages/reorder`, { pageIds: ordered });
      await loadComic();
    } catch (error) {
      alert('Failed to reorder pages: ' + (error.response?.data?.error || error.message));
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

  // Debounced save for collection cover adjustments
  const saveCollectionCoverAdj = (adjustments) => {
    clearTimeout(collectionCoverAdjTimer.current);
    collectionCoverAdjTimer.current = setTimeout(() => {
      if (comic?.collectionId) {
        api.put(`/collections/${comic.collectionId}`, {
          id: comic.collectionId,
          ...adjustments
        }).catch(err => console.error('Failed to save cover adjustments:', err));
      }
    }, 500);
  };

  // Debounced save for the landscape cover's brightness/contrast/saturation.
  const saveLandscapeCoverAdj = (adjustments) => {
    clearTimeout(coverLandscapeAdjTimer.current);
    coverLandscapeAdjTimer.current = setTimeout(() => {
      setComic(prev => {
        const updatedCover = { ...(prev.cover || {}), ...adjustments };
        api.put(`/comics/${id}`, { cover: updatedCover })
          .catch(err => console.error('Failed to save landscape cover adjustments:', err));
        return { ...prev, cover: updatedCover };
      });
    }, 500);
  };

  const saveSettings = async (settingsToSave, silent = false) => {
    const data = settingsToSave || settings;
    setSaving(true);
    try {
      if (settingsSource === 'collection' && settingsCollectionId) {
        await api.put(`/collections/${settingsCollectionId}`, {
          title: comic.collectionTitle || '',
          titleEn: comic.collectionTitleEn || '',
          promptSettings: data
        });
        if (!silent) alert('Collection settings saved! (shared across all episodes)');
      } else if (comic.collectionId && settingsSource === 'comic') {
        await api.put(`/collections/${comic.collectionId}`, {
          title: comic.collectionTitle || '',
          titleEn: comic.collectionTitleEn || '',
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
      setSettings(prev => {
        const updated = {
          ...prev,
          characters: [...prev.characters, {
            id: `char-${Date.now()}`,
            name: name.trim(),
            description: lastAssistant.content,
            image: response.data.path
          }]
        };
        saveSettings(updated, true);
        return updated;
      });
      setSettingsTab('characters');
    } catch (error) {
      console.error('Failed to save reference image:', error);
      // Still add the entry without the image
      setSettings(prev => {
        const updated = {
          ...prev,
          characters: [...prev.characters, {
            id: `char-${Date.now()}`,
            name: name.trim(),
            description: lastAssistant.content
          }]
        };
        saveSettings(updated, true);
        return updated;
      });
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
    { id: 'reference', label: 'Reference Builder' },
    { id: 'enforcer', label: 'Color Enforcer' }
  ];

  // Studio handlers
  const studioGenerate = async () => {
    if (!studioPrompt.trim() || studioGenerating) return;
    setStudioGenerating(true);
    try {
      const allRefs = [...studioRefImages, ...studioUploadedRefs];
      if (studioUseMasterStyle && settings.masterStyleImage) {
        allRefs.unshift(settings.masterStyleImage);
      }
      const response = await api.post('/images/generate-studio', {
        prompt: studioPrompt,
        provider: studioProvider,
        aspectRatio: studioAspectRatio,
        referenceImages: allRefs.length > 0 ? allRefs : undefined,
        hasMasterStyleImage: studioUseMasterStyle && !!settings.masterStyleImage
      }, { timeout: 600000 });
      const newItem = {
        path: response.data.path,
        prompt: studioPrompt,
        provider: studioProvider,
        aspectRatio: studioAspectRatio,
        timestamp: Date.now()
      };
      setStudioGallery(prev => [newItem, ...prev]);
      setStudioSelectedImage(0);
    } catch (error) {
      alert('Generation failed: ' + (error.response?.data?.error || error.message));
    } finally {
      setStudioGenerating(false);
    }
  };

  const studioSaveAsReference = async (galleryIndex) => {
    const item = studioGallery[galleryIndex];
    if (!item) return;
    const name = prompt('Name for this reference:');
    if (!name || !name.trim()) return;
    try {
      const imgResponse = await fetch(`${item.path}`);
      const blob = await imgResponse.blob();
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        const savePayload = { image: base64 };
        if (settingsSource === 'collection' && settingsCollectionId) {
          savePayload.collectionId = settingsCollectionId;
        } else {
          savePayload.comicId = id;
        }
        const resp = await api.post('/images/save-reference', savePayload);
        setSettings(prev => {
          const updated = {
            ...prev,
            characters: [...prev.characters, {
              id: `char-${Date.now()}`,
              name: name.trim(),
              description: `Generated in Studio: "${item.prompt.substring(0, 80)}"`,
              image: resp.data.path
            }]
          };
          saveSettings(updated, true);
          return updated;
        });
        alert('Saved as reference!');
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      alert('Failed to save: ' + error.message);
    }
  };

  const studioDownload = (galleryIndex) => {
    const item = studioGallery[galleryIndex];
    if (!item) return;
    const a = document.createElement('a');
    a.href = `${item.path}`;
    a.download = `studio-${item.timestamp}.png`;
    a.click();
  };

  const studioUploadRef = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target.result.split(',')[1];
      try {
        const savePayload = { image: base64, comicId: id };
        const resp = await api.post('/images/save-reference', savePayload);
        setStudioUploadedRefs(prev => [...prev, resp.data.path]);
      } catch (error) {
        alert('Upload failed: ' + error.message);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Style Sheet: add an image (base64) as a locked style reference. Persists in
  // promptSettings.styleSheetImages (on the comic or collection, like other refs),
  // then auto-analyzes the image into a reusable ART-STYLE prompt that gets
  // injected when generating subsequent images in the series. Shared by the
  // file-upload path and the "From comics" picker.
  const styleSheetAddBase64 = async (base64) => {
    const savePayload = { image: base64 };
    if (settingsSource === 'collection' && settingsCollectionId) {
      savePayload.collectionId = settingsCollectionId;
    } else {
      savePayload.comicId = id;
    }
    const resp = await api.post('/images/save-reference', savePayload);
    const newPath = resp.data.path;
    setSettings(prev => {
      const updated = { ...prev, styleSheetImages: [...(prev.styleSheetImages || []), { path: newPath, stylePrompt: '' }] };
      saveSettings(updated, true);
      return updated;
    });
    // Analyze the art style in the background, then persist the prompt.
    setStyleSheetDescribing(prev => [...prev, newPath]);
    try {
      const styleResp = await api.post('/chat/describe-style', { image: base64 }, { timeout: 120000 });
      const stylePrompt = styleResp.data.stylePrompt || '';
      setSettings(prev => {
        const updated = {
          ...prev,
          styleSheetImages: (prev.styleSheetImages || []).map(r =>
            r.path === newPath ? { ...r, stylePrompt } : r)
        };
        saveSettings(updated, true);
        return updated;
      });
    } catch (err) {
      alert('Style analysis failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setStyleSheetDescribing(prev => prev.filter(p => p !== newPath));
    }
  };

  const styleSheetUploadRef = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target.result.split(',')[1];
      try {
        await styleSheetAddBase64(base64);
      } catch (error) {
        alert('Upload failed: ' + (error.response?.data?.error || error.message));
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // "From comics": browse the collection's comics and grab a panel / page image
  // as a style reference — same pipeline as an upload from disk.
  const openStyleSheetPicker = async () => {
    setStyleSheetPickerOpen(true);
    if (styleSheetPickerComics) return;   // already fetched this session
    try {
      const res = await api.get('/comics');
      let list = res.data || [];
      if (comic?.collectionId) {
        const sameCollection = list.filter(c => c.collectionId === comic.collectionId);
        if (sameCollection.length) list = sameCollection;
      }
      list.sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0));
      setStyleSheetPickerComics(list);
      // Default to a sibling comic — pulling style from the one being edited is rarer.
      setStyleSheetPickerComicId((list.find(c => c.id !== id) || list[0])?.id || null);
    } catch (err) {
      setStyleSheetPickerOpen(false);
      alert('Failed to load comics: ' + (err.response?.data?.error || err.message));
    }
  };

  const styleSheetPickFromComic = async (imgPath) => {
    setStyleSheetPickerBusy(true);
    try {
      const imgResp = await fetch(`${imgPath}`);
      const blob = await imgResp.blob();
      const base64 = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result.split(',')[1]);
        r.readAsDataURL(blob);
      });
      setStyleSheetPickerOpen(false);
      await styleSheetAddBase64(base64);
    } catch (err) {
      alert('Failed to add reference: ' + (err.response?.data?.error || err.message));
    } finally {
      setStyleSheetPickerBusy(false);
    }
  };

  const styleSheetRemoveRef = (imgPath) => {
    setSettings(prev => {
      const updated = { ...prev, styleSheetImages: (prev.styleSheetImages || []).filter(r => r.path !== imgPath) };
      saveSettings(updated, true);
      return updated;
    });
  };

  // Edit a reference's style prompt (persisted on blur).
  const styleSheetUpdatePrompt = (imgPath, text) => {
    setSettings(prev => ({
      ...prev,
      styleSheetImages: (prev.styleSheetImages || []).map(r => r.path === imgPath ? { ...r, stylePrompt: text } : r)
    }));
  };
  const styleSheetPersist = () => saveSettings(settingsRef.current, true);

  // Re-run the style analysis for an existing reference.
  const styleSheetRedescribe = async (imgPath) => {
    setStyleSheetDescribing(prev => [...prev, imgPath]);
    try {
      const imgResp = await fetch(`${imgPath}`);
      const blob = await imgResp.blob();
      const base64 = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result.split(',')[1]);
        r.readAsDataURL(blob);
      });
      const styleResp = await api.post('/chat/describe-style', { image: base64 }, { timeout: 120000 });
      const stylePrompt = styleResp.data.stylePrompt || '';
      setSettings(prev => {
        const updated = {
          ...prev,
          styleSheetImages: (prev.styleSheetImages || []).map(r => r.path === imgPath ? { ...r, stylePrompt } : r)
        };
        saveSettings(updated, true);
        return updated;
      });
    } catch (err) {
      alert('Style analysis failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setStyleSheetDescribing(prev => prev.filter(p => p !== imgPath));
    }
  };

  // Wrap the user's prompt with style-sheet layout instructions + baked negatives so
  // the model lays out a proper reference sheet in the locked style.
  const buildStyleSheetPrompt = (mode, userPrompt) => {
    // Front-load the medium: image models weight the earliest tokens hardest, so the
    // very first thing must establish "hand-drawn comic, NOT a photo" — then the scene,
    // then layout, with the verbose extracted style left as trailing supporting detail.
    const lead = `Hand-drawn comic / manhwa / webtoon illustration, cel-shaded, NOT a photograph, NOT photorealistic, NOT a 3D render.`;
    const layout = mode === 'location'
      ? `Lay out as a LOCATION REFERENCE SHEET: the same place from a wide establishing view, an alternate angle, and a close detail, on a plain neutral background, kept consistent across views.`
      : `Lay out as a CHARACTER TURNAROUND SHEET: the same character front, three-quarter, side and back at matching scale, plus two expression close-ups, on a plain neutral background, identical across views.`;
    const negatives = [];
    if (settings.hardNegatives) negatives.push(settings.hardNegatives);
    if (settings.globalDoNot) negatives.push(settings.globalDoNot);
    const negTail = negatives.length ? ` Avoid: ${negatives.join('; ')}.` : '';
    // Trailing, lower-weight detail (the rich extracted style description).
    const stylePrompts = (settings.styleSheetImages || []).map(r => r.stylePrompt).filter(Boolean);
    const styleDetail = stylePrompts.length ? `\n\nStyle details to match: ${stylePrompts.join(' ')}` : '';
    return `${lead}\n\nScene: ${userPrompt.trim()}\n\n${layout}${negTail}${styleDetail}`;
  };

  const styleSheetGenerate = async () => {
    if (!styleSheetPrompt.trim() || styleSheetGenerating) return;
    const refs = settings.styleSheetImages || [];
    if (refs.length === 0) {
      alert('Upload at least one style reference first.');
      return;
    }
    const controller = new AbortController();
    styleSheetAbortRef.current = controller;
    setStyleSheetGenerating(true);
    try {
      const response = await api.post('/images/generate-stylesheet', {
        prompt: buildStyleSheetPrompt(styleSheetMode, styleSheetPrompt),
        provider: styleSheetProvider,
        aspectRatio: styleSheetAspect,
        referenceImages: refs.map(r => r.path),
        openaiQuality: styleSheetQuality
      }, { timeout: 600000, signal: controller.signal });
      const newItem = {
        path: response.data.path,
        prompt: styleSheetPrompt,
        promptSent: response.data.promptSent,
        refsLoaded: response.data.refsLoaded,
        mode: styleSheetMode,
        provider: styleSheetProvider,
        timestamp: Date.now()
      };
      setStyleSheetGallery(prev => [newItem, ...prev]);
    } catch (error) {
      // Ignore user-initiated cancels; surface real failures.
      if (error.code !== 'ERR_CANCELED' && error.name !== 'CanceledError') {
        alert('Generation failed: ' + (error.response?.data?.error || error.message));
      }
    } finally {
      styleSheetAbortRef.current = null;
      setStyleSheetGenerating(false);
    }
  };

  const styleSheetStop = () => {
    styleSheetAbortRef.current?.abort();
  };

  // --- Voice Library ---
  const loadVoiceLibrary = async () => {
    setVoiceLibLoading(true);
    setVoiceLibError(null);
    try {
      const res = await api.get('/audio/voices');
      setVoiceLib(res.data.voices || []);
      setVoiceLibLoaded(true);
    } catch (e) {
      setVoiceLibError(e.response?.data?.error || e.message);
    } finally {
      setVoiceLibLoading(false);
    }
  };

  const voiceLibPreview = (voice) => {
    // Stop whatever is playing.
    if (voiceLibAudioRef.current) {
      voiceLibAudioRef.current.pause();
      voiceLibAudioRef.current = null;
    }
    if (voiceLibPlayingId === voice.voice_id) { setVoiceLibPlayingId(null); return; }
    if (!voice.preview_url) { alert('No preview available for this voice.'); return; }
    const audio = new Audio(voice.preview_url);
    audio.onended = () => setVoiceLibPlayingId(null);
    audio.onerror = () => { setVoiceLibPlayingId(null); alert('Could not play preview.'); };
    audio.play().catch(() => {});
    voiceLibAudioRef.current = audio;
    setVoiceLibPlayingId(voice.voice_id);
  };

  const voiceLibSave = async (voice) => {
    if ((comic.voices || []).some(v => v.voiceId === voice.voice_id)) {
      alert('This voice is already in your Voices.');
      return;
    }
    const characterName = prompt('Character name for this voice:', voice.name);
    if (!characterName || !characterName.trim()) return;
    const updatedVoices = [...(comic.voices || []), { name: characterName.trim(), voiceId: voice.voice_id }];
    try {
      await api.put(`/comics/${id}`, { voices: updatedVoices });
      setComic({ ...comic, voices: updatedVoices });
    } catch (e) {
      alert('Failed to save voice: ' + (e.response?.data?.error || e.message));
    }
  };

  const loadCommunityVoices = async (page = 0, append = false, overrides = {}) => {
    const search = overrides.search ?? communitySearch;
    const language = overrides.language ?? communityLanguage;
    const gender = overrides.gender ?? communityGender;
    const accent = overrides.accent ?? communityAccent;
    setCommunityLoading(true);
    setCommunityError(null);
    try {
      const res = await api.get('/audio/shared-voices', {
        params: { search, language, gender, accent, page, page_size: 30 }
      });
      setCommunityVoices(prev => append ? [...prev, ...(res.data.voices || [])] : (res.data.voices || []));
      setCommunityHasMore(!!res.data.has_more);
      setCommunityPage(page);
      setCommunityLoaded(true);
    } catch (e) {
      setCommunityError(e.response?.data?.error || e.message);
    } finally {
      setCommunityLoading(false);
    }
  };

  // Add a community voice to the ElevenLabs library, then save it to this comic's Voices.
  const communityAddAndSave = async (voice) => {
    const characterName = prompt('Character name for this voice:', voice.name);
    if (!characterName || !characterName.trim()) return;
    const name = characterName.trim();
    setAddingVoiceId(voice.voice_id);
    try {
      const res = await api.post('/audio/add-shared-voice', {
        public_owner_id: voice.public_owner_id,
        voice_id: voice.voice_id,
        name
      });
      const newId = res.data.voice_id;
      if (!(comic.voices || []).some(v => v.voiceId === newId)) {
        const updatedVoices = [...(comic.voices || []), { name, voiceId: newId }];
        await api.put(`/comics/${id}`, { voices: updatedVoices });
        setComic({ ...comic, voices: updatedVoices });
      }
      setCommunityAdded(prev => prev.includes(voice.voice_id) ? prev : [...prev, voice.voice_id]);
      setVoiceLibLoaded(false); // refresh "My Voices" next time it's opened
      alert(`Added “${name}” to your ElevenLabs library and this ${comic.collectionId ? 'collection' : 'comic'}’s Voices.`);
    } catch (e) {
      const msg = e.response?.data?.error || e.message;
      if (/voices_write|missing_permissions/i.test(msg)) {
        alert('Adding a community voice needs the “Voices → Write” permission on your ElevenLabs API key. Enable it in the ElevenLabs dashboard and try again.');
      } else {
        alert('Failed to add voice: ' + msg);
      }
    } finally {
      setAddingVoiceId(null);
    }
  };

  const styleSheetDownload = (item) => {
    const a = document.createElement('a');
    a.href = `${item.path}`;
    a.download = `stylesheet-${item.mode}-${item.timestamp}.png`;
    a.click();
  };

  // Copy a generated result into the project's images folder so it can live in
  // prompt settings (returns the saved path).
  const styleSheetCopyToProject = async (item) => {
    const imgResp = await fetch(`${item.path}`);
    const blob = await imgResp.blob();
    const base64 = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.readAsDataURL(blob);
    });
    const savePayload = { image: base64 };
    if (settingsSource === 'collection' && settingsCollectionId) {
      savePayload.collectionId = settingsCollectionId;
    } else {
      savePayload.comicId = id;
    }
    const resp = await api.post('/images/save-reference', savePayload);
    return resp.data.path;
  };

  // After saving a generated sheet into Prompt Settings, replace the entry's
  // description (initially the user's GENERATION prompt) with a full
  // describe-image analysis of the sheet. The generation prompt says what was
  // ASKED FOR ("a nice looking boy from her school"), not the design that came
  // out — at panel time it carries no wardrobe/colour detail, so characters
  // drift. field = 'characters' | 'styleBibleImages'.
  const styleSheetDescribeAndUpdate = async (savedPath, field, entryId) => {
    try {
      const imgResp = await fetch(`${savedPath}`);
      const blob = await imgResp.blob();
      const base64 = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result.split(',')[1]);
        r.readAsDataURL(blob);
      });
      const descResp = await api.post('/chat/describe-image', { image: base64 }, { timeout: 120000 });
      const desc = descResp.data.message;
      if (desc) {
        setSettings(prev => {
          const updated = {
            ...prev,
            [field]: (prev[field] || []).map(e => e.id === entryId ? { ...e, description: desc } : e)
          };
          saveSettings(updated, true);
          return updated;
        });
      }
    } catch (err) {
      console.warn('Auto-describe failed (kept the generation prompt):', err.message);
    }
  };

  const styleSheetSaveAsCharacter = async (item) => {
    const name = prompt('Name for this character:');
    if (!name || !name.trim()) return;
    try {
      const savedPath = await styleSheetCopyToProject(item);
      const entryId = `char-${Date.now()}`;
      setSettings(prev => {
        const updated = {
          ...prev,
          characters: [...(prev.characters || []), {
            id: entryId,
            name: name.trim(),
            description: item.prompt,
            image: savedPath
          }]
        };
        saveSettings(updated, true);
        return updated;
      });
      alert('Saved to Characters (Prompt Settings). Analyzing the sheet now — a detailed description will replace the generation prompt shortly.');
      styleSheetDescribeAndUpdate(savedPath, 'characters', entryId);
    } catch (error) {
      alert('Failed to save: ' + (error.response?.data?.error || error.message));
    }
  };

  const styleSheetSaveToStyleBible = async (item) => {
    const name = prompt('Name for this style bible entry:', item.mode === 'location' ? 'location' : 'reference');
    if (!name || !name.trim()) return;
    try {
      const savedPath = await styleSheetCopyToProject(item);
      const entryId = `style-img-${Date.now()}`;
      setSettings(prev => {
        const updated = {
          ...prev,
          styleBibleImages: [...(prev.styleBibleImages || []), {
            id: entryId,
            name: name.trim(),
            image: savedPath,
            description: item.prompt
          }]
        };
        saveSettings(updated, true);
        return updated;
      });
      alert('Added to Style Bible (Prompt Settings). Analyzing the sheet now — a detailed description will replace the generation prompt shortly.');
      styleSheetDescribeAndUpdate(savedPath, 'styleBibleImages', entryId);
    } catch (error) {
      alert('Failed to save: ' + (error.response?.data?.error || error.message));
    }
  };

  const studioExecuteInpaint = async (provider) => {
    if (studioSelectedImage == null || !studioInpaintRect || !studioInpaintPrompt.trim()) return;
    const item = studioGallery[studioSelectedImage];
    if (!item) return;
    setStudioInpaintGenerating(provider);
    try {
      const allRefs = [...studioRefImages, ...studioUploadedRefs];
      const response = await api.post('/images/inpaint-region', {
        sourceImagePath: item.path,
        rect: studioInpaintRect,
        prompt: studioInpaintPrompt,
        panelId: 'studio',
        referenceImages: allRefs.length > 0 ? allRefs : undefined,
        provider
      }, { timeout: 600000 });
      const newItem = {
        path: response.data.path,
        prompt: `[Inpaint] ${studioInpaintPrompt}`,
        provider,
        aspectRatio: item.aspectRatio,
        timestamp: Date.now()
      };
      setStudioGallery(prev => [newItem, ...prev]);
      setStudioSelectedImage(0);
      setStudioInpaintRect(null);
      setStudioInpaintPrompt('');
    } catch (error) {
      alert('Inpaint failed: ' + (error.response?.data?.error || error.message));
    } finally {
      setStudioInpaintGenerating(null);
    }
  };

  const studioToggleRef = (path) => {
    setStudioRefImages(prev =>
      prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]
    );
  };

  const studioHandleMouseDown = (e) => {
    if (!studioInpaintMode) return;
    const img = studioImageRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setStudioInpaintStart({ x, y });
    setStudioInpaintRect({ x, y, width: 0, height: 0 });
    setStudioInpaintDrawing(true);
  };

  const studioHandleMouseMove = (e) => {
    if (!studioInpaintDrawing || !studioInpaintStart) return;
    const img = studioImageRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const left = Math.max(0, Math.min(studioInpaintStart.x, x));
    const top = Math.max(0, Math.min(studioInpaintStart.y, y));
    const right = Math.min(1, Math.max(studioInpaintStart.x, x));
    const bottom = Math.min(1, Math.max(studioInpaintStart.y, y));
    setStudioInpaintRect({ x: left, y: top, width: right - left, height: bottom - top });
  };

  // Consistency handlers
  const handleConsistencyScan = async () => {
    if (!consistencyCharId || consistencyScanning) return;
    const charIds = consistencyCharId === 'all'
      ? settings.characters.filter(c => c.image).map(c => c.id)
      : [consistencyCharId];

    // Build list of panels to scan
    const panelsToScan = [];
    for (const page of (comic.pages || [])) {
      if (consistencyScope !== 'all' && page.id !== consistencyScope) continue;
      for (const panel of (page.panels || [])) {
        if (!panel.artworkImage) continue;
        for (const cId of charIds) {
          const char = settings.characters.find(c => c.id === cId);
          if (!char || !char.image) continue;
          panelsToScan.push({ page, panel, character: char });
        }
      }
    }

    if (panelsToScan.length === 0) {
      alert('No panels with artwork found in the selected scope.');
      return;
    }

    setConsistencyScanning(true);
    setConsistencyResults([]);
    setConsistencySelected({});
    setConsistencyBeforeAfter({});
    setConsistencyScanProgress({ current: 0, total: panelsToScan.length });

    const results = [];
    for (let i = 0; i < panelsToScan.length; i++) {
      const { page, panel, character } = panelsToScan[i];
      setConsistencyScanProgress({ current: i + 1, total: panelsToScan.length });
      try {
        const resp = await api.post('/images/consistency/detect', {
          panelImagePath: panel.artworkImage,
          characterName: character.name,
          characterDescription: character.description || '',
          characterRefImagePath: character.image,
          provider: consistencyProvider,
          ignore: consistencyIgnore,
          focus: consistencyFocus
        }, { timeout: 120000 });

        if (resp.data.detected && resp.data.matchScore < 9) {
          results.push({
            pageId: page.id,
            pageNumber: page.pageNumber,
            panelId: panel.id,
            panelImage: panel.artworkImage,
            characterId: character.id,
            characterName: character.name,
            characterRefImage: character.image,
            characterDescription: character.description || '',
            boundingBox: resp.data.boundingBox,
            matchScore: resp.data.matchScore,
            discrepancies: resp.data.discrepancies || [],
            notes: resp.data.notes || ''
          });
          setConsistencyResults([...results]);
        }
      } catch (err) {
        console.error(`Consistency detect failed for panel ${panel.id}:`, err.response?.data || err.message);
      }
    }

    setConsistencyResults(results);
    setConsistencyScanning(false);
  };

  const handleConsistencyAdjust = async () => {
    const selectedKeys = Object.keys(consistencySelected).filter(k => consistencySelected[k]);
    if (selectedKeys.length === 0 || consistencyAdjusting) return;

    setConsistencyAdjusting(true);
    setConsistencyAdjustProgress({ current: 0, total: selectedKeys.length });

    for (let i = 0; i < selectedKeys.length; i++) {
      const idx = parseInt(selectedKeys[i]);
      const result = consistencyResults[idx];
      if (!result) continue;

      setConsistencyAdjustProgress({ current: i + 1, total: selectedKeys.length });
      try {
        const resp = await api.post('/images/consistency/adjust', {
          panelImagePath: result.panelImage,
          boundingBox: result.boundingBox,
          characterName: result.characterName,
          characterDescription: result.characterDescription,
          characterRefImagePath: result.characterRefImage,
          discrepancies: result.userNotes ? [...result.discrepancies, result.userNotes] : result.discrepancies,
          panelId: result.panelId,
          provider: consistencyProvider,
          ignore: consistencyIgnore,
          focus: consistencyFocus
        }, { timeout: 600000 });

        // Update the panel in the DB
        await api.patch(`/comics/${id}/pages/${result.pageId}/panels/${result.panelId}`, {
          artworkImage: resp.data.path
        });

        // Store before/after
        setConsistencyBeforeAfter(prev => ({
          ...prev,
          [result.panelId]: { before: result.panelImage, after: resp.data.path }
        }));

        // Update the result's panelImage to the new one
        setConsistencyResults(prev => prev.map((r, ri) =>
          ri === idx ? { ...r, panelImage: resp.data.path, adjusted: true } : r
        ));

        // Refresh comic data
        const comicResp = await api.get(`/comics/${id}`);
        setComic(comicResp.data);
      } catch (err) {
        console.error(`Consistency adjust failed for panel ${result.panelId}:`, err);
        alert(`Adjust failed for P${result.pageNumber} panel ${result.panelId}: ${err.response?.data?.error || err.message}`);
      }
    }

    setConsistencyAdjusting(false);
  };

  const handleConsistencyRevert = async (idx) => {
    const result = consistencyResults[idx];
    if (!result) return;
    const ba = consistencyBeforeAfter[result.panelId];
    if (!ba) return;

    try {
      await api.patch(`/comics/${id}/pages/${result.pageId}/panels/${result.panelId}`, {
        artworkImage: ba.before
      });
      setConsistencyResults(prev => prev.map((r, ri) =>
        ri === idx ? { ...r, panelImage: ba.before, adjusted: false } : r
      ));
      setConsistencyBeforeAfter(prev => {
        const next = { ...prev };
        delete next[result.panelId];
        return next;
      });
      const comicResp = await api.get(`/comics/${id}`);
      setComic(comicResp.data);
    } catch (err) {
      alert('Revert failed: ' + err.message);
    }
  };

  const handleConsistencySaveAll = async () => {
    const adjustedResults = consistencyResults.filter(r => r.adjusted);
    if (adjustedResults.length === 0) return;

    try {
      const resp = await api.post('/images/consistency/save-all', {
        comicId: id,
        panels: adjustedResults.map(r => ({
          panelId: r.panelId,
          pageId: r.pageId,
          imagePath: r.panelImage
        }))
      });

      // Update local results with new project paths
      if (resp.data.results) {
        const pathMap = {};
        resp.data.results.forEach(r => {
          if (r.status === 'saved') pathMap[r.panelId] = r.path;
        });
        setConsistencyResults(prev => prev.map(r =>
          pathMap[r.panelId] ? { ...r, panelImage: pathMap[r.panelId] } : r
        ));
      }

      const comicResp = await api.get(`/comics/${id}`);
      setComic(comicResp.data);
      alert(`Saved ${resp.data.saved} adjusted panel${resp.data.saved !== 1 ? 's' : ''} to project.`);
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleLanguageScan = async () => {
    if (languageScanning) return;

    const pagesToScan = [];
    for (const page of (comic.pages || [])) {
      const pageImage = page.masterImage || page.bakedImage;
      if (!pageImage) continue;

      // Collect bubbles from panels
      const panels = (page.panels || []).map((panel, panelIdx) => {
        const bubbles = (panel.bubbles || [])
          .filter(b => b.type !== 'image' && !b.isSoundEffect)
          .map(bubble => ({
            type: bubble.type || 'speech',
            sentences: (bubble.sentences || [])
              .filter(s => s.text && s.translation)
              .map(s => ({ text: s.text, translation: s.translation }))
          }))
          .filter(b => b.sentences.length > 0);
        if (bubbles.length === 0) return null;
        return { panelId: panel.id, panelIndex: panelIdx, bubbles };
      }).filter(Boolean);

      // Also collect page-level bubbles (not inside panels)
      const pageBubbles = (page.bubbles || [])
        .filter(b => b.type !== 'image' && !b.isSoundEffect)
        .map(bubble => ({
          type: bubble.type || 'speech',
          sentences: (bubble.sentences || [])
            .filter(s => s.text && s.translation)
            .map(s => ({ text: s.text, translation: s.translation }))
        }))
        .filter(b => b.sentences.length > 0);

      if (pageBubbles.length > 0) {
        panels.push({ panelId: 'page-level', panelIndex: panels.length, bubbles: pageBubbles });
      }

      if (panels.length === 0) continue;
      pagesToScan.push({ page, panels, pageImage });
    }

    if (pagesToScan.length === 0) {
      alert('No pages with images and dialogue found.');
      return;
    }

    setLanguageScanning(true);
    setLanguageResults([]);
    setLanguageScanProgress({ current: 0, total: pagesToScan.length });

    const allResults = [];
    for (let i = 0; i < pagesToScan.length; i++) {
      const { page, panels, pageImage } = pagesToScan[i];
      setLanguageScanProgress({ current: i + 1, total: pagesToScan.length });
      try {
        const resp = await api.post('/images/language/review', {
          pageImagePath: pageImage,
          pageNumber: page.pageNumber,
          panels,
          language: comic.language || 'es',
          targetLanguage: comic.targetLanguage || 'en',
          provider: languageProvider
        }, { timeout: 120000 });

        if (resp.data.issues && resp.data.issues.length > 0) {
          for (const issue of resp.data.issues) {
            // Match sentenceText back to the correct panel
            let matchedPanelIndex = issue.panelIndex || 0;
            for (const panel of panels) {
              const found = panel.bubbles.some(b =>
                b.sentences.some(s => s.text === issue.sentenceText)
              );
              if (found) { matchedPanelIndex = panel.panelIndex; break; }
            }
            allResults.push({ pageNumber: page.pageNumber, pageId: page.id, ...issue, panelIndex: matchedPanelIndex });
          }
          setLanguageResults([...allResults]);
        }
      } catch (err) {
        console.error(`Language review failed for page ${page.pageNumber}:`, err.response?.data || err.message);
      }
    }

    setLanguageResults(allResults);
    setLanguageScanning(false);
  };

  return (
    <div style={{ maxWidth: 'none', width: 'calc(100vw - 4rem)' }}>
      <div className="page-header">
        <div>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem' }}>
            <Link to="/" style={{ color: '#888', textDecoration: 'none' }}>
              ← Back to Comics
            </Link>
            {comic.collectionId && (
              <Link to={`/?collection=${comic.collectionId}`} style={{ color: '#888', textDecoration: 'none' }}>
                ← Back to Collection
              </Link>
            )}
          </div>
          <h1>{comic.title}</h1>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(id)}
            title="Click to copy — use with ./sync-store.sh"
            style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#888', background: 'rgba(255,255,255,0.06)', border: '1px solid #444', borderRadius: '4px', padding: '0.15rem 0.4rem', cursor: 'pointer', marginBottom: '0.4rem' }}
          >
            {id} 📋
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <textarea
              value={comic.description || ''}
              placeholder="Add a description…"
              rows={2}
              onChange={(e) => setComic(prev => ({ ...prev, description: e.target.value }))}
              onBlur={(e) => {
                api.put(`/comics/${id}`, { description: e.target.value })
                  .catch(err => console.error('Failed to update description:', err));
              }}
              style={{ flex: 1, minWidth: '20rem', color: '#ccc', background: 'rgba(255,255,255,0.04)', border: '1px solid #444', borderRadius: '4px', padding: '0.4rem 0.6rem', fontSize: '0.9rem', resize: 'vertical', fontFamily: 'inherit' }}
            />
            <select
              value={comic.level || 'beginner'}
              onChange={(e) => {
                const newLevel = e.target.value;
                setComic(prev => ({ ...prev, level: newLevel }));
                api.put(`/comics/${id}`, { level: newLevel }).catch(err => console.error('Failed to update level:', err));
              }}
              style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid #555', background: '#1a1a2e', color: '#fff', cursor: 'pointer' }}
            >
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
            <label
              title="Colour of the flashing dot on the open bubble in the reader — pick one that stands out against this comic's art"
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: '#888' }}
            >
              Bubble dot
              <input
                type="color"
                value={comic.bubbleDotColor || '#409B08'}
                onChange={(e) => {
                  const color = e.target.value;
                  setComic(prev => ({ ...prev, bubbleDotColor: color }));
                  api.put(`/comics/${id}`, { bubbleDotColor: color }).catch(err => console.error('Failed to update bubble dot color:', err));
                }}
                style={{ width: '34px', height: '24px', padding: 0, border: '1px solid #555', borderRadius: '4px', background: 'none', cursor: 'pointer' }}
              />
            </label>
          </div>
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
        <button
          className={`btn ${activeTab === 'voicelibrary' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('voicelibrary')}
          style={{ padding: '0.6rem 1.2rem' }}
        >
          Voice Library
        </button>
        <button
          className={`btn ${activeTab === 'studio' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('studio')}
          style={{ padding: '0.6rem 1.2rem' }}
        >
          Studio
        </button>
        <button
          className={`btn ${activeTab === 'stylesheet' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('stylesheet')}
          style={{ padding: '0.6rem 1.2rem' }}
        >
          Style Sheet
        </button>
        <button
          className={`btn ${activeTab === 'consistency' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('consistency')}
          style={{ padding: '0.6rem 1.2rem' }}
        >
          Consistency
        </button>
        <button
          className={`btn ${activeTab === 'language' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('language')}
          style={{ padding: '0.6rem 1.2rem' }}
        >
          Language
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
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'stretch' }}>
      {/* Left column: Tab Content */}
      <div style={{ flex: 1, minWidth: 0 }}>

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
                  src={`${comic.cover.image}`}
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

            {/* Regular Pages (sorted by pageNumber, with insert buttons between).
                Drag a page onto another to move it there (drop = insert at that spot). */}
            {[...comic.pages].sort((a, b) => a.pageNumber - b.pageNumber).map((page) => (
              <React.Fragment key={page.id}>
                <div
                  className="page-thumbnail"
                  draggable
                  onDragStart={(e) => {
                    setDragPageId(page.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverPageId !== page.id) setDragOverPageId(page.id);
                  }}
                  onDragLeave={() => setDragOverPageId(prev => (prev === page.id ? null : prev))}
                  onDrop={(e) => {
                    e.preventDefault();
                    reorderPages(dragPageId, page.id);
                    setDragPageId(null);
                    setDragOverPageId(null);
                  }}
                  onDragEnd={() => { setDragPageId(null); setDragOverPageId(null); }}
                  style={{
                    position: 'relative',
                    cursor: 'pointer',
                    opacity: dragPageId === page.id ? 0.4 : 1,
                    outline: dragOverPageId === page.id && dragPageId !== page.id ? '3px solid #6c3483' : 'none',
                    outlineOffset: '2px',
                    borderRadius: '4px'
                  }}
                  onClick={() => navigate(`/comic/${id}/page/${page.id}`)}
                >
                  {page.masterImage ? (
                    <img
                      src={`${page.masterImage}`}
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
                {/* Master Style Image */}
                <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#16213e', borderRadius: '8px', border: '1px solid #1a3a5c' }}>
                  <h3 style={{ marginTop: 0, marginBottom: '0.3rem', fontSize: '1rem' }}>Master Style Image</h3>
                  <p style={{ color: '#888', fontSize: '0.8rem', marginBottom: '0.75rem', marginTop: 0 }}>
                    A global style reference included in every generation — used for visual style guidance only
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {settings.masterStyleImage && (
                      <div style={{ position: 'relative' }}>
                        <img
                          src={`${settings.masterStyleImage}`}
                          alt="Master style"
                          style={{ width: '100px', height: '100px', objectFit: 'cover', borderRadius: '6px', border: '2px solid #8e44ad' }}
                        />
                        <button
                          onClick={async () => {
                            const updated = { ...settingsRef.current, masterStyleImage: '' };
                            setSettings(updated);
                            try {
                              if (settingsSource === 'collection' && settingsCollectionId) {
                                await api.put(`/collections/${settingsCollectionId}`, {
                                  title: comic?.collectionTitle || '',
                                  promptSettings: updated
                                });
                              } else if (comic?.collectionId) {
                                await api.put(`/collections/${comic.collectionId}`, {
                                  title: comic?.collectionTitle || '',
                                  promptSettings: updated
                                });
                              } else {
                                await api.put(`/comics/${id}`, { promptSettings: updated });
                              }
                            } catch (err) {
                              console.error('Failed to remove master style image:', err);
                            }
                          }}
                          style={{ position: 'absolute', top: -6, right: -6, background: '#e74c3c', color: '#fff', border: 'none', borderRadius: '50%', width: '20px', height: '20px', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 'bold', lineHeight: '20px', textAlign: 'center', padding: 0 }}
                        >
                          ✕
                        </button>
                      </div>
                    )}
                    <label style={{
                      padding: '0.5rem 1rem', background: '#8e44ad', color: '#fff',
                      borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem'
                    }}>
                      {settings.masterStyleImage ? 'Replace' : 'Upload Image'}
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = async (event) => {
                            const base64 = event.target.result.split(',')[1];
                            try {
                              const savePayload = { image: base64 };
                              if (settingsSource === 'collection' && settingsCollectionId) {
                                savePayload.collectionId = settingsCollectionId;
                              } else {
                                savePayload.comicId = id;
                              }
                              const response = await api.post('/images/save-reference', savePayload);
                              const imagePath = response.data.path;
                              // Use ref to get latest settings, avoiding stale closure
                              const updated = { ...settingsRef.current, masterStyleImage: imagePath };
                              setSettings(updated);
                              // Save directly to DB
                              try {
                                if (settingsSource === 'collection' && settingsCollectionId) {
                                  await api.put(`/collections/${settingsCollectionId}`, {
                                    title: comic?.collectionTitle || '',
                                    promptSettings: updated
                                  });
                                } else if (comic?.collectionId) {
                                  await api.put(`/collections/${comic.collectionId}`, {
                                    title: comic?.collectionTitle || '',
                                    promptSettings: updated
                                  });
                                } else {
                                  await api.put(`/comics/${id}`, { promptSettings: updated });
                                }
                                alert('Master style image saved!');
                              } catch (saveErr) {
                                console.error('Failed to save master style image:', saveErr);
                                alert('Failed to save master style image: ' + saveErr.message);
                              }
                            } catch (error) {
                              console.error('Failed to upload master style image:', error);
                              alert('Failed to upload image: ' + error.message);
                            }
                          };
                          reader.readAsDataURL(file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                </div>

                <h2 style={{ marginBottom: '0.5rem' }}>Style Bible</h2>
                <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Define the visual style for all pages in this comic
                </p>
                <textarea
                  value={settings.styleBible}
                  onChange={(e) => updateSetting('styleBible', e.target.value)}
                  onBlur={() => saveSettings(settingsRef.current, true)}
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
                          src={`${item.image}`}
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
                              onBlur={() => saveSettings(settingsRef.current, true)}
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
                          <textarea
                            value={item.description || ''}
                            onChange={(e) => {
                              setSettings(prev => ({
                                ...prev,
                                styleBibleImages: prev.styleBibleImages.map((img, i) =>
                                  i === index ? { ...img, description: e.target.value } : img
                                )
                              }));
                            }}
                            onBlur={() => saveSettings(settingsRef.current, true)}
                            placeholder="Description of this reference (visual facts only — avoid invented names, places or lore)"
                            style={{
                              width: '100%',
                              minHeight: '120px',
                              padding: '0.5rem',
                              borderRadius: '4px',
                              border: '1px solid #333',
                              background: 'transparent',
                              color: '#ddd',
                              fontSize: '0.85rem',
                              fontFamily: 'inherit',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              resize: 'vertical'
                            }}
                          />
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
                  onBlur={() => saveSettings(settingsRef.current, true)}
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
                        onBlur={() => saveSettings(settingsRef.current, true)}
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
                          src={`${char.image}`}
                          alt={char.name}
                          style={{ maxHeight: '150px', borderRadius: '6px', border: '1px solid #333' }}
                        />
                      </div>
                    )}
                    <textarea
                      value={char.description}
                      onChange={(e) => updateCharacter(index, 'description', e.target.value)}
                      onBlur={() => saveSettings(settingsRef.current, true)}
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
                  onBlur={() => saveSettings(settingsRef.current, true)}
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
                  onBlur={() => saveSettings(settingsRef.current, true)}
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

            {settingsTab === 'enforcer' && (
              <div>
                <h2 style={{ marginBottom: '0.5rem' }}>Color Enforcer</h2>
                <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Upload reference images that define your target color palette and style. The enforcer will analyze them and apply corrections to keep all pages consistent.
                </p>

                {/* Reference Images */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <h3 style={{ margin: 0, color: '#ccc' }}>Reference Images</h3>
                    <button
                      onClick={() => enforcerFileInputRef.current?.click()}
                      className="btn btn-secondary"
                      style={{ padding: '0.3rem 0.8rem', fontSize: '0.8rem' }}
                    >
                      + Add Image
                    </button>
                  </div>

                  {enforcerImages.length === 0 ? (
                    <div style={{
                      border: '2px dashed #333',
                      borderRadius: '8px',
                      padding: '2rem',
                      textAlign: 'center',
                      color: '#666',
                      cursor: 'pointer'
                    }} onClick={() => enforcerFileInputRef.current?.click()}>
                      Click to add reference images that define the target color/style
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      {enforcerImages.map((imgPath, index) => (
                        <div key={index} style={{ position: 'relative' }}>
                          <img
                            src={`${imgPath}`}
                            alt={`Reference ${index + 1}`}
                            style={{
                              height: '120px',
                              borderRadius: '6px',
                              border: '1px solid #333'
                            }}
                          />
                          <button
                            onClick={async () => {
                              const updated = enforcerImages.filter((_, i) => i !== index);
                              setEnforcerImages(updated);
                              setEnforcerProfile(null);
                              await api.put(`/comics/${id}`, {
                                styleEnforcer: { referenceImages: updated, profile: null }
                              });
                              setComic(prev => ({
                                ...prev,
                                styleEnforcer: { referenceImages: updated, profile: null }
                              }));
                            }}
                            style={{
                              position: 'absolute',
                              top: '4px',
                              right: '4px',
                              background: 'rgba(192, 57, 43, 0.9)',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '50%',
                              width: '20px',
                              height: '20px',
                              cursor: 'pointer',
                              fontSize: '12px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <input
                    type="file"
                    ref={enforcerFileInputRef}
                    onChange={async (e) => {
                      const file = e.target.files[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = async (event) => {
                        const base64 = event.target.result.split(',')[1];
                        try {
                          const response = await api.post('/images/save-reference', {
                            image: base64,
                            comicId: id
                          });
                          const updated = [...enforcerImages, response.data.path];
                          setEnforcerImages(updated);
                          setEnforcerProfile(null);
                          await api.put(`/comics/${id}`, {
                            styleEnforcer: { referenceImages: updated, profile: null }
                          });
                          setComic(prev => ({
                            ...prev,
                            styleEnforcer: { referenceImages: updated, profile: null }
                          }));
                        } catch (error) {
                          console.error('Failed to save enforcer reference:', error);
                          alert('Failed to upload image');
                        }
                      };
                      reader.readAsDataURL(file);
                      e.target.value = '';
                    }}
                    accept="image/*"
                    style={{ display: 'none' }}
                  />
                </div>

                {/* Analyze Button */}
                {enforcerImages.length > 0 && (
                  <div style={{ marginBottom: '1.5rem' }}>
                    <button
                      className="btn btn-primary"
                      disabled={enforcerAnalyzing}
                      onClick={async () => {
                        setEnforcerAnalyzing(true);
                        try {
                          const response = await api.post('/images/style-enforcer/analyze', {
                            referenceImages: enforcerImages
                          });
                          const profile = response.data.profile;
                          setEnforcerProfile(profile);
                          await api.put(`/comics/${id}`, {
                            styleEnforcer: { referenceImages: enforcerImages, profile }
                          });
                          setComic(prev => ({
                            ...prev,
                            styleEnforcer: { referenceImages: enforcerImages, profile }
                          }));
                        } catch (error) {
                          console.error('Failed to analyze style:', error);
                          alert('Failed to analyze: ' + (error.response?.data?.error || error.message));
                        } finally {
                          setEnforcerAnalyzing(false);
                        }
                      }}
                      style={{ padding: '0.6rem 1.2rem' }}
                    >
                      {enforcerAnalyzing ? 'Analyzing...' : enforcerProfile ? 'Re-Analyze Style' : 'Analyze Style'}
                    </button>
                  </div>
                )}

                {/* Profile Preview */}
                {enforcerProfile && (
                  <div style={{
                    background: '#1a1a2e',
                    borderRadius: '8px',
                    padding: '1rem',
                    marginBottom: '1.5rem'
                  }}>
                    <h3 style={{ margin: '0 0 0.75rem', color: '#ccc' }}>Extracted Profile</h3>
                    <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      {/* Dominant Color Swatch */}
                      <div style={{ textAlign: 'center' }}>
                        <div style={{
                          width: '60px',
                          height: '60px',
                          borderRadius: '8px',
                          border: '1px solid #444',
                          background: `rgb(${enforcerProfile.dominant?.r || 0}, ${enforcerProfile.dominant?.g || 0}, ${enforcerProfile.dominant?.b || 0})`
                        }} />
                        <small style={{ color: '#888', display: 'block', marginTop: '0.3rem' }}>Dominant</small>
                      </div>

                      {/* Channel Means as color bars */}
                      <div>
                        <small style={{ color: '#888', display: 'block', marginBottom: '0.4rem' }}>Channel Means</small>
                        {['R', 'G', 'B'].map((ch, i) => (
                          <div key={ch} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                            <span style={{ color: ['#e74c3c', '#27ae60', '#3498db'][i], width: '12px', fontWeight: 'bold', fontSize: '0.8rem' }}>{ch}</span>
                            <div style={{
                              height: '10px',
                              width: `${(enforcerProfile.channels?.[i]?.mean || 0) / 255 * 150}px`,
                              background: ['#e74c3c', '#27ae60', '#3498db'][i],
                              borderRadius: '3px',
                              minWidth: '2px'
                            }} />
                            <span style={{ color: '#999', fontSize: '0.75rem' }}>
                              {(enforcerProfile.channels?.[i]?.mean || 0).toFixed(1)}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Brightness / Contrast / Saturation */}
                      <div>
                        <small style={{ color: '#888', display: 'block', marginBottom: '0.4rem' }}>Properties</small>
                        {[
                          { label: 'Brightness', value: enforcerProfile.brightness },
                          { label: 'Contrast', value: enforcerProfile.contrast },
                          { label: 'Saturation', value: enforcerProfile.saturation }
                        ].map(({ label, value }) => (
                          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                            <span style={{ color: '#aaa', fontSize: '0.8rem', width: '70px' }}>{label}</span>
                            <div style={{
                              height: '10px',
                              width: `${Math.min((value || 0) / 2 * 100, 150)}px`,
                              background: '#8e44ad',
                              borderRadius: '3px',
                              minWidth: '2px'
                            }} />
                            <span style={{ color: '#999', fontSize: '0.75rem' }}>
                              {(value || 0).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Strength Slider + Enforce All */}
                {enforcerProfile && (
                  <div style={{
                    background: '#1a1a2e',
                    borderRadius: '8px',
                    padding: '1rem'
                  }}>
                    {/* Sliders */}
                    {[
                      { label: 'Color Strength', value: enforcerStrength, set: setEnforcerStrength, min: 0, max: 100, unit: '%', desc: 'How aggressively to shift colors toward the reference profile', convert: v => v * 100, parse: v => v / 100 },
                      { label: 'Brightness', value: enforcerBrightness, set: setEnforcerBrightness, min: -50, max: 50, unit: '', desc: null, convert: v => v * 100, parse: v => v / 100 },
                      { label: 'Contrast', value: enforcerContrast, set: setEnforcerContrast, min: -50, max: 50, unit: '', desc: null, convert: v => v * 100, parse: v => v / 100 },
                      { label: 'Saturation', value: enforcerSaturation, set: setEnforcerSaturation, min: -50, max: 50, unit: '', desc: null, convert: v => v * 100, parse: v => v / 100 }
                    ].map(({ label, value, set, min, max, unit, desc, convert, parse }) => (
                      <div key={label} style={{ marginBottom: '0.75rem' }}>
                        <label style={{ color: '#ccc', display: 'block', marginBottom: '0.2rem', fontSize: '0.85rem' }}>
                          {label}: {Math.round(convert(value))}{unit}
                        </label>
                        <input
                          type="range"
                          min={min}
                          max={max}
                          value={Math.round(convert(value))}
                          onChange={(e) => set(parse(parseInt(e.target.value)))}
                          style={{ width: '100%', maxWidth: '300px' }}
                        />
                        {desc && <small style={{ color: '#666', display: 'block', marginTop: '0.1rem' }}>{desc}</small>}
                      </div>
                    ))}

                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                      <button
                        className="btn btn-primary"
                        disabled={enforcerEnforcing}
                        onClick={async () => {
                          if (!confirm('This will apply color corrections to ALL pages. Original images will be preserved. Continue?')) return;
                          setEnforcerEnforcing(true);
                          try {
                            const response = await api.post('/images/style-enforcer/enforce-batch', {
                              comicId: id,
                              profile: enforcerProfile,
                              strength: enforcerStrength,
                              brightness: enforcerBrightness,
                              contrast: enforcerContrast,
                              saturation: enforcerSaturation
                            }, { timeout: 300000 });
                            alert(`Done! Processed ${response.data.pagesProcessed} pages.`);
                            await loadComic();
                          } catch (error) {
                            console.error('Failed to enforce batch:', error);
                            alert('Failed: ' + (error.response?.data?.error || error.message));
                          } finally {
                            setEnforcerEnforcing(false);
                          }
                        }}
                        style={{ padding: '0.6rem 1.2rem', background: enforcerEnforcing ? '#666' : '#8e44ad' }}
                      >
                        {enforcerEnforcing ? 'Enforcing... please wait' : 'Enforce All Pages'}
                      </button>

                      {comic.pages?.some(p => p.originalMasterImage) && (
                        <button
                          className="btn btn-secondary"
                          disabled={enforcerReverting}
                          onClick={async () => {
                            if (!confirm('Revert ALL pages to their original images?')) return;
                            setEnforcerReverting(true);
                            try {
                              const response = await api.post('/images/style-enforcer/revert-batch', { comicId: id });
                              alert(`Reverted ${response.data.pagesReverted} pages to originals.`);
                              await loadComic();
                            } catch (error) {
                              console.error('Failed to revert:', error);
                              alert('Failed: ' + (error.response?.data?.error || error.message));
                            } finally {
                              setEnforcerReverting(false);
                            }
                          }}
                          style={{ padding: '0.6rem 1.2rem', background: enforcerReverting ? '#666' : '#e67e22' }}
                        >
                          {enforcerReverting ? 'Reverting...' : 'Revert All Pages'}
                        </button>
                      )}
                    </div>
                    {enforcerEnforcing && (
                      <p style={{ color: '#c4b5fd', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                        Processing all pages — this may take a moment. An alert will appear when done.
                      </p>
                    )}
                  </div>
                )}
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

          {/* Image generation agent */}
          <div style={{ background: '#f8f9fa', border: '1px solid #ddd', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem' }}>
            <h3 style={{ marginTop: 0, marginBottom: '0.3rem', color: '#333' }}>Image generation agent</h3>
            <p style={{ color: '#888', fontSize: '0.85rem', margin: '0 0 0.8rem' }}>
              Which AI creates this comic's page/panel images by default (used by "Generate All" and the primary Generate). The per-panel OpenAI/Gemini buttons still override per generation. Gemini uses the current best page-generation model.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {[{ v: 'openai', label: 'ChatGPT (OpenAI)' }, { v: 'gemini', label: 'Gemini' }].map(opt => {
                const active = (comic.imageProvider || 'openai') === opt.v;
                return (
                  <button key={opt.v}
                    onClick={async () => {
                      try {
                        await api.put(`/comics/${id}`, { imageProvider: opt.v });
                        setComic({ ...comic, imageProvider: opt.v });
                      } catch (e) { alert('Failed to update image agent'); }
                    }}
                    style={{ padding: '0.5rem 1.2rem', borderRadius: '6px', border: active ? 'none' : '1px solid #ccc', cursor: 'pointer', fontWeight: active ? 'bold' : 'normal', color: active ? '#fff' : '#333', background: active ? '#4a90d9' : '#fff' }}>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cover — Landscape (Reader detail-view banner) */}
          <div style={{
            background: '#f8f9fa',
            border: '1px solid #ddd',
            borderRadius: '8px',
            padding: '1.5rem',
            marginBottom: '1.5rem'
          }}>
            <h3 style={{ marginTop: 0, marginBottom: '0.3rem', color: '#333' }}>Cover — Landscape (Reader banner)</h3>
            <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1rem' }}>
              A wide 3:2 image shown as the banner at the top of this comic in the Reader. Generated like the cover image.
            </p>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
              {coverLandscapeImage && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div
                    onClick={() => setCoverLandscapeLightbox(true)}
                    title="Click to enlarge"
                    style={{ width: 220, height: 147, borderRadius: '6px', border: '1px solid #ccc', overflow: 'hidden', cursor: 'pointer' }}
                  >
                    <img
                      src={`${api.defaults.baseURL.replace('/api', '')}${coverLandscapeImage}?t=${Date.now()}`}
                      alt="Landscape cover"
                      style={{
                        width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                        transformOrigin: 'center',
                        transform: `scale(${coverLandscapeZoom}) translate(${coverLandscapeZoom > 1 ? (-coverLandscapeCropX * (coverLandscapeZoom - 1) / (2 * coverLandscapeZoom) * 100) : 0}%, ${coverLandscapeZoom > 1 ? (-coverLandscapeCropY * (coverLandscapeZoom - 1) / (2 * coverLandscapeZoom) * 100) : 0}%)`,
                        filter: `brightness(${coverLandscapeBrightness}) contrast(${coverLandscapeContrast}) saturate(${coverLandscapeSaturation})`
                      }}
                    />
                  </div>
                  {/* Brightness / contrast / saturation controls */}
                  <div style={{ width: 220 }}>
                    <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.3rem' }}>
                      <button
                        onClick={() => {
                          const newSat = coverLandscapeSaturation === 0 ? 1 : 0;
                          setCoverLandscapeSaturation(newSat);
                          saveLandscapeCoverAdj({ landscapeSaturation: newSat });
                        }}
                        style={{ padding: '2px 6px', fontSize: '0.65rem', border: '1px solid #ccc', borderRadius: '3px', cursor: 'pointer', background: coverLandscapeSaturation === 0 ? '#8e44ad' : '#fff', color: coverLandscapeSaturation === 0 ? '#fff' : '#333' }}
                      >B&amp;W</button>
                      {(coverLandscapeBrightness !== 1 || coverLandscapeContrast !== 1 || coverLandscapeSaturation !== 1) && (
                        <button
                          onClick={() => {
                            setCoverLandscapeBrightness(1); setCoverLandscapeContrast(1); setCoverLandscapeSaturation(1);
                            saveLandscapeCoverAdj({ landscapeBrightness: 1, landscapeContrast: 1, landscapeSaturation: 1 });
                          }}
                          style={{ padding: '2px 6px', fontSize: '0.65rem', border: '1px solid #ccc', borderRadius: '3px', cursor: 'pointer', background: '#fff', color: '#333' }}
                        >Reset</button>
                      )}
                    </div>
                    {[
                      { label: 'Bright', value: coverLandscapeBrightness, set: setCoverLandscapeBrightness, field: 'landscapeBrightness', min: 50, max: 300 },
                      { label: 'Contrast', value: coverLandscapeContrast, set: setCoverLandscapeContrast, field: 'landscapeContrast', min: 50, max: 150 },
                      { label: 'Saturtn', value: coverLandscapeSaturation, set: setCoverLandscapeSaturation, field: 'landscapeSaturation', min: 0, max: 200 }
                    ].map(s => (
                      <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.15rem' }}>
                        <span style={{ fontSize: '0.6rem', color: '#888', width: '40px' }}>{s.label}</span>
                        <input type="range" min={s.min} max={s.max} value={Math.round(s.value * 100)}
                          onChange={(e) => { const v = parseInt(e.target.value) / 100; s.set(v); saveLandscapeCoverAdj({ [s.field]: v }); }}
                          style={{ flex: 1, height: '12px' }}
                        />
                        <span style={{ fontSize: '0.6rem', color: '#888', width: '28px', textAlign: 'right' }}>{Math.round(s.value * 100)}%</span>
                      </div>
                    ))}

                    {/* Zoom + pan (move up/down/left/right) */}
                    <div style={{ marginTop: '0.4rem', borderTop: '1px solid #eee', paddingTop: '0.4rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.25rem' }}>
                        <span style={{ fontSize: '0.6rem', color: '#888', width: '40px' }}>Zoom</span>
                        <input type="range" min={100} max={300} value={Math.round(coverLandscapeZoom * 100)}
                          onChange={(e) => { const v = parseInt(e.target.value) / 100; setCoverLandscapeZoom(v); saveLandscapeCoverAdj({ landscapeZoom: v }); }}
                          style={{ flex: 1, height: '12px' }}
                        />
                        <span style={{ fontSize: '0.6rem', color: '#888', width: '28px', textAlign: 'right' }}>{Math.round(coverLandscapeZoom * 100)}%</span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.6rem', color: '#888', width: '40px' }}>Move</span>
                        {[
                          { label: '←', dx: -0.25, dy: 0 },
                          { label: '→', dx: 0.25, dy: 0 },
                          { label: '↑', dx: 0, dy: -0.25 },
                          { label: '↓', dx: 0, dy: 0.25 }
                        ].map(b => (
                          <button key={b.label} disabled={coverLandscapeZoom <= 1}
                            onClick={() => {
                              const nx = Math.min(1, Math.max(-1, coverLandscapeCropX + b.dx));
                              const ny = Math.min(1, Math.max(-1, coverLandscapeCropY + b.dy));
                              setCoverLandscapeCropX(nx); setCoverLandscapeCropY(ny);
                              saveLandscapeCoverAdj({ landscapeCropX: nx, landscapeCropY: ny });
                            }}
                            style={{ padding: '2px 8px', fontSize: '0.8rem', border: '1px solid #ccc', borderRadius: '3px', cursor: coverLandscapeZoom <= 1 ? 'default' : 'pointer', background: '#fff', color: coverLandscapeZoom <= 1 ? '#ccc' : '#333' }}
                          >{b.label}</button>
                        ))}
                        {(coverLandscapeZoom !== 1 || coverLandscapeCropX !== 0 || coverLandscapeCropY !== 0) && (
                          <button
                            onClick={() => {
                              setCoverLandscapeZoom(1); setCoverLandscapeCropX(0); setCoverLandscapeCropY(0);
                              saveLandscapeCoverAdj({ landscapeZoom: 1, landscapeCropX: 0, landscapeCropY: 0 });
                            }}
                            style={{ padding: '2px 6px', fontSize: '0.65rem', border: '1px solid #ccc', borderRadius: '3px', cursor: 'pointer', background: '#fff', color: '#333' }}
                          >Reset</button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.8rem', color: '#555' }}>Landscape Prompt</label>
                <textarea
                  value={coverLandscapePrompt}
                  onChange={(e) => setCoverLandscapePrompt(e.target.value)}
                  placeholder="Describe the wide banner image, e.g. 'A cinematic wide shot of the train cutting through the night countryside, the two leads silhouetted in a lit carriage window...'"
                  rows={3}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc', resize: 'vertical', fontSize: '0.85rem' }}
                />
                {/* Reference image selector */}
                {(() => {
                  const availableChars = settings.characters?.filter(c => c.image) || [];
                  const availableStyles = (settings.styleBibleImages || []).filter(img => img.image);
                  const hasMaster = !!settings.masterStyleImage;
                  // Pages of this comic — usable as references so the banner can
                  // reuse an actual scene/pose from the story. Strip cache-busters.
                  const availablePages = [...(comic.pages || [])]
                    .filter(p => p.masterImage)
                    .sort((a, b) => a.pageNumber - b.pageNumber)
                    .map(p => ({ src: p.masterImage.split('?')[0], label: `Page ${p.pageNumber}` }));
                  if (availableChars.length === 0 && availableStyles.length === 0 && !hasMaster && availablePages.length === 0) return null;
                  const toggle = (img) => setCoverLandscapeRefs(prev => prev.includes(img) ? prev.filter(p => p !== img) : [...prev, img]);
                  const chip = (src, label, key) => (
                    <div key={key} style={{ position: 'relative', border: coverLandscapeRefs.includes(src) ? '3px solid #27ae60' : '2px solid #ddd', borderRadius: '6px', padding: '2px', textAlign: 'center' }}>
                      <img onClick={() => toggle(src)} src={`${api.defaults.baseURL.replace('/api', '')}${src}`} alt={label} style={{ height: '60px', borderRadius: '4px', display: 'block', cursor: 'pointer' }} />
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setRefLightbox(`${api.defaults.baseURL.replace('/api', '')}${src}`); }}
                        title="Enlarge"
                        style={{ position: 'absolute', top: '4px', right: '4px', width: '18px', height: '18px', lineHeight: '16px', padding: 0, borderRadius: '4px', border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: '0.7rem', cursor: 'pointer' }}
                      >⤢</button>
                      <div style={{ fontSize: '0.65rem', color: '#666', maxWidth: '60px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                    </div>
                  );
                  return (
                    <div style={{ marginTop: '0.5rem' }}>
                      <small style={{ color: '#888' }}>Reference Images ({coverLandscapeRefs.length} selected)</small>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                        {hasMaster && chip(settings.masterStyleImage, 'Master', 'master')}
                        {availableChars.map(c => chip(c.image, c.name, c.id))}
                        {availableStyles.map((img, idx) => chip(img.image, img.name || `Style ${idx + 1}`, img.id || idx))}
                      </div>
                      {availablePages.length > 0 && (
                        <>
                          <small style={{ color: '#888', display: 'block', marginTop: '0.5rem' }}>From comic pages</small>
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                            {availablePages.map(pg => chip(pg.src, pg.label, `page-${pg.src}`))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}
                <button
                  className="btn btn-primary"
                  disabled={coverLandscapeGenerating || !coverLandscapePrompt.trim()}
                  onClick={async () => {
                    setCoverLandscapeGenerating(true);
                    try {
                      let fullPrompt = '';
                      if (settings.styleBible) fullPrompt += `ART STYLE GUIDE:\n${settings.styleBible}\n\n`;
                      if (settings.cameraAndInks) fullPrompt += `CAMERA & INKS:\n${settings.cameraAndInks}\n\n`;
                      const selectedCharImages = coverLandscapeRefs.filter(ref => settings.characters?.some(c => c.image === ref));
                      const chars = settings.characters?.filter(c => c.name && c.description && (!c.image || selectedCharImages.includes(c.image))) || [];
                      if (chars.length > 0) {
                        fullPrompt += `CHARACTERS:\n`;
                        chars.forEach(c => { fullPrompt += `- ${c.name}: ${c.description}\n`; });
                        fullPrompt += '\n';
                      }
                      if (settings.doNotInclude) fullPrompt += `DO NOT INCLUDE: ${settings.doNotInclude}\n\n`;
                      fullPrompt += `SCENE:\n${coverLandscapePrompt}\n\nThis is a LANDSCAPE BANNER IMAGE for a comic, shown as a wide header at the top of the comic. Make it dramatic and cinematic, composed for a horizontal 3:2 banner with the key subject framed toward the upper portion. Landscape orientation. IMPORTANT: the artwork must FILL THE ENTIRE FRAME edge to edge (full bleed) — do NOT add any borders, frames, margins, or empty/white space around the image. COMPOSE A SINGLE UNIFIED SCENE — this is NOT a character sheet or turnaround. Use the reference images ONLY for character identity, costume, and art style; do NOT reproduce their layout, multiple poses, turnaround/angle rows, or repeated figures. Show each named character exactly once.`;

                      const referenceImages = [...coverLandscapeRefs];
                      const hasMasterSelected = settings.masterStyleImage && coverLandscapeRefs.includes(settings.masterStyleImage);

                      const response = await api.post('/images/generate-panel', {
                        prompt: fullPrompt,
                        panelId: `comic-cover-landscape-${id}`,
                        aspectRatio: 'landscape',
                        referenceImages,
                        linkedPanelImages: [],
                        provider: 'openai',
                        openaiQuality: 'high',
                        hasMasterStyleImage: !!hasMasterSelected
                      }, { timeout: 600000 });

                      const genData = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
                      if (genData.error) throw new Error(genData.error);
                      if (!genData.path) throw new Error('Image generation did not return a file path');

                      const saveRes = await api.post('/images/save-to-project', {
                        comicId: id,
                        filename: genData.path.split('/').pop(),
                        imageType: 'cover-landscape'
                      });
                      const finalPath = `${saveRes.data.path}`;
                      setCoverLandscapeImage(finalPath);

                      const updatedCover = { ...(comic.cover || {}), landscapeImage: finalPath, landscapePrompt: coverLandscapePrompt };
                      await api.put(`/comics/${id}`, { cover: updatedCover });
                      setComic(prev => ({ ...prev, cover: updatedCover }));
                    } catch (err) {
                      console.error('Landscape cover generation failed:', err);
                      alert('Failed to generate landscape cover: ' + (err.response?.data?.error || err.message));
                    } finally {
                      setCoverLandscapeGenerating(false);
                    }
                  }}
                  style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', marginTop: '0.75rem' }}
                >
                  {coverLandscapeGenerating ? 'Generating…' : (coverLandscapeImage ? 'Regenerate Landscape Cover' : 'Generate Landscape Cover')}
                </button>

                <label
                  className="btn btn-secondary"
                  style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', marginTop: '0.75rem', marginLeft: '0.5rem', cursor: coverLandscapeGenerating ? 'default' : 'pointer', display: 'inline-block' }}
                >
                  Upload Image
                  <input
                    type="file"
                    accept="image/*"
                    disabled={coverLandscapeGenerating}
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setCoverLandscapeGenerating(true);
                      try {
                        const formData = new FormData();
                        formData.append('image', file);
                        const up = await api.post('/images/upload', formData, {
                          headers: { 'Content-Type': 'multipart/form-data' }
                        });
                        const saveRes = await api.post('/images/save-to-project', {
                          comicId: id,
                          filename: up.data.filename,
                          imageType: 'cover-landscape'
                        });
                        const finalPath = `${saveRes.data.path}`;
                        setCoverLandscapeImage(finalPath);
                        const updatedCover = { ...(comic.cover || {}), landscapeImage: finalPath };
                        await api.put(`/comics/${id}`, { cover: updatedCover });
                        setComic(prev => ({ ...prev, cover: updatedCover }));
                      } catch (err) {
                        console.error('Landscape upload failed:', err);
                        alert('Failed to upload landscape image: ' + (err.response?.data?.error || err.message));
                      } finally {
                        setCoverLandscapeGenerating(false);
                        e.target.value = '';
                      }
                    }}
                  />
                </label>

                {/* Refine the existing landscape cover: current image is the edit
                    target, refinement instructions describe the change. */}
                {coverLandscapeImage && (
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem' }}>
                    <input
                      type="text"
                      value={coverLandscapeRefinePrompt}
                      onChange={(e) => setCoverLandscapeRefinePrompt(e.target.value)}
                      placeholder="Refinement instructions (e.g. make the sky stormy, remove the second rider...)"
                      style={{ flex: 1, padding: '0.4rem 0.6rem', fontSize: '0.85rem', border: '1px solid #444', borderRadius: '4px', background: 'rgba(255,255,255,0.04)', color: '#ccc' }}
                    />
                    <button
                      className="btn btn-secondary"
                      disabled={coverLandscapeGenerating || !coverLandscapeRefinePrompt.trim()}
                      onClick={async () => {
                        setCoverLandscapeGenerating(true);
                        try {
                          let fullPrompt = '';
                          if (settings.styleBible) fullPrompt += `ART STYLE GUIDE:\n${settings.styleBible}\n\n`;
                          fullPrompt += `REFINEMENT of the attached landscape banner image. Apply ONLY these changes:\n${coverLandscapeRefinePrompt}\n\n`
                            + `Keep everything else in the image exactly the same — same composition, characters, colors and art style. `
                            + `Landscape orientation, full bleed edge to edge, no borders or margins.`;

                          const response = await api.post('/images/generate-panel', {
                            prompt: fullPrompt,
                            panelId: `comic-cover-landscape-${id}`,
                            aspectRatio: 'landscape',
                            referenceImages: [...coverLandscapeRefs],
                            linkedPanelImages: [coverLandscapeImage],
                            isRefinement: true,
                            provider: 'openai',
                            openaiQuality: 'high',
                            hasMasterStyleImage: !!(settings.masterStyleImage && coverLandscapeRefs.includes(settings.masterStyleImage))
                          }, { timeout: 600000 });

                          const genData = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
                          if (genData.error) throw new Error(genData.error);
                          if (!genData.path) throw new Error('Image generation did not return a file path');

                          const saveRes = await api.post('/images/save-to-project', {
                            comicId: id,
                            filename: genData.path.split('/').pop(),
                            imageType: 'cover-landscape'
                          });
                          const finalPath = `${saveRes.data.path}`;
                          setCoverLandscapeImage(finalPath);
                          const updatedCover = { ...(comic.cover || {}), landscapeImage: finalPath };
                          await api.put(`/comics/${id}`, { cover: updatedCover });
                          setComic(prev => ({ ...prev, cover: updatedCover }));
                          setCoverLandscapeRefinePrompt('');
                        } catch (err) {
                          console.error('Landscape cover refinement failed:', err);
                          alert('Failed to refine landscape cover: ' + (err.response?.data?.error || err.message));
                        } finally {
                          setCoverLandscapeGenerating(false);
                        }
                      }}
                      style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                    >
                      {coverLandscapeGenerating ? 'Working…' : 'Refine'}
                    </button>
                  </div>
                )}

                <div style={{ marginTop: '0.75rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.8rem', color: '#555' }}>
                    Title position on banner (in the Reader)
                  </label>
                  <select
                    value={bannerTitlePosition}
                    onChange={async (e) => {
                      const pos = e.target.value;
                      setBannerTitlePosition(pos);
                      const updatedCover = { ...(comic.cover || {}), bannerTitlePosition: pos };
                      setComic(prev => ({ ...prev, cover: updatedCover }));
                      try {
                        await api.put(`/comics/${id}`, { cover: updatedCover });
                      } catch (err) {
                        console.error('Failed to save banner title position:', err);
                      }
                    }}
                    style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '0.85rem' }}
                  >
                    <option value="topLeft">Top left</option>
                    <option value="topRight">Top right</option>
                    <option value="bottomLeft">Bottom left</option>
                    <option value="bottomRight">Bottom right</option>
                    <option value="center">Centered</option>
                    <option value="hidden">Hidden (no title — art only)</option>
                  </select>
                  <p style={{ color: '#999', fontSize: '0.75rem', margin: '0.3rem 0 0' }}>
                    Where the Reader places the title + level over the banner, so it doesn't cover the art.
                  </p>
                </div>
              </div>
            </div>
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
            {comic.collectionId && (
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem', color: '#555' }}>Collection English Title (optional)</label>
                <input
                  type="text"
                  value={comic.collectionTitleEn || ''}
                  onChange={(e) => setComic({ ...comic, collectionTitleEn: e.target.value || undefined })}
                  placeholder="e.g. The Visitor"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>
            )}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem', color: '#555' }}>Episode Number</label>
              <input
                type="number"
                min="1"
                value={comic.episodeNumber || ''}
                onChange={(e) => setComic({ ...comic, episodeNumber: e.target.value ? parseInt(e.target.value) : undefined })}
                placeholder="e.g. 1"
                style={{ width: '120px', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
              />
            </div>
            {comic.collectionId && (
              <>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem', color: '#555' }}>Collection Caption</label>
                  <textarea
                    value={collectionDescription}
                    onChange={(e) => setCollectionDescription(e.target.value)}
                    placeholder="Short description shown in the store, e.g. 'A coming-of-age story set in a busy restaurant...'"
                    rows={2}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc', resize: 'vertical' }}
                  />
                </div>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.85rem', color: '#555' }}>Collection Cover Image</label>
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                    {collectionCoverImage && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center' }}>
                        <img
                          src={`${api.defaults.baseURL.replace('/api', '')}${collectionCoverImage}?t=${Date.now()}`}
                          alt="Collection cover"
                          onClick={() => setCollectionCoverLightbox(true)}
                          style={{
                            width: 100, height: 150, objectFit: 'cover', borderRadius: '6px', border: '1px solid #ccc',
                            cursor: 'pointer',
                            filter: `brightness(${collectionCoverBrightness}) contrast(${collectionCoverContrast}) saturate(${collectionCoverSaturation})`
                          }}
                        />
                        {/* Adjustment controls */}
                        <div style={{ width: 180 }}>
                          <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.3rem' }}>
                            <button
                              onClick={() => {
                                const newSat = collectionCoverSaturation === 0 ? 1 : 0;
                                setCollectionCoverSaturation(newSat);
                                saveCollectionCoverAdj({ coverSaturation: newSat });
                              }}
                              style={{ padding: '2px 6px', fontSize: '0.65rem', border: '1px solid #ccc', borderRadius: '3px', cursor: 'pointer', background: collectionCoverSaturation === 0 ? '#8e44ad' : '#fff', color: collectionCoverSaturation === 0 ? '#fff' : '#333' }}
                            >B&W</button>
                            {(collectionCoverBrightness !== 1 || collectionCoverContrast !== 1 || collectionCoverSaturation !== 1) && (
                              <button
                                onClick={() => {
                                  setCollectionCoverBrightness(1); setCollectionCoverContrast(1); setCollectionCoverSaturation(1);
                                  saveCollectionCoverAdj({ coverBrightness: 1, coverContrast: 1, coverSaturation: 1 });
                                }}
                                style={{ padding: '2px 6px', fontSize: '0.65rem', border: '1px solid #ccc', borderRadius: '3px', cursor: 'pointer', background: '#fff', color: '#333' }}
                              >Reset</button>
                            )}
                          </div>
                          {[
                            { label: 'Bright', value: collectionCoverBrightness, set: setCollectionCoverBrightness, field: 'coverBrightness', min: 50, max: 300 },
                            { label: 'Contrast', value: collectionCoverContrast, set: setCollectionCoverContrast, field: 'coverContrast', min: 50, max: 150 },
                            { label: 'Saturtn', value: collectionCoverSaturation, set: setCollectionCoverSaturation, field: 'coverSaturation', min: 0, max: 200 }
                          ].map(s => (
                            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.15rem' }}>
                              <span style={{ fontSize: '0.6rem', color: '#888', width: '40px' }}>{s.label}</span>
                              <input type="range" min={s.min} max={s.max} value={Math.round(s.value * 100)}
                                onChange={(e) => { const v = parseInt(e.target.value) / 100; s.set(v); saveCollectionCoverAdj({ [s.field]: v }); }}
                                style={{ flex: 1, height: '12px' }}
                              />
                              <span style={{ fontSize: '0.6rem', color: '#888', width: '28px', textAlign: 'right' }}>{Math.round(s.value * 100)}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.8rem', color: '#555' }}>Cover Prompt</label>
                      <textarea
                        value={collectionCoverPrompt}
                        onChange={(e) => setCollectionCoverPrompt(e.target.value)}
                        placeholder="Describe the collection cover image, e.g. 'A dramatic portrait-style illustration of the main characters standing in front of the restaurant...'"
                        rows={3}
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc', resize: 'vertical', fontSize: '0.85rem' }}
                      />
                      {/* Reference image selector */}
                      {(() => {
                        const availableChars = settings.characters?.filter(c => c.image) || [];
                        const availableStyles = (settings.styleBibleImages || []).filter(img => img.image);
                        const hasMaster = !!settings.masterStyleImage;
                        if (availableChars.length === 0 && availableStyles.length === 0 && !hasMaster) return null;
                        return (
                          <div style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                            <small style={{ color: '#888' }}>Reference Images ({collectionCoverRefs.length} selected)</small>
                            {hasMaster && (
                              <div style={{ marginTop: '0.25rem', marginBottom: '0.25rem' }}>
                                <small style={{ color: '#aaa', fontSize: '0.7rem' }}>Master Style</small>
                                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.15rem' }}>
                                  <div
                                    style={{ position: 'relative', border: collectionCoverRefs.includes(settings.masterStyleImage) ? '3px solid #27ae60' : '2px solid #ddd', borderRadius: '6px', padding: '2px', textAlign: 'center' }}
                                  >
                                    <img onClick={() => setCollectionCoverRefs(prev => prev.includes(settings.masterStyleImage) ? prev.filter(p => p !== settings.masterStyleImage) : [...prev, settings.masterStyleImage])} src={`${api.defaults.baseURL.replace('/api', '')}${settings.masterStyleImage}`} alt="Master style" style={{ height: '60px', borderRadius: '4px', display: 'block', cursor: 'pointer' }} />
                                    <button type="button" onClick={(e) => { e.stopPropagation(); setRefLightbox(`${api.defaults.baseURL.replace('/api', '')}${settings.masterStyleImage}`); }} title="Enlarge" style={{ position: 'absolute', top: '4px', right: '4px', width: '18px', height: '18px', lineHeight: '16px', padding: 0, borderRadius: '4px', border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: '0.7rem', cursor: 'pointer' }}>⤢</button>
                                    <div style={{ fontSize: '0.65rem', color: '#666' }}>Master</div>
                                  </div>
                                </div>
                              </div>
                            )}
                            {availableChars.length > 0 && (
                              <div style={{ marginTop: '0.25rem', marginBottom: '0.25rem' }}>
                                <small style={{ color: '#aaa', fontSize: '0.7rem' }}>Characters</small>
                                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.15rem' }}>
                                  {availableChars.map(char => (
                                    <div
                                      key={char.id}
                                      style={{ position: 'relative', border: collectionCoverRefs.includes(char.image) ? '3px solid #27ae60' : '2px solid #ddd', borderRadius: '6px', padding: '2px', textAlign: 'center' }}
                                    >
                                      <img onClick={() => setCollectionCoverRefs(prev => prev.includes(char.image) ? prev.filter(p => p !== char.image) : [...prev, char.image])} src={`${api.defaults.baseURL.replace('/api', '')}${char.image}`} alt={char.name} style={{ height: '60px', borderRadius: '4px', display: 'block', cursor: 'pointer' }} />
                                      <button type="button" onClick={(e) => { e.stopPropagation(); setRefLightbox(`${api.defaults.baseURL.replace('/api', '')}${char.image}`); }} title="Enlarge" style={{ position: 'absolute', top: '4px', right: '4px', width: '18px', height: '18px', lineHeight: '16px', padding: 0, borderRadius: '4px', border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: '0.7rem', cursor: 'pointer' }}>⤢</button>
                                      <div style={{ fontSize: '0.65rem', color: '#666', maxWidth: '60px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{char.name}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {availableStyles.length > 0 && (
                              <div style={{ marginTop: '0.25rem', marginBottom: '0.25rem' }}>
                                <small style={{ color: '#aaa', fontSize: '0.7rem' }}>Style Bible</small>
                                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.15rem' }}>
                                  {availableStyles.map((img, idx) => (
                                    <div
                                      key={img.id || idx}
                                      style={{ position: 'relative', border: collectionCoverRefs.includes(img.image) ? '3px solid #27ae60' : '2px solid #ddd', borderRadius: '6px', padding: '2px', textAlign: 'center' }}
                                    >
                                      <img onClick={() => setCollectionCoverRefs(prev => prev.includes(img.image) ? prev.filter(p => p !== img.image) : [...prev, img.image])} src={`${api.defaults.baseURL.replace('/api', '')}${img.image}`} alt={img.name || `Style ${idx + 1}`} style={{ height: '60px', borderRadius: '4px', display: 'block', cursor: 'pointer' }} />
                                      <button type="button" onClick={(e) => { e.stopPropagation(); setRefLightbox(`${api.defaults.baseURL.replace('/api', '')}${img.image}`); }} title="Enlarge" style={{ position: 'absolute', top: '4px', right: '4px', width: '18px', height: '18px', lineHeight: '16px', padding: 0, borderRadius: '4px', border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: '0.7rem', cursor: 'pointer' }}>⤢</button>
                                      <div style={{ fontSize: '0.65rem', color: '#666', maxWidth: '60px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{img.name || `Style ${idx + 1}`}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
                        <button
                          className="btn btn-primary"
                          disabled={collectionCoverGenerating || !collectionCoverPrompt.trim()}
                          onClick={async () => {
                            setCollectionCoverGenerating(true);
                            try {
                              // Build prompt with style bible context
                              let fullPrompt = '';
                              if (settings.styleBible) {
                                fullPrompt += `ART STYLE GUIDE:\n${settings.styleBible}\n\n`;
                              }
                              if (settings.cameraAndInks) {
                                fullPrompt += `CAMERA & INKS:\n${settings.cameraAndInks}\n\n`;
                              }
                              // Add character descriptions for selected characters only
                              const selectedCharImages = collectionCoverRefs.filter(ref =>
                                settings.characters?.some(c => c.image === ref)
                              );
                              const chars = settings.characters?.filter(c => c.name && c.description && (!c.image || selectedCharImages.includes(c.image))) || [];
                              if (chars.length > 0) {
                                fullPrompt += `CHARACTERS:\n`;
                                chars.forEach(c => { fullPrompt += `- ${c.name}: ${c.description}\n`; });
                                fullPrompt += '\n';
                              }
                              if (settings.doNotInclude) {
                                fullPrompt += `DO NOT INCLUDE: ${settings.doNotInclude}\n\n`;
                              }
                              fullPrompt += `SCENE:\n${collectionCoverPrompt}\n\nThis is a COVER IMAGE for a comic collection. Make it dramatic and eye-catching, suitable for a book cover or movie poster. Portrait orientation.`;

                              // Use selected reference images
                              const referenceImages = [...collectionCoverRefs];
                              const hasMasterSelected = settings.masterStyleImage && collectionCoverRefs.includes(settings.masterStyleImage);

                              const colId = comic.collectionId || settingsCollectionId;
                              const response = await api.post('/images/generate-panel', {
                                prompt: fullPrompt,
                                panelId: `collection-cover-${colId}`,
                                aspectRatio: 'portrait',
                                referenceImages,
                                linkedPanelImages: [],
                                provider: 'openai',
                                openaiQuality: 'high',
                                hasMasterStyleImage: !!hasMasterSelected
                              }, { timeout: 600000 });

                              // Parse response if it came back as a string (keep-alive padding)
                              const genData = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;

                              if (genData.error) {
                                throw new Error(genData.error);
                              }
                              if (!genData.path) {
                                console.error('generate-panel response:', genData);
                                throw new Error('Image generation did not return a file path');
                              }

                              // Copy from uploads to collection project folder
                              const copyRes = await api.post('/images/copy-to-collection', {
                                collectionId: colId,
                                sourcePath: genData.path
                              });

                              const finalPath = copyRes.data.path;
                              setCollectionCoverImage(finalPath);

                              // Auto-save to collection
                              await api.put(`/collections/${colId}`, {
                                id: colId,
                                coverImage: finalPath,
                                coverPrompt: collectionCoverPrompt
                              });
                            } catch (err) {
                              console.error('Collection cover generation failed:', err);
                              alert('Failed to generate cover image: ' + (err.response?.data?.error || err.message));
                            } finally {
                              setCollectionCoverGenerating(false);
                            }
                          }}
                          style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}
                        >
                          {collectionCoverGenerating ? 'Generating...' : (collectionCoverImage ? 'Regenerate' : 'Generate')}
                        </button>
                        <span style={{ fontSize: '0.75rem', color: '#999' }}>or</span>
                        <label style={{ fontSize: '0.8rem', color: '#3498db', cursor: 'pointer' }}>
                          Upload
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                            onChange={async (e) => {
                              const file = e.target.files[0];
                              if (!file) return;
                              const reader = new FileReader();
                              reader.onload = async (ev) => {
                                try {
                                  const base64 = ev.target.result.split(',')[1];
                                  const res = await api.post('/images/save-reference', {
                                    collectionId: comic.collectionId,
                                    image: base64
                                  });
                                  setCollectionCoverImage(res.data.path);
                                  await api.put(`/collections/${comic.collectionId}`, {
                                    id: comic.collectionId,
                                    coverImage: res.data.path
                                  });
                                } catch (err) {
                                  alert('Failed to upload cover image');
                                }
                              };
                              reader.readAsDataURL(file);
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
            <div>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    // Save comic-level collection fields
                    const collectionData = {};
                    if (comic.collectionId) collectionData.collectionId = comic.collectionId;
                    if (comic.collectionTitle) collectionData.collectionTitle = comic.collectionTitle;
                    if (comic.episodeNumber) collectionData.episodeNumber = comic.episodeNumber;
                    await api.put(`/comics/${id}`, collectionData);

                    // Save collection-level metadata (description, coverImage)
                    if (comic.collectionId) {
                      await api.put(`/collections/${comic.collectionId}`, {
                        id: comic.collectionId,
                        title: comic.collectionTitle,
                        titleEn: comic.collectionTitleEn || '',
                        description: collectionDescription,
                        coverImage: collectionCoverImage,
                        coverPrompt: collectionCoverPrompt
                      });
                    }
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
      {activeTab === 'voicelibrary' && (
        <div style={{ maxWidth: '800px' }}>
          <h2 style={{ margin: '0 0 0.75rem' }}>Voice Library</h2>

          {/* Source toggle */}
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem' }}>
            <button
              className={`btn btn-sm ${voiceLibSource === 'mine' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setVoiceLibSource('mine')}
              style={{ padding: '0.35rem 0.9rem', fontSize: '0.85rem' }}
            >My Voices</button>
            <button
              className={`btn btn-sm ${voiceLibSource === 'community' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setVoiceLibSource('community'); if (!communityLoaded && !communityLoading) loadCommunityVoices(0, false); }}
              style={{ padding: '0.35rem 0.9rem', fontSize: '0.85rem' }}
            >Community</button>
          </div>

          {voiceLibSource === 'mine' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <p style={{ color: '#888', fontSize: '0.85rem', margin: 0 }}>
                  Voices in your ElevenLabs account. Preview and save into this {comic.collectionId ? 'collection' : 'comic'}’s Voices.
                </p>
                <button onClick={loadVoiceLibrary} disabled={voiceLibLoading} className="btn btn-secondary btn-sm" style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem', flexShrink: 0 }}>
                  {voiceLibLoading ? 'Loading…' : 'Refresh'}
                </button>
              </div>

              <input
                type="text"
                value={voiceLibSearch}
                onChange={(e) => setVoiceLibSearch(e.target.value)}
                placeholder="Filter by name (e.g. Diego)…"
                style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #ccc', fontSize: '0.95rem', margin: '0.5rem 0 0.4rem' }}
              />
              {voiceLib.length > 0 && (
                <p style={{ color: '#aaa', fontSize: '0.75rem', margin: '0 0 0.75rem' }}>
                  {(() => {
                    const q = voiceLibSearch.trim().toLowerCase();
                    const shown = q ? voiceLib.filter(v => `${v.name} ${v.category || ''} ${Object.values(v.labels || {}).join(' ')}`.toLowerCase().includes(q)).length : voiceLib.length;
                    return `Showing ${shown} of ${voiceLib.length}. Most premade voices are multilingual — they speak Spanish regardless of the language label, so don't filter by “Spanish” here.`;
                  })()}
                </p>
              )}

              {voiceLibError && (
                <p style={{ color: '#e74c3c', fontSize: '0.85rem' }}>Couldn’t load voices: {voiceLibError}</p>
              )}
              {voiceLibLoading && voiceLib.length === 0 && (
                <p style={{ color: '#888' }}>Loading voices…</p>
              )}
              {voiceLibLoaded && !voiceLibLoading && voiceLib.length === 0 && !voiceLibError && (
                <p style={{ color: '#888', fontStyle: 'italic' }}>No voices found in your ElevenLabs account.</p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {voiceLib
                  .filter(v => {
                    const q = voiceLibSearch.trim().toLowerCase();
                    if (!q) return true;
                    const hay = `${v.name} ${v.category || ''} ${Object.values(v.labels || {}).join(' ')}`.toLowerCase();
                    return hay.includes(q);
                  })
                  .map(voice => {
                    const saved = (comic.voices || []).some(x => x.voiceId === voice.voice_id);
                    const labelTags = Object.values(voice.labels || {}).filter(Boolean);
                    const playing = voiceLibPlayingId === voice.voice_id;
                    return (
                      <div key={voice.voice_id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: '#f8f9fa', border: '1px solid #ddd', borderRadius: '8px', padding: '0.75rem' }}>
                        <button
                          onClick={() => voiceLibPreview(voice)}
                          title={voice.preview_url ? 'Preview' : 'No preview available'}
                          style={{ flexShrink: 0, width: '36px', height: '36px', borderRadius: '50%', border: 'none', cursor: 'pointer', background: playing ? '#e74c3c' : '#2980b9', color: '#fff', fontSize: '0.9rem' }}
                        >{playing ? '■' : '▶'}</button>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 'bold' }}>{voice.name}</div>
                          <div style={{ fontSize: '0.75rem', color: '#888' }}>
                            {[voice.category, ...labelTags].filter(Boolean).join(' · ')}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#aaa', fontFamily: 'monospace' }}>{voice.voice_id}</div>
                        </div>
                        {saved ? (
                          <span style={{ color: '#27ae60', fontSize: '0.85rem', fontWeight: 'bold' }}>✓ Added</span>
                        ) : (
                          <button onClick={() => voiceLibSave(voice)} className="btn btn-primary btn-sm" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>Save to Voices</button>
                        )}
                      </div>
                    );
                  })}
              </div>
            </>
          )}

          {voiceLibSource === 'community' && (
            <>
              <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                Search ElevenLabs’ full community library. “Add to Voices” adds the voice to your ElevenLabs account and into this {comic.collectionId ? 'collection' : 'comic'}.
              </p>
              <p style={{ color: '#aaa', fontSize: '0.75rem', marginBottom: '0.75rem' }}>
                To find Spanish voices, use the <b>Language</b> filter — not the search box (typing “Spanish” there matches across all languages).
              </p>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem' }}>
                <select value={communityLanguage} onChange={(e) => { const v = e.target.value; setCommunityLanguage(v); loadCommunityVoices(0, false, { language: v }); }} style={{ padding: '0.55rem', borderRadius: '6px', border: '1px solid #ccc', fontSize: '0.85rem' }}>
                  <option value="">Any language</option>
                  <option value="es">Spanish</option>
                  <option value="en">English</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                  <option value="it">Italian</option>
                  <option value="pt">Portuguese</option>
                </select>
                <select value={communityGender} onChange={(e) => { const v = e.target.value; setCommunityGender(v); loadCommunityVoices(0, false, { gender: v }); }} style={{ padding: '0.55rem', borderRadius: '6px', border: '1px solid #ccc', fontSize: '0.85rem' }}>
                  <option value="">Any gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="neutral">Neutral</option>
                </select>
                <select value={communityAccent} onChange={(e) => { const v = e.target.value; setCommunityAccent(v); loadCommunityVoices(0, false, { accent: v }); }} style={{ padding: '0.55rem', borderRadius: '6px', border: '1px solid #ccc', fontSize: '0.85rem' }}>
                  <option value="">Any accent</option>
                  <option value="peninsular">Peninsular (Spain)</option>
                  <option value="latin american">Latin American</option>
                  <option value="mexican">Mexican</option>
                  <option value="argentine">Argentine</option>
                  <option value="colombian">Colombian</option>
                  <option value="chilean">Chilean</option>
                  <option value="cuban">Cuban</option>
                  <option value="peruvian">Peruvian</option>
                </select>
                <input
                  type="text"
                  value={communitySearch}
                  onChange={(e) => setCommunitySearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') loadCommunityVoices(0, false); }}
                  placeholder="Name or style (optional): narrator, raspy…"
                  style={{ flex: 1, minWidth: '180px', padding: '0.6rem', borderRadius: '6px', border: '1px solid #ccc', fontSize: '0.95rem' }}
                />
                <button onClick={() => loadCommunityVoices(0, false)} disabled={communityLoading} className="btn btn-primary btn-sm" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
                  {communityLoading ? 'Searching…' : 'Search'}
                </button>
              </div>

              {communityLoaded && communityVoices.length > 0 && (
                <p style={{ color: '#aaa', fontSize: '0.75rem', marginBottom: '0.5rem' }}>{communityVoices.length} loaded{communityHasMore ? ' (more available)' : ''}</p>
              )}

              {communityError && (
                <p style={{ color: '#e74c3c', fontSize: '0.85rem' }}>Couldn’t load voices: {communityError}</p>
              )}
              {communityLoaded && !communityLoading && communityVoices.length === 0 && !communityError && (
                <p style={{ color: '#888', fontStyle: 'italic' }}>No community voices matched.</p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {communityVoices.map(voice => {
                  const playing = voiceLibPlayingId === voice.voice_id;
                  const tags = [voice.gender, voice.age, voice.accent, voice.language, voice.use_case, voice.descriptive].filter(Boolean);
                  const adding = addingVoiceId === voice.voice_id;
                  const added = communityAdded.includes(voice.voice_id);
                  return (
                    <div key={`${voice.public_owner_id}-${voice.voice_id}`} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: added ? '#eafaf0' : '#f8f9fa', border: added ? '1px solid #27ae60' : '1px solid #ddd', borderRadius: '8px', padding: '0.75rem' }}>
                      <button
                        onClick={() => voiceLibPreview(voice)}
                        title={voice.preview_url ? 'Preview' : 'No preview available'}
                        style={{ flexShrink: 0, width: '36px', height: '36px', borderRadius: '50%', border: 'none', cursor: 'pointer', background: playing ? '#e74c3c' : '#2980b9', color: '#fff', fontSize: '0.9rem' }}
                      >{playing ? '■' : '▶'}</button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 'bold' }}>{voice.name}</div>
                        <div style={{ fontSize: '0.75rem', color: '#888' }}>{tags.join(' · ')}</div>
                      </div>
                      {added ? (
                        <span style={{ color: '#27ae60', fontSize: '0.85rem', fontWeight: 'bold', flexShrink: 0 }}>✓ Added</span>
                      ) : (
                        <button onClick={() => communityAddAndSave(voice)} disabled={adding} className="btn btn-primary btn-sm" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', flexShrink: 0 }}>
                          {adding ? 'Adding…' : 'Add to Voices'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {communityHasMore && !communityLoading && (
                <button onClick={() => loadCommunityVoices(communityPage + 1, true)} className="btn btn-secondary btn-sm" style={{ marginTop: '0.75rem', padding: '0.4rem 1rem', fontSize: '0.8rem' }}>
                  Load more
                </button>
              )}
            </>
          )}
        </div>
      )}

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
                    // Use fetch with streaming to keep connection alive
                    const response = await fetch('/api/audio/generate-word-audio', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        comicId: id,
                        voiceId: wordAudioVoiceId,
                        modelId: wordAudioModel,
                        forceRegenerate: wordAudioForceRegenerate
                      })
                    });
                    if (!response.ok) {
                      const err = await response.json();
                      throw new Error(err.error || 'Generation failed');
                    }
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';
                    while (true) {
                      const { done, value } = await reader.read();
                      if (done) break;
                      buffer += decoder.decode(value, { stream: true });
                      const lines = buffer.split('\n');
                      buffer = lines.pop(); // keep incomplete line in buffer
                      for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                          const msg = JSON.parse(line);
                          if (msg.type === 'progress') {
                            setWordAudioProgress(prev => ({ ...prev, generated: msg.generated, skipped: msg.skipped, failed: msg.failed, currentWord: msg.current }));
                          } else if (msg.type === 'done') {
                            setWordAudioProgress(prev => ({ ...prev, generated: msg.generated, skipped: msg.skipped, failed: msg.failed, done: true }));
                          } else if (msg.type === 'error') {
                            throw new Error(msg.error);
                          }
                        } catch (parseErr) {
                          console.warn('Failed to parse stream line:', line);
                        }
                      }
                    }
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
                  <div style={{ marginTop: '0.5rem' }}>
                    {wordAudioProgress.generated > 0 || wordAudioProgress.failed > 0 ? (
                      <p style={{ margin: '0 0 0.3rem 0', color: '#2c3e50', fontSize: '0.85rem' }}>
                        Progress: {wordAudioProgress.generated + (wordAudioProgress.failed || 0)} / {wordAudioProgress.toGenerate} generated
                        {wordAudioProgress.currentWord && <span style={{ color: '#888' }}> — {wordAudioProgress.currentWord}</span>}
                      </p>
                    ) : null}
                    <p style={{ margin: '0', color: '#856404', fontSize: '0.85rem' }}>
                      Generating audio... Please do not close this page.
                    </p>
                  </div>
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

            {/* Word Forms Section */}
            <div style={{ background: '#fdf2e9', padding: '1rem', borderRadius: '6px', border: '1px solid #e8c9a0' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#e67e22' }}>Word Grammar Forms</h4>
              <p style={{ color: '#888', fontSize: '0.85rem', margin: '0 0 0.75rem 0' }}>
                Generate grammatical forms (conjugations, gender/number variants) for all words in the comic via GPT.
              </p>
              <button
                onClick={async () => {
                  setWordFormsGenerating(true);
                  setWordFormsResult(null);
                  try {
                    const response = await fetch('/api/chat/generate-word-forms', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      // Only words WITHOUT forms by default — force was hard-coded
                      // true for a while, redoing every word on every click.
                      body: JSON.stringify({ comicId: id, forceRegenerate: wordFormsForceRegenerate })
                    });
                    if (!response.ok) {
                      const err = await response.json();
                      throw new Error(err.error || 'Generation failed');
                    }
                    // Check if streaming (NDJSON) or regular JSON (e.g. "all words already have forms")
                    const contentType = response.headers.get('content-type') || '';
                    if (contentType.includes('ndjson')) {
                      const reader = response.body.getReader();
                      const decoder = new TextDecoder();
                      let buffer = '';
                      while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop();
                        for (const line of lines) {
                          if (!line.trim()) continue;
                          try {
                            const msg = JSON.parse(line);
                            if (msg.type === 'progress') {
                              setWordFormsResult({ chunk: msg.chunk, totalChunks: msg.totalChunks, wordsProcessed: msg.wordsProcessed, totalWords: msg.totalWords, inProgress: true });
                            } else if (msg.type === 'done') {
                              setWordFormsResult({ generated: msg.generated, updated: msg.updated, total: msg.total, inProgress: false });
                            } else if (msg.type === 'error') {
                              throw new Error(msg.error);
                            }
                          } catch (parseErr) {
                            console.warn('Failed to parse stream line:', line);
                          }
                        }
                      }
                    } else {
                      const data = await response.json();
                      setWordFormsResult({ ...data, inProgress: false });
                    }
                  } catch (error) {
                    console.error('Word forms generation failed:', error);
                    alert('Word forms generation failed: ' + error.message);
                  } finally {
                    setWordFormsGenerating(false);
                  }
                }}
                disabled={wordFormsGenerating}
                style={{
                  padding: '0.5rem 1.2rem',
                  background: wordFormsGenerating ? '#95a5a6' : '#e67e22',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: wordFormsGenerating ? 'default' : 'pointer',
                  fontSize: '0.95rem'
                }}
              >
                {wordFormsGenerating ? 'Generating Forms...' : 'Generate Word Forms'}
              </button>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: '#666', marginTop: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={wordFormsForceRegenerate}
                  onChange={(e) => setWordFormsForceRegenerate(e.target.checked)}
                />
                Force regenerate all (redo words that already have forms)
              </label>
              {wordFormsResult && wordFormsResult.inProgress && (
                <div style={{ background: '#fff3cd', padding: '0.75rem', borderRadius: '4px', marginTop: '0.75rem' }}>
                  <p style={{ margin: 0, color: '#856404' }}>
                    Processing chunk {wordFormsResult.chunk} of {wordFormsResult.totalChunks} ({wordFormsResult.wordsProcessed} / {wordFormsResult.totalWords} words)...
                  </p>
                </div>
              )}
              {wordFormsResult && !wordFormsResult.inProgress && wordFormsResult.generated != null && (
                <div style={{ background: '#d4edda', padding: '0.75rem', borderRadius: '4px', marginTop: '0.75rem' }}>
                  <p style={{ margin: 0, color: '#155724' }}>
                    Done! Generated forms for {wordFormsResult.generated} base words. Updated {wordFormsResult.updated} word instances.
                  </p>
                </div>
              )}
            </div>

            {/* Grammar Explanations Section */}
            <div style={{ background: '#f4ecf7', padding: '1rem', borderRadius: '6px', border: '1px solid #d2b4de' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#8e44ad' }}>Sentence Grammar Explanations</h4>
              <p style={{ color: '#888', fontSize: '0.85rem', margin: '0 0 0.75rem 0' }}>
                Generate a short grammar explanation for every sentence via GPT. Shown in the reader app under "Explain grammar". Run before exporting.
              </p>
              <button
                onClick={async () => {
                  setGrammarNotesGenerating(true);
                  setGrammarNotesResult(null);
                  try {
                    const response = await fetch('/api/chat/generate-grammar-explanations', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ comicId: id })
                    });
                    if (!response.ok) {
                      const err = await response.json();
                      throw new Error(err.error || 'Generation failed');
                    }
                    const contentType = response.headers.get('content-type') || '';
                    if (contentType.includes('ndjson')) {
                      const reader = response.body.getReader();
                      const decoder = new TextDecoder();
                      let buffer = '';
                      while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop();
                        for (const line of lines) {
                          if (!line.trim()) continue;
                          try {
                            const msg = JSON.parse(line);
                            if (msg.type === 'progress') {
                              setGrammarNotesResult({ chunk: msg.chunk, totalChunks: msg.totalChunks, sentencesProcessed: msg.sentencesProcessed, totalSentences: msg.totalSentences, inProgress: true });
                            } else if (msg.type === 'done') {
                              setGrammarNotesResult({ generated: msg.generated, updated: msg.updated, total: msg.total, inProgress: false });
                            } else if (msg.type === 'error') {
                              throw new Error(msg.error);
                            }
                          } catch (parseErr) {
                            console.warn('Failed to parse stream line:', line);
                          }
                        }
                      }
                    } else {
                      const data = await response.json();
                      setGrammarNotesResult({ ...data, inProgress: false });
                    }
                  } catch (error) {
                    console.error('Grammar explanations generation failed:', error);
                    alert('Grammar explanations generation failed: ' + error.message);
                  } finally {
                    setGrammarNotesGenerating(false);
                  }
                }}
                disabled={grammarNotesGenerating}
                style={{
                  padding: '0.5rem 1.2rem',
                  background: grammarNotesGenerating ? '#95a5a6' : '#8e44ad',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: grammarNotesGenerating ? 'default' : 'pointer',
                  fontSize: '0.95rem'
                }}
              >
                {grammarNotesGenerating ? 'Generating Explanations...' : 'Generate Grammar Explanations'}
              </button>
              {grammarNotesResult && grammarNotesResult.inProgress && (
                <div style={{ background: '#fff3cd', padding: '0.75rem', borderRadius: '4px', marginTop: '0.75rem' }}>
                  <p style={{ margin: 0, color: '#856404' }}>
                    Processing chunk {grammarNotesResult.chunk} of {grammarNotesResult.totalChunks} ({grammarNotesResult.sentencesProcessed} / {grammarNotesResult.totalSentences} sentences)...
                  </p>
                </div>
              )}
              {grammarNotesResult && !grammarNotesResult.inProgress && grammarNotesResult.generated != null && (
                <div style={{ background: '#d4edda', padding: '0.75rem', borderRadius: '4px', marginTop: '0.75rem' }}>
                  <p style={{ margin: 0, color: '#155724' }}>
                    Done! Generated explanations for {grammarNotesResult.generated} sentences{grammarNotesResult.updated != null ? `, updated ${grammarNotesResult.updated}` : ''}.
                  </p>
                </div>
              )}
              {grammarNotesResult && !grammarNotesResult.inProgress && grammarNotesResult.generated === 0 && grammarNotesResult.message && (
                <div style={{ background: '#d1ecf1', padding: '0.75rem', borderRadius: '4px', marginTop: '0.75rem' }}>
                  <p style={{ margin: 0, color: '#0c5460' }}>{grammarNotesResult.message}</p>
                </div>
              )}
            </div>

            {/* Fill Missing Meanings Section */}
            <div style={{ background: '#eaf2f8', padding: '1rem', borderRadius: '6px', border: '1px solid #a9cce3' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#2980b9' }}>Fill Missing Meanings</h4>
              <p style={{ color: '#888', fontSize: '0.85rem', margin: '0 0 0.75rem 0' }}>
                Scan all words and fill in any missing English meanings and base forms via GPT.
              </p>
              <button
                onClick={async () => {
                  setFillMeaningsRunning(true);
                  setFillMeaningsResult(null);
                  try {
                    const response = await fetch('/api/chat/fill-missing-meanings', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ comicId: id })
                    });
                    if (!response.ok) {
                      const err = await response.json();
                      throw new Error(err.error || 'Failed');
                    }
                    const contentType = response.headers.get('content-type') || '';
                    if (contentType.includes('ndjson')) {
                      const reader = response.body.getReader();
                      const decoder = new TextDecoder();
                      let buffer = '';
                      while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop();
                        for (const line of lines) {
                          if (!line.trim()) continue;
                          try {
                            const msg = JSON.parse(line);
                            if (msg.type === 'progress') {
                              setFillMeaningsResult({ current: msg.current, total: msg.total, fixed: msg.fixed, inProgress: true });
                            } else if (msg.type === 'done') {
                              setFillMeaningsResult({ fixed: msg.fixed, total: msg.total, inProgress: false, message: msg.message });
                            } else if (msg.type === 'error') {
                              throw new Error(msg.error);
                            }
                          } catch (parseErr) {
                            console.warn('Failed to parse stream line:', line);
                          }
                        }
                      }
                    } else {
                      const data = await response.json();
                      setFillMeaningsResult({ ...data, inProgress: false });
                    }
                  } catch (error) {
                    console.error('Fill meanings failed:', error);
                    alert('Fill meanings failed: ' + error.message);
                  } finally {
                    setFillMeaningsRunning(false);
                  }
                }}
                disabled={fillMeaningsRunning}
                style={{
                  padding: '0.5rem 1.2rem',
                  background: fillMeaningsRunning ? '#95a5a6' : '#2980b9',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: fillMeaningsRunning ? 'default' : 'pointer',
                  fontSize: '0.95rem'
                }}
              >
                {fillMeaningsRunning ? 'Filling Meanings...' : 'Fill Missing Meanings'}
              </button>
              {fillMeaningsResult && fillMeaningsResult.inProgress && (
                <div style={{ background: '#fff3cd', padding: '0.75rem', borderRadius: '4px', marginTop: '0.75rem' }}>
                  <p style={{ margin: 0, color: '#856404' }}>
                    Processing sentence {fillMeaningsResult.current} of {fillMeaningsResult.total} ({fillMeaningsResult.fixed} words fixed so far)...
                  </p>
                </div>
              )}
              {fillMeaningsResult && !fillMeaningsResult.inProgress && (
                <div style={{ background: '#d4edda', padding: '0.75rem', borderRadius: '4px', marginTop: '0.75rem' }}>
                  <p style={{ margin: 0, color: '#155724' }}>
                    {fillMeaningsResult.fixed > 0
                      ? `Done! Fixed meanings for ${fillMeaningsResult.fixed} words across ${fillMeaningsResult.total} sentences.`
                      : (fillMeaningsResult.message || 'All words already have meanings.')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Style Sheet Tab */}
      {activeTab === 'stylesheet' && (
        <div style={{ maxWidth: '800px' }}>
          <h2 style={{ marginBottom: '0.5rem' }}>Style Sheet</h2>
          <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
            Build character and location reference sheets in a locked art style. Start by uploading
            one or more images that define the style you want to enforce — these get pinned as the
            style anchor for everything generated here.
          </p>

          <h3 style={{ fontSize: '1rem', marginBottom: '0.35rem' }}>Style references</h3>
          <p style={{ color: '#999', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
            Upload example art whose style you want to match (line work, shading, palette).
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.75rem' }}>
            {(settings.styleSheetImages || []).map((ref, idx) => {
              const describing = styleSheetDescribing.includes(ref.path);
              return (
                <div key={ref.path || idx} style={{ display: 'flex', gap: '0.75rem', border: '1px solid #2a2a3e', borderRadius: '8px', padding: '0.5rem', alignItems: 'flex-start' }}>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <img
                      onClick={() => setRefLightbox(ref.path)}
                      src={`${ref.path}`}
                      alt={`Style reference ${idx + 1}`}
                      title="Click to enlarge"
                      style={{ height: '140px', borderRadius: '6px', display: 'block', cursor: 'pointer', border: '2px solid #6E40F0' }}
                    />
                    <button
                      onClick={() => styleSheetRemoveRef(ref.path)}
                      title="Remove"
                      style={{
                        position: 'absolute', top: '-8px', right: '-8px', background: '#e74c3c', color: '#fff',
                        border: 'none', borderRadius: '50%', width: '22px', height: '22px', fontSize: '0.8rem',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}
                    >×</button>
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                      <small style={{ color: '#888' }}>
                        {describing ? 'Analyzing art style…' : 'Extracted style prompt'}
                      </small>
                      <button
                        onClick={() => styleSheetRedescribe(ref.path)}
                        disabled={describing}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem' }}
                      >{describing ? '…' : 'Re-analyze'}</button>
                    </div>
                    <textarea
                      value={ref.stylePrompt || ''}
                      onChange={(e) => styleSheetUpdatePrompt(ref.path, e.target.value)}
                      onBlur={styleSheetPersist}
                      placeholder={describing ? 'Generating a detailed style description…' : 'Style description (used to keep new images on-style)'}
                      style={{ height: '140px', minHeight: '110px', width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', fontSize: '0.82rem', resize: 'both', fontFamily: 'inherit' }}
                    />
                  </div>
                </div>
              );
            })}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => styleSheetFileInputRef.current?.click()}
                className="btn btn-secondary"
                style={{ flex: 1, minHeight: '60px', border: '2px dashed #aaa', borderRadius: '8px', fontSize: '0.85rem' }}
              >
                + Upload style reference
              </button>
              <button
                onClick={openStyleSheetPicker}
                className="btn btn-secondary"
                title="Pick a panel or page from a comic in this collection"
                style={{ flex: 1, minHeight: '60px', border: '2px dashed #aaa', borderRadius: '8px', fontSize: '0.85rem' }}
              >
                + From comics
              </button>
            </div>
            <input type="file" ref={styleSheetFileInputRef} onChange={styleSheetUploadRef} accept="image/*" style={{ display: 'none' }} />
          </div>

          {(settings.styleSheetImages || []).length === 0 && (
            <p style={{ color: '#bbb', fontSize: '0.8rem', fontStyle: 'italic' }}>
              No style references yet. Upload at least one to anchor the style.
            </p>
          )}

          {/* Generator */}
          <div style={{ borderTop: '1px solid #2a2a3e', marginTop: '1.5rem', paddingTop: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Generate a sheet</h3>

            {/* Mode toggle */}
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem' }}>
              <button
                className={`btn btn-sm ${styleSheetMode === 'character' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setStyleSheetMode('character')}
                style={{ padding: '0.35rem 0.8rem', fontSize: '0.85rem' }}
              >Character</button>
              <button
                className={`btn btn-sm ${styleSheetMode === 'location' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setStyleSheetMode('location')}
                style={{ padding: '0.35rem 0.8rem', fontSize: '0.85rem' }}
              >Location</button>
            </div>

            {/* Prompt */}
            <textarea
              value={styleSheetPrompt}
              onChange={(e) => setStyleSheetPrompt(e.target.value)}
              placeholder={styleSheetMode === 'character'
                ? 'Describe the character: name, age, build, face, hair, clothing, props, personality…'
                : 'Describe the location: type of place, architecture, key features, mood, lighting, palette…'}
              rows={5}
              style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px solid #ccc', fontSize: '0.95rem', marginBottom: '0.75rem', resize: 'both' }}
            />

            {/* Controls */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.85rem', color: '#666', marginRight: '0.25rem' }}>Provider:</span>
                <button className={`btn btn-sm ${styleSheetProvider === 'gemini' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStyleSheetProvider('gemini')} style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>Gemini</button>
                <button className={`btn btn-sm ${styleSheetProvider === 'openai' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStyleSheetProvider('openai')} style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>OpenAI</button>
              </div>
              {styleSheetProvider === 'openai' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <span style={{ fontSize: '0.85rem', color: '#666', marginRight: '0.25rem' }}>ChatGPT:</span>
                  <button className={`btn btn-sm ${styleSheetQuality === 'high' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStyleSheetQuality('high')} style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>High</button>
                  <button className={`btn btn-sm ${styleSheetQuality === 'medium' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStyleSheetQuality('medium')} style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>Medium (~4x cheaper)</button>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.85rem', color: '#666', marginRight: '0.25rem' }}>Aspect:</span>
                <button className={`btn btn-sm ${styleSheetAspect === 'landscape' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStyleSheetAspect('landscape')} style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>Landscape</button>
                <button className={`btn btn-sm ${styleSheetAspect === 'square' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStyleSheetAspect('square')} style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>Square</button>
                <button className={`btn btn-sm ${styleSheetAspect === 'portrait' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStyleSheetAspect('portrait')} style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>Portrait</button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '1.5rem' }}>
              <button
                onClick={styleSheetGenerate}
                disabled={styleSheetGenerating || !styleSheetPrompt.trim() || (settings.styleSheetImages || []).length === 0}
                className="btn btn-primary"
                style={{ padding: '0.6rem 1.5rem' }}
              >
                {styleSheetGenerating ? 'Generating…' : `Generate ${styleSheetMode === 'location' ? 'Location' : 'Character'} Sheet`}
              </button>
              {styleSheetGenerating && (
                <button
                  onClick={styleSheetStop}
                  className="btn btn-secondary"
                  style={{ padding: '0.6rem 1.2rem', color: '#e74c3c' }}
                >Stop</button>
              )}
            </div>

            {/* Results */}
            {styleSheetGallery.length > 0 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                  <h3 style={{ fontSize: '1rem', margin: 0 }}>Results ({styleSheetGallery.length})</h3>
                  <button
                    onClick={() => setStyleSheetGallery([])}
                    className="btn btn-secondary btn-sm"
                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                  >Clear all</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {styleSheetGallery.map((item, idx) => (
                    <div key={idx} style={{ border: '1px solid #2a2a3e', borderRadius: '8px', padding: '0.5rem' }}>
                      <img
                        src={`${item.path}`}
                        alt={item.prompt.substring(0, 40)}
                        onClick={() => setRefLightbox(item.path)}
                        title="Click to enlarge"
                        style={{ width: '100%', borderRadius: '6px', cursor: 'pointer', display: 'block' }}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.7rem', color: '#888', textTransform: 'uppercase' }}>{item.mode} · {item.provider}{typeof item.refsLoaded === 'number' ? ` · ${item.refsLoaded} ref(s) sent` : ''}</span>
                        <button onClick={() => styleSheetSaveAsCharacter(item)} className="btn btn-primary btn-sm" style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}>Save as Character</button>
                        <button onClick={() => styleSheetSaveToStyleBible(item)} className="btn btn-secondary btn-sm" style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}>Add to Style Bible</button>
                        <button onClick={() => styleSheetDownload(item)} className="btn btn-secondary btn-sm" style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}>Download</button>
                        <button
                          onClick={() => setStyleSheetGallery(prev => prev.filter((_, i) => i !== idx))}
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', color: '#e74c3c' }}
                        >Delete</button>
                      </div>
                      {item.promptSent && (
                        <details style={{ marginTop: '0.4rem' }}>
                          <summary style={{ cursor: 'pointer', fontSize: '0.72rem', color: '#888' }}>Prompt sent to model</summary>
                          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.7rem', color: '#aaa', background: '#11111a', padding: '0.5rem', borderRadius: '6px', marginTop: '0.3rem', maxHeight: '200px', overflow: 'auto' }}>{item.promptSent}</pre>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Studio Tab */}
      {activeTab === 'studio' && (
        <div style={{ maxWidth: '800px' }}>
          <h2 style={{ marginBottom: '0.5rem' }}>Image Studio</h2>
          <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1rem' }}>
            Generate standalone images using the API directly. Select references from this comic's characters and style bible.
          </p>

          {/* Prompt */}
          <textarea
            value={studioPrompt}
            onChange={(e) => setStudioPrompt(e.target.value)}
            placeholder="Describe the image you want to generate..."
            rows={4}
            style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px solid #ccc', fontSize: '0.95rem', marginBottom: '0.75rem', resize: 'vertical' }}
          />

          {/* Controls row */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <span style={{ fontSize: '0.85rem', color: '#666', marginRight: '0.25rem' }}>Provider:</span>
              <button className={`btn btn-sm ${studioProvider === 'gemini' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStudioProvider('gemini')} style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>Gemini</button>
              <button className={`btn btn-sm ${studioProvider === 'openai' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStudioProvider('openai')} style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>OpenAI</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <span style={{ fontSize: '0.85rem', color: '#666', marginRight: '0.25rem' }}>Aspect:</span>
              <button className={`btn btn-sm ${studioAspectRatio === 'square' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStudioAspectRatio('square')} style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>Square</button>
              <button className={`btn btn-sm ${studioAspectRatio === 'portrait' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStudioAspectRatio('portrait')} style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>Portrait</button>
              <button className={`btn btn-sm ${studioAspectRatio === 'landscape' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStudioAspectRatio('landscape')} style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>Landscape</button>
            </div>
            {settings.masterStyleImage && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem', color: '#666', cursor: 'pointer' }}>
                <input type="checkbox" checked={studioUseMasterStyle} onChange={(e) => setStudioUseMasterStyle(e.target.checked)} />
                Master style
              </label>
            )}
          </div>

          {/* Reference images picker */}
          <details style={{ marginBottom: '0.75rem', border: '1px solid #e0e0e0', borderRadius: '6px', padding: '0.5rem 0.75rem' }}>
            <summary style={{ cursor: 'pointer', color: '#555', fontSize: '0.9rem', userSelect: 'none' }}>
              Reference Images ({studioRefImages.length + studioUploadedRefs.length} selected)
            </summary>
            <div style={{ marginTop: '0.5rem' }}>
              {/* Characters */}
              {settings.characters.filter(c => c.image).length > 0 && (
                <div style={{ marginBottom: '0.5rem' }}>
                  <small style={{ color: '#888' }}>Characters</small>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                    {settings.characters.filter(c => c.image).map(char => (
                      <div key={char.id} style={{
                        position: 'relative',
                        border: studioRefImages.includes(char.image) ? '3px solid #27ae60' : '2px solid #ddd',
                        borderRadius: '6px', padding: '2px', textAlign: 'center'
                      }}>
                        <img onClick={() => studioToggleRef(char.image)} src={`${char.image}`} alt={char.name} style={{ height: '60px', borderRadius: '4px', display: 'block', cursor: 'pointer' }} />
                        <button type="button" onClick={(e) => { e.stopPropagation(); setRefLightbox(char.image); }} title="Enlarge" style={{ position: 'absolute', top: '4px', right: '4px', width: '18px', height: '18px', lineHeight: '16px', padding: 0, borderRadius: '4px', border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: '0.7rem', cursor: 'pointer' }}>⤢</button>
                        <div style={{ fontSize: '0.65rem', color: '#666', maxWidth: '60px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{char.name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Style Bible images */}
              {(settings.styleBibleImages || []).length > 0 && (
                <div style={{ marginBottom: '0.5rem' }}>
                  <small style={{ color: '#888' }}>Style Bible</small>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                    {settings.styleBibleImages.map((img, idx) => (
                      <div key={idx} style={{
                        position: 'relative',
                        border: studioRefImages.includes(img) ? '3px solid #27ae60' : '2px solid #ddd',
                        borderRadius: '6px', padding: '2px'
                      }}>
                        <img onClick={() => studioToggleRef(img)} src={`${img}`} alt={`Style ${idx + 1}`} style={{ height: '60px', borderRadius: '4px', display: 'block', cursor: 'pointer' }} />
                        <button type="button" onClick={(e) => { e.stopPropagation(); setRefLightbox(img); }} title="Enlarge" style={{ position: 'absolute', top: '4px', right: '4px', width: '18px', height: '18px', lineHeight: '16px', padding: 0, borderRadius: '4px', border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: '0.7rem', cursor: 'pointer' }}>⤢</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Uploaded refs */}
              {studioUploadedRefs.length > 0 && (
                <div style={{ marginBottom: '0.5rem' }}>
                  <small style={{ color: '#888' }}>Uploaded</small>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                    {studioUploadedRefs.map((img, idx) => (
                      <div key={idx} style={{ position: 'relative', border: '2px solid #3498db', borderRadius: '6px', padding: '2px' }}>
                        <img onClick={() => setRefLightbox(img)} src={`${img}`} alt={`Upload ${idx + 1}`} title="Enlarge" style={{ height: '60px', borderRadius: '4px', display: 'block', cursor: 'pointer' }} />
                        <button onClick={() => setStudioUploadedRefs(prev => prev.filter((_, i) => i !== idx))} style={{
                          position: 'absolute', top: '-6px', right: '-6px', background: '#e74c3c', color: '#fff',
                          border: 'none', borderRadius: '50%', width: '18px', height: '18px', fontSize: '0.7rem',
                          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>x</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={() => studioFileInputRef.current?.click()} className="btn btn-secondary btn-sm" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>+ Upload Reference</button>
              <input type="file" ref={studioFileInputRef} onChange={studioUploadRef} accept="image/*" style={{ display: 'none' }} />
            </div>
          </details>

          {/* Generate button */}
          <button
            onClick={studioGenerate}
            disabled={studioGenerating || !studioPrompt.trim()}
            className="btn btn-primary"
            style={{ padding: '0.6rem 1.5rem', marginBottom: '1.5rem' }}
          >
            {studioGenerating ? 'Generating...' : 'Generate Image'}
          </button>

          {/* Gallery */}
          {studioGallery.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Gallery ({studioGallery.length})</h3>
              <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
                {studioGallery.map((item, idx) => (
                  <img
                    key={idx}
                    src={`${item.path}`}
                    alt={item.prompt.substring(0, 30)}
                    onClick={() => { setStudioSelectedImage(idx); setStudioInpaintMode(false); setStudioInpaintRect(null); }}
                    style={{
                      height: '80px', borderRadius: '4px', cursor: 'pointer', flexShrink: 0,
                      border: studioSelectedImage === idx ? '3px solid #3498db' : '2px solid #ddd'
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Selected image viewer */}
          {studioSelectedImage != null && studioGallery[studioSelectedImage] && (
            <div>
              <div style={{ position: 'relative', display: 'inline-block', marginBottom: '0.5rem' }}>
                <img
                  ref={studioImageRef}
                  src={`${studioGallery[studioSelectedImage].path}`}
                  alt="Selected"
                  onMouseDown={studioHandleMouseDown}
                  onMouseMove={studioHandleMouseMove}
                  draggable={false}
                  style={{
                    maxWidth: '100%', maxHeight: '500px', borderRadius: '6px',
                    cursor: studioInpaintMode ? 'crosshair' : 'default', userSelect: 'none'
                  }}
                />
                {/* Inpaint rect overlay */}
                {studioInpaintMode && studioInpaintRect && studioInpaintRect.width > 0 && studioInpaintRect.height > 0 && (
                  <div style={{
                    position: 'absolute',
                    left: `${studioInpaintRect.x * 100}%`,
                    top: `${studioInpaintRect.y * 100}%`,
                    width: `${studioInpaintRect.width * 100}%`,
                    height: `${studioInpaintRect.height * 100}%`,
                    border: '2px dashed #00ff88',
                    background: 'rgba(0,255,136,0.15)',
                    pointerEvents: 'none'
                  }} />
                )}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: '0.5rem' }}>
                {studioGallery[studioSelectedImage].prompt} ({studioGallery[studioSelectedImage].provider})
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <button onClick={() => studioSaveAsReference(studioSelectedImage)} className="btn btn-secondary btn-sm" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                  Save as Reference
                </button>
                <button onClick={() => studioDownload(studioSelectedImage)} className="btn btn-secondary btn-sm" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                  Download
                </button>
                <button
                  onClick={() => { setStudioInpaintMode(!studioInpaintMode); setStudioInpaintRect(null); setStudioInpaintPrompt(''); }}
                  className={`btn btn-sm ${studioInpaintMode ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                >
                  {studioInpaintMode ? 'Cancel Inpaint' : 'Inpaint'}
                </button>
              </div>

              {/* Inpaint controls */}
              {studioInpaintMode && (
                <div style={{ background: '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: '6px', padding: '0.75rem', marginBottom: '1rem' }}>
                  {!studioInpaintRect || studioInpaintRect.width === 0 ? (
                    <p style={{ color: '#888', fontSize: '0.85rem', margin: 0 }}>Draw a rectangle on the image to select the region to inpaint</p>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={studioInpaintPrompt}
                        onChange={(e) => setStudioInpaintPrompt(e.target.value)}
                        placeholder="Describe what to generate in the selected region..."
                        onKeyDown={(e) => { if (e.key === 'Enter' && studioInpaintPrompt.trim()) studioExecuteInpaint('gemini'); }}
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '0.9rem', marginBottom: '0.5rem' }}
                        autoFocus
                      />
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => studioExecuteInpaint('openai')}
                          disabled={!!studioInpaintGenerating || !studioInpaintPrompt.trim()}
                          className="btn btn-sm btn-secondary"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                        >
                          {studioInpaintGenerating === 'openai' ? 'Inpainting...' : 'Inpaint (ChatGPT)'}
                        </button>
                        <button
                          onClick={() => studioExecuteInpaint('gemini')}
                          disabled={!!studioInpaintGenerating || !studioInpaintPrompt.trim()}
                          className="btn btn-sm btn-secondary"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                        >
                          {studioInpaintGenerating === 'gemini' ? 'Inpainting...' : 'Inpaint (Gemini)'}
                        </button>
                        <button
                          onClick={() => { setStudioInpaintRect(null); setStudioInpaintPrompt(''); }}
                          className="btn btn-sm btn-secondary"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                        >
                          Redraw
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Consistency Tab */}
      {activeTab === 'consistency' && (
        <div style={{ maxWidth: '900px' }}>
          <h2 style={{ marginBottom: '0.5rem' }}>Character Consistency</h2>
          <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1rem' }}>
            Scan panels for character consistency issues and fix them using AI.
          </p>

          {/* Controls */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '0.25rem' }}>Character</label>
              <select
                value={consistencyCharId || ''}
                onChange={(e) => setConsistencyCharId(e.target.value || null)}
                style={{ padding: '0.4rem 0.6rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '0.9rem', minWidth: '160px' }}
              >
                <option value="">Select character...</option>
                <option value="all">All Characters</option>
                {settings.characters.filter(c => c.image).map(char => (
                  <option key={char.id} value={char.id}>{char.name}</option>
                ))}
              </select>
            </div>

            {consistencyCharId && consistencyCharId !== 'all' && (() => {
              const char = settings.characters.find(c => c.id === consistencyCharId);
              return char?.image ? (
                <img src={`${char.image}`} alt={char.name} style={{ height: '48px', borderRadius: '4px', border: '2px solid #3498db' }} />
              ) : null;
            })()}

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '0.25rem' }}>Scope</label>
              <select
                value={consistencyScope}
                onChange={(e) => setConsistencyScope(e.target.value)}
                style={{ padding: '0.4rem 0.6rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '0.9rem', minWidth: '140px' }}
              >
                <option value="all">All Pages</option>
                {(comic.pages || []).map(p => (
                  <option key={p.id} value={p.id}>Page {p.pageNumber}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '0.25rem' }}>Provider</label>
              <select
                value={consistencyProvider}
                onChange={(e) => setConsistencyProvider(e.target.value)}
                style={{ padding: '0.4rem 0.6rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '0.9rem', minWidth: '120px' }}
              >
                <option value="openai">ChatGPT</option>
                <option value="gemini">Gemini</option>
              </select>
            </div>

            <button
              onClick={handleConsistencyScan}
              disabled={!consistencyCharId || consistencyScanning}
              className="btn btn-primary"
              style={{ padding: '0.5rem 1.2rem' }}
            >
              {consistencyScanning ? `Scanning... (${consistencyScanProgress.current}/${consistencyScanProgress.total})` : 'Scan'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '200px', maxWidth: '400px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '0.25rem' }}>Only check for</label>
              <input
                type="text"
                value={consistencyFocus}
                onChange={(e) => setConsistencyFocus(e.target.value)}
                placeholder="e.g. glasses, hair color, scar"
                style={{ padding: '0.4rem 0.6rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '0.9rem', width: '100%' }}
              />
            </div>
            <div style={{ flex: 1, minWidth: '200px', maxWidth: '400px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '0.25rem' }}>Ignore</label>
              <input
                type="text"
                value={consistencyIgnore}
                onChange={(e) => setConsistencyIgnore(e.target.value)}
                placeholder="e.g. clothing, outfit, accessories"
                style={{ padding: '0.4rem 0.6rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '0.9rem', width: '100%' }}
              />
            </div>
          </div>

          {/* No characters warning */}
          {settings.characters.filter(c => c.image).length === 0 && (
            <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '6px', padding: '0.75rem', marginBottom: '1rem', color: '#856404' }}>
              No characters with reference images found. Add characters with images in Prompt Settings &gt; Characters to use this feature.
            </div>
          )}

          {/* Results */}
          {consistencyResults.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>Results ({consistencyResults.length} found)</h3>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => {
                      const all = {};
                      consistencyResults.forEach((_, i) => { if (!consistencyResults[i].adjusted) all[i] = true; });
                      setConsistencySelected(all);
                    }}
                    className="btn btn-secondary btn-sm"
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                  >Select All</button>
                  <button
                    onClick={() => setConsistencySelected({})}
                    className="btn btn-secondary btn-sm"
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                  >Deselect</button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                {consistencyResults.map((result, idx) => {
                  const ba = consistencyBeforeAfter[result.panelId];
                  const scoreColor = result.matchScore >= 8 ? '#27ae60' : result.matchScore >= 5 ? '#f39c12' : '#e74c3c';
                  return (
                    <div key={idx} style={{ border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden', background: '#fff' }}>
                      {/* Panel thumbnail with bounding box overlay */}
                      <div style={{ position: 'relative', background: '#f0f0f0', cursor: 'pointer' }} onClick={() => setConsistencyLightbox(`${result.panelImage}?t=${Date.now()}`)}>
                        <img
                          src={`${result.panelImage}?t=${Date.now()}`}
                          alt={`P${result.pageNumber} ${result.panelId}`}
                          style={{ width: '100%', display: 'block' }}
                        />
                        {result.boundingBox && !result.adjusted && (
                          <div style={{
                            position: 'absolute',
                            left: `${result.boundingBox.x * 100}%`,
                            top: `${result.boundingBox.y * 100}%`,
                            width: `${result.boundingBox.width * 100}%`,
                            height: `${result.boundingBox.height * 100}%`,
                            border: '2px solid #e74c3c',
                            pointerEvents: 'none'
                          }} />
                        )}
                        {result.adjusted && (
                          <div style={{
                            position: 'absolute', top: '8px', right: '8px',
                            background: '#27ae60', color: '#fff', padding: '2px 8px',
                            borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold'
                          }}>Adjusted</div>
                        )}
                      </div>

                      <div style={{ padding: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                          <span style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>P{result.pageNumber} — {result.characterName}</span>
                          <span style={{ background: scoreColor, color: '#fff', padding: '1px 8px', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 'bold' }}>
                            {result.matchScore}/10
                          </span>
                        </div>

                        {result.discrepancies.length > 0 && (
                          <ul style={{ margin: '0 0 0.5rem 0', paddingLeft: '1.2rem', fontSize: '0.8rem', color: '#666' }}>
                            {result.discrepancies.slice(0, 4).map((d, i) => <li key={i}>{d}</li>)}
                            {result.discrepancies.length > 4 && <li>...and {result.discrepancies.length - 4} more</li>}
                          </ul>
                        )}

                        {result.notes && (
                          <p style={{ fontSize: '0.75rem', color: '#888', margin: '0 0 0.5rem 0', fontStyle: 'italic' }}>{result.notes}</p>
                        )}

                        {!result.adjusted && (
                          <input
                            type="text"
                            placeholder="Add notes (e.g. looks too old)"
                            value={result.userNotes || ''}
                            onChange={(e) => setConsistencyResults(prev => prev.map((r, ri) =>
                              ri === idx ? { ...r, userNotes: e.target.value } : r
                            ))}
                            style={{ width: '100%', padding: '0.3rem 0.5rem', fontSize: '0.75rem', border: '1px solid #ddd', borderRadius: '4px', marginBottom: '0.5rem', boxSizing: 'border-box' }}
                          />
                        )}

                        {/* Before/After comparison */}
                        {ba && result.adjusted && (
                          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <div style={{ flex: 1, textAlign: 'center', cursor: 'pointer' }} onClick={() => setConsistencyLightbox(`${ba.before}`)}>
                              <img src={`${ba.before}`} alt="Before" style={{ width: '100%', borderRadius: '4px' }} />
                              <div style={{ fontSize: '0.65rem', color: '#888' }}>Before</div>
                            </div>
                            <div style={{ flex: 1, textAlign: 'center', cursor: 'pointer' }} onClick={() => setConsistencyLightbox(`${ba.after}`)}>
                              <img src={`${ba.after}`} alt="After" style={{ width: '100%', borderRadius: '4px' }} />
                              <div style={{ fontSize: '0.65rem', color: '#888' }}>After</div>
                            </div>
                          </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          {!result.adjusted ? (
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={!!consistencySelected[idx]}
                                onChange={(e) => setConsistencySelected(prev => ({ ...prev, [idx]: e.target.checked }))}
                              />
                              Select
                            </label>
                          ) : (
                            <button
                              onClick={() => handleConsistencyRevert(idx)}
                              className="btn btn-secondary btn-sm"
                              style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                            >Revert</button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Adjust button */}
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {Object.values(consistencySelected).some(v => v) && (
                  <button
                    onClick={handleConsistencyAdjust}
                    disabled={consistencyAdjusting}
                    className="btn btn-primary"
                    style={{ padding: '0.6rem 1.5rem' }}
                  >
                    {consistencyAdjusting
                      ? `Adjusting... (${consistencyAdjustProgress.current}/${consistencyAdjustProgress.total})`
                      : `Adjust Selected (${Object.values(consistencySelected).filter(v => v).length})`
                    }
                  </button>
                )}
                {consistencyResults.some(r => r.adjusted) && (
                  <button
                    onClick={handleConsistencySaveAll}
                    className="btn btn-secondary"
                    style={{ padding: '0.6rem 1.5rem' }}
                  >
                    Save All Adjusted ({consistencyResults.filter(r => r.adjusted).length})
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Scan complete message */}
          {!consistencyScanning && consistencyScanProgress.total > 0 && (
            <div style={{
              background: consistencyResults.length > 0 ? '#fff3cd' : '#d4edda',
              border: `1px solid ${consistencyResults.length > 0 ? '#ffc107' : '#28a745'}`,
              borderRadius: '6px', padding: '0.75rem', marginBottom: '1rem',
              color: consistencyResults.length > 0 ? '#856404' : '#155724',
              textAlign: 'center'
            }}>
              {consistencyResults.length > 0
                ? `Scan complete — ${consistencyScanProgress.total} panels checked, ${consistencyResults.length} issue${consistencyResults.length !== 1 ? 's' : ''} found.`
                : `Scan complete — ${consistencyScanProgress.total} panels checked. No consistency issues found!`
              }
            </div>
          )}

          {/* Lightbox overlay */}
          {consistencyLightbox && (
            <div
              onClick={() => setConsistencyLightbox(null)}
              style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(0,0,0,0.85)', zIndex: 10000,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              <img
                src={consistencyLightbox}
                alt="Enlarged"
                style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: '8px' }}
                onClick={(e) => e.stopPropagation()}
              />
              <div style={{
                position: 'absolute', top: '20px', right: '30px',
                color: '#fff', fontSize: '2rem', cursor: 'pointer', fontWeight: 'bold'
              }} onClick={() => setConsistencyLightbox(null)}>×</div>
            </div>
          )}
        </div>
      )}

      {/* Language Tab */}
      {activeTab === 'language' && (
        <div style={{ maxWidth: '900px' }}>
          <h2 style={{ marginBottom: '0.5rem' }}>Language Review</h2>
          <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1rem' }}>
            Scan pages to review translations for contextual accuracy and register consistency (tú vs usted).
            Each page image is sent to AI along with all dialogue for analysis.
          </p>

          {/* Controls */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '0.25rem' }}>Provider</label>
              <select
                value={languageProvider}
                onChange={(e) => setLanguageProvider(e.target.value)}
                style={{ padding: '0.4rem 0.6rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '0.9rem', minWidth: '120px' }}
              >
                <option value="openai">ChatGPT</option>
                <option value="gemini">Gemini</option>
              </select>
            </div>
            <button
              onClick={handleLanguageScan}
              disabled={languageScanning}
              className="btn btn-primary"
              style={{ padding: '0.5rem 1.2rem' }}
            >
              {languageScanning
                ? `Scanning... (${languageScanProgress.current}/${languageScanProgress.total})`
                : 'Scan All Pages'}
            </button>
          </div>

          {/* Results */}
          {languageResults.length > 0 && (
            <div>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>
                Issues Found ({languageResults.length})
              </h3>
              {languageResults.map((issue, idx) => (
                <div key={idx} style={{
                  border: '1px solid #e0e0e0', borderRadius: '8px',
                  padding: '1rem', marginBottom: '0.75rem', background: '#fff'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>
                      Page {issue.pageNumber} ({issue.bubbleType})
                    </span>
                    <span style={{
                      background: issue.issueType === 'register_inconsistency' ? '#f39c12'
                        : issue.issueType === 'missing_wrong_context' ? '#e67e22' : '#e74c3c',
                      color: '#fff', padding: '2px 8px', borderRadius: '10px',
                      fontSize: '0.7rem', fontWeight: 'bold'
                    }}>
                      {issue.issueType === 'contextual_translation_error' ? 'Translation'
                        : issue.issueType === 'register_inconsistency' ? 'Register' : 'Context'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                    <strong>Text:</strong> {issue.sentenceText}
                  </div>
                  <div style={{ fontSize: '0.85rem', marginBottom: '0.4rem', color: '#666' }}>
                    <strong>Translation:</strong> {issue.sentenceTranslation}
                  </div>
                  <div style={{ fontSize: '0.85rem', marginBottom: '0.4rem', color: '#c0392b' }}>
                    <strong>Issue:</strong> {issue.description}
                  </div>
                  {issue.suggestedFix && (
                    <div style={{ fontSize: '0.85rem', color: '#27ae60' }}>
                      <strong>Suggested fix:</strong> {issue.suggestedFix}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Scan complete message */}
          {!languageScanning && languageScanProgress.total > 0 && (
            <div style={{
              background: languageResults.length > 0 ? '#fff3cd' : '#d4edda',
              border: `1px solid ${languageResults.length > 0 ? '#ffc107' : '#28a745'}`,
              borderRadius: '6px', padding: '0.75rem', marginBottom: '1rem',
              color: languageResults.length > 0 ? '#856404' : '#155724',
              textAlign: 'center'
            }}>
              {languageResults.length > 0
                ? `Scan complete — ${languageScanProgress.total} pages reviewed, ${languageResults.length} issue${languageResults.length !== 1 ? 's' : ''} found.`
                : `Scan complete — ${languageScanProgress.total} pages reviewed. No language issues found!`
              }
            </div>
          )}
        </div>
      )}

      </div>{/* End left column */}

      {/* Right column: Chat Sidebar */}
      <div style={{
        flex: '0 0 20%',
        maxWidth: '20%',
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

      {/* Style Sheet "From comics" picker */}
      {styleSheetPickerOpen && (
        <div
          onClick={() => !styleSheetPickerBusy && setStyleSheetPickerOpen(false)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.85)', zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#1a1a2e', borderRadius: '10px', padding: '1rem',
              width: 'min(1000px, 92vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: '#eee' }}>Pick a style reference from a comic</h3>
              <button
                onClick={() => setStyleSheetPickerOpen(false)}
                disabled={styleSheetPickerBusy}
                style={{
                  background: '#e74c3c', color: '#fff', border: 'none', borderRadius: '50%',
                  width: '26px', height: '26px', fontSize: '1rem', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}
              >&times;</button>
            </div>

            {!styleSheetPickerComics ? (
              <p style={{ color: '#aaa' }}>Loading comics…</p>
            ) : (
              <>
                {/* Comic tabs */}
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                  {styleSheetPickerComics.map(c => (
                    <button
                      key={c.id}
                      className={`btn btn-sm ${styleSheetPickerComicId === c.id ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setStyleSheetPickerComicId(c.id)}
                      style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}
                    >
                      {c.title}{c.id === id ? ' (this comic)' : ''}
                    </button>
                  ))}
                </div>

                {/* Image grid: panels per page; page master as fallback */}
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {(() => {
                    const sel = styleSheetPickerComics.find(c => c.id === styleSheetPickerComicId);
                    if (!sel) return <p style={{ color: '#aaa' }}>No comic selected.</p>;
                    const pages = [...(sel.pages || [])].sort((a, b) => (a.pageNumber || 0) - (b.pageNumber || 0));
                    return pages.map(p => {
                      const panelImgs = (p.panels || [])
                        .slice().sort((a, b) => (a.panelOrder || 0) - (b.panelOrder || 0))
                        .map(pan => pan.artworkImage).filter(Boolean);
                      const imgs = panelImgs.length ? panelImgs : (p.masterImage ? [p.masterImage] : []);
                      if (!imgs.length) return null;
                      return (
                        <div key={p.pageNumber} style={{ marginBottom: '0.75rem' }}>
                          <small style={{ color: '#888' }}>Page {p.pageNumber}</small>
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                            {imgs.map((img, i) => (
                              <img
                                key={`${img}-${i}`}
                                src={`${img}`}
                                alt={`Page ${p.pageNumber} panel ${i + 1}`}
                                onClick={() => !styleSheetPickerBusy && styleSheetPickFromComic(img)}
                                style={{
                                  height: '120px', borderRadius: '6px', cursor: styleSheetPickerBusy ? 'wait' : 'pointer',
                                  border: '2px solid #2a2a3e', opacity: styleSheetPickerBusy ? 0.5 : 1
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
                {styleSheetPickerBusy && (
                  <p style={{ color: '#F0BB29', margin: '0.5rem 0 0' }}>Adding reference…</p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Reference Image Lightbox */}
      {refLightbox && (
        <div
          onClick={() => setRefLightbox(null)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.85)', zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', cursor: 'default' }}>
            <img
              src={refLightbox}
              alt="Reference"
              style={{ maxHeight: '90vh', maxWidth: '90vw', borderRadius: '8px' }}
            />
            <button
              onClick={() => setRefLightbox(null)}
              style={{
                position: 'absolute', top: '-12px', right: '-12px',
                background: '#e74c3c', color: '#fff', border: 'none', borderRadius: '50%',
                width: '30px', height: '30px', fontSize: '1.1rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
            >&times;</button>
          </div>
        </div>
      )}

      {/* Landscape Cover Lightbox */}
      {coverLandscapeLightbox && coverLandscapeImage && (
        <div
          onClick={() => setCoverLandscapeLightbox(false)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.85)', zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer'
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', cursor: 'default' }}>
            <img
              src={`${api.defaults.baseURL.replace('/api', '')}${coverLandscapeImage}?t=${Date.now()}`}
              alt="Landscape cover"
              style={{
                maxHeight: '90vh', maxWidth: '90vw', borderRadius: '8px',
                filter: `brightness(${coverLandscapeBrightness}) contrast(${coverLandscapeContrast}) saturate(${coverLandscapeSaturation})`
              }}
            />
            <button
              onClick={() => setCoverLandscapeLightbox(false)}
              style={{
                position: 'absolute', top: '-12px', right: '-12px',
                background: '#e74c3c', color: '#fff', border: 'none', borderRadius: '50%',
                width: '30px', height: '30px', fontSize: '1.1rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
            >&times;</button>
          </div>
        </div>
      )}

      {/* Collection Cover Lightbox */}
      {collectionCoverLightbox && collectionCoverImage && (
        <div
          onClick={() => setCollectionCoverLightbox(false)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.85)', zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer'
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', cursor: 'default' }}>
            <img
              src={`${api.defaults.baseURL.replace('/api', '')}${collectionCoverImage}?t=${Date.now()}`}
              alt="Collection cover"
              style={{
                maxHeight: '90vh', maxWidth: '90vw', borderRadius: '8px',
                filter: `brightness(${collectionCoverBrightness}) contrast(${collectionCoverContrast}) saturate(${collectionCoverSaturation})`
              }}
            />
            <button
              onClick={() => setCollectionCoverLightbox(false)}
              style={{
                position: 'absolute', top: '-12px', right: '-12px',
                background: '#e74c3c', color: '#fff', border: 'none', borderRadius: '50%',
                width: '30px', height: '30px', fontSize: '1.1rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
            >&times;</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ComicEditor;

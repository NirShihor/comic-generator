import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import html2canvas from 'html2canvas';

// Strip audio enhancement tags like [sighs], [pause], [ominous, slowly] and quotation marks from text
function stripAudioTags(text) {
  if (!text) return text;
  return text.replace(/\[[^\]]+\]/g, '').replace(/["]/g, '').replace(/\s+/g, ' ').trim();
}

// Check if a line exists between two adjacent cells
function hasLineBetween(lines, cell1, cell2, direction) {
  if (direction === 'horizontal') {
    // cell2 is below cell1, check for horizontal line at their boundary
    const y = cell1.y2;
    const x1 = Math.max(cell1.x1, cell2.x1);
    const x2 = Math.min(cell1.x2, cell2.x2);
    return lines.some(l =>
      l.type === 'horizontal' &&
      Math.abs(l.y - y) < 0.01 &&
      l.x1 <= x1 + 0.01 &&
      l.x2 >= x2 - 0.01
    );
  } else {
    // cell2 is to the right of cell1, check for vertical line at their boundary
    const x = cell1.x2;
    const y1 = Math.max(cell1.y1, cell2.y1);
    const y2 = Math.min(cell1.y2, cell2.y2);
    return lines.some(l =>
      l.type === 'vertical' &&
      Math.abs(l.x - x) < 0.01 &&
      l.y1 <= y1 + 0.01 &&
      l.y2 >= y2 - 0.01
    );
  }
}

// Compute panel regions from divider lines using union-find for merging
function computePanelsFromLines(lines, pageId) {
  if (lines.length === 0) {
    return [{
      id: `${pageId}-panel-1`,
      panelOrder: 1,
      tapZone: { x: 0, y: 0, width: 1, height: 1 },
      content: '',
      bubbles: []
    }];
  }

  // Collect all unique x and y coordinates (including edges)
  const xCoords = new Set([0, 1]);
  const yCoords = new Set([0, 1]);

  lines.forEach(line => {
    if (line.type === 'horizontal') {
      yCoords.add(line.y);
    } else {
      xCoords.add(line.x);
    }
  });

  const xs = Array.from(xCoords).sort((a, b) => a - b);
  const ys = Array.from(yCoords).sort((a, b) => a - b);

  // Create grid cells
  const cells = [];
  const cellMap = {}; // (row, col) -> cell index

  for (let row = 0; row < ys.length - 1; row++) {
    for (let col = 0; col < xs.length - 1; col++) {
      const cellIndex = cells.length;
      cellMap[`${row},${col}`] = cellIndex;
      cells.push({
        x1: xs[col],
        x2: xs[col + 1],
        y1: ys[row],
        y2: ys[row + 1],
        row,
        col,
        parent: cellIndex // Union-find parent
      });
    }
  }

  // Union-find helpers
  function find(i) {
    if (cells[i].parent !== i) {
      cells[i].parent = find(cells[i].parent);
    }
    return cells[i].parent;
  }

  function union(i, j) {
    const pi = find(i);
    const pj = find(j);
    if (pi !== pj) {
      cells[pi].parent = pj;
    }
  }

  // Merge adjacent cells that don't have a line between them
  for (let row = 0; row < ys.length - 1; row++) {
    for (let col = 0; col < xs.length - 1; col++) {
      const cellIndex = cellMap[`${row},${col}`];
      const cell = cells[cellIndex];

      // Check right neighbor
      if (col < xs.length - 2) {
        const rightIndex = cellMap[`${row},${col + 1}`];
        const rightCell = cells[rightIndex];
        if (!hasLineBetween(lines, cell, rightCell, 'vertical')) {
          union(cellIndex, rightIndex);
        }
      }

      // Check bottom neighbor
      if (row < ys.length - 2) {
        const bottomIndex = cellMap[`${row + 1},${col}`];
        const bottomCell = cells[bottomIndex];
        if (!hasLineBetween(lines, cell, bottomCell, 'horizontal')) {
          union(cellIndex, bottomIndex);
        }
      }
    }
  }

  // Group cells by their root parent
  const groups = {};
  cells.forEach((cell, i) => {
    const root = find(i);
    if (!groups[root]) {
      groups[root] = [];
    }
    groups[root].push(cell);
  });

  // Create panels from groups, computing bounding box
  const panels = [];
  let panelIndex = 1;

  // Sort groups using comic reading order (left column first, then right)
  // When panels overlap vertically, read left-to-right (same row)
  // When they don't overlap, read top-to-bottom
  const sortedGroups = Object.values(groups).sort((a, b) => {
    const aMinY = Math.min(...a.map(c => c.y1));
    const aMaxY = Math.max(...a.map(c => c.y2));
    const bMinY = Math.min(...b.map(c => c.y1));
    const bMaxY = Math.max(...b.map(c => c.y2));
    const aMinX = Math.min(...a.map(c => c.x1));
    const bMinX = Math.min(...b.map(c => c.x1));

    // Check if panels overlap vertically
    const yOverlap = Math.min(aMaxY, bMaxY) - Math.max(aMinY, bMinY);
    const minHeight = Math.min(aMaxY - aMinY, bMaxY - bMinY);

    // If significant vertical overlap (>50% of smaller panel), sort by X (left to right)
    // This ensures left column is read before right column when they share vertical space
    if (yOverlap > minHeight * 0.5) {
      return aMinX - bMinX;
    }

    // Otherwise, sort by Y (top to bottom), then X
    if (Math.abs(aMinY - bMinY) > 0.01) return aMinY - bMinY;
    return aMinX - bMinX;
  });

  for (const group of sortedGroups) {
    const x1 = Math.min(...group.map(c => c.x1));
    const x2 = Math.max(...group.map(c => c.x2));
    const y1 = Math.min(...group.map(c => c.y1));
    const y2 = Math.max(...group.map(c => c.y2));

    panels.push({
      id: `${pageId}-panel-${panelIndex}`,
      panelOrder: panelIndex,
      tapZone: {
        x: x1,
        y: y1,
        width: x2 - x1,
        height: y2 - y1
      },
      content: '',
      bubbles: []
    });
    panelIndex++;
  }

  return panels;
}

// Generate layout description from panels
function generateLayoutDescription(panels) {
  const count = panels.length;
  if (count === 0) return 'No panels defined';
  if (count === 1 && panels[0].tapZone.width === 1 && panels[0].tapZone.height === 1) {
    return 'Full page (no panels defined yet)';
  }

  const descriptions = panels.map((panel, i) => {
    const { x, y, width, height } = panel.tapZone;

    // Use center point for position detection
    const centerY = y + height / 2;
    const centerX = x + width / 2;

    const vPos = centerY < 0.33 ? 'top' : centerY < 0.67 ? 'middle' : 'bottom';
    const hPos = centerX < 0.33 ? 'left' : centerX < 0.67 ? 'center' : 'right';
    const widthDesc = width > 0.9 ? 'full-width' : width > 0.6 ? 'wide' : 'half-width';
    const heightDesc = height > 0.6 ? 'full-length' : height > 0.4 ? 'half-length' : 'third-length';

    return `Panel ${i + 1} = ${vPos}-${hPos}, ${widthDesc}, ${heightDesc}`;
  });

  return `EXACTLY ${count} panels:\n${descriptions.join('\n')}`;
}

function PageEditor({ isCover = false }) {
  const { id, pageId } = useParams();
  const navigate = useNavigate();
  const [comic, setComic] = useState(null);
  const [page, setPage] = useState(null);
  const [lines, setLines] = useState([]); // { type: 'horizontal'|'vertical', y/x, x1/y1, x2/y2 }
  const [panels, setPanels] = useState([]);
  const [selectedPanel, setSelectedPanel] = useState(null);
  const [selectedLineIndex, setSelectedLineIndex] = useState(null);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState(null);
  const [drawEnd, setDrawEnd] = useState(null);
  const [panelsComputed, setPanelsComputed] = useState(false);

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const [dragLineIndex, setDragLineIndex] = useState(null);
  const [isDraggingEndpoint, setIsDraggingEndpoint] = useState(false);
  const [dragEndpoint, setDragEndpoint] = useState(null); // 'start' or 'end'

  // Image generation state
  const [generatedImage, setGeneratedImage] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [generationError, setGenerationError] = useState(null);
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const [customPrompt, setCustomPrompt] = useState(''); // For manual prompt override
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [customLayoutDescription, setCustomLayoutDescription] = useState(''); // For manual layout description override
  const [showPagePreview, setShowPagePreview] = useState(false);

  // Panel-by-panel generation state
  // Each panel can have: { path, generating, error, fitMode: 'stretch'|'crop', cropX: 0, cropY: 0, zoom: 1 }
  const [panelImages, setPanelImages] = useState({});
  const [generatingAllPanels, setGeneratingAllPanels] = useState(false);
  const [showCompositePreview, setShowCompositePreview] = useState(false);
  const compositeCanvasRef = useRef(null);

  // Audio generation state (voices come from comic.voices)
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [audioModel, setAudioModel] = useState('eleven_v3');
  const [copiedTag, setCopiedTag] = useState(null);
  const [audioSettings, setAudioSettings] = useState({
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.0,
    speed: 1.0
  });
  const [audioPreview, setAudioPreview] = useState({}); // { [sentenceId]: { url, base64, isPlaying } }
  const [generatingAudio, setGeneratingAudio] = useState({}); // { [sentenceId]: true/false }
  const [savingAudio, setSavingAudio] = useState({}); // { [sentenceId]: true/false }
  const [enhancingText, setEnhancingText] = useState({}); // { [sentenceId]: true/false }
  const [translatingText, setTranslatingText] = useState({}); // { [sentenceId]: true/false }
  const [translateInput, setTranslateInput] = useState({}); // { [sentenceId]: 'english text' }
  const audioRef = useRef(null);

  // ChatGPT panel state - persist in localStorage
  const [chatMessages, setChatMessages] = useState(() => {
    try {
      const saved = localStorage.getItem(`comic-chat-${id}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Filter out any messages that might have old image data
        return parsed.map(msg => ({
          role: msg.role,
          content: msg.content,
          hadImages: msg.hadImages
        }));
      }
      return [];
    } catch (e) {
      console.warn('Failed to load chat from localStorage:', e);
      localStorage.removeItem(`comic-chat-${id}`);
      return [];
    }
  });
  const [chatInput, setChatInput] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [chatImages, setChatImages] = useState([]); // Images to send with next message
  const chatFileInputRef = useRef(null);
  const chatMessagesEndRef = useRef(null);
  const chatMessagesRef = useRef(chatMessages); // Backup ref to prevent state loss

  // Save chat messages to localStorage when they change (without images to avoid quota issues)
  useEffect(() => {
    if (chatMessages.length > 0) {
      // Strip image data to avoid localStorage quota issues
      const messagesWithoutImages = chatMessages.map(msg => ({
        role: msg.role,
        content: msg.content,
        hadImages: msg.images && msg.images.length > 0 // Just note that there were images
      }));
      try {
        localStorage.setItem(`comic-chat-${id}`, JSON.stringify(messagesWithoutImages));
      } catch (e) {
        console.warn('Failed to save chat to localStorage:', e);
      }
    }
    chatMessagesRef.current = chatMessages;
  }, [chatMessages, id]);

  // Sidebar tab state
  const [sidebarTab, setSidebarTab] = useState('panels'); // 'panels', 'prompts', 'generate'

  // Prompt settings (editable copy from comic - persists across pages)
  const [promptSettings, setPromptSettings] = useState({
    styleBible: '',
    cameraInks: '',
    characters: [],
    globalDoNot: '',
    hardNegatives: ''
  });
  const [newCharacter, setNewCharacter] = useState({ name: '', description: '' });

  // Editor mode and bubble state
  const [editorMode, setEditorMode] = useState(isCover ? 'bubbles' : 'layout'); // 'layout' or 'bubbles'
  const [bubbles, setBubbles] = useState([]);
  const [selectedBubbleId, setSelectedBubbleId] = useState(null);
  const [isDraggingBubble, setIsDraggingBubble] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isResizingBubble, setIsResizingBubble] = useState(false);
  const [resizeCorner, setResizeCorner] = useState(null);
  const [isAddingBubble, setIsAddingBubble] = useState(false);

  const canvasRef = useRef(null);

  const CANVAS_WIDTH = 400;
  const CANVAS_HEIGHT = 600;
  const SNAP_THRESHOLD = 0.03; // Snap to lines/edges within 3%

  useEffect(() => {
    loadComic();
  }, [id, pageId, isCover]);

  // Audio generation functions (voices come from comic.voices configured in ComicEditor)
  const generateAudio = async (bubbleId, sentenceId, text) => {
    if (!text || !selectedVoiceId) {
      alert('Please enter text and select a voice');
      return;
    }

    setGeneratingAudio(prev => ({ ...prev, [sentenceId]: true }));

    try {
      const response = await api.post('/audio/generate', {
        text,
        voice_id: selectedVoiceId,
        model_id: audioModel,
        ...audioSettings
      });

      setAudioPreview(prev => ({
        ...prev,
        [sentenceId]: {
          url: `http://localhost:3001${response.data.path}`,
          base64: response.data.base64,
          filename: response.data.filename,
          isPlaying: false,
          wordTimestamps: response.data.wordTimestamps || []
        }
      }));
    } catch (error) {
      console.error('Failed to generate audio:', error);
      alert('Failed to generate audio: ' + error.message);
    } finally {
      setGeneratingAudio(prev => ({ ...prev, [sentenceId]: false }));
    }
  };

  const enhanceText = async (bubbleId, sentenceId, text) => {
    if (!text) return;

    setEnhancingText(prev => ({ ...prev, [sentenceId]: true }));

    try {
      const bubble = bubbles.find(b => b.id === bubbleId);
      const context = bubble?.type === 'thought' ? 'This is an internal thought' :
                      bubble?.type === 'narration' ? 'This is narration text' :
                      'This is dialogue speech';

      const response = await api.post('/audio/enhance', { text, context });

      // Update the sentence with enhanced text
      updateSentence(bubbleId, sentenceId, { text: response.data.enhanced });
    } catch (error) {
      console.error('Failed to enhance text:', error);
      alert('Failed to enhance text: ' + error.message);
    } finally {
      setEnhancingText(prev => ({ ...prev, [sentenceId]: false }));
    }
  };

  const translateText = async (bubbleId, sentenceId, englishText) => {
    if (!englishText) return;

    setTranslatingText(prev => ({ ...prev, [sentenceId]: true }));

    try {
      const response = await api.post('/audio/translate', {
        text: englishText,
        fromLanguage: 'en',
        toLanguage: comic?.language || 'es'
      });

      // Update the sentence with translated text and English as translation
      updateSentence(bubbleId, sentenceId, {
        text: response.data.translated,
        translation: englishText
      });

      // Clear the translate input
      setTranslateInput(prev => ({ ...prev, [sentenceId]: '' }));
    } catch (error) {
      console.error('Failed to translate text:', error);
      alert('Failed to translate: ' + error.message);
    } finally {
      setTranslatingText(prev => ({ ...prev, [sentenceId]: false }));
    }
  };

  const playAudio = (sentenceId) => {
    const preview = audioPreview[sentenceId];
    if (!preview) return;

    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audio = new Audio(`data:audio/mpeg;base64,${preview.base64}`);
    audioRef.current = audio;

    audio.onended = () => {
      setAudioPreview(prev => ({
        ...prev,
        [sentenceId]: { ...prev[sentenceId], isPlaying: false }
      }));
    };

    audio.play();
    setAudioPreview(prev => ({
      ...prev,
      [sentenceId]: { ...prev[sentenceId], isPlaying: true }
    }));
  };

  const stopAudio = (sentenceId) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setAudioPreview(prev => ({
      ...prev,
      [sentenceId]: { ...prev[sentenceId], isPlaying: false }
    }));
  };

  const saveAudio = async (bubbleId, sentenceId, pageNum, panelNum) => {
    const preview = audioPreview[sentenceId];
    if (!preview?.filename) return;

    setSavingAudio(prev => ({ ...prev, [sentenceId]: true }));
    try {
      const audioName = `${comic.title.toLowerCase().replace(/\s+/g, '_')}_p${pageNum}_s${panelNum}`;
      const response = await api.post('/audio/save-to-project', {
        comicId: id,
        filename: preview.filename,
        audioName
      });

      // Find current sentence text and strip audio tags
      const bubble = bubbles.find(b => b.id === bubbleId);
      const sentence = bubble?.sentences?.find(s => s.id === sentenceId);
      const cleanedText = sentence?.text ? stripAudioTags(sentence.text) : '';

      // Build word list from timestamps - every spoken word gets an entry
      const timestamps = preview.wordTimestamps || [];
      const existingWords = sentence?.words || [];
      const normWord = (s) => (s || '').toLowerCase().replace(/[.,!?;:"""''¿¡…\[\]]/g, '').trim();
      const cleanWord = (s) => (s || '').replace(/[.,!?;:"""''¿¡…\[\]]+/g, '').trim();
      const audioTagWords = new Set(['slowly', 'whispering', 'shouting', 'frightened', 'surprised', 'amazed', 'hopeful', 'worried', 'excited', 'pause', 'sighs', 'laughs', 'cries', 'gasps', 'whispers', 'shouts', 'sad', 'angry', 'happy', 'fearful', 'fearfully', 'very']);
      const stripTags = (w) => w.replace(/\[.*?\]/g, '').trim();
      const isAudioTag = (w) => { const cleaned = stripTags(w); return !cleaned || audioTagWords.has(normWord(cleaned)); };
      const allWords = timestamps.filter(t => !isAudioTag(t.word)).map(t => {
        t = { ...t, word: stripTags(t.word) || t.word };
        const normalised = normWord(t.word);
        const existing = existingWords.find(w => normWord(w.text) === normalised);
        return {
          id: existing?.id || `word-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          text: cleanWord(existing?.text || t.word),
          meaning: cleanWord(existing?.meaning || ''),
          baseForm: cleanWord(existing?.baseForm || ''),
          startTimeMs: t.startMs,
          endTimeMs: t.endMs,
          vocabQuiz: existing?.vocabQuiz || false
        };
      });

      // Auto-fill meaning/baseForm for words that don't have them
      const wordsNeedingLookup = allWords.filter(w => !w.meaning);
      if (wordsNeedingLookup.length > 0 && cleanedText) {
        try {
          const lookupResponse = await api.post('/chat/batch-word-lookup', {
            words: wordsNeedingLookup.map(w => normWord(w.text)),
            sentenceText: cleanedText,
            sentenceTranslation: sentence?.translation || '',
            sourceLanguage: comic?.language || 'es',
            targetLanguage: comic?.targetLanguage || 'en'
          });
          const lookupResults = lookupResponse.data;
          if (Array.isArray(lookupResults)) {
            const nameIds = new Set();
            wordsNeedingLookup.forEach((w, i) => {
              if (lookupResults[i]) {
                if (lookupResults[i].isName) {
                  nameIds.add(w.id);
                } else {
                  w.meaning = cleanWord(lookupResults[i].meaning || '');
                  w.baseForm = cleanWord(lookupResults[i].baseForm || '');
                }
              }
            });
            if (nameIds.size > 0) {
              allWords.splice(0, allWords.length, ...allWords.filter(w => !nameIds.has(w.id)));
            }
          }
        } catch (lookupError) {
          console.error('Batch word lookup failed (words saved without meanings):', lookupError);
        }
      }

      setBubbles(prev => prev.map(b => {
        if (b.id !== bubbleId) return b;
        return { ...b, sentences: (b.sentences || []).map(s => {
          if (s.id !== sentenceId) return s;
          return { ...s, audioUrl: audioName, text: cleanedText, words: allWords.length > 0 ? allWords : existingWords };
        })};
      }));

      alert('Audio saved successfully!');
    } catch (error) {
      console.error('Failed to save audio:', error);
      alert('Failed to save audio: ' + error.message);
    } finally {
      setSavingAudio(prev => ({ ...prev, [sentenceId]: false }));
    }
  };

  const fillDictionary = async (bubbleId, sentenceId) => {
    const bubble = bubbles.find(b => b.id === bubbleId);
    const sentence = bubble?.sentences?.find(s => s.id === sentenceId);
    if (!sentence?.words?.length || !sentence.text) return;

    const normWord = (s) => (s || '').toLowerCase().replace(/[.,!?;:"""''¿¡…\[\]]/g, '').trim();
    const wordsNeedingLookup = sentence.words.filter(w => !w.meaning);
    if (wordsNeedingLookup.length === 0) return;

    const cleanedText = stripAudioTags(sentence.text);
    try {
      const lookupResponse = await api.post('/chat/batch-word-lookup', {
        words: wordsNeedingLookup.map(w => normWord(w.text)),
        sentenceText: cleanedText,
        sentenceTranslation: sentence.translation || '',
        sourceLanguage: comic?.language || 'es',
        targetLanguage: comic?.targetLanguage || 'en'
      });
      const lookupResults = lookupResponse.data;
      if (Array.isArray(lookupResults)) {
        setBubbles(prev => prev.map(b => {
          if (b.id !== bubbleId) return b;
          return { ...b, sentences: (b.sentences || []).map(s => {
            if (s.id !== sentenceId) return s;
            const updatedWords = s.words.map(w => {
              if (w.meaning) return w;
              const idx = wordsNeedingLookup.findIndex(wn => wn.id === w.id);
              if (idx >= 0 && lookupResults[idx]) {
                if (lookupResults[idx].isName) return null;
                return { ...w, meaning: lookupResults[idx].meaning || '', baseForm: lookupResults[idx].baseForm || '' };
              }
              return w;
            }).filter(Boolean);
            return { ...s, words: updatedWords };
          })};
        }));
      }
    } catch (error) {
      console.error('Fill dictionary failed:', error);
      alert('Failed to fill dictionary: ' + error.message);
    }
  };

  const loadComic = async () => {
    try {
      const response = await api.get(`/comics/${id}`);
      setComic(response.data);

      if (isCover) {
        // Create a virtual "page" for the cover
        const coverPage = {
          id: 'cover',
          pageNumber: 0,
          masterImage: response.data.cover?.image || '',
          panels: [{
            id: 'cover-panel-1',
            panelOrder: 1,
            tapZone: { x: 0, y: 0, width: 1, height: 1 },
            content: response.data.cover?.prompt || '',
            bubbles: []
          }]
        };
        setPage(coverPage);
        setPanels(coverPage.panels);
        setPanelsComputed(true);
        if (response.data.cover?.bubbles) {
          setBubbles(response.data.cover.bubbles);
        }
        if (response.data.promptSettings) {
          setPromptSettings(prev => ({ ...prev, ...response.data.promptSettings }));
        }
        return;
      }

      const pages = response.data.pages || [];
      const currentPage = pages.find(p => p.id === pageId);
      if (!currentPage) {
        console.error('Page not found:', pageId);
        return;
      }
      setPage(currentPage);
      if (currentPage?.lines) {
        setLines(currentPage.lines);
      } else if (currentPage?.dividerLines) {
        // Convert old format
        const converted = [];
        currentPage.dividerLines.horizontal?.forEach(y => {
          converted.push({ type: 'horizontal', y, x1: 0, x2: 1 });
        });
        currentPage.dividerLines.vertical?.forEach(v => {
          if (typeof v === 'number') {
            converted.push({ type: 'vertical', x: v, y1: 0, y2: 1 });
          } else {
            converted.push({ type: 'vertical', x: v.x, y1: v.y1 || 0, y2: v.y2 || 1 });
          }
        });
        setLines(converted);
      }
      if (currentPage?.panels && currentPage.panels.length > 0) {
        setPanels(currentPage.panels);
        setPanelsComputed(true);
      }
      if (currentPage?.bubbles) {
        setBubbles(currentPage.bubbles);
      }
      // Load prompt settings from comic
      if (response.data.promptSettings) {
        setPromptSettings(prev => ({ ...prev, ...response.data.promptSettings }));
      }
    } catch (error) {
      console.error('Failed to load comic:', error);
    }
  };

  // Update a prompt setting field
  const updatePromptSetting = (key, value) => {
    setPromptSettings(prev => ({ ...prev, [key]: value }));
  };

  // Character management
  const addCharacter = () => {
    if (!newCharacter.name.trim()) return;
    setPromptSettings(prev => ({
      ...prev,
      characters: [...(prev.characters || []), { ...newCharacter, id: Date.now() }]
    }));
    setNewCharacter({ name: '', description: '' });
  };

  const removeCharacter = (charId) => {
    setPromptSettings(prev => ({
      ...prev,
      characters: prev.characters.filter(c => c.id !== charId)
    }));
  };

  const updateCharacter = (charId, field, value) => {
    setPromptSettings(prev => ({
      ...prev,
      characters: prev.characters.map(c =>
        c.id === charId ? { ...c, [field]: value } : c
      )
    }));
  };

  // Save prompt settings to comic
  const savePromptSettings = async () => {
    try {
      const updatedComic = { ...comic, promptSettings };
      await api.put(`/comics/${id}`, updatedComic);
      setComic(updatedComic);
      alert('Prompt settings saved!');
    } catch (error) {
      console.error('Failed to save prompt settings:', error);
      alert('Failed to save prompt settings');
    }
  };

  const getRelativeCoords = useCallback((e) => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    };
  }, []);

  // Find snap points (edges and line intersections)
  const getSnapPoints = useCallback(() => {
    const points = {
      x: new Set([0, 1]),
      y: new Set([0, 1])
    };

    lines.forEach(line => {
      if (line.type === 'horizontal') {
        points.y.add(line.y);
        points.x.add(line.x1);
        points.x.add(line.x2);
      } else {
        points.x.add(line.x);
        points.y.add(line.y1);
        points.y.add(line.y2);
      }
    });

    return {
      x: Array.from(points.x).sort((a, b) => a - b),
      y: Array.from(points.y).sort((a, b) => a - b)
    };
  }, [lines]);

  // Snap a coordinate to nearest snap point
  const snapToNearest = useCallback((value, snapPoints) => {
    let nearest = value;
    let minDist = SNAP_THRESHOLD;

    snapPoints.forEach(point => {
      const dist = Math.abs(value - point);
      if (dist < minDist) {
        minDist = dist;
        nearest = point;
      }
    });

    return nearest;
  }, []);

  const handleMouseDown = (e) => {
    if (e.target.dataset.lineIndex) return;

    const coords = getRelativeCoords(e);
    if (!coords) return;

    const snapPoints = getSnapPoints();
    const snappedCoords = {
      x: snapToNearest(coords.x, snapPoints.x),
      y: snapToNearest(coords.y, snapPoints.y)
    };

    setIsDrawing(true);
    setDrawStart(snappedCoords);
    setDrawEnd(snappedCoords);
    setSelectedLineIndex(null);
    setSelectedPanel(null);
  };

  const handleMouseMove = (e) => {
    const coords = getRelativeCoords(e);
    if (!coords) return;

    // Handle endpoint dragging (extend/shorten lines)
    if (isDraggingEndpoint && dragLineIndex !== null && dragEndpoint) {
      const snapPoints = getSnapPoints();

      setLines(prev => prev.map((l, i) => {
        if (i !== dragLineIndex) return l;

        if (l.type === 'horizontal') {
          // Horizontal line: drag x1 or x2
          const snappedX = snapToNearest(coords.x, snapPoints.x);
          const clampedX = Math.max(0, Math.min(1, snappedX));
          if (dragEndpoint === 'start') {
            return { ...l, x1: Math.min(clampedX, l.x2 - 0.05) };
          } else {
            return { ...l, x2: Math.max(clampedX, l.x1 + 0.05) };
          }
        } else {
          // Vertical line: drag y1 or y2
          const snappedY = snapToNearest(coords.y, snapPoints.y);
          const clampedY = Math.max(0, Math.min(1, snappedY));
          if (dragEndpoint === 'start') {
            return { ...l, y1: Math.min(clampedY, l.y2 - 0.05) };
          } else {
            return { ...l, y2: Math.max(clampedY, l.y1 + 0.05) };
          }
        }
      }));
      setPanelsComputed(false);
      return;
    }

    // Handle line dragging
    if (isDragging && dragLineIndex !== null) {
      const line = lines[dragLineIndex];
      const snapPoints = getSnapPoints();

      setLines(prev => prev.map((l, i) => {
        if (i !== dragLineIndex) return l;

        if (l.type === 'horizontal') {
          // Snap y position
          const newY = snapToNearest(coords.y, snapPoints.y.filter(y => y !== l.y));
          return { ...l, y: Math.max(0, Math.min(1, newY)) };
        } else {
          // Snap x position
          const newX = snapToNearest(coords.x, snapPoints.x.filter(x => x !== l.x));
          return { ...l, x: Math.max(0, Math.min(1, newX)) };
        }
      }));
      setPanelsComputed(false);
      return;
    }

    // Handle drawing
    if (!isDrawing) return;

    const snapPoints = getSnapPoints();
    const snappedCoords = {
      x: snapToNearest(coords.x, snapPoints.x),
      y: snapToNearest(coords.y, snapPoints.y)
    };

    setDrawEnd(snappedCoords);
  };

  const handleMouseUp = (overrideEndCoords = null) => {
    // Stop endpoint dragging
    if (isDraggingEndpoint) {
      setIsDraggingEndpoint(false);
      setDragLineIndex(null);
      setDragEndpoint(null);
      return;
    }

    // Stop dragging
    if (isDragging) {
      setIsDragging(false);
      setDragLineIndex(null);
      return;
    }

    const endCoords = overrideEndCoords || drawEnd;

    if (!isDrawing || !drawStart || !endCoords) {
      setIsDrawing(false);
      return;
    }

    const dx = Math.abs(endCoords.x - drawStart.x);
    const dy = Math.abs(endCoords.y - drawStart.y);

    // Minimum drag distance
    if (dx < 0.02 && dy < 0.02) {
      setIsDrawing(false);
      setDrawStart(null);
      setDrawEnd(null);
      return;
    }

    let newLine;
    if (dx > dy) {
      // Horizontal line
      const y = (drawStart.y + endCoords.y) / 2;
      const snapPoints = getSnapPoints();
      const snappedY = snapToNearest(y, snapPoints.y);

      newLine = {
        type: 'horizontal',
        y: snappedY,
        x1: Math.min(drawStart.x, endCoords.x),
        x2: Math.max(drawStart.x, endCoords.x)
      };
    } else {
      // Vertical line
      const x = (drawStart.x + endCoords.x) / 2;
      const snapPoints = getSnapPoints();
      const snappedX = snapToNearest(x, snapPoints.x);

      newLine = {
        type: 'vertical',
        x: snappedX,
        y1: Math.min(drawStart.y, endCoords.y),
        y2: Math.max(drawStart.y, endCoords.y)
      };
    }

    setLines(prev => [...prev, newLine]);
    setPanelsComputed(false);
    setIsDrawing(false);
    setDrawStart(null);
    setDrawEnd(null);
  };

  const handleLineMouseDown = (e, index) => {
    e.stopPropagation();
    setSelectedLineIndex(index);
    setSelectedPanel(null);
    setIsDragging(true);
    setDragLineIndex(index);
  };

  const deleteSelectedLine = () => {
    if (selectedLineIndex === null) return;
    setLines(prev => prev.filter((_, i) => i !== selectedLineIndex));
    setSelectedLineIndex(null);
    setPanelsComputed(false);
  };

  // Bubble handlers
  const [isDraggingTail, setIsDraggingTail] = useState(false);

  // Available handwritten fonts
  const BUBBLE_FONTS = [
    { id: 'bangers', name: 'Bangers', family: "'Bangers', cursive" },
    { id: 'permanent-marker', name: 'Marker', family: "'Permanent Marker', cursive" },
    { id: 'patrick-hand', name: 'Patrick', family: "'Patrick Hand', cursive" },
    { id: 'caveat', name: 'Caveat', family: "'Caveat', cursive" },
    { id: 'indie-flower', name: 'Indie', family: "'Indie Flower', cursive" },
    { id: 'comic-neue', name: 'Comic', family: "'Comic Neue', cursive" }
  ];

  const addBubble = (coords) => {
    const newBubble = {
      id: `bubble-${Date.now()}`,
      x: coords.x,
      y: coords.y,
      width: 0.2,
      height: 0.1,
      type: 'speech', // 'speech', 'thought', 'narration'
      fontId: 'patrick-hand', // default font
      fontSize: 15,
      italic: false,
      uppercase: false, // default to lowercase
      bgColor: '#ffffff',
      textColor: '#000000',
      cornerRadius: 20, // 0 = square, 50 = very round
      // Tail position relative to bubble center (as offset in percentage of canvas)
      tailX: 0.03, // tip offset from bubble center
      tailY: 0.08,  // tip offset from bubble center (positive = below)
      tailBaseX: 0.5, // where tail joins bubble (0 = left edge, 1 = right edge)
      tailSide: 'bottom', // which side tail connects: 'top', 'bottom', 'left', 'right'
      tailWidth: 0.25, // width of tail base as percentage of bubble width
      showTail: true,
      // Rotation (for speech bubbles - rotates the whole bubble+tail)
      rotation: 0, // degrees, 0 = tail at bottom
      tailLength: 0.35, // length of tail relative to bubble height
      tailCurve: 0, // tail angle: -1 = far left, 0 = center, +1 = far right
      tailBend: 0, // tail curvature: -1 = bend left, 0 = straight, +1 = bend right
      textAngle: 0, // rotation angle for text inside bubble
      isSoundEffect: false, // if true, this is a sound effect (no TTS audio)
      // Tail curve control points (offset from midpoint of each edge)
      tailCtrl1X: 0,
      tailCtrl1Y: 0,
      tailCtrl2X: 0,
      tailCtrl2Y: 0,
      // Language learning data
      sentences: [{
        id: `sentence-${Date.now()}`,
        text: '',
        translation: '',
        audioUrl: '',
        words: []
      }]
    };
    setBubbles(prev => [...prev, newBubble]);
    setSelectedBubbleId(newBubble.id);
  };

  // Get display text from sentences
  const getBubbleDisplayText = (bubble) => {
    if (!bubble.sentences || bubble.sentences.length === 0) return '';
    return bubble.sentences.map(s => s.text).join(' ');
  };

  // Sentence management
  const addSentence = (bubbleId) => {
    setBubbles(prev => prev.map(b => {
      if (b.id !== bubbleId) return b;
      return {
        ...b,
        sentences: [...(b.sentences || []), {
          id: `sentence-${Date.now()}`,
          text: '',
          translation: '',
          audioUrl: '',
          words: []
        }]
      };
    }));
  };

  const updateSentence = (bubbleId, sentenceId, updates) => {
    setBubbles(prev => prev.map(b => {
      if (b.id !== bubbleId) return b;
      return {
        ...b,
        sentences: (b.sentences || []).map(s =>
          s.id === sentenceId ? { ...s, ...updates } : s
        )
      };
    }));
  };

  const removeSentence = (bubbleId, sentenceId) => {
    setBubbles(prev => prev.map(b => {
      if (b.id !== bubbleId) return b;
      return {
        ...b,
        sentences: (b.sentences || []).filter(s => s.id !== sentenceId)
      };
    }));
  };

  // Word management
  const addWord = (bubbleId, sentenceId) => {
    setBubbles(prev => prev.map(b => {
      if (b.id !== bubbleId) return b;
      return {
        ...b,
        sentences: (b.sentences || []).map(s => {
          if (s.id !== sentenceId) return s;
          return {
            ...s,
            words: [...(s.words || []), {
              id: `word-${Date.now()}`,
              text: '',
              meaning: '',
              baseForm: ''
            }]
          };
        })
      };
    }));
  };

  const updateWord = (bubbleId, sentenceId, wordId, updates) => {
    setBubbles(prev => prev.map(b => {
      if (b.id !== bubbleId) return b;
      return {
        ...b,
        sentences: (b.sentences || []).map(s => {
          if (s.id !== sentenceId) return s;
          return {
            ...s,
            words: (s.words || []).map(w =>
              w.id === wordId ? { ...w, ...updates } : w
            )
          };
        })
      };
    }));
  };

  const removeWord = (bubbleId, sentenceId, wordId) => {
    setBubbles(prev => prev.map(b => {
      if (b.id !== bubbleId) return b;
      return {
        ...b,
        sentences: (b.sentences || []).map(s => {
          if (s.id !== sentenceId) return s;
          return {
            ...s,
            words: (s.words || []).filter(w => w.id !== wordId)
          };
        })
      };
    }));
  };

  const [lookingUpWord, setLookingUpWord] = useState({});

  const wordLookup = async (bubbleId, sentenceId, selectedText, sentenceText, sentenceTranslation) => {
    const lookupKey = `${sentenceId}-${selectedText}`;
    setLookingUpWord(prev => ({ ...prev, [lookupKey]: true }));
    try {
      const response = await api.post('/chat/word-lookup', {
        selectedText,
        sentenceText,
        sentenceTranslation,
        sourceLanguage: comic?.language || 'es',
        targetLanguage: comic?.targetLanguage || 'en'
      });
      setBubbles(prev => prev.map(b => {
        if (b.id !== bubbleId) return b;
        return {
          ...b,
          sentences: (b.sentences || []).map(s => {
            if (s.id !== sentenceId) return s;
            return {
              ...s,
              words: [...(s.words || []), {
                id: `word-${Date.now()}`,
                text: response.data.text || selectedText,
                meaning: response.data.meaning || '',
                baseForm: response.data.baseForm || ''
              }]
            };
          })
        };
      }));
    } catch (error) {
      console.error('Word lookup failed:', error);
      alert('Word lookup failed: ' + error.message);
    } finally {
      setLookingUpWord(prev => ({ ...prev, [lookupKey]: false }));
    }
  };

  const updateBubble = (bubbleId, updates) => {
    setBubbles(prev => prev.map(b =>
      b.id === bubbleId ? { ...b, ...updates } : b
    ));
  };

  const deleteBubble = (bubbleId) => {
    setBubbles(prev => prev.filter(b => b.id !== bubbleId));
    if (selectedBubbleId === bubbleId) {
      setSelectedBubbleId(null);
    }
  };

  const handleBubbleMouseDown = (e, bubble) => {
    e.stopPropagation();
    const coords = getRelativeCoords(e);
    if (!coords) return;

    setSelectedBubbleId(bubble.id);
    if (bubble.locked) return;
    setIsDraggingBubble(true);
    setDragOffset({
      x: coords.x - bubble.x,
      y: coords.y - bubble.y
    });
  };

  const handleResizeMouseDown = (e, bubble, corner) => {
    e.stopPropagation();
    setSelectedBubbleId(bubble.id);
    if (bubble.locked) return;
    setIsResizingBubble(true);
    setResizeCorner(corner);
  };

  const [isDraggingTailBase, setIsDraggingTailBase] = useState(false);
  const [isDraggingTailCtrl1, setIsDraggingTailCtrl1] = useState(false);
  const [isDraggingTailCtrl2, setIsDraggingTailCtrl2] = useState(false);
  const [isDraggingRotation, setIsDraggingRotation] = useState(false);

  const handleTailMouseDown = (e, bubble) => {
    e.stopPropagation();
    setSelectedBubbleId(bubble.id);
    if (bubble.locked) return;
    setIsDraggingTail(true);
  };

  const handleTailBaseMouseDown = (e, bubble) => {
    e.stopPropagation();
    setSelectedBubbleId(bubble.id);
    if (bubble.locked) return;
    setIsDraggingTailBase(true);
  };

  const handleTailCtrl1MouseDown = (e, bubble) => {
    e.stopPropagation();
    setSelectedBubbleId(bubble.id);
    if (bubble.locked) return;
    setIsDraggingTailCtrl1(true);
  };

  const handleTailCtrl2MouseDown = (e, bubble) => {
    e.stopPropagation();
    setSelectedBubbleId(bubble.id);
    if (bubble.locked) return;
    setIsDraggingTailCtrl2(true);
  };

  const handleRotationMouseDown = (e, bubble) => {
    e.stopPropagation();
    setSelectedBubbleId(bubble.id);
    if (bubble.locked) return;
    setIsDraggingRotation(true);
  };

  const handleCanvasMouseDown = (e) => {
    if (editorMode === 'bubbles') {
      // Only add bubble if in "adding bubble" mode and clicking on empty space
      if (isAddingBubble && !e.target.dataset.bubbleId && !e.target.dataset.resizeHandle) {
        const coords = getRelativeCoords(e);
        if (coords) {
          addBubble(coords);
          setIsAddingBubble(false); // Exit adding mode after placing bubble
        }
      } else if (!e.target.dataset.bubbleId && !e.target.dataset.resizeHandle) {
        // Clicking on empty space deselects current bubble
        setSelectedBubbleId(null);
      }
    } else {
      handleMouseDown(e);
    }
  };

  const handleCanvasMouseMove = (e) => {
    if (editorMode === 'bubbles') {
      const coords = getRelativeCoords(e);
      if (!coords) return;

      if (isDraggingBubble && selectedBubbleId) {
        updateBubble(selectedBubbleId, {
          x: Math.max(0, Math.min(1, coords.x - dragOffset.x)),
          y: Math.max(0, Math.min(1, coords.y - dragOffset.y))
        });
      } else if (isResizingBubble && selectedBubbleId) {
        const bubble = bubbles.find(b => b.id === selectedBubbleId);
        if (bubble) {
          let newWidth = bubble.width;
          let newHeight = bubble.height;
          let newX = bubble.x;
          let newY = bubble.y;

          if (resizeCorner.includes('right')) {
            newWidth = Math.max(0.05, coords.x - bubble.x);
          }
          if (resizeCorner.includes('left')) {
            newWidth = Math.max(0.05, bubble.x + bubble.width - coords.x);
            newX = coords.x;
          }
          if (resizeCorner.includes('bottom')) {
            newHeight = Math.max(0.03, coords.y - bubble.y);
          }
          if (resizeCorner.includes('top')) {
            newHeight = Math.max(0.03, bubble.y + bubble.height - coords.y);
            newY = coords.y;
          }

          updateBubble(selectedBubbleId, {
            x: newX,
            y: newY,
            width: newWidth,
            height: newHeight
          });
        }
      } else if (isDraggingTail && selectedBubbleId) {
        const bubble = bubbles.find(b => b.id === selectedBubbleId);
        if (bubble) {
          // Calculate tail position relative to bubble center
          const bubbleCenterX = bubble.x + bubble.width / 2;
          const bubbleCenterY = bubble.y + bubble.height / 2;
          updateBubble(selectedBubbleId, {
            tailX: coords.x - bubbleCenterX,
            tailY: coords.y - bubbleCenterY
          });
        }
      } else if (isDraggingTailBase && selectedBubbleId) {
        const bubble = bubbles.find(b => b.id === selectedBubbleId);
        if (bubble) {
          // Calculate which side of the bubble we're closest to
          const bubbleCenterX = bubble.x + bubble.width / 2;
          const bubbleCenterY = bubble.y + bubble.height / 2;

          // Relative position from bubble center
          const relX = coords.x - bubbleCenterX;
          const relY = coords.y - bubbleCenterY;

          // Determine which side based on angle
          const angle = Math.atan2(relY, relX);
          let tailSide, tailBaseX;

          if (angle > -Math.PI/4 && angle <= Math.PI/4) {
            // Right side
            tailSide = 'right';
            tailBaseX = Math.max(0.1, Math.min(0.9, (coords.y - bubble.y) / bubble.height));
          } else if (angle > Math.PI/4 && angle <= 3*Math.PI/4) {
            // Bottom side
            tailSide = 'bottom';
            tailBaseX = Math.max(0.1, Math.min(0.9, (coords.x - bubble.x) / bubble.width));
          } else if (angle > -3*Math.PI/4 && angle <= -Math.PI/4) {
            // Top side
            tailSide = 'top';
            tailBaseX = Math.max(0.1, Math.min(0.9, (coords.x - bubble.x) / bubble.width));
          } else {
            // Left side
            tailSide = 'left';
            tailBaseX = Math.max(0.1, Math.min(0.9, (coords.y - bubble.y) / bubble.height));
          }

          updateBubble(selectedBubbleId, { tailSide, tailBaseX });
        }
      } else if (isDraggingTailCtrl1 && selectedBubbleId) {
        const bubble = bubbles.find(b => b.id === selectedBubbleId);
        if (bubble) {
          // Control point is an offset from the midpoint between base1 and tip
          // Calculate current base1 and tip positions
          const tailBasePos = bubble.tailBaseX ?? 0.5;
          const tailSide = bubble.tailSide || 'bottom';
          const tailWidth = bubble.tailWidth ?? 0.10;
          const halfWidth = (tailWidth / 2) * (tailSide === 'bottom' || tailSide === 'top' ? bubble.width : bubble.height);

          let base1X, base1Y;
          if (tailSide === 'bottom') {
            base1X = bubble.x + bubble.width * tailBasePos - halfWidth;
            base1Y = bubble.y + bubble.height;
          } else if (tailSide === 'top') {
            base1X = bubble.x + bubble.width * tailBasePos - halfWidth;
            base1Y = bubble.y;
          } else if (tailSide === 'left') {
            base1X = bubble.x;
            base1Y = bubble.y + bubble.height * tailBasePos - halfWidth;
          } else {
            base1X = bubble.x + bubble.width;
            base1Y = bubble.y + bubble.height * tailBasePos - halfWidth;
          }

          const tipX = bubble.x + bubble.width / 2 + (bubble.tailX || 0);
          const tipY = bubble.y + bubble.height / 2 + (bubble.tailY || 0.15);

          // Midpoint between base1 and tip
          const midX = (base1X + tipX) / 2;
          const midY = (base1Y + tipY) / 2;

          // Control point offset is mouse position minus midpoint
          updateBubble(selectedBubbleId, {
            tailCtrl1X: coords.x - midX,
            tailCtrl1Y: coords.y - midY
          });
        }
      } else if (isDraggingTailCtrl2 && selectedBubbleId) {
        const bubble = bubbles.find(b => b.id === selectedBubbleId);
        if (bubble) {
          // Control point is an offset from the midpoint between base2 and tip
          const tailBasePos = bubble.tailBaseX ?? 0.5;
          const tailSide = bubble.tailSide || 'bottom';
          const tailWidth = bubble.tailWidth ?? 0.10;
          const halfWidth = (tailWidth / 2) * (tailSide === 'bottom' || tailSide === 'top' ? bubble.width : bubble.height);

          let base2X, base2Y;
          if (tailSide === 'bottom') {
            base2X = bubble.x + bubble.width * tailBasePos + halfWidth;
            base2Y = bubble.y + bubble.height;
          } else if (tailSide === 'top') {
            base2X = bubble.x + bubble.width * tailBasePos + halfWidth;
            base2Y = bubble.y;
          } else if (tailSide === 'left') {
            base2X = bubble.x;
            base2Y = bubble.y + bubble.height * tailBasePos + halfWidth;
          } else {
            base2X = bubble.x + bubble.width;
            base2Y = bubble.y + bubble.height * tailBasePos + halfWidth;
          }

          const tipX = bubble.x + bubble.width / 2 + (bubble.tailX || 0);
          const tipY = bubble.y + bubble.height / 2 + (bubble.tailY || 0.15);

          // Midpoint between base2 and tip
          const midX = (base2X + tipX) / 2;
          const midY = (base2Y + tipY) / 2;

          // Control point offset is mouse position minus midpoint
          updateBubble(selectedBubbleId, {
            tailCtrl2X: coords.x - midX,
            tailCtrl2Y: coords.y - midY
          });
        }
      } else if (isDraggingRotation && selectedBubbleId) {
        const bubble = bubbles.find(b => b.id === selectedBubbleId);
        if (bubble) {
          // Calculate angle from bubble center to mouse position
          const cx = bubble.x + bubble.width / 2;
          const cy = bubble.y + bubble.height / 2;
          const dx = coords.x - cx;
          const dy = coords.y - cy;
          // Calculate angle in degrees (0 = bottom, clockwise positive)
          let angle = Math.atan2(dy, dx) * 180 / Math.PI + 90;
          // Normalize to 0-360
          if (angle < 0) angle += 360;
          updateBubble(selectedBubbleId, {
            rotation: angle
          });
        }
      }
    } else {
      handleMouseMove(e);
    }
  };

  const handleCanvasMouseUp = () => {
    if (editorMode === 'bubbles') {
      setIsDraggingBubble(false);
      setIsResizingBubble(false);
      setResizeCorner(null);
      setIsDraggingTail(false);
      setIsDraggingTailBase(false);
      setIsDraggingTailCtrl1(false);
      setIsDraggingTailCtrl2(false);
      setIsDraggingRotation(false);
    } else {
      handleMouseUp();
    }
  };

  const computePanels = () => {
    const newPanels = computePanelsFromLines(lines, pageId);
    const panelsWithContent = newPanels.map((newPanel, idx) => {
      const existing = panels[idx];
      return existing ? { ...newPanel, content: existing.content || '' } : newPanel;
    });
    setPanels(panelsWithContent);
    setPanelsComputed(true);
  };

  const movePanelUp = (index) => {
    if (index === 0) return;
    const newPanels = [...panels];
    [newPanels[index - 1], newPanels[index]] = [newPanels[index], newPanels[index - 1]];
    // Update panel orders
    newPanels.forEach((p, i) => {
      p.panelOrder = i + 1;
      p.id = `${pageId}-panel-${i + 1}`;
    });
    setPanels(newPanels);
  };

  const movePanelDown = (index) => {
    if (index === panels.length - 1) return;
    const newPanels = [...panels];
    [newPanels[index], newPanels[index + 1]] = [newPanels[index + 1], newPanels[index]];
    // Update panel orders
    newPanels.forEach((p, i) => {
      p.panelOrder = i + 1;
      p.id = `${pageId}-panel-${i + 1}`;
    });
    setPanels(newPanels);
  };

  const updatePanelContent = (panelId, content) => {
    setPanels(panels.map(p =>
      p.id === panelId ? { ...p, content } : p
    ));
  };

  const savePage = async () => {
    try {
      if (isCover) {
        // Save cover with prompt and bubbles
        const coverPrompt = panels[0]?.content || '';
        await api.put(`/comics/${id}/cover`, {
          image: page.masterImage,
          prompt: coverPrompt,
          bubbles
        });
        alert('Cover saved!');
        return;
      }

      let panelsToSave = panels;
      if (!panelsComputed) {
        panelsToSave = computePanelsFromLines(lines, pageId);
        setPanels(panelsToSave);
        setPanelsComputed(true);
      }

      const updatedComic = { ...comic, promptSettings };
      const pageIndex = updatedComic.pages.findIndex(p => p.id === pageId);
      updatedComic.pages[pageIndex] = {
        ...page,
        lines,
        panels: panelsToSave,
        bubbles
      };

      await api.put(`/comics/${id}`, updatedComic);
      setComic(updatedComic);
      setPage(updatedComic.pages[pageIndex]);
      alert('Page saved!');
    } catch (error) {
      console.error('Failed to save page:', error);
      alert('Failed to save page');
    }
  };

  const clearAllLines = () => {
    setLines([]);
    setPanels([]);
    setSelectedLineIndex(null);
    setPanelsComputed(false);
  };

  // Build the full prompt for image generation
  const buildFullPrompt = () => {
    const settings = promptSettings;
    let prompt = '';

    // Style Bible
    if (settings.styleBible) {
      prompt += `🎨 STYLE BIBLE\n${settings.styleBible}\n\n`;
    }

    // Page Layout (use custom if set, otherwise auto-generate)
    const layout = customLayoutDescription || generateLayoutDescription(panels);
    prompt += `CRITICAL PAGE SHAPE:\n${layout}\n\n`;

    // Camera & Inks
    if (settings.cameraInks) {
      prompt += `CAMERA + INKS\n${settings.cameraInks}\n\n`;
    }

    // Character Bible
    if (settings.characters && settings.characters.length > 0) {
      prompt += `CHARACTER BIBLE (MAINTAIN CONSISTENCY)\n`;
      settings.characters.forEach(char => {
        prompt += `\nCharacter: ${char.name}\n${char.description}\n`;
      });
      prompt += '\n';
    }

    // Global Do Not
    if (settings.globalDoNot) {
      prompt += `GLOBAL DO NOT\n${settings.globalDoNot}\n\n`;
    }

    // Hard Negatives
    if (settings.hardNegatives) {
      prompt += `HARD NEGATIVES\n${settings.hardNegatives}\n\n`;
    }

    // Panel Content
    prompt += `${isCover ? 'COVER' : `PAGE ${page.pageNumber}`} — PANEL CONTENT\n\n`;
    panels.forEach((panel, i) => {
      prompt += `Panel ${i + 1}:\n${panel.content || '(No content specified)'}\n\n`;
    });

    // Additional instructions
    if (additionalInstructions.trim()) {
      prompt += `ADDITIONAL INSTRUCTIONS:\n${additionalInstructions}\n\n`;
    }

    // Critical: fill entire canvas
    prompt += `CRITICAL: The artwork MUST fill the ENTIRE canvas edge-to-edge. No margins, no borders, no white space around the edges. The panels should extend to all four edges of the image.`;

    return prompt;
  };

  // Build prompt for a single panel
  const buildPanelPrompt = (panel, panelIndex) => {
    const settings = promptSettings;
    let prompt = '';

    // Style Bible
    if (settings.styleBible) {
      prompt += `🎨 STYLE BIBLE\n${settings.styleBible}\n\n`;
    }

    // Camera & Inks
    if (settings.cameraInks) {
      prompt += `CAMERA + INKS\n${settings.cameraInks}\n\n`;
    }

    // Character Bible
    if (settings.characters && settings.characters.length > 0) {
      prompt += `CHARACTER BIBLE (MAINTAIN CONSISTENCY)\n`;
      settings.characters.forEach(char => {
        prompt += `\nCharacter: ${char.name}\n${char.description}\n`;
      });
      prompt += '\n';
    }

    // Global Do Not
    if (settings.globalDoNot) {
      prompt += `GLOBAL DO NOT\n${settings.globalDoNot}\n\n`;
    }

    // Hard Negatives
    if (settings.hardNegatives) {
      prompt += `HARD NEGATIVES\n${settings.hardNegatives}\n\n`;
    }

    // Single panel content
    prompt += `SINGLE PANEL IMAGE\n\n`;
    prompt += `This is Panel ${panelIndex + 1} of ${panels.length} on ${isCover ? 'the COVER' : `PAGE ${page.pageNumber}`}.\n\n`;
    prompt += `Panel Content:\n${panel.content || '(No content specified)'}\n\n`;

    // Additional instructions
    if (additionalInstructions.trim()) {
      prompt += `ADDITIONAL INSTRUCTIONS:\n${additionalInstructions}\n\n`;
    }

    // Critical: fill entire canvas, absolutely no borders
    prompt += `CRITICAL REQUIREMENTS:
- This is a SINGLE PANEL illustration, NOT a comic page.
- The artwork MUST fill the ENTIRE canvas edge-to-edge with NO borders.
- Do NOT draw any panel borders, frames, outlines, or edges around the image.
- Do NOT add any margins, gutters, or white/black space around the edges.
- Do NOT draw rectangular frames or box outlines.
- The image content should extend all the way to every edge of the canvas.
- This image will be cropped and placed into a panel frame by the app - any borders you draw will create ugly double-borders.`;

    return prompt;
  };

  // Determine aspect ratio based on panel dimensions
  const getPanelAspectRatio = (panel) => {
    const { width, height } = panel.tapZone;
    const ratio = width / height;
    if (ratio > 1.3) return 'landscape';
    if (ratio < 0.77) return 'portrait';
    return 'square';
  };

  // Generate a single panel image
  const generatePanelImage = async (panel, panelIndex) => {
    if (!panel.content?.trim()) {
      alert(`Panel ${panelIndex + 1} has no content. Please add content first.`);
      return;
    }

    setPanelImages(prev => ({
      ...prev,
      [panel.id]: { ...prev[panel.id], generating: true, error: null }
    }));

    try {
      const prompt = buildPanelPrompt(panel, panelIndex);
      const aspectRatio = getPanelAspectRatio(panel);

      console.log(`Generating panel ${panelIndex + 1} (${panel.id}), aspect: ${aspectRatio}`);

      const response = await api.post('/images/generate-panel', {
        prompt,
        panelId: panel.id,
        aspectRatio
      });

      setPanelImages(prev => ({
        ...prev,
        [panel.id]: {
          ...prev[panel.id], // Preserve existing fitMode and crop settings
          path: response.data.path,
          generating: false,
          error: null,
          fitMode: prev[panel.id]?.fitMode || 'stretch',
          cropX: prev[panel.id]?.cropX ?? 0,
          cropY: prev[panel.id]?.cropY ?? 0,
          zoom: prev[panel.id]?.zoom ?? 1
        }
      }));

      console.log(`Panel ${panelIndex + 1} generated:`, response.data.path);
    } catch (error) {
      console.error(`Panel ${panelIndex + 1} generation failed:`, error);
      setPanelImages(prev => ({
        ...prev,
        [panel.id]: {
          ...prev[panel.id],
          generating: false,
          error: error.response?.data?.error || error.message
        }
      }));
    }
  };

  // Generate all panels sequentially
  const generateAllPanels = async () => {
    const panelsWithContent = panels.filter(p => p.content?.trim());
    if (panelsWithContent.length === 0) {
      alert('No panels have content. Please add content to at least one panel.');
      return;
    }

    setGeneratingAllPanels(true);
    console.log(`Starting generation of ${panelsWithContent.length} panels...`);

    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];
      if (panel.content?.trim()) {
        console.log(`Generating panel ${i + 1} of ${panels.length}...`);
        try {
          await generatePanelImage(panel, i);
          console.log(`Panel ${i + 1} complete.`);
        } catch (error) {
          console.error(`Panel ${i + 1} failed:`, error);
          // Continue with next panel even if this one fails
        }
      }
    }

    console.log('All panels generation complete.');
    setGeneratingAllPanels(false);
  };

  // Composite all panel images onto a single canvas
  const compositePageFromPanels = async () => {
    const canvas = compositeCanvasRef.current;
    if (!canvas) return null;

    const ctx = canvas.getContext('2d');
    const canvasWidth = 1024;
    const canvasHeight = 1536;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // Gutter size in pixels (margin between panels)
    const gutterSize = 16;
    // Outer margin for the entire page
    const outerMargin = 12;

    // Load and draw each panel image
    const loadImage = (src) => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    };

    // First, load all images and sample their edge colors
    const loadedImages = [];
    let totalR = 0, totalG = 0, totalB = 0, sampleCount = 0;

    for (const panel of panels) {
      const panelData = panelImages[panel.id];
      if (panelData?.path) {
        try {
          const img = await loadImage(`http://localhost:3001${panelData.path}`);
          loadedImages.push({ panel, img });

          // Sample colors from image edges using a temp canvas
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = img.width;
          tempCanvas.height = img.height;
          const tempCtx = tempCanvas.getContext('2d');
          tempCtx.drawImage(img, 0, 0);

          // Sample from edges (top, bottom, left, right strips)
          const sampleEdge = (sx, sy, sw, sh) => {
            try {
              const data = tempCtx.getImageData(sx, sy, sw, sh).data;
              for (let i = 0; i < data.length; i += 4) {
                totalR += data[i];
                totalG += data[i + 1];
                totalB += data[i + 2];
                sampleCount++;
              }
            } catch (e) { /* ignore */ }
          };

          const edgeWidth = 10;
          sampleEdge(0, 0, img.width, edgeWidth); // top
          sampleEdge(0, img.height - edgeWidth, img.width, edgeWidth); // bottom
          sampleEdge(0, 0, edgeWidth, img.height); // left
          sampleEdge(img.width - edgeWidth, 0, edgeWidth, img.height); // right
        } catch (error) {
          console.error(`Failed to load panel image for ${panel.id}:`, error);
        }
      }
    }

    // Calculate average color and create a light tint for gutters
    let gutterColor = '#e8e8e8'; // fallback light grey
    if (sampleCount > 0) {
      const avgR = Math.round(totalR / sampleCount);
      const avgG = Math.round(totalG / sampleCount);
      const avgB = Math.round(totalB / sampleCount);

      // Create a lighter tint (blend with white, 70% towards white)
      const tintFactor = 0.7;
      const tintR = Math.round(avgR + (255 - avgR) * tintFactor);
      const tintG = Math.round(avgG + (255 - avgG) * tintFactor);
      const tintB = Math.round(avgB + (255 - avgB) * tintFactor);

      gutterColor = `rgb(${tintR}, ${tintG}, ${tintB})`;
    }

    // Fill background with the blended gutter color
    ctx.fillStyle = gutterColor;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Now draw all the loaded images
    for (const { panel, img } of loadedImages) {
      const { x, y, width, height } = panel.tapZone;
      const panelData = panelImages[panel.id];
      const fitMode = panelData?.fitMode || 'stretch';
      const cropX = panelData?.cropX ?? 0; // -1 to 1 (left to right)
      const cropY = panelData?.cropY ?? 0; // -1 to 1 (top to bottom)
      const zoom = panelData?.zoom ?? 1; // 1 = 100%, >1 = zoom in

      // Calculate pixel positions
      const px = x * canvasWidth;
      const py = y * canvasHeight;
      const pw = width * canvasWidth;
      const ph = height * canvasHeight;

      // Apply gutter insets and outer margin
      const inset = gutterSize / 2;
      // Left edge: outer margin if at page edge, half gutter if internal
      const leftInset = x > 0.01 ? inset : outerMargin;
      // Top edge: outer margin if at page edge, half gutter if internal
      const topInset = y > 0.01 ? inset : outerMargin;
      // Right edge: outer margin if at page edge, half gutter if internal
      const rightInset = x + width < 0.99 ? inset : outerMargin;
      // Bottom edge: outer margin if at page edge, half gutter if internal
      const bottomInset = y + height < 0.99 ? inset : outerMargin;

      const adjustedX = px + leftInset;
      const adjustedY = py + topInset;
      const adjustedW = pw - leftInset - rightInset;
      const adjustedH = ph - topInset - bottomInset;

      // Trim percentage off each edge to remove AI-generated borders
      const edgeTrim = 0.03; // 3% off each edge
      const trimX = img.width * edgeTrim;
      const trimY = img.height * edgeTrim;
      const trimmedW = img.width - (trimX * 2);
      const trimmedH = img.height - (trimY * 2);

      if (fitMode === 'crop') {
        // Crop mode: preserve aspect ratio, cover the panel, and allow repositioning + zoom
        const imgAspect = trimmedW / trimmedH;
        const panelAspect = adjustedW / adjustedH;

        // Calculate base source dimensions (minimum to cover the panel)
        let baseSourceW, baseSourceH;

        if (imgAspect > panelAspect) {
          // Image is wider - base on height for cover
          baseSourceH = trimmedH;
          baseSourceW = trimmedH * panelAspect;
        } else {
          // Image is taller - base on width for cover
          baseSourceW = trimmedW;
          baseSourceH = trimmedW / panelAspect;
        }

        // Apply zoom (zoom > 1 = zoom in = smaller source area)
        const sourceW = baseSourceW / zoom;
        const sourceH = baseSourceH / zoom;

        // Calculate max offsets (how much we can pan around) within trimmed area
        const maxOffsetX = Math.max(0, trimmedW - sourceW);
        const maxOffsetY = Math.max(0, trimmedH - sourceH);

        // Position based on cropX/cropY (-1 to 1), offset by trim
        const sourceX = trimX + (maxOffsetX / 2) * (1 + cropX);
        const sourceY = trimY + (maxOffsetY / 2) * (1 + cropY);

        // Draw cropped portion of the image
        ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, adjustedX, adjustedY, adjustedW, adjustedH);
      } else {
        // Stretch mode: scale to fit exactly (may distort), but trim edges
        ctx.drawImage(img, trimX, trimY, trimmedW, trimmedH, adjustedX, adjustedY, adjustedW, adjustedH);
      }
    }

    // Helper function to draw a wobbly/hand-drawn line
    const drawWobblyLine = (x1, y1, x2, y2) => {
      const segments = 12; // Number of segments for the wobble
      const wobbleAmount = 1.5; // Max pixels of wobble

      ctx.beginPath();
      ctx.moveTo(x1, y1);

      for (let i = 1; i <= segments; i++) {
        const t = i / segments;
        const x = x1 + (x2 - x1) * t;
        const y = y1 + (y2 - y1) * t;

        // Add random wobble perpendicular to the line direction
        const wobbleX = (Math.random() - 0.5) * wobbleAmount * 2;
        const wobbleY = (Math.random() - 0.5) * wobbleAmount * 2;

        if (i === segments) {
          // End at exact position
          ctx.lineTo(x2, y2);
        } else {
          ctx.lineTo(x + wobbleX, y + wobbleY);
        }
      }
      ctx.stroke();
    };

    // Calculate border color (darker shade from sampled colors)
    let borderColor = '#1a1a1a'; // fallback dark
    if (sampleCount > 0) {
      const avgR = Math.round(totalR / sampleCount);
      const avgG = Math.round(totalG / sampleCount);
      const avgB = Math.round(totalB / sampleCount);

      // Create a darker shade (blend towards black, 80% towards black)
      const darkFactor = 0.8;
      const darkR = Math.round(avgR * (1 - darkFactor));
      const darkG = Math.round(avgG * (1 - darkFactor));
      const darkB = Math.round(avgB * (1 - darkFactor));

      borderColor = `rgb(${darkR}, ${darkG}, ${darkB})`;
    }

    // Draw hand-drawn style panel borders
    ctx.strokeStyle = borderColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const panel of panels) {
      const { x, y, width, height } = panel.tapZone;
      const px = x * canvasWidth;
      const py = y * canvasHeight;
      const pw = width * canvasWidth;
      const ph = height * canvasHeight;

      // Apply same gutter insets and outer margin for border
      const inset = gutterSize / 2;
      const leftInset = x > 0.01 ? inset : outerMargin;
      const topInset = y > 0.01 ? inset : outerMargin;
      const rightInset = x + width < 0.99 ? inset : outerMargin;
      const bottomInset = y + height < 0.99 ? inset : outerMargin;

      const adjustedX = px + leftInset;
      const adjustedY = py + topInset;
      const adjustedW = pw - leftInset - rightInset;
      const adjustedH = ph - topInset - bottomInset;

      // Draw multiple passes for thicker, more organic look
      for (let pass = 0; pass < 3; pass++) {
        ctx.lineWidth = 2 + Math.random() * 1.5;

        // Top edge
        drawWobblyLine(adjustedX, adjustedY, adjustedX + adjustedW, adjustedY);
        // Right edge
        drawWobblyLine(adjustedX + adjustedW, adjustedY, adjustedX + adjustedW, adjustedY + adjustedH);
        // Bottom edge
        drawWobblyLine(adjustedX + adjustedW, adjustedY + adjustedH, adjustedX, adjustedY + adjustedH);
        // Left edge
        drawWobblyLine(adjustedX, adjustedY + adjustedH, adjustedX, adjustedY);
      }
    }

    return canvas.toDataURL('image/png');
  };

  // Save composited image
  const saveCompositedImage = async () => {
    const dataUrl = await compositePageFromPanels();
    if (!dataUrl) {
      alert('Failed to composite image');
      return;
    }

    try {
      // Convert data URL to blob and upload
      const response = await fetch(dataUrl);
      const blob = await response.blob();

      const formData = new FormData();
      formData.append('image', blob, `composited-${pageId}.png`);

      const uploadResponse = await api.post('/images/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      // Save to project
      await api.post('/images/save-to-project', {
        comicId: id,
        filename: uploadResponse.data.filename,
        imageType: 'page',
        pageNumber: page.pageNumber
      });

      // Update comic and page data
      const imagePath = `/projects/${id}/images/${id}_p${page.pageNumber}.png`;

      const updatedComic = { ...comic };
      const pageIndex = updatedComic.pages.findIndex(p => p.id === pageId);
      updatedComic.pages[pageIndex].masterImage = imagePath;

      // Save to database
      await api.put(`/comics/${id}`, updatedComic);
      setComic(updatedComic);

      // Update local page state with cache-buster for immediate display refresh
      setPage(prev => ({ ...prev, masterImage: `${imagePath}?t=${Date.now()}` }));

      alert('Composited page saved to project!');
    } catch (error) {
      console.error('Failed to save composited image:', error);
      alert('Failed to save composited image: ' + error.message);
    }
  };

  // --- Bake Bubbles into Page Image ---
  const [isBaking, setIsBaking] = useState(false);
  const [showBakedPreview, setShowBakedPreview] = useState(false);
  const bakeTargetRef = useRef(null);

  const bakeBubblesToImage = async () => {
    if (!page.masterImage || bubbles.length === 0) {
      alert('Need a page image and at least one bubble to bake.');
      return;
    }
    setIsBaking(true);
    // Wait for React to render the off-screen bake target
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // Ensure all bubble fonts are loaded before capture
    const usedFonts = [...new Set(bubbles.map(b => {
      const font = BUBBLE_FONTS.find(f => f.id === b.fontId) || BUBBLE_FONTS[0];
      return font.family.replace(/'/g, '').split(',')[0].trim();
    }))];
    try {
      await Promise.all(usedFonts.map(f => document.fonts.load(`16px "${f}"`)));
      await document.fonts.ready;
    } catch (e) {
      console.warn('Font preload warning:', e);
    }

    // Extra frame to let fonts apply to rendered elements
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    try {
      const targetEl = bakeTargetRef.current;
      if (!targetEl) throw new Error('Bake target not rendered');

      const scale = 1024 / CANVAS_WIDTH; // 2.56x for 1024x1536 output
      const canvas = await html2canvas(targetEl, {
        scale,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT
      });

      canvas.toBlob(async (blob) => {
        try {
          const formData = new FormData();
          formData.append('image', blob, `baked-${pageId}.png`);

          const uploadResponse = await api.post('/images/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });

          await api.post('/images/save-to-project', {
            comicId: id,
            filename: uploadResponse.data.filename,
            imageType: 'baked',
            pageNumber: page.pageNumber
          });

          const bakedPath = `/projects/${id}/images/${id}_p${page.pageNumber}_baked.png`;

          const updatedComic = { ...comic };
          const pageIndex = updatedComic.pages.findIndex(p => p.id === pageId);
          if (pageIndex !== -1) {
            updatedComic.pages[pageIndex].bakedImage = bakedPath;
            await api.put(`/comics/${id}`, updatedComic);
            setComic(updatedComic);
          }

          setPage(prev => ({ ...prev, bakedImage: `${bakedPath}?t=${Date.now()}` }));
          alert('Bubbles baked into image!');
        } catch (error) {
          console.error('Failed to bake bubbles:', error);
          alert('Failed to bake bubbles: ' + error.message);
        } finally {
          setIsBaking(false);
        }
      }, 'image/png');
    } catch (error) {
      console.error('Failed to bake bubbles:', error);
      alert('Failed to bake bubbles: ' + error.message);
      setIsBaking(false);
    }
  };

  const generatePageImage = async () => {
    if (!panelsComputed || panels.length === 0) {
      alert('Please compute panels and add content first.');
      return;
    }

    setIsGenerating(true);
    setGenerationError(null);

    try {
      const prompt = useCustomPrompt && customPrompt ? customPrompt : buildFullPrompt();
      console.log('Generating with prompt:', prompt);

      const response = await api.post('/images/generate-page', {
        prompt,
        size: '1024x1536' // Portrait for comic pages (GPT image supported size)
      });

      setGeneratedImage({
        path: response.data.path
      });
    } catch (error) {
      console.error('Generation failed:', error);
      setGenerationError(error.response?.data?.error || error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const saveGeneratedImage = async () => {
    if (!generatedImage) return;

    try {
      const filename = generatedImage.path.split('/').pop();
      const saveResponse = await api.post('/images/save-to-project', {
        comicId: id,
        filename,
        imageType: isCover ? 'cover' : 'page',
        pageNumber: page.pageNumber
      });

      if (isCover) {
        const savedPath = saveResponse.data.path;
        const coverPrompt = panels[0]?.content || '';
        const updatedCover = { ...comic.cover, image: savedPath, prompt: coverPrompt };
        await api.put(`/comics/${id}`, { cover: updatedCover });
        setComic(prev => ({ ...prev, cover: updatedCover }));
        setPage(prev => ({ ...prev, masterImage: savedPath + `?t=${Date.now()}` }));
        alert('Image saved to cover!');
        return;
      }

      const updatedComic = { ...comic };
      const pageIndex = updatedComic.pages.findIndex(p => p.id === pageId);
      updatedComic.pages[pageIndex].masterImage = `/projects/${id}/images/${id}_p${page.pageNumber}.png`;

      await api.put(`/comics/${id}`, updatedComic);
      setComic(updatedComic);
      const pageWithCacheBuster = {
        ...updatedComic.pages[pageIndex],
        masterImage: updatedComic.pages[pageIndex].masterImage + `?t=${Date.now()}`
      };
      setPage(pageWithCacheBuster);
      alert('Image saved to page!');
    } catch (error) {
      console.error('Failed to save image:', error);
      alert('Failed to save image');
    }
  };

  // ChatGPT functions
  const scrollToBottomOfChat = () => {
    chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() && chatImages.length === 0) return;

    const userMessage = {
      role: 'user',
      content: chatInput,
      images: chatImages.map(img => img.preview)
    };

    // Update both state and ref
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

      console.log('Chat API response:', response.data);

      const assistantMessage = {
        role: 'assistant',
        content: response.data.message
      };

      console.log('Assistant message created:', assistantMessage);

      // Update both state and ref with assistant response
      const messagesWithResponse = [...chatMessagesRef.current, assistantMessage];
      console.log('Messages with response:', messagesWithResponse);
      chatMessagesRef.current = messagesWithResponse;
      setChatMessages(messagesWithResponse);
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage = {
        role: 'assistant',
        content: `Error: ${error.response?.data?.error || error.message}`
      };
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
        setChatImages(prev => [...prev, {
          preview: event.target.result,
          base64,
          name: file.name
        }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const uploadGeneratedImageToChat = async () => {
    if (!generatedImage?.path) {
      alert('No generated image to upload');
      return;
    }

    try {
      // Fetch the generated image and convert to base64
      const response = await fetch(`http://localhost:3001${generatedImage.path}`);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target.result.split(',')[1];
        setChatImages(prev => [...prev, {
          preview: event.target.result,
          base64,
          name: 'generated-page.png'
        }]);
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error('Failed to upload generated image:', error);
      alert('Failed to upload image');
    }
  };

  const removeChatImage = (index) => {
    setChatImages(prev => prev.filter((_, i) => i !== index));
  };

  const clearChat = () => {
    chatMessagesRef.current = [];
    setChatMessages([]);
    setChatImages([]);
    localStorage.removeItem(`comic-chat-${id}`);
  };

  // Preview line while drawing
  const getPreviewLine = () => {
    if (!isDrawing || !drawStart || !drawEnd) return null;

    const dx = Math.abs(drawEnd.x - drawStart.x);
    const dy = Math.abs(drawEnd.y - drawStart.y);

    if (dx < 0.01 && dy < 0.01) return null;

    if (dx > dy) {
      const y = (drawStart.y + drawEnd.y) / 2;
      return {
        type: 'horizontal',
        y,
        x1: Math.min(drawStart.x, drawEnd.x),
        x2: Math.max(drawStart.x, drawEnd.x)
      };
    } else {
      const x = (drawStart.x + drawEnd.x) / 2;
      return {
        type: 'vertical',
        x,
        y1: Math.min(drawStart.y, drawEnd.y),
        y2: Math.max(drawStart.y, drawEnd.y)
      };
    }
  };

  if (!comic || !page) {
    return <div>Loading...</div>;
  }

  const previewLine = getPreviewLine();
  const layoutDescription = generateLayoutDescription(panels);
  const selectedPanelData = panels.find(p => p.id === selectedPanel);
  const snapPoints = getSnapPoints();

  const sortedPages = comic?.pages ? [...comic.pages].sort((a, b) => a.pageNumber - b.pageNumber) : [];
  const currentPageIdx = sortedPages.findIndex(p => p.id === pageId);
  const prevPage = currentPageIdx > 0 ? sortedPages[currentPageIdx - 1] : null;
  const nextPage = currentPageIdx < sortedPages.length - 1 ? sortedPages[currentPageIdx + 1] : null;

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to={`/comic/${id}`} style={{ color: '#888', textDecoration: 'none', marginBottom: '0.5rem', display: 'block' }}>
            ← Back to {comic.title}
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h1 style={{ margin: 0 }}>{isCover ? 'Cover' : `Page ${page.pageNumber}`}</h1>
            {!isCover && sortedPages.length > 0 && (
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                <button
                  onClick={() => prevPage && navigate(`/comic/${id}/page/${prevPage.id}`)}
                  disabled={!prevPage}
                  style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem', background: '#555', color: '#fff', border: 'none', borderRadius: '4px', cursor: prevPage ? 'pointer' : 'default', opacity: prevPage ? 1 : 0.4 }}
                >
                  ← Prev
                </button>
                <button
                  onClick={() => nextPage && navigate(`/comic/${id}/page/${nextPage.id}`)}
                  disabled={!nextPage}
                  style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem', background: '#555', color: '#fff', border: 'none', borderRadius: '4px', cursor: nextPage ? 'pointer' : 'default', opacity: nextPage ? 1 : 0.4 }}
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mode Toggle - hide for cover */}
      {!isCover && (
      <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
        <button
          className={`btn ${editorMode === 'layout' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setEditorMode('layout')}
          style={{ padding: '0.5rem 1rem' }}
        >
          Layout Mode
        </button>
        <button
          className={`btn ${editorMode === 'bubbles' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => {
            setEditorMode('bubbles');
            setSidebarTab('panels');
          }}
          style={{ padding: '0.5rem 1rem' }}
        >
          Bubbles Mode
        </button>
      </div>
      )}

      {/* Toolbar */}
      <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: '#888', fontSize: '0.85rem' }}>
          {isCover
            ? (isAddingBubble ? 'Click on canvas to place bubble' : 'Add bubbles for title text')
            : editorMode === 'layout'
              ? 'Draw lines by dragging | Drag lines to reposition'
              : isAddingBubble
                ? 'Click on canvas to place bubble'
                : 'Drag to reposition | Select to edit'}
        </span>
        {editorMode === 'bubbles' && (
          <button
            className={`btn ${isAddingBubble ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setIsAddingBubble(!isAddingBubble)}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
          >
            {isAddingBubble ? 'Cancel' : '+ Add Bubble'}
          </button>
        )}
        {editorMode === 'bubbles' && page.masterImage && bubbles.length > 0 && (
          <button
            className="btn btn-secondary"
            onClick={bakeBubblesToImage}
            disabled={isBaking}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', background: isBaking ? '#ccc' : '#8e44ad', color: '#fff', border: 'none' }}
          >
            {isBaking ? 'Baking...' : 'Bake Bubbles'}
          </button>
        )}
        {page.bakedImage && (
          <button
            className="btn btn-secondary"
            onClick={() => setShowBakedPreview(prev => !prev)}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', background: showBakedPreview ? '#27ae60' : '#95a5a6', color: '#fff', border: 'none' }}
          >
            {showBakedPreview ? 'Hide Baked' : 'View Baked'}
          </button>
        )}
        {!isCover && (
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          {selectedLineIndex !== null && (
            <button
              className="btn"
              onClick={deleteSelectedLine}
              style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', background: '#c0392b' }}
            >
              Delete Line
            </button>
          )}
          <button
            className="btn btn-secondary"
            onClick={clearAllLines}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
          >
            Clear All
          </button>
          <button
            className="btn btn-primary"
            onClick={computePanels}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
          >
            Compute Panels
          </button>
        </div>
        )}
      </div>

      <div className="panel-editor">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {/* Canvas */}
          <div
            ref={canvasRef}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={(e) => {
              if (isDrawing && drawStart) {
                // Finish the line at the edge instead of canceling
                const rect = canvasRef.current.getBoundingClientRect();
                const rawX = (e.clientX - rect.left) / rect.width;
                const rawY = (e.clientY - rect.top) / rect.height;
                // Clamp to canvas boundaries
                const clampedX = Math.max(0, Math.min(1, rawX));
                const clampedY = Math.max(0, Math.min(1, rawY));
                // Pass clamped coordinates directly to handleMouseUp
                handleMouseUp({ x: clampedX, y: clampedY });
                return;
              }
              if (isDragging) {
                setIsDragging(false);
                setDragLineIndex(null);
              }
              if (isDraggingEndpoint) {
                setIsDraggingEndpoint(false);
                setDragLineIndex(null);
                setDragEndpoint(null);
              }
              if (isDraggingBubble) {
                setIsDraggingBubble(false);
              }
              if (isResizingBubble) {
                setIsResizingBubble(false);
                setResizeCorner(null);
              }
              if (isDraggingTail) {
                setIsDraggingTail(false);
              }
              if (isDraggingTailBase) {
                setIsDraggingTailBase(false);
              }
              if (isDraggingTailCtrl1) {
                setIsDraggingTailCtrl1(false);
              }
              if (isDraggingTailCtrl2) {
                setIsDraggingTailCtrl2(false);
              }
            }}
            style={{
              width: CANVAS_WIDTH,
              height: CANVAS_HEIGHT,
              background: page.masterImage ? 'transparent' : '#f5f5f5',
              border: '2px solid #ddd',
              borderRadius: '4px',
              position: 'relative',
              cursor: isDragging ? 'grabbing' : (editorMode === 'bubbles' ? (isAddingBubble ? 'crosshair' : 'default') : 'crosshair'),
              overflow: 'hidden',
              userSelect: 'none'
            }}
          >
            {/* SVG filter for hand-drawn bubble effect */}
            <svg width="0" height="0" style={{ position: 'absolute' }}>
              <defs>
                <filter id="roughEdge" x="-5%" y="-5%" width="110%" height="110%">
                  <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" result="noise" />
                  <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" xChannelSelector="R" yChannelSelector="G" />
                </filter>
              </defs>
            </svg>

            {/* Background image */}
            {page.masterImage && (
              <img
                src={`http://localhost:3001${page.masterImage}`}
                alt={`Page ${page.pageNumber}`}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  position: 'absolute',
                  opacity: 0.4,
                  pointerEvents: 'none'
                }}
              />
            )}

            {/* Snap guides (subtle) */}
            {snapPoints.x.map((x, i) => (
              <div
                key={`snap-x-${i}`}
                style={{
                  position: 'absolute',
                  left: `${x * 100}%`,
                  top: 0,
                  bottom: 0,
                  width: '1px',
                  background: 'rgba(0,0,0,0.1)',
                  pointerEvents: 'none'
                }}
              />
            ))}
            {snapPoints.y.map((y, i) => (
              <div
                key={`snap-y-${i}`}
                style={{
                  position: 'absolute',
                  top: `${y * 100}%`,
                  left: 0,
                  right: 0,
                  height: '1px',
                  background: 'rgba(0,0,0,0.1)',
                  pointerEvents: 'none'
                }}
              />
            ))}

            {/* Panel regions */}
            {panelsComputed && panels.map((panel, i) => (
              <div
                key={panel.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedPanel(panel.id);
                  setSelectedLineIndex(null);
                }}
                style={{
                  position: 'absolute',
                  left: `${panel.tapZone.x * 100}%`,
                  top: `${panel.tapZone.y * 100}%`,
                  width: `${panel.tapZone.width * 100}%`,
                  height: `${panel.tapZone.height * 100}%`,
                  background: selectedPanel === panel.id
                    ? 'rgba(0, 255, 0, 0.2)'
                    : 'rgba(100, 100, 255, 0.1)',
                  border: selectedPanel === panel.id
                    ? '2px solid #00ff00'
                    : '1px dashed rgba(100, 100, 255, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: '1.5rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  boxSizing: 'border-box',
                  pointerEvents: 'auto'
                }}
              >
                {i + 1}
              </div>
            ))}

            {/* Drawn lines with endpoint handles */}
            {lines.map((line, i) => (
              <React.Fragment key={`line-${i}`}>
                {line.type === 'horizontal' ? (
                  <>
                    {/* Horizontal line */}
                    <div
                      data-line-index={i}
                      onMouseDown={(e) => handleLineMouseDown(e, i)}
                      style={{
                        position: 'absolute',
                        left: `${line.x1 * 100}%`,
                        width: `${(line.x2 - line.x1) * 100}%`,
                        top: `${line.y * 100}%`,
                        height: '8px',
                        background: selectedLineIndex === i ? '#00ff00' : '#e94560',
                        cursor: isDragging && dragLineIndex === i ? 'grabbing' : 'ns-resize',
                        transform: 'translateY(-50%)',
                        zIndex: 20,
                        boxShadow: '0 0 4px rgba(0,0,0,0.5)',
                        borderRadius: '2px'
                      }}
                    />
                    {/* Left endpoint handle */}
                    <div
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setIsDraggingEndpoint(true);
                        setDragLineIndex(i);
                        setDragEndpoint('start');
                        setSelectedLineIndex(i);
                      }}
                      style={{
                        position: 'absolute',
                        left: `${line.x1 * 100}%`,
                        top: `${line.y * 100}%`,
                        width: '14px',
                        height: '14px',
                        background: selectedLineIndex === i ? '#00ff00' : '#e94560',
                        border: '2px solid #fff',
                        borderRadius: '50%',
                        transform: 'translate(-50%, -50%)',
                        cursor: 'ew-resize',
                        zIndex: 25,
                        boxShadow: '0 0 4px rgba(0,0,0,0.5)'
                      }}
                    />
                    {/* Right endpoint handle */}
                    <div
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setIsDraggingEndpoint(true);
                        setDragLineIndex(i);
                        setDragEndpoint('end');
                        setSelectedLineIndex(i);
                      }}
                      style={{
                        position: 'absolute',
                        left: `${line.x2 * 100}%`,
                        top: `${line.y * 100}%`,
                        width: '14px',
                        height: '14px',
                        background: selectedLineIndex === i ? '#00ff00' : '#e94560',
                        border: '2px solid #fff',
                        borderRadius: '50%',
                        transform: 'translate(-50%, -50%)',
                        cursor: 'ew-resize',
                        zIndex: 25,
                        boxShadow: '0 0 4px rgba(0,0,0,0.5)'
                      }}
                    />
                  </>
                ) : (
                  <>
                    {/* Vertical line */}
                    <div
                      data-line-index={i}
                      onMouseDown={(e) => handleLineMouseDown(e, i)}
                      style={{
                        position: 'absolute',
                        left: `${line.x * 100}%`,
                        top: `${line.y1 * 100}%`,
                        height: `${(line.y2 - line.y1) * 100}%`,
                        width: '8px',
                        background: selectedLineIndex === i ? '#00ff00' : '#3498db',
                        cursor: isDragging && dragLineIndex === i ? 'grabbing' : 'ew-resize',
                        transform: 'translateX(-50%)',
                        zIndex: 20,
                        boxShadow: '0 0 4px rgba(0,0,0,0.5)',
                        borderRadius: '2px'
                      }}
                    />
                    {/* Top endpoint handle */}
                    <div
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setIsDraggingEndpoint(true);
                        setDragLineIndex(i);
                        setDragEndpoint('start');
                        setSelectedLineIndex(i);
                      }}
                      style={{
                        position: 'absolute',
                        left: `${line.x * 100}%`,
                        top: `${line.y1 * 100}%`,
                        width: '14px',
                        height: '14px',
                        background: selectedLineIndex === i ? '#00ff00' : '#3498db',
                        border: '2px solid #fff',
                        borderRadius: '50%',
                        transform: 'translate(-50%, -50%)',
                        cursor: 'ns-resize',
                        zIndex: 25,
                        boxShadow: '0 0 4px rgba(0,0,0,0.5)'
                      }}
                    />
                    {/* Bottom endpoint handle */}
                    <div
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setIsDraggingEndpoint(true);
                        setDragLineIndex(i);
                        setDragEndpoint('end');
                        setSelectedLineIndex(i);
                      }}
                      style={{
                        position: 'absolute',
                        left: `${line.x * 100}%`,
                        top: `${line.y2 * 100}%`,
                        width: '14px',
                        height: '14px',
                        background: selectedLineIndex === i ? '#00ff00' : '#3498db',
                        border: '2px solid #fff',
                        borderRadius: '50%',
                        transform: 'translate(-50%, -50%)',
                        cursor: 'ns-resize',
                        zIndex: 25,
                        boxShadow: '0 0 4px rgba(0,0,0,0.5)'
                      }}
                    />
                  </>
                )}
              </React.Fragment>
            ))}

            {/* Preview line */}
            {previewLine && previewLine.type === 'horizontal' && (
              <div
                style={{
                  position: 'absolute',
                  left: `${previewLine.x1 * 100}%`,
                  width: `${(previewLine.x2 - previewLine.x1) * 100}%`,
                  top: `${previewLine.y * 100}%`,
                  height: '4px',
                  background: '#444444',
                  transform: 'translateY(-50%)',
                  zIndex: 30,
                  opacity: 0.8,
                  pointerEvents: 'none',
                  borderRadius: '2px'
                }}
              />
            )}
            {previewLine && previewLine.type === 'vertical' && (
              <div
                style={{
                  position: 'absolute',
                  left: `${previewLine.x * 100}%`,
                  top: `${previewLine.y1 * 100}%`,
                  height: `${(previewLine.y2 - previewLine.y1) * 100}%`,
                  width: '4px',
                  background: '#444444',
                  transform: 'translateX(-50%)',
                  zIndex: 30,
                  opacity: 0.8,
                  pointerEvents: 'none',
                  borderRadius: '2px'
                }}
              />
            )}

            {/* Speech Bubbles */}
            {bubbles.map((bubble) => {
              // Calculate tail endpoint position in canvas coordinates
              const bubbleCenterX = bubble.x + bubble.width / 2;
              const bubbleCenterY = bubble.y + bubble.height / 2;
              const tailEndX = bubbleCenterX + (bubble.tailX || 0);
              const tailEndY = bubbleCenterY + (bubble.tailY || 0);

              // Calculate angle and length of tail for SVG
              const tailDx = (bubble.tailX || 0) * CANVAS_WIDTH;
              const tailDy = (bubble.tailY || 0) * CANVAS_HEIGHT;

              return (
                <div key={bubble.id}>
                  {/* Unified Speech Bubble with integrated tail */}
                  {bubble.type === 'speech' && bubble.showTail !== false && (() => {
                    // Bubble dimensions in pixels
                    const bx = bubble.x * CANVAS_WIDTH;
                    const by = bubble.y * CANVAS_HEIGHT;
                    const bw = bubble.width * CANVAS_WIDTH;
                    const bh = bubble.height * CANVAS_HEIGHT;
                    const r = Math.min(bubble.cornerRadius || 8, bw / 2, bh / 2);
                    const borderWidthVal = bubble.borderWidth ?? 2.5;
                    const borderColorVal = bubble.borderColor || '#000';

                    // Bubble center (pivot point for rotation)
                    const cx = bx + bw / 2;
                    const cy = by + bh / 2;

                    // Rotation angle for the whole bubble
                    const rotation = bubble.rotation ?? 0; // degrees

                    // Tail properties
                    const tailWidth = (bubble.tailWidth ?? 0.25) * bw; // wide tail base
                    const halfTailWidth = tailWidth / 2;
                    const tailLength = (bubble.tailLength ?? 0.35) * bh;

                    // Tail angle: negative = left, 0 = straight, positive = right
                    const tailCurve = bubble.tailCurve ?? 0;
                    const angleOffset = tailCurve * tailLength * 1.5; // horizontal offset for angle (widened range)

                    // Tail bend: negative = bend left, 0 = straight, positive = bend right
                    const tailBend = bubble.tailBend ?? 0;
                    const bendOffset = tailBend * tailLength * 0.8; // how much the middle of tail bends

                    // Tail tip position (below bubble center, offset by angle)
                    const tipX = cx + angleOffset;
                    const tipY = by + bh + tailLength;

                    // Control points for smooth bezier curves - bend affects the middle of the tail
                    const ctrl1X = cx + halfTailWidth * 0.3 + angleOffset * 0.5 + bendOffset;
                    const ctrl1Y = by + bh + tailLength * 0.5;
                    const ctrl2X = cx - halfTailWidth * 0.3 + angleOffset * 0.5 + bendOffset;
                    const ctrl2Y = by + bh + tailLength * 0.5;

                    // Build unified path with smooth tail integration
                    // Path goes clockwise from top-left

                    // For round bubbles, we need to calculate where the tail connects on the curved edge
                    // The tail base should connect smoothly to the ellipse/rounded rect
                    const isVeryRound = r >= Math.min(bw, bh) * 0.4;

                    // Clamp tail base positions to stay within the flat portion of the bottom edge
                    const tailRightX = Math.min(cx + halfTailWidth, bx + bw - r - 2);
                    const tailLeftX = Math.max(cx - halfTailWidth, bx + r + 2);

                    // For very round bubbles, use quadratic curves to blend tail into the ellipse
                    let path;
                    if (isVeryRound) {
                      // For round bubbles, connect tail with smooth curves that follow the ellipse curvature
                      // Calculate angle on ellipse where tail connects
                      const ellipseRx = bw / 2;
                      const ellipseRy = bh / 2;

                      // Tail connects at bottom, slightly offset from center
                      const tailConnectRight = Math.min(halfTailWidth, ellipseRx * 0.6);
                      const tailConnectLeft = Math.min(halfTailWidth, ellipseRx * 0.6);

                      // Y position on ellipse at tail connection points
                      const yOffsetRight = ellipseRy * Math.sqrt(1 - Math.pow(tailConnectRight / ellipseRx, 2));
                      const yOffsetLeft = ellipseRy * Math.sqrt(1 - Math.pow(tailConnectLeft / ellipseRx, 2));

                      const connectRightY = cy + yOffsetRight;
                      const connectLeftY = cy + yOffsetLeft;

                      path = `
                        M ${cx} ${by}
                        A ${ellipseRx} ${ellipseRy} 0 0 1 ${cx + tailConnectRight} ${connectRightY}
                        C ${cx + tailConnectRight} ${connectRightY + tailLength * 0.2},
                          ${ctrl1X} ${ctrl1Y},
                          ${tipX} ${tipY}
                        C ${ctrl2X} ${ctrl2Y},
                          ${cx - tailConnectLeft} ${connectLeftY + tailLength * 0.2},
                          ${cx - tailConnectLeft} ${connectLeftY}
                        A ${ellipseRx} ${ellipseRy} 0 1 1 ${cx} ${by}
                        Z
                      `;
                    } else {
                      // Standard rounded rectangle with tail
                      path = `
                        M ${bx + r} ${by}
                        L ${bx + bw - r} ${by}
                        A ${r} ${r} 0 0 1 ${bx + bw} ${by + r}
                        L ${bx + bw} ${by + bh - r}
                        A ${r} ${r} 0 0 1 ${bx + bw - r} ${by + bh}
                        L ${tailRightX} ${by + bh}
                        C ${ctrl1X} ${ctrl1Y},
                          ${tipX + halfTailWidth * 0.2} ${tipY - tailLength * 0.15},
                          ${tipX} ${tipY}
                        C ${tipX - halfTailWidth * 0.2} ${tipY - tailLength * 0.15},
                          ${ctrl2X} ${ctrl2Y},
                          ${tailLeftX} ${by + bh}
                        L ${bx + r} ${by + bh}
                        A ${r} ${r} 0 0 1 ${bx} ${by + bh - r}
                        L ${bx} ${by + r}
                        A ${r} ${r} 0 0 1 ${bx + r} ${by}
                        Z
                      `;
                    }

                    // Calculate rotated tip position for the indicator line
                    const rotRad = rotation * Math.PI / 180;
                    const relTipX = angleOffset;
                    const relTipY = bh / 2 + tailLength;
                    const rotatedTipX = cx + relTipX * Math.cos(rotRad) - relTipY * Math.sin(rotRad);
                    const rotatedTipY = cy + relTipX * Math.sin(rotRad) + relTipY * Math.cos(rotRad);

                    return (
                      <svg
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          width: CANVAS_WIDTH,
                          height: CANVAS_HEIGHT,
                          zIndex: 50,
                          overflow: 'visible',
                          pointerEvents: 'none'
                        }}
                        viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
                      >
                        <defs>
                          <filter id={`roughBubble-${bubble.id}`} x="-50%" y="-50%" width="200%" height="200%">
                            <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" result="noise" />
                            <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" xChannelSelector="R" yChannelSelector="G" />
                          </filter>
                        </defs>
                        {/* Unified bubble + tail shape with rotation around center */}
                        <g
                          transform={`rotate(${rotation} ${cx} ${cy})`}
                          data-bubble-id={bubble.id}
                          onMouseDown={(e) => handleBubbleMouseDown(e, bubble)}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedBubbleId(bubble.id);
                            setEditorMode('bubbles');
                          }}
                          style={{ pointerEvents: 'auto', cursor: editorMode === 'bubbles' ? (bubble.locked ? 'default' : (isDraggingBubble ? 'grabbing' : 'grab')) : 'default' }}
                        >
                          <path
                            d={path}
                            fill={bubble.bgTransparent ? 'transparent' : (bubble.bgColor || '#fff')}
                            stroke={selectedBubbleId === bubble.id ? '#00ff00' : (bubble.noBorder ? 'none' : borderColorVal)}
                            strokeWidth={selectedBubbleId === bubble.id ? 3 : borderWidthVal}
                            strokeLinejoin="round"
                            filter={`url(#roughBubble-${bubble.id})`}
                          />
                        </g>
                        {/* Visual indicator line from center to tip (only when selected) */}
                        {selectedBubbleId === bubble.id && editorMode === 'bubbles' && (
                          <line
                            x1={cx}
                            y1={cy}
                            x2={rotatedTipX}
                            y2={rotatedTipY}
                            stroke="#ff6600"
                            strokeWidth={2}
                            strokeDasharray="4,4"
                            opacity={0.7}
                          />
                        )}
                        {/* Text inside bubble (not rotated - stays readable) */}
                        <foreignObject x={bx} y={by} width={bw} height={bh}>
                          <div
                            style={{
                              width: '100%',
                              height: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: '6px 8px',
                              boxSizing: 'border-box'
                            }}
                          >
                            <span
                              style={{
                                fontFamily: (BUBBLE_FONTS.find(f => f.id === bubble.fontId) || BUBBLE_FONTS[0]).family,
                                fontSize: `${bubble.fontSize}px`,
                                fontWeight: bubble.fontId === 'caveat' ? '700' : 'normal',
                                fontStyle: bubble.italic ? 'italic' : 'normal',
                                color: bubble.textColor || '#000000',
                                textAlign: bubble.textAlign || 'center',
                                width: '100%',
                                wordBreak: 'break-word',
                                lineHeight: 1.3,
                                letterSpacing: bubble.fontId === 'bangers' ? '0.5px' : '0',
                                textTransform: bubble.uppercase ? 'uppercase' : 'none',
                                pointerEvents: 'none',
                                userSelect: 'none',
                                transform: `rotate(${bubble.textAngle ?? 0}deg)`,
                                display: 'inline-block'
                              }}
                            >
                              {getBubbleDisplayText(bubble) || (editorMode === 'bubbles' ? '...' : '')}
                            </span>
                          </div>
                        </foreignObject>
                      </svg>
                    );
                  })()}

                  {/* Resize handles for speech bubbles with tail */}
                  {bubble.type === 'speech' && bubble.showTail !== false && editorMode === 'bubbles' && selectedBubbleId === bubble.id && (
                    <>
                      <div
                        data-resize-handle="true"
                        onMouseDown={(e) => handleResizeMouseDown(e, bubble, 'bottom-right')}
                        style={{
                          position: 'absolute',
                          left: `${(bubble.x + bubble.width) * 100}%`,
                          top: `${(bubble.y + bubble.height) * 100}%`,
                          width: 10,
                          height: 10,
                          background: '#00ff00',
                          cursor: 'nwse-resize',
                          borderRadius: '50%',
                          transform: 'translate(-50%, -50%)',
                          zIndex: 60
                        }}
                      />
                      <div
                        data-resize-handle="true"
                        onMouseDown={(e) => handleResizeMouseDown(e, bubble, 'bottom-left')}
                        style={{
                          position: 'absolute',
                          left: `${bubble.x * 100}%`,
                          top: `${(bubble.y + bubble.height) * 100}%`,
                          width: 10,
                          height: 10,
                          background: '#00ff00',
                          cursor: 'nesw-resize',
                          borderRadius: '50%',
                          transform: 'translate(-50%, -50%)',
                          zIndex: 60
                        }}
                      />
                      <div
                        data-resize-handle="true"
                        onMouseDown={(e) => handleResizeMouseDown(e, bubble, 'top-right')}
                        style={{
                          position: 'absolute',
                          left: `${(bubble.x + bubble.width) * 100}%`,
                          top: `${bubble.y * 100}%`,
                          width: 10,
                          height: 10,
                          background: '#00ff00',
                          cursor: 'nesw-resize',
                          borderRadius: '50%',
                          transform: 'translate(-50%, -50%)',
                          zIndex: 60
                        }}
                      />
                      <div
                        data-resize-handle="true"
                        onMouseDown={(e) => handleResizeMouseDown(e, bubble, 'top-left')}
                        style={{
                          position: 'absolute',
                          left: `${bubble.x * 100}%`,
                          top: `${bubble.y * 100}%`,
                          width: 10,
                          height: 10,
                          background: '#00ff00',
                          cursor: 'nwse-resize',
                          borderRadius: '50%',
                          transform: 'translate(-50%, -50%)',
                          zIndex: 60
                        }}
                      />
                    </>
                  )}

                  {/* Thought bubble trail (ooo circles) */}
                  {bubble.type === 'thought' && bubble.showTail !== false && (() => {
                    const tailBasePos = bubble.tailBaseX ?? 0.5;
                    const tailSide = bubble.tailSide || 'bottom';

                    // Calculate start position based on which side the trail connects to
                    let startX, startY;
                    if (tailSide === 'bottom') {
                      startX = (bubble.x + bubble.width * tailBasePos) * CANVAS_WIDTH;
                      startY = (bubble.y + bubble.height) * CANVAS_HEIGHT;
                    } else if (tailSide === 'top') {
                      startX = (bubble.x + bubble.width * tailBasePos) * CANVAS_WIDTH;
                      startY = bubble.y * CANVAS_HEIGHT;
                    } else if (tailSide === 'left') {
                      startX = bubble.x * CANVAS_WIDTH;
                      startY = (bubble.y + bubble.height * tailBasePos) * CANVAS_HEIGHT;
                    } else { // right
                      startX = (bubble.x + bubble.width) * CANVAS_WIDTH;
                      startY = (bubble.y + bubble.height * tailBasePos) * CANVAS_HEIGHT;
                    }

                    // End at tail tip position
                    const tipX = tailEndX * CANVAS_WIDTH;
                    const tipY = tailEndY * CANVAS_HEIGHT;

                    // Calculate curl for the trail (similar to speech tail)
                    const dx = tipX - startX;
                    const dy = tipY - startY;
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    // Determine curl direction perpendicular to the tail direction
                    let curlAmount = Math.min(distance * 0.3, 30);
                    let perpX, perpY;
                    if (tailSide === 'bottom' || tailSide === 'top') {
                      perpX = dx > 0 ? curlAmount : -curlAmount;
                      perpY = 0;
                    } else {
                      perpX = 0;
                      perpY = dy > 0 ? curlAmount : -curlAmount;
                    }

                    // Control point for quadratic bezier curve
                    const ctrlX = (startX + tipX) / 2 + perpX;
                    const ctrlY = (startY + tipY) / 2 + perpY;

                    // Create 3 circles along the curved path using quadratic bezier interpolation
                    const circles = [];
                    const numCircles = 3;
                    const spacing = 18;

                    for (let i = 0; i < numCircles; i++) {
                      // Calculate t parameter for this circle (fixed distance along curve approximation)
                      const targetDist = (i + 1) * spacing;
                      const t = Math.min(targetDist / Math.max(distance, 1), 0.9);

                      // Quadratic bezier: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
                      const oneMinusT = 1 - t;
                      const cx = oneMinusT * oneMinusT * startX + 2 * oneMinusT * t * ctrlX + t * t * tipX;
                      const cy = oneMinusT * oneMinusT * startY + 2 * oneMinusT * t * ctrlY + t * t * tipY;

                      const radius = 7 - (i * 2); // 7, 5, 3
                      circles.push({ cx, cy, radius });
                    }

                    const borderColor = bubble.borderColor || '#000';
                    const borderWidth = bubble.borderWidth ?? 2;

                    return (
                      <svg
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          width: CANVAS_WIDTH,
                          height: CANVAS_HEIGHT,
                          pointerEvents: 'none',
                          zIndex: 49,
                          overflow: 'visible'
                        }}
                        viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
                      >
                        <defs>
                          <filter id={`roughCircles-${bubble.id}`} x="-20%" y="-20%" width="140%" height="140%">
                            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" result="noise" />
                            <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" xChannelSelector="R" yChannelSelector="G" />
                          </filter>
                        </defs>
                        {circles.map((circle, i) => (
                          <circle
                            key={i}
                            cx={circle.cx}
                            cy={circle.cy}
                            r={circle.radius}
                            fill={bubble.bgTransparent ? 'transparent' : (bubble.bgColor || '#fff')}
                            stroke={bubble.noBorder ? 'none' : borderColor}
                            strokeWidth={borderWidth}
                            filter={`url(#roughCircles-${bubble.id})`}
                          />
                        ))}
                      </svg>
                    );
                  })()}

                  {/* Bubble body - hand-drawn style (for non-speech or speech without tail) */}
                  {!(bubble.type === 'speech' && bubble.showTail !== false) && (
                  <div
                    data-bubble-id={bubble.id}
                    onMouseDown={(e) => handleBubbleMouseDown(e, bubble)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedBubbleId(bubble.id);
                      setEditorMode('bubbles');
                    }}
                    style={{
                      position: 'absolute',
                      left: `${bubble.x * 100}%`,
                      top: `${bubble.y * 100}%`,
                      width: `${bubble.width * 100}%`,
                      height: `${bubble.height * 100}%`,
                      background: bubble.bgTransparent ? 'transparent' : (bubble.bgColor || (bubble.type === 'narration' ? '#fffde7' : '#ffffff')),
                      border: selectedBubbleId === bubble.id ? '3px solid #00ff00' : (bubble.noBorder ? 'none' : `${bubble.borderWidth ?? 2.5}px solid ${bubble.borderColor || '#000'}`),
                      borderRadius: bubble.type === 'thought'
                        ? `${bubble.cornerRadius ?? 50}%`
                        : `${bubble.cornerRadius || 8}px`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '6px 8px',
                      boxSizing: 'border-box',
                      cursor: editorMode === 'bubbles' ? (bubble.locked ? 'default' : (isDraggingBubble ? 'grabbing' : 'grab')) : 'default',
                      zIndex: 50,
                      boxShadow: selectedBubbleId === bubble.id ? '0 0 10px rgba(0,255,0,0.5)' : 'none',
                      // Hand-drawn effect with slight rotation and rough filter
                      transform: `rotate(${(bubble.id.charCodeAt(bubble.id.length - 1) % 5) - 2}deg)`,
                      filter: 'url(#roughEdge)'
                    }}
                  >
                    <span
                      style={{
                        fontFamily: (BUBBLE_FONTS.find(f => f.id === bubble.fontId) || BUBBLE_FONTS[0]).family,
                        fontSize: `${bubble.fontSize}px`,
                        fontWeight: bubble.fontId === 'caveat' ? '700' : 'normal',
                        fontStyle: bubble.italic ? 'italic' : 'normal',
                        color: bubble.textColor || '#000000',
                        textAlign: bubble.textAlign || 'center',
                        width: '100%',
                        wordBreak: 'break-word',
                        lineHeight: 1.3,
                        letterSpacing: bubble.fontId === 'bangers' ? '0.5px' : '0',
                        textTransform: bubble.uppercase ? 'uppercase' : 'none',
                        pointerEvents: 'none',
                        userSelect: 'none',
                        // Counter-rotation for hand-drawn effect + user text angle
                        transform: `rotate(${-((bubble.id.charCodeAt(bubble.id.length - 1) % 5) - 2) + (bubble.textAngle ?? 0)}deg)`,
                        display: 'inline-block'
                      }}
                    >
                      {getBubbleDisplayText(bubble) || (editorMode === 'bubbles' ? '...' : '')}
                    </span>

                    {/* Resize handles (only in bubble mode and when selected) */}
                    {editorMode === 'bubbles' && selectedBubbleId === bubble.id && (
                      <>
                        <div
                          data-resize-handle="true"
                          onMouseDown={(e) => handleResizeMouseDown(e, bubble, 'bottom-right')}
                          style={{
                            position: 'absolute',
                            right: -4,
                            bottom: -4,
                            width: 8,
                            height: 8,
                            background: '#00ff00',
                            cursor: 'nwse-resize',
                            borderRadius: '50%'
                          }}
                        />
                        <div
                          data-resize-handle="true"
                          onMouseDown={(e) => handleResizeMouseDown(e, bubble, 'bottom-left')}
                          style={{
                            position: 'absolute',
                            left: -4,
                            bottom: -4,
                            width: 8,
                            height: 8,
                            background: '#00ff00',
                            cursor: 'nesw-resize',
                            borderRadius: '50%'
                          }}
                        />
                        <div
                          data-resize-handle="true"
                          onMouseDown={(e) => handleResizeMouseDown(e, bubble, 'top-right')}
                          style={{
                            position: 'absolute',
                            right: -4,
                            top: -4,
                            width: 8,
                            height: 8,
                            background: '#00ff00',
                            cursor: 'nesw-resize',
                            borderRadius: '50%'
                          }}
                        />
                        <div
                          data-resize-handle="true"
                          onMouseDown={(e) => handleResizeMouseDown(e, bubble, 'top-left')}
                          style={{
                            position: 'absolute',
                            left: -4,
                            top: -4,
                            width: 8,
                            height: 8,
                            background: '#00ff00',
                            cursor: 'nwse-resize',
                            borderRadius: '50%'
                          }}
                        />
                      </>
                    )}
                  </div>
                  )}

                  {/* Draggable tail tip handle (orange - for tip position) - only for thought bubbles */}
                  {editorMode === 'bubbles' && selectedBubbleId === bubble.id && bubble.type === 'thought' && bubble.showTail !== false && (
                    <div
                      data-tail-handle="true"
                      onMouseDown={(e) => handleTailMouseDown(e, bubble)}
                      style={{
                        position: 'absolute',
                        left: `${tailEndX * 100}%`,
                        top: `${tailEndY * 100}%`,
                        width: 12,
                        height: 12,
                        background: '#ff6600',
                        border: '2px solid #fff',
                        borderRadius: '50%',
                        transform: 'translate(-50%, -50%)',
                        cursor: 'move',
                        zIndex: 60
                      }}
                      title="Drag to move tail tip"
                    />
                  )}

                  {/* Rotation handle (orange - for rotating speech bubble) */}
                  {editorMode === 'bubbles' && selectedBubbleId === bubble.id && bubble.type === 'speech' && bubble.showTail !== false && (() => {
                    const rotation = bubble.rotation ?? 0;
                    const rotRad = (rotation - 90) * Math.PI / 180; // -90 so 0 degrees = bottom
                    const cx = bubble.x + bubble.width / 2;
                    const cy = bubble.y + bubble.height / 2;
                    const handleDistance = bubble.height / 2 + (bubble.tailLength ?? 0.35) * bubble.height + 0.02;
                    const handleX = cx + Math.cos(rotRad) * handleDistance;
                    const handleY = cy + Math.sin(rotRad) * handleDistance;

                    return (
                      <div
                        data-rotation-handle="true"
                        onMouseDown={(e) => handleRotationMouseDown(e, bubble)}
                        style={{
                          position: 'absolute',
                          left: `${handleX * 100}%`,
                          top: `${handleY * 100}%`,
                          width: 14,
                          height: 14,
                          background: '#ff6600',
                          border: '2px solid #fff',
                          borderRadius: '50%',
                          transform: 'translate(-50%, -50%)',
                          cursor: 'grab',
                          zIndex: 60
                        }}
                        title="Drag to rotate bubble"
                      />
                    );
                  })()}

                  {/* Draggable tail base handle (blue - for base position on bubble) - only for thought bubbles */}
                  {editorMode === 'bubbles' && selectedBubbleId === bubble.id && bubble.type === 'thought' && bubble.showTail !== false && (() => {
                    const tailBasePos = bubble.tailBaseX ?? 0.5;
                    const tailSide = bubble.tailSide || 'bottom';

                    // Calculate handle position based on side
                    let handleLeft, handleTop, cursorStyle;
                    if (tailSide === 'bottom') {
                      handleLeft = (bubble.x + bubble.width * tailBasePos) * 100;
                      handleTop = (bubble.y + bubble.height) * 100;
                      cursorStyle = 'ew-resize';
                    } else if (tailSide === 'top') {
                      handleLeft = (bubble.x + bubble.width * tailBasePos) * 100;
                      handleTop = bubble.y * 100;
                      cursorStyle = 'ew-resize';
                    } else if (tailSide === 'left') {
                      handleLeft = bubble.x * 100;
                      handleTop = (bubble.y + bubble.height * tailBasePos) * 100;
                      cursorStyle = 'ns-resize';
                    } else { // right
                      handleLeft = (bubble.x + bubble.width) * 100;
                      handleTop = (bubble.y + bubble.height * tailBasePos) * 100;
                      cursorStyle = 'ns-resize';
                    }

                    return (
                      <div
                        data-tail-base-handle="true"
                        onMouseDown={(e) => handleTailBaseMouseDown(e, bubble)}
                        style={{
                          position: 'absolute',
                          left: `${handleLeft}%`,
                          top: `${handleTop}%`,
                          width: 14,
                          height: 14,
                          background: '#0088ff',
                          border: '2px solid #fff',
                          borderRadius: '50%',
                          transform: 'translate(-50%, -50%)',
                          cursor: cursorStyle,
                          zIndex: 60
                        }}
                        title="Drag to move tail base"
                      />
                    );
                  })()}

                  {/* Draggable tail curve control point 1 (green - for left side curve) - only for thought bubbles */}
                  {editorMode === 'bubbles' && selectedBubbleId === bubble.id && bubble.type === 'thought' && bubble.showTail !== false && (() => {
                    const tailBasePos = bubble.tailBaseX ?? 0.5;
                    const tailSide = bubble.tailSide || 'bottom';
                    const tailWidth = bubble.tailWidth ?? 0.10;
                    const halfWidth = (tailWidth / 2) * (tailSide === 'bottom' || tailSide === 'top' ? bubble.width : bubble.height);

                    let base1X, base1Y;
                    if (tailSide === 'bottom') {
                      base1X = bubble.x + bubble.width * tailBasePos - halfWidth;
                      base1Y = bubble.y + bubble.height;
                    } else if (tailSide === 'top') {
                      base1X = bubble.x + bubble.width * tailBasePos - halfWidth;
                      base1Y = bubble.y;
                    } else if (tailSide === 'left') {
                      base1X = bubble.x;
                      base1Y = bubble.y + bubble.height * tailBasePos - halfWidth;
                    } else {
                      base1X = bubble.x + bubble.width;
                      base1Y = bubble.y + bubble.height * tailBasePos - halfWidth;
                    }

                    const tipX = bubble.x + bubble.width / 2 + (bubble.tailX || 0);
                    const tipY = bubble.y + bubble.height / 2 + (bubble.tailY || 0.15);

                    // Control point position = midpoint + offset
                    const midX = (base1X + tipX) / 2;
                    const midY = (base1Y + tipY) / 2;
                    const ctrlX = midX + (bubble.tailCtrl1X || 0.02);
                    const ctrlY = midY + (bubble.tailCtrl1Y || 0.02);

                    return (
                      <div
                        data-tail-ctrl1-handle="true"
                        onMouseDown={(e) => handleTailCtrl1MouseDown(e, bubble)}
                        style={{
                          position: 'absolute',
                          left: `${ctrlX * 100}%`,
                          top: `${ctrlY * 100}%`,
                          width: 10,
                          height: 10,
                          background: '#00cc66',
                          border: '2px solid #fff',
                          borderRadius: '50%',
                          transform: 'translate(-50%, -50%)',
                          cursor: 'move',
                          zIndex: 61
                        }}
                        title="Drag to curve left side of tail"
                      />
                    );
                  })()}

                  {/* Draggable tail curve control point 2 (purple - for right side curve) - only for thought bubbles */}
                  {editorMode === 'bubbles' && selectedBubbleId === bubble.id && bubble.type === 'thought' && bubble.showTail !== false && (() => {
                    const tailBasePos = bubble.tailBaseX ?? 0.5;
                    const tailSide = bubble.tailSide || 'bottom';
                    const tailWidth = bubble.tailWidth ?? 0.10;
                    const halfWidth = (tailWidth / 2) * (tailSide === 'bottom' || tailSide === 'top' ? bubble.width : bubble.height);

                    let base2X, base2Y;
                    if (tailSide === 'bottom') {
                      base2X = bubble.x + bubble.width * tailBasePos + halfWidth;
                      base2Y = bubble.y + bubble.height;
                    } else if (tailSide === 'top') {
                      base2X = bubble.x + bubble.width * tailBasePos + halfWidth;
                      base2Y = bubble.y;
                    } else if (tailSide === 'left') {
                      base2X = bubble.x;
                      base2Y = bubble.y + bubble.height * tailBasePos + halfWidth;
                    } else {
                      base2X = bubble.x + bubble.width;
                      base2Y = bubble.y + bubble.height * tailBasePos + halfWidth;
                    }

                    const tipX = bubble.x + bubble.width / 2 + (bubble.tailX || 0);
                    const tipY = bubble.y + bubble.height / 2 + (bubble.tailY || 0.15);

                    // Control point position = midpoint + offset
                    const midX = (base2X + tipX) / 2;
                    const midY = (base2Y + tipY) / 2;
                    const ctrlX = midX + (bubble.tailCtrl2X || -0.02);
                    const ctrlY = midY + (bubble.tailCtrl2Y || 0.02);

                    return (
                      <div
                        data-tail-ctrl2-handle="true"
                        onMouseDown={(e) => handleTailCtrl2MouseDown(e, bubble)}
                        style={{
                          position: 'absolute',
                          left: `${ctrlX * 100}%`,
                          top: `${ctrlY * 100}%`,
                          width: 10,
                          height: 10,
                          background: '#9933ff',
                          border: '2px solid #fff',
                          borderRadius: '50%',
                          transform: 'translate(-50%, -50%)',
                          cursor: 'move',
                          zIndex: 61
                        }}
                        title="Drag to curve right side of tail"
                      />
                    );
                  })()}
                </div>
              );
            })}

            {/* Instructions */}
            {editorMode === 'layout' && lines.length === 0 && (
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#666',
                textAlign: 'center',
                padding: '2rem',
                pointerEvents: 'none'
              }}>
                <p style={{ marginBottom: '0.5rem', fontSize: '1.1rem' }}>Drag to draw panel dividers</p>
                <p style={{ fontSize: '0.9rem' }}>Lines snap to edges and other lines</p>
                <p style={{ fontSize: '0.85rem', marginTop: '1rem', color: '#555' }}>
                  Click "Compute Panels" when done
                </p>
              </div>
            )}

            {editorMode === 'bubbles' && bubbles.length === 0 && (
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#666',
                textAlign: 'center',
                padding: '2rem',
                pointerEvents: 'none'
              }}>
                <p style={{ marginBottom: '0.5rem', fontSize: '1.1rem' }}>Click "+ Add Bubble" to start</p>
                <p style={{ fontSize: '0.9rem' }}>Then click on the canvas to place it</p>
                <p style={{ fontSize: '0.85rem', marginTop: '1rem', color: '#555' }}>
                  Select a bubble to edit its text
                </p>
              </div>
            )}
          </div>

          {/* Line count */}
          <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#888' }}>
            {lines.length} lines drawn
            {!panelsComputed && lines.length > 0 && (
              <span style={{ color: '#e94560', marginLeft: '1rem' }}>
                → Click "Compute Panels" to see regions
              </span>
            )}
          </div>

          {/* Layout Preview */}
          {panelsComputed && (
            <div style={{ marginTop: '1rem', padding: '1rem', background: '#fff', borderRadius: '8px', border: '1px solid #ddd', width: '400px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h3 style={{ margin: 0, fontSize: '0.9rem', color: '#666' }}>Layout Description:</h3>
                {customLayoutDescription && (
                  <button
                    onClick={() => setCustomLayoutDescription('')}
                    style={{
                      padding: '0.2rem 0.5rem',
                      fontSize: '0.7rem',
                      background: '#95a5a6',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '3px',
                      cursor: 'pointer'
                    }}
                  >
                    Reset to Auto
                  </button>
                )}
              </div>
              <textarea
                value={customLayoutDescription || layoutDescription}
                onChange={(e) => setCustomLayoutDescription(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '100px',
                  fontSize: '0.85rem',
                  fontFamily: 'monospace',
                  padding: '0.5rem',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  resize: 'vertical',
                  background: customLayoutDescription ? '#fffbeb' : '#f9f9f9'
                }}
                placeholder="Edit layout description..."
              />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
                {customLayoutDescription && (
                  <small style={{ color: '#e67e22', fontSize: '0.75rem' }}>Custom layout description (yellow background)</small>
                )}
                <button
                  onClick={() => {
                    // Regenerate the prompt with current layout description
                    setCustomPrompt(buildFullPrompt());
                    setUseCustomPrompt(true);
                  }}
                  style={{
                    marginLeft: 'auto',
                    padding: '0.3rem 0.6rem',
                    fontSize: '0.75rem',
                    background: '#3498db',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer'
                  }}
                >
                  Update Prompt
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Baked Image Preview */}
        {showBakedPreview && page.bakedImage && (
          <div style={{ marginBottom: '1rem', position: 'relative' }}>
            <button
              onClick={() => setShowBakedPreview(false)}
              style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, background: '#c0392b', color: '#fff', border: 'none', borderRadius: '4px', padding: '0.2rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' }}
            >
              Close
            </button>
            <img
              src={`http://localhost:3001${page.bakedImage}`}
              alt="Baked page"
              style={{
                width: CANVAS_WIDTH,
                height: CANVAS_HEIGHT,
                objectFit: 'contain',
                border: '2px solid #27ae60',
                borderRadius: '4px',
                background: '#fff'
              }}
            />
          </div>
        )}

        {/* Sidebar */}
        <div className="sidebar">
          {/* Preview & Save */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <button
              className="btn btn-secondary"
              onClick={() => setShowPagePreview(true)}
              disabled={!page.masterImage}
              style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', opacity: page.masterImage ? 1 : 0.5 }}
            >
              Preview
            </button>
            <button className="btn btn-primary" onClick={savePage} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
              {isCover ? 'Save Cover' : 'Save Page'}
            </button>
          </div>
          {/* Sidebar Tabs */}
          <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', borderBottom: '2px solid #ddd', paddingBottom: '0.5rem' }}>
            <button
              onClick={() => setSidebarTab('panels')}
              style={{
                padding: '0.5rem 1rem',
                background: sidebarTab === 'panels' ? '#e94560' : '#fff',
                border: '1px solid #ddd',
                borderRadius: '4px',
                color: sidebarTab === 'panels' ? '#fff' : '#333',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: sidebarTab === 'panels' ? 'bold' : 'normal'
              }}
            >
              Panels
            </button>
            <button
              onClick={() => setSidebarTab('prompts')}
              style={{
                padding: '0.5rem 1rem',
                background: sidebarTab === 'prompts' ? '#e94560' : '#fff',
                border: '1px solid #ddd',
                borderRadius: '4px',
                color: sidebarTab === 'prompts' ? '#fff' : '#333',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: sidebarTab === 'prompts' ? 'bold' : 'normal'
              }}
            >
              Prompts
            </button>
            <button
              onClick={() => setSidebarTab('generate')}
              style={{
                padding: '0.5rem 1rem',
                background: sidebarTab === 'generate' ? '#e94560' : '#fff',
                border: '1px solid #ddd',
                borderRadius: '4px',
                color: sidebarTab === 'generate' ? '#fff' : '#333',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: sidebarTab === 'generate' ? 'bold' : 'normal'
              }}
            >
              Generate
            </button>
          </div>

          {/* PANELS TAB */}
          {sidebarTab === 'panels' && (
            <div style={{ maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }}>
              <h2>Panels {panelsComputed ? `(${panels.length})` : ''}</h2>

              {!panelsComputed && (
                <p style={{ color: '#888', fontSize: '0.9rem', marginBottom: '1rem' }}>
                  Draw divider lines, then click "Compute Panels"
                </p>
              )}

          {panelsComputed && panels.map((panel, i) => (
            <div
              key={panel.id}
              className={`panel-list-item ${selectedPanel === panel.id ? 'active' : ''}`}
              onClick={() => {
                setSelectedPanel(panel.id);
                setSelectedLineIndex(null);
              }}
              style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <div style={{ flex: 1 }}>
                <h4>Panel {i + 1}</h4>
                <small style={{ color: '#888' }}>
                  {(panel.tapZone.width * 100).toFixed(0)}% × {(panel.tapZone.height * 100).toFixed(0)}%
                </small>
                {panel.content && (
                  <p style={{
                    fontSize: '0.8rem',
                    color: '#aaa',
                    marginTop: '0.25rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {panel.content.substring(0, 30)}...
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <button
                  onClick={(e) => { e.stopPropagation(); movePanelUp(i); }}
                  disabled={i === 0}
                  style={{
                    padding: '2px 6px',
                    fontSize: '0.7rem',
                    background: i === 0 ? '#ccc' : '#e94560',
                    border: 'none',
                    borderRadius: '3px',
                    color: i === 0 ? '#999' : '#fff',
                    cursor: i === 0 ? 'default' : 'pointer'
                  }}
                >
                  ▲
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); movePanelDown(i); }}
                  disabled={i === panels.length - 1}
                  style={{
                    padding: '2px 6px',
                    fontSize: '0.7rem',
                    background: i === panels.length - 1 ? '#ccc' : '#e94560',
                    border: 'none',
                    borderRadius: '3px',
                    color: i === panels.length - 1 ? '#999' : '#fff',
                    cursor: i === panels.length - 1 ? 'default' : 'pointer'
                  }}
                >
                  ▼
                </button>
              </div>
            </div>
          ))}

          {selectedPanelData && editorMode === 'layout' && (
            <div style={{ marginTop: '1rem', padding: '1rem', background: '#fff', borderRadius: '8px', border: '1px solid #ddd' }}>
              <h3 style={{ marginBottom: '0.5rem', color: '#333' }}>
                Panel {panels.findIndex(p => p.id === selectedPanel) + 1} Content
              </h3>
              <p style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.5rem' }}>
                Describe what happens in this panel
              </p>
              <textarea
                value={selectedPanelData.content || ''}
                onChange={(e) => updatePanelContent(selectedPanel, e.target.value)}
                placeholder="E.g., Close up on Javier's face. Speech bubble: 'I need to rest.'"
                style={{
                  width: '100%',
                  minHeight: '120px',
                  padding: '0.5rem',
                  borderRadius: '4px',
                  border: '1px solid #ddd',
                  background: '#f9f9f9',
                  color: '#333',
                  fontSize: '0.85rem',
                  resize: 'vertical'
                }}
              />
            </div>
          )}

          {/* Bubble Editing Section */}
          {editorMode === 'bubbles' && (
            <div style={{ marginTop: '1rem' }}>
              <h3 style={{ marginBottom: '0.5rem' }}>Bubbles ({bubbles.length})</h3>

              {bubbles.length === 0 && (
                <p style={{ color: '#888', fontSize: '0.9rem' }}>
                  Click on the canvas to add a speech bubble
                </p>
              )}

              {bubbles.map((bubble, i) => (
                <div
                  key={bubble.id}
                  onClick={() => setSelectedBubbleId(bubble.id)}
                  style={{
                    padding: '0.75rem',
                    background: selectedBubbleId === bubble.id ? '#e8f4fc' : '#fff',
                    borderRadius: '8px',
                    marginBottom: '0.5rem',
                    border: selectedBubbleId === bubble.id ? '2px solid #e94560' : '1px solid #ddd',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontWeight: 'bold' }}>Bubble {i + 1} {bubble.locked ? '(locked)' : ''}</span>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); updateBubble(bubble.id, { locked: !bubble.locked }); }}
                        style={{
                          padding: '0.2rem 0.5rem',
                          background: bubble.locked ? '#e67e22' : '#95a5a6',
                          border: 'none',
                          borderRadius: '4px',
                          color: '#fff',
                          cursor: 'pointer',
                          fontSize: '0.75rem'
                        }}
                      >
                        {bubble.locked ? 'Unlock' : 'Lock'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteBubble(bubble.id); }}
                        style={{
                          padding: '0.2rem 0.5rem',
                          background: '#c0392b',
                          border: 'none',
                          borderRadius: '4px',
                          color: '#fff',
                          cursor: 'pointer',
                          fontSize: '0.75rem'
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {selectedBubbleId === bubble.id && (
                    <>
                      {/* Bubble Type */}
                      <div style={{ marginBottom: '0.5rem' }}>
                        <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '0.25rem' }}>
                          Type:
                        </label>
                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                          {['speech', 'thought', 'narration'].map(type => (
                            <button
                              key={type}
                              onClick={(e) => { e.stopPropagation(); updateBubble(bubble.id, { type }); }}
                              style={{
                                padding: '0.3rem 0.6rem',
                                background: bubble.type === type ? '#e94560' : '#ddd',
                                border: 'none',
                                borderRadius: '4px',
                                color: bubble.type === type ? '#fff' : '#333',
                                cursor: 'pointer',
                                fontSize: '0.75rem',
                                textTransform: 'capitalize'
                              }}
                            >
                              {type}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Font Selector */}
                      <div style={{ marginBottom: '0.5rem' }}>
                        <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '0.25rem' }}>
                          Font:
                        </label>
                        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          {BUBBLE_FONTS.map(font => (
                            <button
                              key={font.id}
                              onClick={(e) => { e.stopPropagation(); updateBubble(bubble.id, { fontId: font.id }); }}
                              style={{
                                padding: '0.3rem 0.5rem',
                                background: (bubble.fontId || 'bangers') === font.id ? '#e94560' : '#ddd',
                                border: 'none',
                                borderRadius: '4px',
                                color: (bubble.fontId || 'bangers') === font.id ? '#fff' : '#333',
                                cursor: 'pointer',
                                fontSize: '0.7rem',
                                fontFamily: font.family
                              }}
                            >
                              {font.name}
                            </button>
                          ))}
                          <button
                            onClick={(e) => { e.stopPropagation(); updateBubble(bubble.id, { italic: !bubble.italic }); }}
                            style={{
                              padding: '0.3rem 0.6rem',
                              background: bubble.italic ? '#e94560' : '#ddd',
                              border: 'none',
                              borderRadius: '4px',
                              color: bubble.italic ? '#fff' : '#333',
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              fontStyle: 'italic',
                              fontWeight: 'bold'
                            }}
                          >
                            I
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); updateBubble(bubble.id, { uppercase: !(bubble.uppercase !== false) }); }}
                            style={{
                              padding: '0.3rem 0.5rem',
                              background: bubble.uppercase !== false ? '#e94560' : '#ddd',
                              border: 'none',
                              borderRadius: '4px',
                              color: bubble.uppercase !== false ? '#fff' : '#333',
                              cursor: 'pointer',
                              fontSize: '0.7rem',
                              fontWeight: 'bold'
                            }}
                          >
                            AA
                          </button>
                          <span style={{ borderLeft: '1px solid #ccc', height: '20px', margin: '0 0.25rem' }} />
                          {['left', 'center', 'right'].map((align) => (
                            <button
                              key={align}
                              onClick={(e) => { e.stopPropagation(); updateBubble(bubble.id, { textAlign: align }); }}
                              style={{
                                padding: '0.3rem 0.5rem',
                                background: (bubble.textAlign || 'center') === align ? '#e94560' : '#ddd',
                                border: 'none',
                                borderRadius: '4px',
                                color: (bubble.textAlign || 'center') === align ? '#fff' : '#333',
                                cursor: 'pointer',
                                fontSize: '0.7rem'
                              }}
                              title={`Align ${align}`}
                            >
                              {align === 'left' ? '⫷' : align === 'center' ? '⫶' : '⫸'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Colors */}
                      <div style={{ marginBottom: '0.5rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div>
                          <label style={{ fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: '0.2rem' }}>
                            Background
                          </label>
                          <input
                            type="color"
                            value={bubble.bgColor || '#ffffff'}
                            onChange={(e) => updateBubble(bubble.id, { bgColor: e.target.value, bgTransparent: false })}
                            onClick={(e) => e.stopPropagation()}
                            disabled={bubble.bgTransparent}
                            style={{
                              width: '40px',
                              height: '28px',
                              border: '1px solid #ccc',
                              borderRadius: '4px',
                              cursor: bubble.bgTransparent ? 'not-allowed' : 'pointer',
                              opacity: bubble.bgTransparent ? 0.4 : 1
                            }}
                          />
                        </div>
                        <label style={{ fontSize: '0.75rem', color: '#666', display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.2rem' }}>
                          <input
                            type="checkbox"
                            checked={bubble.bgTransparent || false}
                            onChange={(e) => updateBubble(bubble.id, { bgTransparent: e.target.checked })}
                            onClick={(e) => e.stopPropagation()}
                          />
                          No fill
                        </label>
                        <label style={{ fontSize: '0.75rem', color: '#666', display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.2rem' }}>
                          <input
                            type="checkbox"
                            checked={bubble.noBorder || false}
                            onChange={(e) => updateBubble(bubble.id, { noBorder: e.target.checked })}
                            onClick={(e) => e.stopPropagation()}
                          />
                          No border
                        </label>
                        <div style={{ opacity: bubble.noBorder ? 0.4 : 1 }}>
                          <label style={{ fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: '0.2rem' }}>
                            Border
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            <input
                              type="color"
                              value={bubble.borderColor || '#000000'}
                              onChange={(e) => updateBubble(bubble.id, { borderColor: e.target.value })}
                              onClick={(e) => e.stopPropagation()}
                              disabled={bubble.noBorder}
                              style={{ width: '32px', height: '24px', border: '1px solid #ccc', borderRadius: '4px', cursor: bubble.noBorder ? 'not-allowed' : 'pointer' }}
                            />
                            <input
                              type="range"
                              min="1"
                              max="6"
                              step="0.5"
                              value={bubble.borderWidth ?? 2.5}
                              onChange={(e) => updateBubble(bubble.id, { borderWidth: parseFloat(e.target.value) })}
                              onClick={(e) => e.stopPropagation()}
                              disabled={bubble.noBorder}
                              style={{ width: '50px', cursor: bubble.noBorder ? 'not-allowed' : 'pointer' }}
                            />
                            <span style={{ fontSize: '0.7rem', color: '#888', minWidth: '20px' }}>{bubble.borderWidth ?? 2.5}</span>
                          </div>
                        </div>
                        <div>
                          <label style={{ fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: '0.2rem' }}>
                            Text
                          </label>
                          <input
                            type="color"
                            value={bubble.textColor || '#000000'}
                            onChange={(e) => updateBubble(bubble.id, { textColor: e.target.value })}
                            onClick={(e) => e.stopPropagation()}
                            style={{ width: '40px', height: '28px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}
                          />
                        </div>
                      </div>

                      {/* Sentences */}
                      <div style={{ marginBottom: '0.5rem' }}>
                        <label style={{ fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: '0.25rem' }}>
                          Sentences ({(bubble.sentences || []).length}):
                        </label>

                        {(bubble.sentences || []).map((sentence, sIdx) => (
                          <div key={sentence.id} style={{
                            background: '#f5f5f5',
                            borderRadius: '4px',
                            padding: '0.5rem',
                            marginBottom: '0.5rem',
                            border: '1px solid #ddd'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                              <span style={{ fontSize: '0.75rem', color: '#888' }}>Sentence {sIdx + 1}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); removeSentence(bubble.id, sentence.id); }}
                                style={{
                                  padding: '0.15rem 0.4rem',
                                  background: '#c0392b',
                                  border: 'none',
                                  borderRadius: '3px',
                                  color: '#fff',
                                  cursor: 'pointer',
                                  fontSize: '0.7rem'
                                }}
                              >
                                ×
                              </button>
                            </div>

                            {/* Translate from English */}
                            <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.25rem' }}>
                              <input
                                type="text"
                                value={translateInput[sentence.id] || ''}
                                onChange={(e) => setTranslateInput(prev => ({ ...prev, [sentence.id]: e.target.value }))}
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && translateInput[sentence.id]) {
                                    e.preventDefault();
                                    translateText(bubble.id, sentence.id, translateInput[sentence.id]);
                                  }
                                }}
                                placeholder="Type in English..."
                                style={{
                                  flex: 1,
                                  padding: '0.4rem',
                                  borderRadius: '3px',
                                  border: '1px solid #27ae60',
                                  background: '#e8f8f0',
                                  color: '#333',
                                  fontSize: '0.85rem'
                                }}
                              />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  translateText(bubble.id, sentence.id, translateInput[sentence.id]);
                                }}
                                disabled={translatingText[sentence.id] || !translateInput[sentence.id]}
                                style={{
                                  padding: '0.4rem 0.6rem',
                                  fontSize: '0.75rem',
                                  background: translatingText[sentence.id] ? '#95a5a6' : '#27ae60',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: '3px',
                                  cursor: translatingText[sentence.id] ? 'wait' : 'pointer',
                                  whiteSpace: 'nowrap'
                                }}
                                title="Translate English to Spanish"
                              >
                                {translatingText[sentence.id] ? '...' : 'Translate'}
                              </button>
                            </div>

                            <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                              {['[slowly]', '[whispering]', '[shouting]', '[frightened]', '[surprised]', '[amazed]', '[sad]', '[hopeful]', '[worried]', '[excited]', '[pause]'].map(tag => {
                                const tagKey = `${sentence.id}-${tag}`;
                                const isCopied = copiedTag === tagKey;
                                return (
                                <button
                                  key={tag}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(tag);
                                    setCopiedTag(tagKey);
                                    setTimeout(() => setCopiedTag(prev => prev === tagKey ? null : prev), 600);
                                  }}
                                  style={{
                                    padding: '0.15rem 0.4rem',
                                    fontSize: '0.7rem',
                                    background: isCopied ? '#27ae60' : '#f0f0f0',
                                    color: isCopied ? '#fff' : '#666',
                                    border: `1px solid ${isCopied ? '#27ae60' : '#ddd'}`,
                                    borderRadius: '3px',
                                    cursor: 'pointer',
                                    fontFamily: 'monospace',
                                    transition: 'all 0.15s ease'
                                  }}
                                  title={`Copy ${tag} to clipboard`}
                                >
                                  {tag}
                                </button>
                                );
                              })}
                            </div>

                            <input
                              type="text"
                              value={sentence.text}
                              onChange={(e) => updateSentence(bubble.id, sentence.id, { text: e.target.value })}
                              onClick={(e) => e.stopPropagation()}
                              placeholder="Text (Spanish)"
                              style={{
                                width: '100%',
                                padding: '0.4rem',
                                borderRadius: '3px',
                                border: '1px solid #ccc',
                                background: '#fff',
                                color: '#333',
                                fontSize: '0.85rem',
                                marginBottom: '0.25rem'
                              }}
                            />
                            <input
                              type="text"
                              value={sentence.translation}
                              onChange={(e) => updateSentence(bubble.id, sentence.id, { translation: e.target.value })}
                              onClick={(e) => e.stopPropagation()}
                              placeholder="Translation (English)"
                              style={{
                                width: '100%',
                                padding: '0.4rem',
                                borderRadius: '3px',
                                border: '1px solid #ccc',
                                background: '#fff',
                                color: '#333',
                                fontSize: '0.85rem',
                                marginBottom: '0.25rem'
                              }}
                            />

                            {/* Audio Generation */}
                            <div style={{
                              background: '#e8f4f8',
                              borderRadius: '4px',
                              padding: '0.5rem',
                              marginBottom: '0.25rem',
                              border: '1px solid #b8d4e3'
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                                <span style={{ fontSize: '0.7rem', color: '#2980b9', fontWeight: 'bold' }}>Audio</span>
                                {sentence.audioUrl && (
                                  <span style={{ fontSize: '0.65rem', color: '#27ae60' }}>Saved</span>
                                )}
                              </div>

                              {/* Voice selector (collapsed by default, shown when needed) */}
                              {(comic.voices || []).length === 0 ? (
                                <p style={{ fontSize: '0.7rem', color: '#e74c3c', margin: '0 0 0.4rem 0' }}>
                                  No voices configured. Go to Comic Editor → Voices tab to add voices.
                                </p>
                              ) : (
                                <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                                  <select
                                    value={selectedVoiceId}
                                    onChange={(e) => { e.stopPropagation(); setSelectedVoiceId(e.target.value); }}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                      flex: 1,
                                      minWidth: '100px',
                                      padding: '0.25rem',
                                      fontSize: '0.7rem',
                                      borderRadius: '3px',
                                      border: '1px solid #ccc'
                                    }}
                                  >
                                    <option value="">Select voice...</option>
                                    {(comic.voices || []).map((voice, idx) => (
                                      <option key={`${voice.voiceId}-${idx}`} value={voice.voiceId}>
                                        {voice.name}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    value={audioModel}
                                    onChange={(e) => { e.stopPropagation(); setAudioModel(e.target.value); }}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                      padding: '0.25rem',
                                      fontSize: '0.7rem',
                                      borderRadius: '3px',
                                      border: '1px solid #ccc'
                                    }}
                                  >
                                    <option value="eleven_v3">V3 (Best)</option>
                                    <option value="eleven_multilingual_v2">Multilingual V2</option>
                                    <option value="eleven_turbo_v2_5">Turbo V2.5</option>
                                  </select>
                                </div>
                              )}

                              {/* Action buttons */}
                              <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    enhanceText(bubble.id, sentence.id, sentence.text);
                                  }}
                                  disabled={enhancingText[sentence.id] || !sentence.text}
                                  style={{
                                    padding: '0.25rem 0.5rem',
                                    fontSize: '0.65rem',
                                    background: enhancingText[sentence.id] ? '#95a5a6' : '#9b59b6',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '3px',
                                    cursor: enhancingText[sentence.id] ? 'wait' : 'pointer'
                                  }}
                                  title="Add audio tags like [excited], [whispers] to enhance delivery"
                                >
                                  {enhancingText[sentence.id] ? '...' : 'Enhance'}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    generateAudio(bubble.id, sentence.id, sentence.text);
                                  }}
                                  disabled={generatingAudio[sentence.id] || !sentence.text || !selectedVoiceId}
                                  style={{
                                    padding: '0.25rem 0.5rem',
                                    fontSize: '0.65rem',
                                    background: generatingAudio[sentence.id] ? '#95a5a6' : '#3498db',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '3px',
                                    cursor: generatingAudio[sentence.id] ? 'wait' : 'pointer'
                                  }}
                                >
                                  {generatingAudio[sentence.id] ? 'Generating...' : 'Generate'}
                                </button>

                                {audioPreview[sentence.id] && (
                                  <>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        audioPreview[sentence.id]?.isPlaying
                                          ? stopAudio(sentence.id)
                                          : playAudio(sentence.id);
                                      }}
                                      style={{
                                        padding: '0.25rem 0.5rem',
                                        fontSize: '0.65rem',
                                        background: audioPreview[sentence.id]?.isPlaying ? '#e74c3c' : '#2ecc71',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: '3px',
                                        cursor: 'pointer'
                                      }}
                                    >
                                      {audioPreview[sentence.id]?.isPlaying ? 'Stop' : 'Play'}
                                    </button>
                                    <button
                                      disabled={savingAudio[sentence.id]}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const panelIdx = panels.findIndex(p => {
                                          const cx = bubble.x + bubble.width / 2;
                                          const cy = bubble.y + bubble.height / 2;
                                          return cx >= p.tapZone.x && cx <= p.tapZone.x + p.tapZone.width &&
                                                 cy >= p.tapZone.y && cy <= p.tapZone.y + p.tapZone.height;
                                        });
                                        saveAudio(bubble.id, sentence.id, page.pageNumber, panelIdx + 1);
                                      }}
                                      style={{
                                        padding: '0.25rem 0.5rem',
                                        fontSize: '0.65rem',
                                        background: savingAudio[sentence.id] ? '#95a5a6' : '#27ae60',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: '3px',
                                        cursor: savingAudio[sentence.id] ? 'wait' : 'pointer'
                                      }}
                                    >
                                      {savingAudio[sentence.id] ? 'Saving...' : 'Save'}
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Words */}
                            <div style={{ marginTop: '0.25rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                <span style={{ fontSize: '0.7rem', color: '#888' }}>Words ({(sentence.words || []).length})</span>
                                <div style={{ display: 'flex', gap: '0.25rem' }}>
                                  {(sentence.words || []).some(w => !w.meaning) && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); fillDictionary(bubble.id, sentence.id); }}
                                      style={{
                                        padding: '0.15rem 0.4rem',
                                        background: '#3498db',
                                        border: 'none',
                                        borderRadius: '3px',
                                        color: '#fff',
                                        cursor: 'pointer',
                                        fontSize: '0.65rem'
                                      }}
                                    >
                                      Fill Dictionary
                                    </button>
                                  )}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); addWord(bubble.id, sentence.id); }}
                                    style={{
                                      padding: '0.15rem 0.4rem',
                                      background: '#27ae60',
                                      border: 'none',
                                      borderRadius: '3px',
                                      color: '#fff',
                                      cursor: 'pointer',
                                      fontSize: '0.65rem'
                                    }}
                                  >
                                    + Manual
                                  </button>
                                </div>
                              </div>

                              {/* Clickable words - Spanish */}
                              {sentence.text && (
                                <div style={{ marginBottom: '0.3rem', padding: '0.3rem', background: '#fff8e1', borderRadius: '3px', border: '1px solid #ffe082' }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <span style={{ fontSize: '0.6rem', color: '#f57f17', display: 'block', marginBottom: '0.15rem' }}>Click word or select phrase:</span>
                                  <span style={{ fontSize: '0.75rem', lineHeight: '1.6' }}
                                    onMouseUp={(e) => {
                                      const selection = window.getSelection();
                                      const selected = selection?.toString().trim();
                                      if (selected && selected.length > 0 && selected.includes(' ')) {
                                        wordLookup(bubble.id, sentence.id, selected, sentence.text, sentence.translation);
                                        selection.removeAllRanges();
                                      }
                                    }}
                                  >
                                    {sentence.text.split(/(\s+)/).map((part, i) => {
                                      if (/^\s+$/.test(part)) return <span key={i}>{part}</span>;
                                      const isLooking = lookingUpWord[`${sentence.id}-${part}`];
                                      return (
                                        <span
                                          key={i}
                                          onClick={() => wordLookup(bubble.id, sentence.id, part, sentence.text, sentence.translation)}
                                          style={{
                                            cursor: isLooking ? 'wait' : 'pointer',
                                            color: '#e65100',
                                            borderBottom: '1px dashed #ffab40',
                                            padding: '0 1px',
                                            opacity: isLooking ? 0.5 : 1
                                          }}
                                        >
                                          {part}
                                        </span>
                                      );
                                    })}
                                  </span>
                                </div>
                              )}

                              {/* Clickable words - English */}
                              {sentence.translation && (
                                <div style={{ marginBottom: '0.3rem', padding: '0.3rem', background: '#e8f5e9', borderRadius: '3px', border: '1px solid #a5d6a7' }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <span style={{ fontSize: '0.6rem', color: '#2e7d32', display: 'block', marginBottom: '0.15rem' }}>Click word or select phrase:</span>
                                  <span style={{ fontSize: '0.75rem', lineHeight: '1.6' }}
                                    onMouseUp={(e) => {
                                      const selection = window.getSelection();
                                      const selected = selection?.toString().trim();
                                      if (selected && selected.length > 0 && selected.includes(' ')) {
                                        wordLookup(bubble.id, sentence.id, selected, sentence.text, sentence.translation);
                                        selection.removeAllRanges();
                                      }
                                    }}
                                  >
                                    {sentence.translation.split(/(\s+)/).map((part, i) => {
                                      if (/^\s+$/.test(part)) return <span key={i}>{part}</span>;
                                      const isLooking = lookingUpWord[`${sentence.id}-${part}`];
                                      return (
                                        <span
                                          key={i}
                                          onClick={() => wordLookup(bubble.id, sentence.id, part, sentence.text, sentence.translation)}
                                          style={{
                                            cursor: isLooking ? 'wait' : 'pointer',
                                            color: '#1b5e20',
                                            borderBottom: '1px dashed #66bb6a',
                                            padding: '0 1px',
                                            opacity: isLooking ? 0.5 : 1
                                          }}
                                        >
                                          {part}
                                        </span>
                                      );
                                    })}
                                  </span>
                                </div>
                              )}

                              {(sentence.words || []).map((word, wIdx) => (
                                <div key={word.id} style={{
                                  display: 'flex',
                                  gap: '0.25rem',
                                  marginBottom: '0.25rem',
                                  alignItems: 'center',
                                  minWidth: 0
                                }}>
                                  <input
                                    type="text"
                                    value={word.text}
                                    onChange={(e) => updateWord(bubble.id, sentence.id, word.id, { text: e.target.value })}
                                    onClick={(e) => e.stopPropagation()}
                                    placeholder="Word"
                                    style={{
                                      flex: 1,
                                      minWidth: 0,
                                      padding: '0.25rem',
                                      borderRadius: '2px',
                                      border: '1px solid #ccc',
                                      fontSize: '0.75rem'
                                    }}
                                  />
                                  <input
                                    type="text"
                                    value={word.meaning}
                                    onChange={(e) => updateWord(bubble.id, sentence.id, word.id, { meaning: e.target.value })}
                                    onClick={(e) => e.stopPropagation()}
                                    placeholder="Meaning"
                                    style={{
                                      flex: 1,
                                      minWidth: 0,
                                      padding: '0.25rem',
                                      borderRadius: '2px',
                                      border: '1px solid #ccc',
                                      fontSize: '0.75rem'
                                    }}
                                  />
                                  <input
                                    type="text"
                                    value={word.baseForm}
                                    onChange={(e) => updateWord(bubble.id, sentence.id, word.id, { baseForm: e.target.value })}
                                    onClick={(e) => e.stopPropagation()}
                                    placeholder="Base"
                                    style={{
                                      flex: 1,
                                      minWidth: 0,
                                      padding: '0.25rem',
                                      borderRadius: '2px',
                                      border: '1px solid #ccc',
                                      fontSize: '0.75rem'
                                    }}
                                  />
                                  <label
                                    onClick={(e) => e.stopPropagation()}
                                    title="Include in Vocabulary Quiz"
                                    style={{ display: 'flex', alignItems: 'center', flexShrink: 0, cursor: 'pointer', gap: '1px' }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={word.vocabQuiz || false}
                                      onChange={(e) => updateWord(bubble.id, sentence.id, word.id, { vocabQuiz: e.target.checked })}
                                      style={{ margin: 0, cursor: 'pointer' }}
                                    />
                                    <span style={{ fontSize: '0.6rem', color: '#666' }}>Q</span>
                                  </label>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); removeWord(bubble.id, sentence.id, word.id); }}
                                    style={{
                                      padding: '0.15rem 0.3rem',
                                      marginRight: '0.25rem',
                                      background: '#c0392b',
                                      border: 'none',
                                      borderRadius: '2px',
                                      color: '#fff',
                                      cursor: 'pointer',
                                      fontSize: '0.65rem',
                                      flexShrink: 0
                                    }}
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}

                        <button
                          onClick={(e) => { e.stopPropagation(); addSentence(bubble.id); }}
                          style={{
                            padding: '0.3rem 0.6rem',
                            background: '#3498db',
                            border: 'none',
                            borderRadius: '3px',
                            color: '#fff',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            width: '100%'
                          }}
                        >
                          + Add Sentence
                        </button>
                      </div>

                      {/* Font Size */}
                      <div style={{ marginBottom: '0.5rem' }}>
                        <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '0.25rem' }}>
                          Font Size: {bubble.fontSize}px
                        </label>
                        <input
                          type="range"
                          min="10"
                          max="32"
                          value={bubble.fontSize}
                          onChange={(e) => updateBubble(bubble.id, { fontSize: parseInt(e.target.value) })}
                          onClick={(e) => e.stopPropagation()}
                          style={{ width: '100%' }}
                        />
                      </div>

                      {/* Corner Radius (shape) */}
                      <div style={{ marginBottom: '0.5rem' }}>
                        <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '0.25rem' }}>
                          Shape: {bubble.type === 'thought'
                            ? `${bubble.cornerRadius ?? 50}% (20=rounded rect, 50=oval)`
                            : `${bubble.cornerRadius || 8}px (0=square, 200=round)`}
                        </label>
                        <input
                          type="range"
                          min={bubble.type === 'thought' ? 20 : 0}
                          max={bubble.type === 'thought' ? 50 : 200}
                          value={bubble.type === 'thought' ? (bubble.cornerRadius ?? 50) : (bubble.cornerRadius || 8)}
                          onChange={(e) => updateBubble(bubble.id, { cornerRadius: parseInt(e.target.value) })}
                          onClick={(e) => e.stopPropagation()}
                          style={{ width: '100%' }}
                        />
                      </div>

                      {/* Show/Hide Tail (for speech and thought bubbles) */}
                      {(bubble.type === 'speech' || bubble.type === 'thought') && (
                        <div style={{ marginBottom: '0.5rem' }}>
                          <label style={{ fontSize: '0.8rem', color: '#888', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <input
                              type="checkbox"
                              checked={bubble.showTail !== false}
                              onChange={(e) => updateBubble(bubble.id, { showTail: e.target.checked })}
                              onClick={(e) => e.stopPropagation()}
                            />
                            Show {bubble.type === 'thought' ? 'bubbles' : 'tail'}
                          </label>
                        </div>
                      )}

                      {/* Sound effect (no audio) */}
                      <div style={{ marginBottom: '0.5rem' }}>
                        <label style={{ fontSize: '0.8rem', color: '#888', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <input
                            type="checkbox"
                            checked={bubble.isSoundEffect || false}
                            onChange={(e) => updateBubble(bubble.id, { isSoundEffect: e.target.checked })}
                            onClick={(e) => e.stopPropagation()}
                          />
                          Sound effect (no audio)
                        </label>
                        {bubble.isSoundEffect && (
                          <p style={{ fontSize: '0.7rem', color: '#666', marginTop: '0.25rem', marginLeft: '1.5rem' }}>
                            Text like CREAK, BANG, etc. - won't generate TTS
                          </p>
                        )}
                      </div>

                      {/* Tail Controls (for speech bubbles) */}
                      {bubble.type === 'speech' && bubble.showTail !== false && (
                        <>
                          {/* Bubble Angle */}
                          <div style={{ marginBottom: '0.5rem' }}>
                            <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '0.25rem' }}>
                              Bubble Angle: {Math.round(bubble.rotation ?? 0)}°
                            </label>
                            <input
                              type="range"
                              min="0"
                              max="360"
                              value={Math.round(bubble.rotation ?? 0)}
                              onChange={(e) => updateBubble(bubble.id, { rotation: parseInt(e.target.value) })}
                              onClick={(e) => e.stopPropagation()}
                              style={{ width: '100%' }}
                            />
                          </div>

                          {/* Tail Length */}
                          <div style={{ marginBottom: '0.5rem' }}>
                            <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '0.25rem' }}>
                              Tail Length: {Math.round((bubble.tailLength ?? 0.35) * 100)}%
                            </label>
                            <input
                              type="range"
                              min="10"
                              max="100"
                              value={Math.round((bubble.tailLength ?? 0.35) * 100)}
                              onChange={(e) => updateBubble(bubble.id, { tailLength: parseInt(e.target.value) / 100 })}
                              onClick={(e) => e.stopPropagation()}
                              style={{ width: '100%' }}
                            />
                          </div>

                          {/* Tail Width */}
                          <div style={{ marginBottom: '0.5rem' }}>
                            <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '0.25rem' }}>
                              Tail Width: {Math.round((bubble.tailWidth ?? 0.25) * 100)}%
                            </label>
                            <input
                              type="range"
                              min="10"
                              max="50"
                              value={Math.round((bubble.tailWidth ?? 0.25) * 100)}
                              onChange={(e) => updateBubble(bubble.id, { tailWidth: parseInt(e.target.value) / 100 })}
                              onClick={(e) => e.stopPropagation()}
                              style={{ width: '100%' }}
                            />
                          </div>

                          {/* Tail Angle */}
                          <div style={{ marginBottom: '0.5rem' }}>
                            <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '0.25rem' }}>
                              Tail Angle: {Math.round((bubble.tailCurve ?? 0) * 100)}% {(bubble.tailCurve ?? 0) > 0 ? '(right)' : (bubble.tailCurve ?? 0) < 0 ? '(left)' : '(center)'}
                            </label>
                            <input
                              type="range"
                              min="-100"
                              max="100"
                              value={Math.round((bubble.tailCurve ?? 0) * 100)}
                              onChange={(e) => updateBubble(bubble.id, { tailCurve: parseInt(e.target.value) / 100 })}
                              onClick={(e) => e.stopPropagation()}
                              style={{ width: '100%' }}
                            />
                          </div>

                          {/* Tail Bend */}
                          <div style={{ marginBottom: '0.5rem' }}>
                            <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '0.25rem' }}>
                              Tail Bend: {Math.round((bubble.tailBend ?? 0) * 100)}% {(bubble.tailBend ?? 0) > 0 ? '(right)' : (bubble.tailBend ?? 0) < 0 ? '(left)' : '(straight)'}
                            </label>
                            <input
                              type="range"
                              min="-100"
                              max="100"
                              value={Math.round((bubble.tailBend ?? 0) * 100)}
                              onChange={(e) => updateBubble(bubble.id, { tailBend: parseInt(e.target.value) / 100 })}
                              onClick={(e) => e.stopPropagation()}
                              style={{ width: '100%' }}
                            />
                          </div>
                        </>
                      )}

                      {/* Text Angle (for all bubble types) */}
                      <div style={{ marginBottom: '0.5rem' }}>
                        <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '0.25rem' }}>
                          Text Angle: {bubble.textAngle ?? 0}°
                        </label>
                        <input
                          type="range"
                          min="-45"
                          max="45"
                          value={bubble.textAngle ?? 0}
                          onChange={(e) => updateBubble(bubble.id, { textAngle: parseInt(e.target.value) })}
                          onClick={(e) => e.stopPropagation()}
                          style={{ width: '100%' }}
                        />
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
            </div>
          )}

          {/* PROMPTS TAB */}
          {sidebarTab === 'prompts' && (
            <div style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ color: '#333' }}>Prompt Settings</h2>
                <button
                  className="btn btn-primary"
                  onClick={savePromptSettings}
                  style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
                >
                  Save Settings
                </button>
              </div>

              {/* Style Bible */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ fontSize: '0.95rem', color: '#e94560', fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }}>
                  Style Bible
                </label>
                <textarea
                  value={promptSettings.styleBible || ''}
                  onChange={(e) => updatePromptSetting('styleBible', e.target.value)}
                  placeholder="Visual style instructions..."
                  style={{
                    width: '100%',
                    minHeight: '150px',
                    padding: '0.75rem',
                    borderRadius: '4px',
                    border: '1px solid #ccc',
                    background: '#fff',
                    color: '#333',
                    fontSize: '0.9rem',
                    fontFamily: 'monospace',
                    resize: 'vertical'
                  }}
                />
              </div>

              {/* Camera + Inks */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ fontSize: '0.95rem', color: '#e94560', fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }}>
                  Camera + Inks
                </label>
                <textarea
                  value={promptSettings.cameraInks || ''}
                  onChange={(e) => updatePromptSetting('cameraInks', e.target.value)}
                  placeholder="Lighting, composition, ink style..."
                  style={{
                    width: '100%',
                    minHeight: '100px',
                    padding: '0.75rem',
                    borderRadius: '4px',
                    border: '1px solid #ccc',
                    background: '#fff',
                    color: '#333',
                    fontSize: '0.9rem',
                    fontFamily: 'monospace',
                    resize: 'vertical'
                  }}
                />
              </div>

              {/* Characters */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ fontSize: '0.95rem', color: '#e94560', fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }}>
                  Characters ({(promptSettings.characters || []).length})
                </label>

                {(promptSettings.characters || []).map((char) => (
                  <div key={char.id} style={{ background: '#fff', borderRadius: '4px', padding: '0.75rem', marginBottom: '0.75rem', border: '1px solid #ccc' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <input
                        type="text"
                        value={char.name}
                        onChange={(e) => updateCharacter(char.id, 'name', e.target.value)}
                        placeholder="Name"
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          borderRadius: '3px',
                          border: '1px solid #ccc',
                          background: '#fff',
                          color: '#333',
                          fontSize: '0.9rem',
                          fontWeight: 'bold'
                        }}
                      />
                      <button
                        onClick={() => removeCharacter(char.id)}
                        style={{ padding: '0.5rem 0.75rem', background: '#c0392b', border: 'none', borderRadius: '3px', color: '#fff', cursor: 'pointer', fontSize: '0.8rem' }}
                      >
                        Remove
                      </button>
                    </div>
                    <textarea
                      value={char.description}
                      onChange={(e) => updateCharacter(char.id, 'description', e.target.value)}
                      placeholder="Description (age, build, features, clothing...)"
                      style={{
                        width: '100%',
                        minHeight: '80px',
                        padding: '0.5rem',
                        borderRadius: '3px',
                        border: '1px solid #ccc',
                        background: '#fff',
                        color: '#333',
                        fontSize: '0.85rem',
                        fontFamily: 'monospace',
                        resize: 'vertical'
                      }}
                    />
                  </div>
                ))}

                {/* Add new character */}
                <div style={{ background: '#f9f9f9', borderRadius: '4px', padding: '0.75rem', border: '2px dashed #ccc' }}>
                  <input
                    type="text"
                    value={newCharacter.name}
                    onChange={(e) => setNewCharacter(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="New character name"
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '3px',
                      border: '1px solid #ccc',
                      background: '#fff',
                      color: '#333',
                      fontSize: '0.9rem',
                      marginBottom: '0.5rem'
                    }}
                  />
                  <textarea
                    value={newCharacter.description}
                    onChange={(e) => setNewCharacter(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Description..."
                    style={{
                      width: '100%',
                      minHeight: '60px',
                      padding: '0.5rem',
                      borderRadius: '3px',
                      border: '1px solid #ccc',
                      background: '#fff',
                      color: '#333',
                      fontSize: '0.85rem',
                      marginBottom: '0.5rem',
                      resize: 'vertical'
                    }}
                  />
                  <button
                    onClick={addCharacter}
                    style={{ padding: '0.5rem 1rem', background: '#27ae60', border: 'none', borderRadius: '3px', color: '#fff', cursor: 'pointer', fontSize: '0.85rem' }}
                  >
                    + Add Character
                  </button>
                </div>
              </div>

              {/* Cover Content - show for cover only */}
              {isCover && (
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ fontSize: '0.95rem', color: '#e94560', fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }}>
                  Cover Content
                </label>
                <textarea
                  value={panels[0]?.content || ''}
                  onChange={(e) => {
                    const updated = [...panels];
                    if (updated[0]) {
                      updated[0] = { ...updated[0], content: e.target.value };
                      setPanels(updated);
                    }
                  }}
                  placeholder="Describe the cover image (characters, scene, composition, text/title placement...)"
                  style={{
                    width: '100%',
                    minHeight: '150px',
                    padding: '0.75rem',
                    borderRadius: '4px',
                    border: '1px solid #ccc',
                    background: '#fff',
                    color: '#333',
                    fontSize: '0.9rem',
                    fontFamily: 'monospace',
                    resize: 'vertical'
                  }}
                />
              </div>
              )}

              {/* Panel Contents - show for regular pages */}
              {!isCover && (
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ fontSize: '0.95rem', color: '#e94560', fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }}>
                  Panel Contents ({panels.length})
                </label>
                {panels.length === 0 ? (
                  <p style={{ color: '#888', fontSize: '0.85rem' }}>
                    Compute panels first to add content
                  </p>
                ) : (
                  panels.map((panel, i) => (
                    <div key={panel.id} style={{ marginBottom: '1rem', padding: '0.75rem', background: '#f9f9f9', borderRadius: '8px', border: '1px solid #eee' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <label style={{ fontSize: '0.85rem', color: '#666', fontWeight: 'bold' }}>
                          Panel {i + 1}
                          <span style={{ fontWeight: 'normal', marginLeft: '0.5rem', color: '#999' }}>
                            ({(panel.tapZone.width * 100).toFixed(0)}% × {(panel.tapZone.height * 100).toFixed(0)}%)
                          </span>
                        </label>
                        <button
                          onClick={() => generatePanelImage(panel, i)}
                          disabled={panelImages[panel.id]?.generating || !panel.content?.trim()}
                          style={{
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.75rem',
                            background: panelImages[panel.id]?.generating ? '#95a5a6' : panel.content?.trim() ? '#27ae60' : '#ccc',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: panelImages[panel.id]?.generating || !panel.content?.trim() ? 'not-allowed' : 'pointer'
                          }}
                        >
                          {panelImages[panel.id]?.generating ? '⏳ Generating...' : '🎨 Generate Panel'}
                        </button>
                      </div>
                      <textarea
                        value={panel.content || ''}
                        onChange={(e) => updatePanelContent(panel.id, e.target.value)}
                        placeholder={`Describe what happens in panel ${i + 1}...`}
                        style={{
                          width: '100%',
                          minHeight: '80px',
                          padding: '0.5rem',
                          borderRadius: '4px',
                          border: '1px solid #ccc',
                          background: '#fff',
                          color: '#333',
                          fontSize: '0.85rem',
                          resize: 'vertical'
                        }}
                      />
                      {/* Panel image preview */}
                      {panelImages[panel.id]?.path && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <img
                            src={`http://localhost:3001${panelImages[panel.id].path}`}
                            alt={`Panel ${i + 1}`}
                            style={{
                              width: '100%',
                              maxHeight: '150px',
                              objectFit: 'contain',
                              borderRadius: '4px',
                              border: '1px solid #ddd'
                            }}
                          />
                        </div>
                      )}
                      {panelImages[panel.id]?.error && (
                        <p style={{ color: '#e74c3c', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                          Error: {panelImages[panel.id].error}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
              )}

              {/* Global Do Not */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ fontSize: '0.95rem', color: '#e94560', fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }}>
                  Global Do Not
                </label>
                <textarea
                  value={promptSettings.globalDoNot || ''}
                  onChange={(e) => updatePromptSetting('globalDoNot', e.target.value)}
                  placeholder="Things to avoid..."
                  style={{
                    width: '100%',
                    minHeight: '80px',
                    padding: '0.75rem',
                    borderRadius: '4px',
                    border: '1px solid #ccc',
                    background: '#fff',
                    color: '#333',
                    fontSize: '0.9rem',
                    fontFamily: 'monospace',
                    resize: 'vertical'
                  }}
                />
              </div>

              {/* Hard Negatives */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ fontSize: '0.95rem', color: '#e94560', fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }}>
                  Hard Negatives
                </label>
                <textarea
                  value={promptSettings.hardNegatives || ''}
                  onChange={(e) => updatePromptSetting('hardNegatives', e.target.value)}
                  placeholder="Strict negatives..."
                  style={{
                    width: '100%',
                    minHeight: '80px',
                    padding: '0.75rem',
                    borderRadius: '4px',
                    border: '1px solid #ccc',
                    background: '#fff',
                    color: '#333',
                    fontSize: '0.9rem',
                    fontFamily: 'monospace',
                    resize: 'vertical'
                  }}
                />
              </div>

              {/* Update Prompt Button */}
              <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#e8f4fc', borderRadius: '8px', border: '1px solid #b8d4e3' }}>
                <p style={{ fontSize: '0.85rem', color: '#555', marginBottom: '0.75rem' }}>
                  After editing panel descriptions or settings, click below to regenerate the compiled prompt:
                </p>
                <button
                  onClick={() => {
                    setCustomPrompt(buildFullPrompt());
                    setUseCustomPrompt(true);
                    setSidebarTab('generate');
                  }}
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '0.75rem' }}
                >
                  Update & View Compiled Prompt
                </button>
              </div>

              </div>
          )}

          {/* GENERATE TAB */}
          {sidebarTab === 'generate' && (
            <div>
              <h2 style={{ marginBottom: '1rem' }}>Generate {isCover ? 'Cover' : 'Page'} Image</h2>

              {!panelsComputed || panels.length === 0 ? (
                <p style={{ color: '#888', fontSize: '0.9rem' }}>
                  {isCover
                    ? 'Add cover content in the Prompts tab first'
                    : 'Please compute panels first (switch to Panels tab and click "Compute Panels")'}
                </p>
              ) : (
                <>
                  {/* Panel Content Summary */}
                  <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#fff', borderRadius: '4px', border: '1px solid #ddd' }}>
                    <h4 style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.5rem' }}>{isCover ? 'Cover' : 'Panel'} Content:</h4>
                    {panels.map((panel, i) => (
                      <div key={panel.id} style={{ fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                        <strong>{isCover ? 'Cover' : `Panel ${i + 1}`}:</strong> {panel.content ? panel.content.substring(0, 50) + '...' : <span style={{ color: '#666' }}>(empty)</span>}
                      </div>
                    ))}
                  </div>

                  {/* Additional Instructions */}
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ fontSize: '0.85rem', color: '#888', display: 'block', marginBottom: '0.25rem' }}>
                      Additional Instructions (optional):
                    </label>
                    <textarea
                      value={additionalInstructions}
                      onChange={(e) => setAdditionalInstructions(e.target.value)}
                      placeholder="Any extra instructions for this specific generation..."
                      style={{
                        width: '100%',
                        minHeight: '60px',
                        padding: '0.5rem',
                        borderRadius: '4px',
                        border: '1px solid #ddd',
                        background: '#f9f9f9',
                        color: '#333',
                        fontSize: '0.85rem',
                        resize: 'vertical'
                      }}
                    />
                  </div>

                  {/* Generation Mode Tabs - hide for cover (only one panel) */}
                  {!isCover && (
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                      <button
                        onClick={() => setShowCompositePreview(false)}
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          fontSize: '0.8rem',
                          background: !showCompositePreview ? '#e94560' : '#ddd',
                          color: !showCompositePreview ? 'white' : '#666',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                      >
                        Full Page (Single Image)
                      </button>
                      <button
                        onClick={() => setShowCompositePreview(true)}
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          fontSize: '0.8rem',
                          background: showCompositePreview ? '#e94560' : '#ddd',
                          color: showCompositePreview ? 'white' : '#666',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                      >
                        Panel by Panel
                      </button>
                    </div>
                  </div>
                  )}

                  {/* Full Page Mode */}
                  {!showCompositePreview && (
                    <>
                      {/* Buttons */}
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                        <button
                          className="btn btn-secondary"
                          onClick={() => setShowPromptPreview(!showPromptPreview)}
                          style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                        >
                          {showPromptPreview ? 'Hide Prompt' : 'Preview Prompt'}
                        </button>
                        <button
                          className="btn btn-primary"
                          onClick={generatePageImage}
                          disabled={isGenerating}
                          style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                        >
                          {isGenerating ? 'Generating...' : 'Generate Full Page'}
                        </button>
                      </div>
                    </>
                  )}

                  {/* Panel by Panel Mode */}
                  {showCompositePreview && (
                    <div style={{ marginBottom: '1rem' }}>
                      <p style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.75rem' }}>
                        Generate each panel separately for better layout control. Individual panel images will be composited into the final page.
                      </p>

                      {/* Panel Generation Status */}
                      <div style={{ marginBottom: '0.75rem', padding: '0.5rem', background: '#f9f9f9', borderRadius: '4px' }}>
                        {panels.map((panel, i) => {
                          const panelData = panelImages[panel.id];
                          return (
                            <div key={panel.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', fontSize: '0.8rem' }}>
                              <span style={{ width: '60px' }}>Panel {i + 1}:</span>
                              {panelData?.generating ? (
                                <span style={{ color: '#f39c12' }}>Generating...</span>
                              ) : panelData?.path ? (
                                <span style={{ color: '#27ae60' }}>Ready</span>
                              ) : panelData?.error ? (
                                <span style={{ color: '#e74c3c' }}>Error</span>
                              ) : panel.content?.trim() ? (
                                <span style={{ color: '#666' }}>Pending</span>
                              ) : (
                                <span style={{ color: '#999' }}>No content</span>
                              )}
                              <button
                                onClick={() => generatePanelImage(panel, i)}
                                disabled={panelData?.generating || !panel.content?.trim()}
                                style={{
                                  marginLeft: 'auto',
                                  padding: '0.15rem 0.4rem',
                                  fontSize: '0.7rem',
                                  background: panelData?.generating ? '#95a5a6' : '#3498db',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '3px',
                                  cursor: panelData?.generating || !panel.content?.trim() ? 'not-allowed' : 'pointer'
                                }}
                              >
                                {panelData?.path ? 'Regenerate' : 'Generate'}
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      {/* Batch Generate Button */}
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                        <button
                          onClick={generateAllPanels}
                          disabled={generatingAllPanels || panels.every(p => !p.content?.trim())}
                          style={{
                            padding: '0.5rem 1rem',
                            fontSize: '0.85rem',
                            background: generatingAllPanels ? '#95a5a6' : '#27ae60',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: generatingAllPanels || panels.every(p => !p.content?.trim()) ? 'not-allowed' : 'pointer'
                          }}
                        >
                          {generatingAllPanels ? 'Generating All...' : 'Generate All Panels'}
                        </button>
                        <button
                          onClick={async () => {
                            await compositePageFromPanels();
                          }}
                          disabled={!panels.some(p => panelImages[p.id]?.path)}
                          style={{
                            padding: '0.5rem 1rem',
                            fontSize: '0.85rem',
                            background: panels.some(p => panelImages[p.id]?.path) ? '#9b59b6' : '#ccc',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: panels.some(p => panelImages[p.id]?.path) ? 'pointer' : 'not-allowed'
                          }}
                        >
                          Preview Composite
                        </button>
                        <button
                          onClick={saveCompositedImage}
                          disabled={!panels.some(p => panelImages[p.id]?.path)}
                          style={{
                            padding: '0.5rem 1rem',
                            fontSize: '0.85rem',
                            background: panels.some(p => panelImages[p.id]?.path) ? '#e94560' : '#ccc',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: panels.some(p => panelImages[p.id]?.path) ? 'pointer' : 'not-allowed'
                          }}
                        >
                          Save Composite as Page
                        </button>
                      </div>

                      {/* Composite Canvas */}
                      <canvas
                        ref={compositeCanvasRef}
                        style={{
                          width: '100%',
                          maxHeight: '400px',
                          objectFit: 'contain',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          background: '#fff'
                        }}
                      />

                      {/* Crop Controls for each panel */}
                      {panels.some(p => panelImages[p.id]?.path) && (
                        <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#f9f9f9', borderRadius: '4px', border: '1px solid #eee' }}>
                          <h4 style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.5rem' }}>Panel Fit & Position</h4>
                          {panels.map((panel, i) => {
                            const panelData = panelImages[panel.id];
                            if (!panelData?.path) return null;

                            return (
                              <div key={panel.id} style={{ marginBottom: '0.75rem', padding: '0.5rem', background: '#fff', borderRadius: '4px', border: '1px solid #ddd' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                  <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#333', minWidth: '55px' }}>Panel {i + 1}</span>
                                  <button
                                    onClick={() => {
                                      setPanelImages(prev => ({
                                        ...prev,
                                        [panel.id]: { ...prev[panel.id], fitMode: 'stretch' }
                                      }));
                                      setTimeout(() => compositePageFromPanels(), 50);
                                    }}
                                    style={{
                                      padding: '0.2rem 0.5rem',
                                      fontSize: '0.7rem',
                                      background: (panelData?.fitMode || 'stretch') === 'stretch' ? '#3498db' : '#ddd',
                                      color: (panelData?.fitMode || 'stretch') === 'stretch' ? 'white' : '#666',
                                      border: 'none',
                                      borderRadius: '3px',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    Stretch
                                  </button>
                                  <button
                                    onClick={() => {
                                      setPanelImages(prev => ({
                                        ...prev,
                                        [panel.id]: { ...prev[panel.id], fitMode: 'crop', cropX: prev[panel.id]?.cropX ?? 0, cropY: prev[panel.id]?.cropY ?? 0, zoom: prev[panel.id]?.zoom ?? 1 }
                                      }));
                                      setTimeout(() => compositePageFromPanels(), 50);
                                    }}
                                    style={{
                                      padding: '0.2rem 0.5rem',
                                      fontSize: '0.7rem',
                                      background: panelData?.fitMode === 'crop' ? '#3498db' : '#ddd',
                                      color: panelData?.fitMode === 'crop' ? 'white' : '#666',
                                      border: 'none',
                                      borderRadius: '3px',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    Crop
                                  </button>
                                </div>
                                {/* Crop position sliders - only show when in crop mode */}
                                {panelData?.fitMode === 'crop' && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                      <span style={{ fontSize: '0.7rem', color: '#666', width: '55px' }}>Horizontal:</span>
                                      <input
                                        type="range"
                                        min="-100"
                                        max="100"
                                        value={(panelData?.cropX ?? 0) * 100}
                                        onChange={(e) => {
                                          setPanelImages(prev => ({
                                            ...prev,
                                            [panel.id]: { ...prev[panel.id], cropX: parseInt(e.target.value) / 100 }
                                          }));
                                          setTimeout(() => compositePageFromPanels(), 50);
                                        }}
                                        style={{ flex: 1 }}
                                      />
                                      <span style={{ fontSize: '0.65rem', color: '#999', width: '35px' }}>
                                        {Math.round((panelData?.cropX ?? 0) * 100)}%
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                      <span style={{ fontSize: '0.7rem', color: '#666', width: '55px' }}>Vertical:</span>
                                      <input
                                        type="range"
                                        min="-100"
                                        max="100"
                                        value={(panelData?.cropY ?? 0) * 100}
                                        onChange={(e) => {
                                          setPanelImages(prev => ({
                                            ...prev,
                                            [panel.id]: { ...prev[panel.id], cropY: parseInt(e.target.value) / 100 }
                                          }));
                                          setTimeout(() => compositePageFromPanels(), 50);
                                        }}
                                        style={{ flex: 1 }}
                                      />
                                      <span style={{ fontSize: '0.65rem', color: '#999', width: '35px' }}>
                                        {Math.round((panelData?.cropY ?? 0) * 100)}%
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                      <span style={{ fontSize: '0.7rem', color: '#666', width: '55px' }}>Zoom:</span>
                                      <input
                                        type="range"
                                        min="100"
                                        max="300"
                                        step="10"
                                        value={(panelData?.zoom ?? 1) * 100}
                                        onChange={(e) => {
                                          setPanelImages(prev => ({
                                            ...prev,
                                            [panel.id]: { ...prev[panel.id], zoom: parseInt(e.target.value) / 100 }
                                          }));
                                          setTimeout(() => compositePageFromPanels(), 50);
                                        }}
                                        style={{ flex: 1 }}
                                      />
                                      <span style={{ fontSize: '0.65rem', color: '#999', width: '35px' }}>
                                        {Math.round((panelData?.zoom ?? 1) * 100)}%
                                      </span>
                                    </div>
                                    <button
                                      onClick={() => {
                                        setPanelImages(prev => ({
                                          ...prev,
                                          [panel.id]: { ...prev[panel.id], cropX: 0, cropY: 0, zoom: 1 }
                                        }));
                                        setTimeout(() => compositePageFromPanels(), 50);
                                      }}
                                      style={{
                                        padding: '0.15rem 0.4rem',
                                        fontSize: '0.65rem',
                                        background: '#95a5a6',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '3px',
                                        cursor: 'pointer',
                                        alignSelf: 'flex-start'
                                      }}
                                    >
                                      Reset All
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Full Page Mode: Prompt Preview, Error, Generated Image */}
                  {!showCompositePreview && (
                    <>
                      {/* Prompt Preview */}
                      {showPromptPreview && (
                        <div style={{ marginBottom: '1rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                            <h4 style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>Full Prompt:</h4>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: '#666' }}>
                              <input
                                type="checkbox"
                                checked={useCustomPrompt}
                                onChange={(e) => {
                                  setUseCustomPrompt(e.target.checked);
                                  if (e.target.checked && !customPrompt) {
                                    setCustomPrompt(buildFullPrompt());
                                  }
                                }}
                              />
                              Edit manually
                            </label>
                          </div>
                          {useCustomPrompt ? (
                            <>
                              <textarea
                                value={customPrompt}
                                onChange={(e) => setCustomPrompt(e.target.value)}
                                style={{
                                  width: '100%',
                                  minHeight: '300px',
                                  padding: '1rem',
                                  borderRadius: '4px',
                                  fontSize: '0.75rem',
                                  fontFamily: 'monospace',
                                  color: '#333',
                                  border: '1px solid #27ae60',
                                  background: '#f0fff0',
                                  resize: 'vertical'
                                }}
                              />
                              <button
                                onClick={() => setCustomPrompt(buildFullPrompt())}
                                style={{
                                  marginTop: '0.5rem',
                                  padding: '0.4rem 0.8rem',
                                  fontSize: '0.75rem',
                                  background: '#95a5a6',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: 'pointer'
                                }}
                              >
                                Reset to Generated
                              </button>
                            </>
                          ) : (
                            <pre style={{
                              background: '#f9f9f9',
                              padding: '1rem',
                              borderRadius: '4px',
                              fontSize: '0.75rem',
                              whiteSpace: 'pre-wrap',
                              maxHeight: '300px',
                              overflow: 'auto',
                              color: '#333',
                              border: '1px solid #ddd'
                            }}>
                              {buildFullPrompt()}
                            </pre>
                          )}
                        </div>
                      )}

                      {/* Error */}
                      {generationError && (
                        <div style={{
                          marginBottom: '1rem',
                          padding: '0.75rem',
                          background: 'rgba(192, 57, 43, 0.2)',
                          border: '1px solid #c0392b',
                          borderRadius: '4px',
                          color: '#e74c3c',
                          fontSize: '0.85rem'
                        }}>
                          Error: {generationError}
                        </div>
                      )}

                      {/* Generated Image */}
                      {generatedImage && (
                        <div>
                          <h4 style={{ marginBottom: '0.5rem' }}>Generated Image:</h4>
                          <img
                            src={`http://localhost:3001${generatedImage.path}`}
                            alt="Generated page"
                            style={{
                              width: '100%',
                              borderRadius: '4px',
                              border: '1px solid #ddd'
                            }}
                          />
                          <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
                            <button
                              className="btn btn-primary"
                              onClick={saveGeneratedImage}
                              style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                            >
                              Save as Page Image
                            </button>
                            <button
                              className="btn btn-secondary"
                              onClick={generatePageImage}
                              disabled={isGenerating}
                              style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                            >
                              Regenerate
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* ChatGPT Panel */}
        <div className="chat-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', color: '#333' }}>ChatGPT</h3>
            <button
              onClick={clearChat}
              style={{
                padding: '0.25rem 0.5rem',
                fontSize: '0.7rem',
                background: '#95a5a6',
                color: '#fff',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer'
              }}
            >
              Clear
            </button>
          </div>

          {/* Messages */}
          <div className="chat-messages">
            {chatMessages.length === 0 && (
              <div style={{ color: '#888', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 1rem' }}>
                <p>Start a conversation with ChatGPT</p>
                <p style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>You can upload images or share your generated page</p>
              </div>
            )}
            {chatMessages.map((msg, idx) => (
              <div key={idx} className={`chat-message ${msg.role}`}>
                {msg.images && msg.images.length > 0 && (
                  <div style={{ marginBottom: '0.5rem' }}>
                    {msg.images.map((img, imgIdx) => (
                      <img key={imgIdx} src={img} alt="Uploaded" style={{ maxHeight: '100px' }} />
                    ))}
                  </div>
                )}
                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content || '[No content]'}</div>
              </div>
            ))}
            {isSendingChat && (
              <div className="chat-message assistant" style={{ fontStyle: 'italic' }}>
                Thinking...
              </div>
            )}
            <div ref={chatMessagesEndRef} />
          </div>

          {/* Pending images */}
          {chatImages.length > 0 && (
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
              {chatImages.map((img, idx) => (
                <div key={idx} style={{ position: 'relative' }}>
                  <img src={img.preview} alt={img.name} style={{ height: '50px', borderRadius: '4px', border: '1px solid #ddd' }} />
                  <button
                    onClick={() => removeChatImage(idx)}
                    style={{
                      position: 'absolute',
                      top: '-5px',
                      right: '-5px',
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: '#c0392b',
                      color: '#fff',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '10px',
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

          {/* Input area */}
          <div className="chat-input-area">
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendChatMessage();
                }
              }}
              placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
              rows={3}
              disabled={isSendingChat}
            />
            <div className="chat-buttons">
              <button
                onClick={sendChatMessage}
                disabled={isSendingChat || (!chatInput.trim() && chatImages.length === 0)}
                style={{
                  padding: '0.4rem 1rem',
                  background: isSendingChat ? '#95a5a6' : '#e94560',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: isSendingChat ? 'wait' : 'pointer',
                  fontSize: '0.85rem'
                }}
              >
                {isSendingChat ? 'Sending...' : 'Send'}
              </button>
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
                  padding: '0.4rem 0.75rem',
                  background: '#3498db',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.85rem'
                }}
              >
                Upload Image
              </button>
              <button
                onClick={uploadGeneratedImageToChat}
                disabled={isSendingChat || !generatedImage?.path}
                style={{
                  padding: '0.4rem 0.75rem',
                  background: generatedImage?.path ? '#27ae60' : '#95a5a6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: generatedImage?.path ? 'pointer' : 'not-allowed',
                  fontSize: '0.85rem'
                }}
                title={generatedImage?.path ? 'Add generated image to chat' : 'Generate an image first'}
              >
                Add Generated
              </button>
              <button
                onClick={() => setChatInput(prev => prev + (prev ? '\n\n' : '') + buildFullPrompt())}
                disabled={isSendingChat}
                style={{
                  padding: '0.4rem 0.75rem',
                  background: '#9b59b6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.85rem'
                }}
                title="Add the full prompt to chat input"
              >
                Add Prompt
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Shared preview content: used by both Preview modal and off-screen Bake target */}
      {(() => {
        const previewContent = (ref) => (
          <div
            ref={ref}
            style={{
              position: 'relative',
              width: CANVAS_WIDTH,
              height: CANVAS_HEIGHT,
              background: '#fff',
              overflow: 'hidden'
            }}
          >
            {page.masterImage && (
              <img
                src={`http://localhost:3001${page.masterImage}`}
                alt="Page preview"
                crossOrigin="anonymous"
                style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover' }}
              />
            )}
            <svg width="0" height="0" style={{ position: 'absolute' }}>
              <defs>
                <filter id={ref === bakeTargetRef ? 'roughEdgeBake' : 'roughEdgePreview'} x="-5%" y="-5%" width="110%" height="110%">
                  <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" result="noise" />
                  <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" xChannelSelector="R" yChannelSelector="G" />
                </filter>
              </defs>
            </svg>
            {bubbles.map((bubble) => {
              const bubbleCenterX = bubble.x + bubble.width / 2;
              const bubbleCenterY = bubble.y + bubble.height / 2;
              const tailEndX = bubbleCenterX + (bubble.tailX || 0);
              const tailEndY = bubbleCenterY + (bubble.tailY || 0);
              const filtSuffix = ref === bakeTargetRef ? 'Bake' : 'Preview';
              return (
                <div key={bubble.id}>
                  {bubble.type === 'speech' && bubble.showTail !== false && (() => {
                    const bx = bubble.x * CANVAS_WIDTH;
                    const by = bubble.y * CANVAS_HEIGHT;
                    const bw = bubble.width * CANVAS_WIDTH;
                    const bh = bubble.height * CANVAS_HEIGHT;
                    const r = Math.min(bubble.cornerRadius || 8, bw / 2, bh / 2);
                    const borderWidthVal = bubble.borderWidth ?? 2.5;
                    const borderColorVal = bubble.borderColor || '#000';
                    const cx = bx + bw / 2;
                    const cy = by + bh / 2;
                    const rotation = bubble.rotation ?? 0;
                    const tailWidth = (bubble.tailWidth ?? 0.25) * bw;
                    const halfTailWidth = tailWidth / 2;
                    const tailLength = (bubble.tailLength ?? 0.35) * bh;
                    const tailCurve = bubble.tailCurve ?? 0;
                    const angleOffset = tailCurve * tailLength * 1.5;
                    const tailBend = bubble.tailBend ?? 0;
                    const bendOffset = tailBend * tailLength * 0.8;
                    const tipX = cx + angleOffset;
                    const tipY = by + bh + tailLength;
                    const ctrl1X = cx + halfTailWidth * 0.3 + angleOffset * 0.5 + bendOffset;
                    const ctrl1Y = by + bh + tailLength * 0.5;
                    const ctrl2X = cx - halfTailWidth * 0.3 + angleOffset * 0.5 + bendOffset;
                    const ctrl2Y = by + bh + tailLength * 0.5;
                    const isVeryRound = r >= Math.min(bw, bh) * 0.4;
                    const tailRightX = Math.min(cx + halfTailWidth, bx + bw - r - 2);
                    const tailLeftX = Math.max(cx - halfTailWidth, bx + r + 2);
                    let path;
                    if (isVeryRound) {
                      const ellipseRx = bw / 2;
                      const ellipseRy = bh / 2;
                      const tailConnectRight = Math.min(halfTailWidth, ellipseRx * 0.6);
                      const tailConnectLeft = Math.min(halfTailWidth, ellipseRx * 0.6);
                      const yOffsetRight = ellipseRy * Math.sqrt(1 - Math.pow(tailConnectRight / ellipseRx, 2));
                      const yOffsetLeft = ellipseRy * Math.sqrt(1 - Math.pow(tailConnectLeft / ellipseRx, 2));
                      const connectRightY = cy + yOffsetRight;
                      const connectLeftY = cy + yOffsetLeft;
                      path = `M ${cx} ${by} A ${ellipseRx} ${ellipseRy} 0 0 1 ${cx + tailConnectRight} ${connectRightY} C ${cx + tailConnectRight} ${connectRightY + tailLength * 0.2}, ${ctrl1X} ${ctrl1Y}, ${tipX} ${tipY} C ${ctrl2X} ${ctrl2Y}, ${cx - tailConnectLeft} ${connectLeftY + tailLength * 0.2}, ${cx - tailConnectLeft} ${connectLeftY} A ${ellipseRx} ${ellipseRy} 0 1 1 ${cx} ${by} Z`;
                    } else {
                      path = `M ${bx + r} ${by} L ${bx + bw - r} ${by} A ${r} ${r} 0 0 1 ${bx + bw} ${by + r} L ${bx + bw} ${by + bh - r} A ${r} ${r} 0 0 1 ${bx + bw - r} ${by + bh} L ${tailRightX} ${by + bh} C ${ctrl1X} ${ctrl1Y}, ${tipX + halfTailWidth * 0.2} ${tipY - tailLength * 0.15}, ${tipX} ${tipY} C ${tipX - halfTailWidth * 0.2} ${tipY - tailLength * 0.15}, ${ctrl2X} ${ctrl2Y}, ${tailLeftX} ${by + bh} L ${bx + r} ${by + bh} A ${r} ${r} 0 0 1 ${bx} ${by + bh - r} L ${bx} ${by + r} A ${r} ${r} 0 0 1 ${bx + r} ${by} Z`;
                    }
                    return (
                      <>
                        <svg style={{ position: 'absolute', left: 0, top: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT, pointerEvents: 'none', zIndex: 50, overflow: 'visible' }} viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}>
                          <defs>
                            <filter id={`roughBubble${filtSuffix}-${bubble.id}`} x="-50%" y="-50%" width="200%" height="200%">
                              <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" result="noise" />
                              <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" xChannelSelector="R" yChannelSelector="G" />
                            </filter>
                          </defs>
                          <g transform={`rotate(${rotation} ${cx} ${cy})`}>
                            <path d={path} fill={bubble.bgTransparent ? 'transparent' : (bubble.bgColor || '#fff')} stroke={bubble.noBorder ? 'none' : borderColorVal} strokeWidth={borderWidthVal} strokeLinejoin="round" filter={`url(#roughBubble${filtSuffix}-${bubble.id})`} />
                          </g>
                        </svg>
                        <div style={{
                          position: 'absolute',
                          left: bx,
                          top: by,
                          width: bw,
                          height: bh,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '6px 8px',
                          boxSizing: 'border-box',
                          zIndex: 51,
                          pointerEvents: 'none'
                        }}>
                          <span style={{
                            fontFamily: (BUBBLE_FONTS.find(f => f.id === bubble.fontId) || BUBBLE_FONTS[0]).family,
                            fontSize: `${bubble.fontSize}px`,
                            fontWeight: bubble.fontId === 'caveat' ? '700' : 'normal',
                            fontStyle: bubble.italic ? 'italic' : 'normal',
                            color: bubble.textColor || '#000000',
                            textAlign: bubble.textAlign || 'center',
                            width: '100%',
                            wordBreak: 'break-word',
                            lineHeight: 1.3,
                            letterSpacing: bubble.fontId === 'bangers' ? '0.5px' : '0',
                            textTransform: bubble.uppercase ? 'uppercase' : 'none',
                            transform: `rotate(${bubble.textAngle ?? 0}deg)`,
                            display: 'inline-block'
                          }}>
                            {getBubbleDisplayText(bubble)}
                          </span>
                        </div>
                      </>
                    );
                  })()}
                  {bubble.type === 'thought' && bubble.showTail !== false && (() => {
                    const tailBasePos = bubble.tailBaseX ?? 0.5;
                    const tailSide = bubble.tailSide || 'bottom';
                    let startX, startY;
                    if (tailSide === 'bottom') { startX = (bubble.x + bubble.width * tailBasePos) * CANVAS_WIDTH; startY = (bubble.y + bubble.height) * CANVAS_HEIGHT; }
                    else if (tailSide === 'top') { startX = (bubble.x + bubble.width * tailBasePos) * CANVAS_WIDTH; startY = bubble.y * CANVAS_HEIGHT; }
                    else if (tailSide === 'left') { startX = bubble.x * CANVAS_WIDTH; startY = (bubble.y + bubble.height * tailBasePos) * CANVAS_HEIGHT; }
                    else { startX = (bubble.x + bubble.width) * CANVAS_WIDTH; startY = (bubble.y + bubble.height * tailBasePos) * CANVAS_HEIGHT; }
                    const tipX = tailEndX * CANVAS_WIDTH;
                    const tipY = tailEndY * CANVAS_HEIGHT;
                    const dx = tipX - startX;
                    const dy = tipY - startY;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    let curlAmount = Math.min(distance * 0.3, 30);
                    let perpX = 0, perpY = 0;
                    if (tailSide === 'bottom' || tailSide === 'top') { perpX = dx > 0 ? curlAmount : -curlAmount; }
                    else { perpY = dy > 0 ? curlAmount : -curlAmount; }
                    const ctrlX = (startX + tipX) / 2 + perpX;
                    const ctrlY = (startY + tipY) / 2 + perpY;
                    const circles = [];
                    for (let i = 0; i < 3; i++) {
                      const t = Math.min(((i + 1) * 18) / Math.max(distance, 1), 0.9);
                      const oneMinusT = 1 - t;
                      const ccx = oneMinusT * oneMinusT * startX + 2 * oneMinusT * t * ctrlX + t * t * tipX;
                      const ccy = oneMinusT * oneMinusT * startY + 2 * oneMinusT * t * ctrlY + t * t * tipY;
                      circles.push({ cx: ccx, cy: ccy, radius: 7 - (i * 2) });
                    }
                    const borderColor = bubble.borderColor || '#000';
                    const borderWidth = bubble.borderWidth ?? 2;
                    return (
                      <svg style={{ position: 'absolute', left: 0, top: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT, pointerEvents: 'none', zIndex: 49, overflow: 'visible' }} viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}>
                        <defs>
                          <filter id={`roughCircles${filtSuffix}-${bubble.id}`} x="-20%" y="-20%" width="140%" height="140%">
                            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" result="noise" />
                            <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" xChannelSelector="R" yChannelSelector="G" />
                          </filter>
                        </defs>
                        {circles.map((circle, i) => (
                          <circle key={i} cx={circle.cx} cy={circle.cy} r={circle.radius} fill={bubble.bgTransparent ? 'transparent' : (bubble.bgColor || '#fff')} stroke={bubble.noBorder ? 'none' : borderColor} strokeWidth={borderWidth} filter={`url(#roughCircles${filtSuffix}-${bubble.id})`} />
                        ))}
                      </svg>
                    );
                  })()}
                  {!(bubble.type === 'speech' && bubble.showTail !== false) && (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${bubble.x * 100}%`,
                      top: `${bubble.y * 100}%`,
                      width: `${bubble.width * 100}%`,
                      height: `${bubble.height * 100}%`,
                      background: bubble.bgTransparent ? 'transparent' : (bubble.bgColor || (bubble.type === 'narration' ? '#fffde7' : '#ffffff')),
                      border: bubble.noBorder ? 'none' : `${bubble.borderWidth ?? 2.5}px solid ${bubble.borderColor || '#000'}`,
                      borderRadius: bubble.type === 'thought' ? `${bubble.cornerRadius ?? 50}%` : `${bubble.cornerRadius || 8}px`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '6px 8px',
                      boxSizing: 'border-box',
                      zIndex: 50,
                      transform: `rotate(${(bubble.id.charCodeAt(bubble.id.length - 1) % 5) - 2}deg)`,
                      filter: `url(#roughEdge${filtSuffix})`
                    }}
                  >
                    <span style={{
                      fontFamily: (BUBBLE_FONTS.find(f => f.id === bubble.fontId) || BUBBLE_FONTS[0]).family,
                      fontSize: `${bubble.fontSize}px`,
                      fontWeight: bubble.fontId === 'caveat' ? '700' : 'normal',
                      fontStyle: bubble.italic ? 'italic' : 'normal',
                      color: bubble.textColor || '#000000',
                      textAlign: bubble.textAlign || 'center',
                      width: '100%',
                      wordBreak: 'break-word',
                      lineHeight: 1.3,
                      letterSpacing: bubble.fontId === 'bangers' ? '0.5px' : '0',
                      textTransform: bubble.uppercase ? 'uppercase' : 'none',
                      transform: `rotate(${-((bubble.id.charCodeAt(bubble.id.length - 1) % 5) - 2) + (bubble.textAngle ?? 0)}deg)`,
                      display: 'inline-block'
                    }}>
                      {getBubbleDisplayText(bubble)}
                    </span>
                  </div>
                  )}
                </div>
              );
            })}
          </div>
        );

        return (
          <>
            {/* Off-screen bake target (rendered when baking) */}
            {isBaking && (
              <div style={{ position: 'fixed', left: 0, top: 0, opacity: 0, pointerEvents: 'none', zIndex: -1 }}>
                {previewContent(bakeTargetRef)}
              </div>
            )}

            {/* Page Preview Modal */}
            {showPagePreview && (
              <div
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem' }}
                onClick={() => setShowPagePreview(false)}
              >
                <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => setShowPagePreview(false)}
                    style={{ position: 'absolute', top: -40, right: 0, background: '#fff', border: 'none', borderRadius: '4px', padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.9rem' }}
                  >
                    Close Preview
                  </button>
                  {previewContent(null)}
                </div>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}

export default PageEditor;

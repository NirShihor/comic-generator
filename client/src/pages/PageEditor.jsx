import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import html2canvas from 'html2canvas';

// Ref image helpers — backward compat with plain string entries
const getRefPath = (ref) => typeof ref === 'string' ? ref : ref.path;
const getRefAnnotations = (ref) => typeof ref === 'string' ? [] : (ref.annotations || []);

// Simple color picker popup with swatches + custom hex input
function ColorPicker({ value, onChange, onClick, disabled, style }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const colors = [
    '#ffffff', '#000000', '#f44336', '#e91e63', '#9c27b0', '#673ab7',
    '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50',
    '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722',
    '#795548', '#9e9e9e', '#607d8b', '#fffde7', '#fff9c4', '#f3e5f5'
  ];

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <div
        onClick={(e) => { e.stopPropagation(); onClick?.(e); if (!disabled) setOpen(!open); }}
        style={{
          ...style,
          background: value,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.4 : 1
        }}
      />
      {open && !disabled && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 1000,
            background: '#fff', border: '1px solid #ccc', borderRadius: '6px',
            padding: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '3px',
            width: '156px', marginTop: '2px'
          }}
        >
          {colors.map(c => (
            <div
              key={c}
              onClick={() => { onChange({ target: { value: c } }); setOpen(false); }}
              style={{
                width: '22px', height: '22px', background: c, borderRadius: '3px',
                border: c === value ? '2px solid #333' : '1px solid #ddd',
                cursor: 'pointer'
              }}
            />
          ))}
          <input
            type="color"
            value={value}
            onChange={(e) => { onChange(e); setOpen(false); }}
            style={{ gridColumn: '1 / -1', width: '100%', height: '24px', marginTop: '3px', cursor: 'pointer', border: '1px solid #ccc', borderRadius: '3px' }}
          />
        </div>
      )}
    </div>
  );
}

// Compute bounding-box tapZone from 4 corner points
function cornersToTapZone(corners) {
  const xs = corners.map(c => c.x);
  const ys = corners.map(c => c.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  };
}

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

  // Group panels into rows by similar Y position (within 5% tolerance)
  const rows = [];
  const sorted = [...panels].map((p, i) => ({ ...p, originalIndex: i })).sort((a, b) => a.tapZone.y - b.tapZone.y);
  let currentRow = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].tapZone.y - currentRow[0].tapZone.y) < 0.05) {
      currentRow.push(sorted[i]);
    } else {
      rows.push(currentRow.sort((a, b) => a.tapZone.x - b.tapZone.x));
      currentRow = [sorted[i]];
    }
  }
  rows.push(currentRow.sort((a, b) => a.tapZone.x - b.tapZone.x));

  let desc = `The page has EXACTLY ${count} panels arranged in ${rows.length} row${rows.length > 1 ? 's' : ''}:\n\n`;

  rows.forEach((row, rowIdx) => {
    const rowHeight = Math.round(row[0].tapZone.height * 100);
    desc += `Row ${rowIdx + 1} (${rowHeight}% of page height, ${row.length} panel${row.length > 1 ? 's' : ''}):\n`;

    row.forEach((panel) => {
      const { width, height } = panel.tapZone;
      const w = Math.round(width * 100);
      const h = Math.round(height * 100);
      const ratio = width / height;
      const shape = ratio > 1.4 ? 'wide landscape' : ratio > 1.1 ? 'slightly landscape' : ratio < 0.7 ? 'tall portrait' : ratio < 0.9 ? 'slightly portrait' : 'roughly square';
      const relWidth = row.length > 1
        ? (width > 0.55 ? ', the WIDER panel in this row' : width < 0.45 ? ', the NARROWER panel in this row' : '')
        : '';

      desc += `  - Panel ${panel.originalIndex + 1}: ${w}% wide × ${h}% tall (${shape}${relWidth})\n`;
    });
    desc += '\n';
  });

  desc += `IMPORTANT: Each panel's content should be composed to fit its specific proportions. Wider panels suit horizontal scenes; taller panels suit vertical compositions. The panel sizes are NOT equal — respect the different widths and heights described above.`;

  return desc;
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

  // Floating panel state
  const [isDrawingFloatingPanel, setIsDrawingFloatingPanel] = useState(false);
  const [floatingPanelStart, setFloatingPanelStart] = useState(null);
  const [floatingPanelEnd, setFloatingPanelEnd] = useState(null);
  const [isDraggingFloatingPanel, setIsDraggingFloatingPanel] = useState(false);
  const [draggingFloatingPanelId, setDraggingFloatingPanelId] = useState(null);
  const [floatingDragOffset, setFloatingDragOffset] = useState({ x: 0, y: 0 });
  const [isDraggingCorner, setIsDraggingCorner] = useState(false);
  const [draggingCornerPanelId, setDraggingCornerPanelId] = useState(null);
  const [draggingCornerIndex, setDraggingCornerIndex] = useState(null);

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
  // Each panel can have: { path, generating, error, fitMode: 'stretch'|'crop', cropX: 0, cropY: 0, zoom: 1, brightness: 1, contrast: 1, saturation: 1 }
  const [panelImages, setPanelImagesRaw] = useState({});
  const panelImagesRef = useRef({});
  const setPanelImages = (valOrFn) => {
    setPanelImagesRaw(prev => {
      const next = typeof valOrFn === 'function' ? valOrFn(prev) : valOrFn;
      panelImagesRef.current = next;
      return next;
    });
  };
  const abortControllers = useRef({}); // { [panelId]: AbortController }
  const [panelRefinePrompts, setPanelRefinePrompts] = useState({});
  // Per-panel framing options (checkboxes): { [panelId]: { subjectSmall: true, ... } }
  const [panelFraming, setPanelFraming] = useState({});
  const [otherPagePanels, setOtherPagePanels] = useState([]);
  const [showOtherPages, setShowOtherPages] = useState({});
  const [generatingAllPanels, setGeneratingAllPanels] = useState(false);
  const [biblePickerPanelId, setBiblePickerPanelId] = useState(null);
  const [pageBibleRefs, setPageBibleRefsRaw] = useState(() => {
    try {
      const saved = localStorage.getItem(`page-bible-refs-${id}-${pageId || 'cover'}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const setPageBibleRefs = (valOrFn) => {
    setPageBibleRefsRaw(prev => {
      const next = typeof valOrFn === 'function' ? valOrFn(prev) : valOrFn;
      try { localStorage.setItem(`page-bible-refs-${id}-${pageId || 'cover'}`, JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const [showPageBiblePicker, setShowPageBiblePicker] = useState(false);
  const [expandedPanelControls, setExpandedPanelControls] = useState({});
  const [showPanelRefs, setShowPanelRefs] = useState({});
  const [borderThickness, setBorderThickness] = useState(100); // percentage: 0=none, 100=default, 1500=15x thicker
  const borderThicknessRef = useRef(100);
  const [floatingBorderThickness, setFloatingBorderThickness] = useState(100);
  const floatingBorderThicknessRef = useRef(100);
  const [borderColorOverride, setBorderColorOverride] = useState('');
  const borderColorOverrideRef = useRef('');
  const [panelMargin, setPanelMargin] = useState(100); // percentage: 0=no gap, 100=default, 300=3x
  const panelMarginRef = useRef(100);
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
  const [savingText, setSavingText] = useState({}); // { [sentenceId]: true/false }
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
  const [comicNotes, setComicNotes] = useState('');
  const notesTextareaRef = useRef(null);
  const notesScrollRestored = useRef(false);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [chatImages, setChatImages] = useState([]); // Images to send with next message
  const chatFileInputRef = useRef(null);
  const chatMessagesEndRef = useRef(null);
  const chatMessagesRef = useRef(chatMessages); // Backup ref to prevent state loss
  const panelTextareaRefs = useRef({});

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
  const [promptSettingsOpen, setPromptSettingsOpen] = useState(false);

  // Prompt settings (loaded from collection or comic via resolver)
  const [promptSettings, setPromptSettings] = useState({
    styleBible: '',
    styleBibleImages: [],
    cameraInks: '',
    characters: [],
    globalDoNot: '',
    hardNegatives: ''
  });
  const [promptSettingsSource, setPromptSettingsSource] = useState('comic');
  const [promptSettingsCollectionId, setPromptSettingsCollectionId] = useState(null);
  const [newCharacter, setNewCharacter] = useState({ name: '', description: '' });
  const [openaiQuality, setOpenaiQuality] = useState('high'); // 'high' or 'medium'

  // Default bubble style (comic-level)
  const [defaultBubbleStyle, setDefaultBubbleStyle] = useState({
    bgColor: '#ffffff',
    textColor: '#000000',
    borderColor: '#000000',
    borderWidth: 2.5,
    fontId: 'patrick-hand',
    fontSize: 15
  });

  // Toast notification
  const [toast, setToast] = useState(null);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [lightboxRefContext, setLightboxRefContext] = useState(null); // { panelId, refIndex }
  // Inpaint mode state
  const [inpaintMode, setInpaintMode] = useState(null); // { panelId, panelIndex, panel }
  const [inpaintRect, setInpaintRect] = useState(null); // { x, y, width, height } normalized 0-1
  const [inpaintDrawing, setInpaintDrawing] = useState(false);
  const [inpaintStart, setInpaintStart] = useState(null); // { x, y } start point
  const [inpaintPrompt, setInpaintPrompt] = useState('');
  const [inpaintGenerating, setInpaintGenerating] = useState(null); // null|'openai'|'gemini'
  // Global mouseup handler for inpaint rect drawing (handles mouse-up outside image)
  useEffect(() => {
    if (!inpaintDrawing) return;
    const handleMouseUp = () => setInpaintDrawing(false);
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [inpaintDrawing]);
  const toastTimer = useRef(null);
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  };

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

  // Auto-composite cover when panelImages are loaded
  useEffect(() => {
    if (isCover && panelImages['cover-panel-1']?.path && compositeCanvasRef.current) {
      setTimeout(() => compositePageFromPanels(), 200);
    }
  }, [isCover, panelImages['cover-panel-1']?.path]);

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

  const saveAudio = async (bubbleId, sentenceId, pageNum, panelNum, bubbleIdx, sentenceIdx) => {
    const preview = audioPreview[sentenceId];
    if (!preview?.filename) return;

    setSavingAudio(prev => ({ ...prev, [sentenceId]: true }));
    try {
      const audioName = `${comic.title.toLowerCase().replace(/\s+/g, '_')}_p${pageNum}_s${panelNum}_b${bubbleIdx}_t${sentenceIdx}`;
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
          text: existing?.text || t.word,
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
            wordsNeedingLookup.forEach((w, i) => {
              if (lookupResults[i] && !lookupResults[i].isName) {
                w.meaning = cleanWord(lookupResults[i].meaning || '');
                w.baseForm = cleanWord(lookupResults[i].baseForm || '');
              }
            });
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

      showToast('Audio saved!');
    } catch (error) {
      console.error('Failed to save audio:', error);
      alert('Failed to save audio: ' + error.message);
    } finally {
      setSavingAudio(prev => ({ ...prev, [sentenceId]: false }));
    }
  };

  // Generate and save audio for an alternative sentence text
  const generateAlternativeAudio = async (bubbleId, sentenceId, altIndex) => {
    const bubble = bubbles.find(b => b.id === bubbleId);
    const sentence = bubble?.sentences?.find(s => s.id === sentenceId);
    const alt = sentence?.alternatives?.[altIndex];
    if (!alt?.text || !selectedVoiceId) {
      alert('Please enter alternative text and select a voice');
      return;
    }

    const altKey = `${sentenceId}-alt-${altIndex}`;
    setGeneratingAudio(prev => ({ ...prev, [altKey]: true }));
    try {
      // Generate audio
      const response = await api.post('/audio/generate', {
        text: alt.text,
        voice_id: selectedVoiceId,
        model_id: audioModel,
        ...audioSettings
      });

      // Save to project
      const pageNum = page?.pageNumber || 0;
      const bubbleIdx = bubbles.indexOf(bubble) + 1;
      const sentenceIdx = (bubble.sentences || []).indexOf(sentence) + 1;
      const audioName = `${comic.title.toLowerCase().replace(/\s+/g, '_')}_p${pageNum}_s${sentenceIdx}_b${bubbleIdx}_alt${altIndex + 1}`;
      await api.post('/audio/save-to-project', {
        comicId: id,
        filename: response.data.filename,
        audioName
      });

      // Update the alternative with the audioUrl and save to DB
      const updatedAlts = [...(sentence.alternatives || [])];
      updatedAlts[altIndex] = { ...updatedAlts[altIndex], audioUrl: audioName };

      setBubbles(prev => {
        const newBubbles = prev.map(b => {
          if (b.id !== bubbleId) return b;
          return { ...b, sentences: (b.sentences || []).map(s => {
            if (s.id !== sentenceId) return s;
            return { ...s, alternatives: updatedAlts };
          })};
        });
        // Persist to DB
        const updatedComic = { ...comic };
        const pageIndex = updatedComic.pages.findIndex(p => p.id === pageId);
        if (pageIndex >= 0) {
          updatedComic.pages[pageIndex] = { ...updatedComic.pages[pageIndex], bubbles: newBubbles };
          api.put(`/comics/${id}`, updatedComic).catch(err => console.error('Failed to save alternatives:', err));
        }
        return newBubbles;
      });
    } catch (error) {
      console.error('Failed to generate alternative audio:', error);
      alert('Failed to generate alternative audio: ' + error.message);
    } finally {
      setGeneratingAudio(prev => ({ ...prev, [altKey]: false }));
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
                if (lookupResults[idx].isName) return w; // Keep proper nouns, skip dictionary fill
                return { ...w, meaning: lookupResults[idx].meaning || '', baseForm: lookupResults[idx].baseForm || '' };
              }
              return w;
            });
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

      // Load default bubble style if saved on comic
      if (response.data.defaultBubbleStyle) {
        setDefaultBubbleStyle(prev => ({ ...prev, ...response.data.defaultBubbleStyle }));
      }
      // Load comic notes
      if (response.data.notes != null) {
        setComicNotes(response.data.notes);
      }

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
        // Initialize panelImages for cover panel so crop controls appear
        if (response.data.cover?.image) {
          const cover = response.data.cover;
          setPanelImages({
            'cover-panel-1': {
              path: cover.image,
              generating: null,
              error: null,
              fitMode: cover.fitMode || 'stretch',
              cropX: cover.cropX ?? 0,
              cropY: cover.cropY ?? 0,
              zoom: cover.zoom ?? 1,
              brightness: cover.brightness ?? 1,
              contrast: cover.contrast ?? 1,
              saturation: cover.saturation ?? 1
            }
          });
        }
        if (response.data.cover?.bubbles) {
          setBubbles(response.data.cover.bubbles);
        }
        // Build list of panels from all pages for cross-page references
        const pages = response.data.pages || [];
        const otherPanels = [];
        pages.forEach((pg, pgIdx) => {
          if (!pg.panels || pg.panels.length === 0) return;
          pg.panels.forEach((pnl, pnlIdx) => {
            if (pnl.artworkImage) {
              otherPanels.push({
                pageNumber: pg.pageNumber || pgIdx + 1,
                panelIndex: pnlIdx,
                panelId: pnl.id,
                artworkImage: pnl.artworkImage
              });
            }
          });
        });
        setOtherPagePanels(otherPanels);
        // Load prompt settings via resolver (after comic data loaded)
        loadPromptSettings();
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
        // Restore panel images from saved artworkImage
        const restored = {};
        currentPage.panels.forEach(p => {
          if (p.artworkImage || (p.refImages && p.refImages.length > 0)) {
            restored[p.id] = {
              path: p.artworkImage || null,
              generating: null,
              error: null,
              fitMode: p.fitMode || 'stretch',
              cropX: p.cropX ?? 0,
              cropY: p.cropY ?? 0,
              zoom: p.zoom ?? 1,
              brightness: p.brightness ?? 1,
              contrast: p.contrast ?? 1,
              saturation: p.saturation ?? 1,
              refImages: p.refImages || [],
              annotations: p.annotations || []
            };
          }
        });
        if (Object.keys(restored).length > 0) setPanelImages(restored);
      }
      if (currentPage?.bubbles) {
        setBubbles(currentPage.bubbles);
      }
      // Build list of panels from other pages that have artwork
      const currentPageIndex = pages.findIndex(p => p.id === pageId);
      const otherPanels = [];
      pages.forEach((pg, pgIdx) => {
        if (pg.id === pageId) return; // skip current page
        if (pgIdx > currentPageIndex) return; // only previous pages
        if (!pg.panels || pg.panels.length === 0) return;
        pg.panels.forEach((pnl, pnlIdx) => {
          if (pnl.artworkImage) {
            otherPanels.push({
              pageNumber: pg.pageNumber || pgIdx + 1,
              panelIndex: pnlIdx,
              panelId: pnl.id,
              artworkImage: pnl.artworkImage
            });
          }
        });
      });
      setOtherPagePanels(otherPanels);
      // Load prompt settings via resolver
      loadPromptSettings();
    } catch (error) {
      console.error('Failed to load comic:', error);
    }
  };

  const loadPromptSettings = async () => {
    try {
      const res = await api.get(`/comics/${id}/prompt-settings`);
      const { source, collectionId, promptSettings: ps } = res.data;
      setPromptSettingsSource(source);
      setPromptSettingsCollectionId(collectionId);
      if (ps) {
        setPromptSettings(prev => ({ ...prev, ...ps }));
      }
    } catch (err) {
      console.error('Failed to load prompt settings from resolver:', err);
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

  // Save prompt settings to collection or comic
  const savePromptSettings = async () => {
    try {
      if (promptSettingsSource === 'collection' && promptSettingsCollectionId) {
        await api.put(`/collections/${promptSettingsCollectionId}`, {
          promptSettings
        });
        showToast('Collection prompt settings saved!');
      } else {
        const updatedComic = { ...comic, promptSettings };
        await api.put(`/comics/${id}`, updatedComic);
        setComic(updatedComic);
        showToast('Prompt settings saved!');
      }
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

    // Floating panel drawing mode
    if (isDrawingFloatingPanel) {
      setFloatingPanelStart(coords);
      setFloatingPanelEnd(coords);
      return;
    }

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

    // Handle floating panel drawing
    if (isDrawingFloatingPanel && floatingPanelStart) {
      setFloatingPanelEnd(coords);
      return;
    }

    // Handle floating panel dragging (move all corners by delta)
    if (isDraggingFloatingPanel && draggingFloatingPanelId) {
      const dx = coords.x - floatingDragOffset.x;
      const dy = coords.y - floatingDragOffset.y;
      setFloatingDragOffset({ x: coords.x, y: coords.y });
      setPanels(prev => prev.map(p => {
        if (p.id !== draggingFloatingPanelId || !p.corners) return p;
        const newCorners = p.corners.map(c => ({
          x: Math.max(0, Math.min(1, c.x + dx)),
          y: Math.max(0, Math.min(1, c.y + dy))
        }));
        return { ...p, corners: newCorners, tapZone: cornersToTapZone(newCorners) };
      }));
      return;
    }

    // Handle floating panel corner dragging
    if (isDraggingCorner && draggingCornerPanelId != null && draggingCornerIndex != null) {
      setPanels(prev => prev.map(p => {
        if (p.id !== draggingCornerPanelId || !p.corners) return p;
        const newCorners = p.corners.map((c, i) =>
          i === draggingCornerIndex ? { x: Math.max(0, Math.min(1, coords.x)), y: Math.max(0, Math.min(1, coords.y)) } : c
        );
        return { ...p, corners: newCorners, tapZone: cornersToTapZone(newCorners) };
      }));
      return;
    }

    // Handle endpoint dragging (2D — endpoints can move freely to create diagonal lines)
    if (isDraggingEndpoint && dragLineIndex !== null && dragEndpoint) {
      const snapPoints = getSnapPoints();

      setLines(prev => prev.map((l, i) => {
        if (i !== dragLineIndex) return l;

        const snappedX = snapToNearest(coords.x, snapPoints.x);
        const snappedY = snapToNearest(coords.y, snapPoints.y);
        const clampedX = Math.max(0, Math.min(1, snappedX));
        const clampedY = Math.max(0, Math.min(1, snappedY));

        if (l.type === 'horizontal') {
          // Horizontal line: drag endpoint freely (x + y)
          if (dragEndpoint === 'start') {
            return { ...l, x1: Math.min(clampedX, l.x2 - 0.05), y1: clampedY };
          } else {
            return { ...l, x2: Math.max(clampedX, l.x1 + 0.05), y2: clampedY };
          }
        } else {
          // Vertical line: drag endpoint freely (x + y)
          if (dragEndpoint === 'start') {
            return { ...l, y1: Math.min(clampedY, l.y2 - 0.05), x1: clampedX };
          } else {
            return { ...l, y2: Math.max(clampedY, l.y1 + 0.05), x2: clampedX };
          }
        }
      }));
      setPanelsComputed(false);
      return;
    }

    // Handle line dragging (move whole line — shift endpoints with it)
    if (isDragging && dragLineIndex !== null) {
      const line = lines[dragLineIndex];
      const snapPoints = getSnapPoints();

      setLines(prev => prev.map((l, i) => {
        if (i !== dragLineIndex) return l;

        if (l.type === 'horizontal') {
          // Snap y position and shift y1/y2 by the same delta
          const newY = snapToNearest(coords.y, snapPoints.y.filter(y => y !== l.y));
          const clampedY = Math.max(0, Math.min(1, newY));
          const deltaY = clampedY - l.y;
          return {
            ...l,
            y: clampedY,
            y1: l.y1 != null ? Math.max(0, Math.min(1, l.y1 + deltaY)) : clampedY,
            y2: l.y2 != null ? Math.max(0, Math.min(1, l.y2 + deltaY)) : clampedY
          };
        } else {
          // Snap x position and shift x1/x2 by the same delta
          const newX = snapToNearest(coords.x, snapPoints.x.filter(x => x !== l.x));
          const clampedX = Math.max(0, Math.min(1, newX));
          const deltaX = clampedX - l.x;
          return {
            ...l,
            x: clampedX,
            x1: l.x1 != null ? Math.max(0, Math.min(1, l.x1 + deltaX)) : clampedX,
            x2: l.x2 != null ? Math.max(0, Math.min(1, l.x2 + deltaX)) : clampedX
          };
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
    // Stop floating panel drawing
    if (isDrawingFloatingPanel && floatingPanelStart && floatingPanelEnd) {
      const x = Math.min(floatingPanelStart.x, floatingPanelEnd.x);
      const y = Math.min(floatingPanelStart.y, floatingPanelEnd.y);
      const w = Math.abs(floatingPanelEnd.x - floatingPanelStart.x);
      const h = Math.abs(floatingPanelEnd.y - floatingPanelStart.y);

      if (w > 0.03 && h > 0.03) {
        const corners = [
          { x, y },                 // top-left
          { x: x + w, y },          // top-right
          { x: x + w, y: y + h },   // bottom-right
          { x, y: y + h }           // bottom-left
        ];
        const newPanel = {
          id: `floating-panel-${Date.now()}`,
          panelOrder: panels.length + 1,
          floating: true,
          corners,
          tapZone: cornersToTapZone(corners),
          content: '',
          artworkImage: null
        };
        setPanels(prev => [...prev, newPanel]);
      }

      setFloatingPanelStart(null);
      setFloatingPanelEnd(null);
      setIsDrawingFloatingPanel(false);
      return;
    }

    // Stop floating panel dragging
    if (isDraggingFloatingPanel) {
      setIsDraggingFloatingPanel(false);
      setDraggingFloatingPanelId(null);
      return;
    }

    // Stop floating panel corner dragging
    if (isDraggingCorner) {
      setIsDraggingCorner(false);
      setDraggingCornerPanelId(null);
      setDraggingCornerIndex(null);
      return;
    }

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
        y1: snappedY,
        x2: Math.max(drawStart.x, endCoords.x),
        y2: snappedY
      };
    } else {
      // Vertical line
      const x = (drawStart.x + endCoords.x) / 2;
      const snapPoints = getSnapPoints();
      const snappedX = snapToNearest(x, snapPoints.x);

      newLine = {
        type: 'vertical',
        x: snappedX,
        x1: snappedX,
        y1: Math.min(drawStart.y, endCoords.y),
        x2: snappedX,
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
      type: 'speech', // 'speech', 'thought', 'narration', 'image'
      fontId: defaultBubbleStyle.fontId || 'patrick-hand',
      fontSize: defaultBubbleStyle.fontSize || 15,
      italic: false,
      uppercase: false,
      bgColor: defaultBubbleStyle.bgColor || '#ffffff',
      textColor: defaultBubbleStyle.textColor || '#000000',
      borderColor: defaultBubbleStyle.borderColor || '#000000',
      borderWidth: defaultBubbleStyle.borderWidth ?? 2.5,
      cornerRadius: 20, // 0 = square, 50 = very round
      // Tail position relative to bubble center (as offset in percentage of canvas)
      tailX: 0.03, // tip offset from bubble center
      tailY: 0.08,  // tip offset from bubble center (positive = below)
      tailBaseX: 0.5, // where tail joins bubble (0 = left edge, 1 = right edge)
      tailSide: 'bottom', // which side tail connects: 'top', 'bottom', 'left', 'right'
      tailWidth: 0.15, // width of tail base as percentage of bubble width
      showTail: true,
      // Rotation (for speech bubbles - rotates the whole bubble+tail)
      rotation: 0, // degrees, 0 = tail at bottom
      tailLength: 0.35, // length of tail relative to bubble height
      tailCurve: 0, // tail angle: -1 = far left, 0 = center, +1 = far right
      tailBend: 0, // tail curvature: -1 = bend left, 0 = straight, +1 = bend right
      textAngle: 0, // rotation angle for text inside bubble
      isSoundEffect: false, // if true, this is a sound effect (no TTS audio)
      // Image bubble fields
      imageUrl: null, // path to generated image (for type 'image')
      imagePrompt: '', // prompt used to generate the image
      imageGenerating: false, // loading state
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
    setBubbles(prev => {
      const newBubbles = prev.map(b => {
        if (b.id !== bubbleId) return b;
        return {
          ...b,
          sentences: (b.sentences || []).map(s =>
            s.id === sentenceId ? { ...s, ...updates } : s
          )
        };
      });
      // Auto-save alternatives to DB when they change
      if ('alternatives' in updates) {
        const updatedComic = { ...comic };
        const pageIndex = updatedComic.pages?.findIndex(p => p.id === pageId);
        if (pageIndex >= 0) {
          updatedComic.pages[pageIndex] = { ...updatedComic.pages[pageIndex], bubbles: newBubbles };
          api.put(`/comics/${id}`, updatedComic).catch(err => console.error('Failed to save alternatives:', err));
        }
      }
      return newBubbles;
    });
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
              baseForm: '',
              manual: true
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

  // Generate an image for an image-type bubble
  const generateBubbleImage = async (bubbleId, prompt, provider = 'openai') => {
    if (!prompt.trim()) return;
    updateBubble(bubbleId, { imageGenerating: provider, imagePrompt: prompt });
    try {
      const response = await api.post('/images/generate', {
        prompt,
        style: promptSettings.styleBible || 'comic book illustration',
        size: '1024x1024',
        provider
      }, { timeout: 600000 });
      updateBubble(bubbleId, {
        imageUrl: response.data.path,
        imageGenerating: null
      });
    } catch (error) {
      console.error('Bubble image generation failed:', error);
      updateBubble(bubbleId, { imageGenerating: null });
      alert('Image generation failed: ' + (error.response?.data?.error || error.message));
    }
  };

  // Upload an image from disk directly into a bubble
  const uploadBubbleImage = async (bubbleId, file) => {
    if (!file) return;
    updateBubble(bubbleId, { imageGenerating: 'upload' });
    try {
      const formData = new FormData();
      formData.append('image', file);
      const response = await api.post('/images/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      updateBubble(bubbleId, {
        imageUrl: response.data.path,
        imageGenerating: null
      });
    } catch (error) {
      console.error('Bubble image upload failed:', error);
      updateBubble(bubbleId, { imageGenerating: null });
      alert('Image upload failed: ' + (error.response?.data?.error || error.message));
    }
  };

  // Refine an existing image bubble using the current image as reference
  const refineBubbleImage = async (bubbleId, refinementPrompt, currentImageUrl) => {
    if (!refinementPrompt.trim() || !currentImageUrl) return;
    updateBubble(bubbleId, { imageGenerating: 'refine' });
    try {
      const response = await api.post('/images/generate-panel', {
        prompt: refinementPrompt,
        panelId: bubbleId,
        aspectRatio: 'square',
        referenceImages: [currentImageUrl]
      }, { timeout: 600000 });
      updateBubble(bubbleId, {
        imageUrl: response.data.path,
        imageGenerating: null
      });
    } catch (error) {
      console.error('Bubble image refinement failed:', error);
      updateBubble(bubbleId, { imageGenerating: null });
      alert('Image refinement failed: ' + (error.response?.data?.error || error.message));
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
      // Layout mode — check for floating panel corner handle or body drag
      if (e.target.dataset.cornerDrag) {
        const panelId = e.target.dataset.cornerDrag;
        const cornerIndex = parseInt(e.target.dataset.cornerIndex, 10);
        setIsDraggingCorner(true);
        setDraggingCornerPanelId(panelId);
        setDraggingCornerIndex(cornerIndex);
        return;
      }
      if (e.target.dataset.floatingPanel) {
        const panelId = e.target.dataset.floatingPanel;
        const coords = getRelativeCoords(e);
        if (coords) {
          const panel = panels.find(p => p.id === panelId);
          if (panel) {
            setIsDraggingFloatingPanel(true);
            setDraggingFloatingPanelId(panelId);
            setFloatingDragOffset({ x: coords.x, y: coords.y });
            setSelectedPanel(panelId);
            setSelectedLineIndex(null);
          }
        }
        return;
      }
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
    // These apply regardless of mode
    if (isDraggingFloatingPanel) {
      setIsDraggingFloatingPanel(false);
      setDraggingFloatingPanelId(null);
    }
    if (isDraggingCorner) {
      setIsDraggingCorner(false);
      setDraggingCornerPanelId(null);
      setDraggingCornerIndex(null);
    }
  };

  const computePanels = () => {
    // Preserve floating panels across recompute
    const floatingPanels = panels.filter(p => p.floating);
    const newPanels = computePanelsFromLines(lines, pageId);
    const regularPanels = panels.filter(p => !p.floating);
    const panelsWithContent = newPanels.map((newPanel, idx) => {
      const existing = regularPanels[idx];
      return existing ? { ...newPanel, content: existing.content || '' } : newPanel;
    });
    setPanels([...panelsWithContent, ...floatingPanels]);
    setPanelsComputed(true);
  };

  const movePanelUp = (index) => {
    if (index === 0) return;
    const newPanels = [...panels];
    [newPanels[index - 1], newPanels[index]] = [newPanels[index], newPanels[index - 1]];
    // Update panel orders (preserve floating panel IDs)
    newPanels.forEach((p, i) => {
      p.panelOrder = i + 1;
      if (!p.floating) p.id = `${pageId}-panel-${i + 1}`;
    });
    setPanels(newPanels);
  };

  const movePanelDown = (index) => {
    if (index === panels.length - 1) return;
    const newPanels = [...panels];
    [newPanels[index], newPanels[index + 1]] = [newPanels[index + 1], newPanels[index]];
    // Update panel orders (preserve floating panel IDs)
    newPanels.forEach((p, i) => {
      p.panelOrder = i + 1;
      if (!p.floating) p.id = `${pageId}-panel-${i + 1}`;
    });
    setPanels(newPanels);
  };

  const deleteFloatingPanel = (panelId) => {
    setPanels(prev => prev.filter(p => p.id !== panelId));
    if (selectedPanel === panelId) setSelectedPanel(null);
    // Clean up any panel image data
    setPanelImages(prev => {
      const updated = { ...prev };
      delete updated[panelId];
      return updated;
    });
  };

  const updatePanelContent = (panelId, content) => {
    setPanels(panels.map(p =>
      p.id === panelId ? { ...p, content } : p
    ));
  };

  // Update panel's artworkImage and auto-save to DB
  const updatePanelArtwork = (panelId, imagePath) => {
    setPanels(prev => prev.map(p =>
      p.id === panelId ? { ...p, artworkImage: imagePath } : p
    ));
    // Auto-save to DB
    if (isCover) {
      const updatedCover = { ...comic.cover, image: imagePath, bakedImage: '' };
      api.put(`/comics/${id}`, { cover: updatedCover }).then(() => {
        setComic(prev => ({ ...prev, cover: updatedCover }));
        setPage(prev => ({ ...prev, masterImage: imagePath + `?t=${Date.now()}`, bakedImage: '' }));
      }).catch(err => {
        console.error('Failed to auto-save cover artwork:', err);
      });
    } else {
      api.patch(`/comics/${id}/pages/${pageId}/panels/${panelId}`, { artworkImage: imagePath }).catch(err => {
        console.error('Failed to auto-save panel artwork:', err);
      });
    }
  };

  // Auto-save panel adjustment values to DB (debounced)
  const adjustmentTimers = useRef({});
  const savePanelAdjustments = (panelId, adjustments) => {
    clearTimeout(adjustmentTimers.current[panelId]);
    adjustmentTimers.current[panelId] = setTimeout(() => {
      if (isCover) {
        // Persist cover adjustments to the cover object
        const coverUpdate = {};
        Object.entries(adjustments).forEach(([key, val]) => {
          coverUpdate[`cover.${key}`] = val;
        });
        api.put(`/comics/${id}`, coverUpdate).catch(err => {
          console.error('Failed to auto-save cover adjustments:', err);
        });
      } else {
        api.patch(`/comics/${id}/pages/${pageId}/panels/${panelId}`, adjustments).catch(err => {
          console.error('Failed to auto-save panel adjustments:', err);
        });
      }
    }, 500);
  };

  // Auto-save refImages and annotations to DB (debounced) — watches panelImages for changes
  const refImageTimers = useRef({});
  const prevRefDataRef = useRef({});
  useEffect(() => {
    if (isCover) return;
    for (const panelId of Object.keys(panelImages)) {
      const refs = panelImages[panelId]?.refImages;
      const annotations = panelImages[panelId]?.annotations;
      const serialized = JSON.stringify({ refs, annotations });
      if (prevRefDataRef.current[panelId] !== serialized) {
        // Skip initial load (first time we see this panel's data)
        if (prevRefDataRef.current[panelId] !== undefined) {
          clearTimeout(refImageTimers.current[panelId]);
          refImageTimers.current[panelId] = setTimeout(() => {
            const update = {};
            if (refs) update.refImages = refs;
            if (annotations) update.annotations = annotations;
            api.patch(`/comics/${id}/pages/${pageId}/panels/${panelId}`, update).catch(err => {
              console.error('Failed to auto-save refImages/annotations:', err);
            });
          }, 500);
        }
        prevRefDataRef.current[panelId] = serialized;
      }
    }
  }, [panelImages]);

  // Zero-width Unicode markers for highlights (invisible in textarea, survive copy-paste)
  const HL_START = '\u2060'; // Word Joiner
  const HL_END = '\u2061';   // Function Application

  // Strip highlight markers from text before sending to AI
  const stripHighlightMarkers = (text) => text
    ? text.replace(/\[\[/g, '').replace(/\]\]/g, '').replace(/[\u2060\u2061]/g, '')
    : '';

  // Check if text has any highlights
  const hasHighlights = (text) => text && text.includes(HL_START);

  // Toggle highlight on selected text using zero-width markers
  const toggleHighlight = (panelId) => {
    const textarea = panelTextareaRefs.current[panelId];
    if (!textarea) return;
    const { selectionStart, selectionEnd, value } = textarea;
    if (selectionStart === selectionEnd) return;

    const before = value.substring(0, selectionStart);
    const after = value.substring(selectionEnd);

    let newValue;
    if (before.endsWith(HL_START) && after.startsWith(HL_END)) {
      // Remove highlight markers
      newValue = before.slice(0, -1) + value.substring(selectionStart, selectionEnd) + after.slice(1);
    } else {
      // Add highlight markers
      newValue = before + HL_START + value.substring(selectionStart, selectionEnd) + HL_END + after;
    }
    updatePanelContent(panelId, newValue);
  };

  // Clear all highlights from a panel's text
  const clearHighlights = (panelId) => {
    const panel = panels.find(p => p.id === panelId);
    if (panel?.content) {
      updatePanelContent(panelId, panel.content.replace(/[\u2060\u2061]/g, ''));
    }
  };

  // Restore notes scroll position after load
  useEffect(() => {
    if (comicNotes && notesTextareaRef.current && !notesScrollRestored.current) {
      notesScrollRestored.current = true;
      try {
        const saved = sessionStorage.getItem(`notes-scroll-${id}`);
        if (saved) {
          requestAnimationFrame(() => {
            if (notesTextareaRef.current) {
              notesTextareaRef.current.scrollTop = parseInt(saved, 10);
            }
          });
        }
      } catch {}
    }
  }, [comicNotes, id]);

  // Notes highlight functions
  const toggleNotesHighlight = () => {
    const textarea = notesTextareaRef.current;
    if (!textarea) return;
    const { selectionStart, selectionEnd, value } = textarea;
    if (selectionStart === selectionEnd) return;

    const before = value.substring(0, selectionStart);
    const after = value.substring(selectionEnd);

    let newValue;
    if (before.endsWith(HL_START) && after.startsWith(HL_END)) {
      newValue = before.slice(0, -1) + value.substring(selectionStart, selectionEnd) + after.slice(1);
    } else {
      newValue = before + HL_START + value.substring(selectionStart, selectionEnd) + HL_END + after;
    }
    setComicNotes(newValue);
    setComic(prev => prev ? { ...prev, notes: newValue } : prev);
  };

  const clearNotesHighlights = () => {
    const cleaned = comicNotes.replace(/[\u2060\u2061]/g, '');
    setComicNotes(cleaned);
    setComic(prev => prev ? { ...prev, notes: cleaned } : prev);
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
        showToast('Cover saved!');
        return;
      }

      let panelsToSave = panels;
      if (!panelsComputed) {
        const floatingPanels = panels.filter(p => p.floating);
        const recomputed = computePanelsFromLines(lines, pageId);
        panelsToSave = [...recomputed, ...floatingPanels];
        setPanels(panelsToSave);
        setPanelsComputed(true);
      }

      const updatedComic = { ...comic };
      // Only include promptSettings in comic save if not from collection
      if (promptSettingsSource !== 'collection') {
        updatedComic.promptSettings = promptSettings;
      }
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
      showToast('Page saved!');
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

    // Style Bible Reference Images
    if (settings.styleBibleImages && settings.styleBibleImages.length > 0) {
      prompt += `🎨 STYLE REFERENCE DESCRIPTIONS\n`;
      settings.styleBibleImages.forEach((img, i) => {
        prompt += `\nStyle Reference ${i + 1}:\n${img.description}\n`;
      });
      prompt += '\n';
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
      prompt += `Panel ${i + 1}:\n${stripHighlightMarkers(panel.content) || '(No content specified)'}\n\n`;
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

    // Style Bible Reference Images — merge page-level + panel-level refs
    const selectedRefs = [...new Set([...(pageBibleRefs || []), ...(panel.selectedBibleRefs || [])])];
    if (settings.styleBibleImages && settings.styleBibleImages.length > 0 && selectedRefs.length > 0) {
      const selectedStyleImages = settings.styleBibleImages.filter(
        img => selectedRefs.includes(String(img.id))
      );
      if (selectedStyleImages.length > 0) {
        prompt += `🎨 STYLE REFERENCE DESCRIPTIONS\n`;
        selectedStyleImages.forEach((img, i) => {
          prompt += `\nStyle Reference ${i + 1}:\n${img.description}\n`;
        });
        prompt += '\n';
      }
    }

    // Camera & Inks
    if (settings.cameraInks) {
      prompt += `CAMERA + INKS\n${settings.cameraInks}\n\n`;
    }

    // Character Bible — only selected ones
    if (settings.characters && settings.characters.length > 0) {
      const selectedChars = selectedRefs.length > 0
        ? settings.characters.filter(char => selectedRefs.includes(String(char.id)))
        : [];
      if (selectedChars.length > 0) {
        prompt += `CHARACTER BIBLE (MAINTAIN CONSISTENCY)\n`;
        selectedChars.forEach(char => {
          prompt += `\nCharacter: ${char.name}\n${char.description}\n`;
        });
        prompt += '\n';
      }
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
    prompt += `Panel Content:\n${stripHighlightMarkers(panel.content) || '(No content specified)'}\n\n`;

    // Per-panel framing options
    const framing = panelFraming[panel.id];
    if (framing) {
      const framingLines = [];
      if (framing.subjectSmall) framingLines.push('- Subject should be SMALL in the frame');
      if (framing.cameraFar) framingLines.push('- Pull the camera FAR BACK from the subject');
      if (framing.negativeSpace) framingLines.push('- Include LOTS of negative space around the subject');
      if (framing.wideMargins) framingLines.push('- Leave WIDE margins on all sides of the subject');
      if (framing.fullEnvironment) framingLines.push('- Show the ENTIRE environment visible around the subject');
      if (framing.safeCrop) framingLines.push('- Keep subject in a SAFE CROP AREA away from edges, the image will be cropped');
      if (framingLines.length > 0) {
        prompt += `FRAMING / CAMERA DISTANCE:\n${framingLines.join('\n')}\n\n`;
      }

      // Camera angle rotation
      if (framing.cameraAngle && framing.cameraAngle !== 0) {
        const angleDescriptions = {
          '-90': 'The camera has rotated 90° LEFT — a full side view. Characters are seen in COMPLETE PROFILE from their RIGHT side. The background perspective is completely different: if the original looked down a street, we now look ACROSS it — the street runs left-to-right and we see building facades directly.',
          '-75': 'The camera has rotated 75° LEFT — nearly a side view. Characters are seen from their RIGHT SIDE in near-profile. The background perspective changes significantly: streets that receded into the distance now run mostly across the frame.',
          '-50': 'The camera has rotated 50° LEFT — a three-quarter view. Characters are shown in THREE-QUARTER RIGHT view, we see their right cheek and right shoulder prominently. The background perspective shifts noticeably.',
          '-25': 'The camera has rotated 25° LEFT — a subtle shift. Characters are at a slight angle from their RIGHT. Their right side is slightly more visible. The background shifts subtly.',
          '25': 'The camera has rotated 25° RIGHT — a subtle shift. Characters are at a slight angle from their LEFT. Their left side is slightly more visible. The background shifts subtly.',
          '50': 'The camera has rotated 50° RIGHT — a three-quarter view. Characters are shown in THREE-QUARTER LEFT view, we see their left cheek and left shoulder prominently. The background perspective shifts noticeably.',
          '75': 'The camera has rotated 75° RIGHT — nearly a side view. Characters are seen from their LEFT SIDE in near-profile. The background perspective changes significantly: streets that receded into the distance now run mostly across the frame.',
          '90': 'The camera has rotated 90° RIGHT — a full side view. Characters are seen in COMPLETE PROFILE from their LEFT side. The background perspective is completely different: if the original looked down a street, we now look ACROSS it — the street runs left-to-right and we see building facades directly.',
          '180': 'The camera has rotated 180° — we see the scene from the OPPOSITE direction. Characters are viewed FROM BEHIND. We see the BACKS of their heads and shoulders. They face AWAY from the camera. We should NOT see any faces. The background shows what was originally in front of them.',
        };
        const desc = angleDescriptions[String(framing.cameraAngle)];
        if (desc) {
          prompt += `CAMERA POSITION (CRITICAL):\n${desc}\nThe background and environment must remain the SAME LOCATION at the SAME LEVEL (street-level stays street-level, indoor stays indoor). Do NOT change the setting or move to a different location. The scene stays identical — only the camera viewpoint changes.\n\nCONSISTENCY RULES (DO NOT VIOLATE):\n- Do NOT add any characters that are not described in the panel content above.\n- Do NOT remove any characters that ARE described.\n- Every character must wear the EXACT same clothing as described in the character bible.\n- Maintain the SAME hairstyle, hair color, and hair length for each character.\n- Maintain the SAME body posture and stance — only rotate the viewpoint, not the pose.\n- Keep the SAME environment and location type. A street scene stays a street scene at ground level.\n- The ONLY thing that changes is the camera angle on the characters.\n\n`;
        }
      }
    }

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

  // Toggle a bible ref (style image or character) for a panel
  const togglePanelBibleRef = (panelId, refId) => {
    const refIdStr = String(refId);
    setPanels(prev => prev.map(p => {
      if (p.id !== panelId) return p;
      const current = p.selectedBibleRefs || [];
      const isSelected = current.includes(refIdStr);
      return {
        ...p,
        selectedBibleRefs: isSelected
          ? current.filter(id => id !== refIdStr)
          : [...current, refIdStr]
      };
    }));
  };

  const selectAllBibleRefs = (panelId) => {
    const allIds = [
      ...(promptSettings.styleBibleImages || []).map(img => String(img.id)),
      ...(promptSettings.characters || []).filter(c => c.image).map(c => String(c.id))
    ];
    setPanels(prev => prev.map(p =>
      p.id === panelId ? { ...p, selectedBibleRefs: allIds } : p
    ));
  };

  const clearAllBibleRefs = (panelId) => {
    setPanels(prev => prev.map(p =>
      p.id === panelId ? { ...p, selectedBibleRefs: [] } : p
    ));
  };

  // Collect reference image paths for a specific panel (page-level + panel-level bible refs)
  const getRefImagePaths = (panelId) => {
    const paths = [];
    const settings = promptSettings;
    const panel = panels.find(p => p.id === panelId);
    const selectedRefs = [...new Set([...(pageBibleRefs || []), ...(panel?.selectedBibleRefs || [])])];
    if (selectedRefs.length === 0) return paths;
    if (settings.styleBibleImages) {
      settings.styleBibleImages.forEach(img => {
        if (img.image && selectedRefs.includes(String(img.id))) paths.push(img.image);
      });
    }
    if (settings.characters) {
      settings.characters.forEach(char => {
        if (char.image && selectedRefs.includes(String(char.id))) paths.push(char.image);
      });
    }
    return paths;
  };

  // For full-page generation: union of page-level + all panels' selected refs
  const getAllSelectedRefImagePaths = () => {
    const allSelectedIds = new Set(pageBibleRefs || []);
    panels.forEach(p => {
      (p.selectedBibleRefs || []).forEach(refId => allSelectedIds.add(refId));
    });
    if (allSelectedIds.size === 0) return [];
    const paths = [];
    const settings = promptSettings;
    if (settings.styleBibleImages) {
      settings.styleBibleImages.forEach(img => {
        if (img.image && allSelectedIds.has(String(img.id))) paths.push(img.image);
      });
    }
    if (settings.characters) {
      settings.characters.forEach(char => {
        if (char.image && allSelectedIds.has(String(char.id))) paths.push(char.image);
      });
    }
    return paths;
  };

  // Stop a panel image generation in progress
  const stopPanelGeneration = (panelId) => {
    if (abortControllers.current[panelId]) {
      abortControllers.current[panelId].abort();
      delete abortControllers.current[panelId];
    }
    setPanelImages(prev => ({
      ...prev,
      [panelId]: { ...prev[panelId], generating: null, error: null }
    }));
  };

  // Generate a single panel image
  const generatePanelImage = async (panel, panelIndex, provider = 'openai', isAngleChange = false) => {
    if (!panel.content?.trim()) {
      alert(`Panel ${panelIndex + 1} has no content. Please add content first.`);
      return;
    }

    // Create abort controller for this panel
    const controller = new AbortController();
    abortControllers.current[panel.id] = controller;

    const currentPath = panelImages[panel.id]?.path;
    setPanelImages(prev => ({
      ...prev,
      [panel.id]: { ...prev[panel.id], generating: provider, error: null, ...(currentPath ? { previousPath: currentPath } : {}) }
    }));

    try {
      const prompt = buildPanelPrompt(panel, panelIndex);
      const aspectRatio = getPanelAspectRatio(panel);

      console.log(`Generating panel ${panelIndex + 1} (${panel.id}), aspect: ${aspectRatio}, angleChange: ${isAngleChange}`);

      // Separate per-panel linked refs from selected style/character refs
      const rawRefs = panelImages[panel.id]?.refImages || [];
      const linkedPanelImages = rawRefs.map(getRefPath);
      const refAnnotations = rawRefs
        .filter(r => getRefAnnotations(r).length > 0)
        .map(r => ({ path: getRefPath(r), annotations: getRefAnnotations(r) }));
      const referenceImages = getRefImagePaths(panel.id);

      // For angle changes, send the current panel image separately as the
      // "source" image (unblurred), while other refs stay in their normal paths
      const angleSourceImage = (isAngleChange && panelImages[panel.id]?.path)
        ? panelImages[panel.id].path
        : null;
      const angleDegrees = isAngleChange ? (panelFraming[panel.id]?.cameraAngle || 0) : 0;

      console.log('ANGLE DEBUG:', { isAngleChange, angleSourceImage, angleDegrees, cameraAngle: panelFraming[panel.id]?.cameraAngle });

      const response = await api.post('/images/generate-panel', {
        prompt,
        panelId: panel.id,
        aspectRatio,
        referenceImages,
        linkedPanelImages,
        refAnnotations,
        isAngleChange,
        angleSourceImage,
        angleDegrees,
        panelContent: panel.content,
        provider,
        openaiQuality
      }, { timeout: 600000, signal: controller.signal });

      delete abortControllers.current[panel.id];

      setPanelImages(prev => ({
        ...prev,
        [panel.id]: {
          ...prev[panel.id], // Preserve existing fitMode and crop settings
          path: response.data.path,
          generating: null,
          error: null,
          fitMode: prev[panel.id]?.fitMode || 'stretch',
          cropX: prev[panel.id]?.cropX ?? 0,
          cropY: prev[panel.id]?.cropY ?? 0,
          zoom: prev[panel.id]?.zoom ?? 1,
          brightness: prev[panel.id]?.brightness ?? 1,
          contrast: prev[panel.id]?.contrast ?? 1,
          saturation: prev[panel.id]?.saturation ?? 1
        }
      }));

      updatePanelArtwork(panel.id, response.data.path);
      console.log(`Panel ${panelIndex + 1} generated:`, response.data.path);
    } catch (error) {
      delete abortControllers.current[panel.id];
      if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
        console.log(`Panel ${panelIndex + 1} generation cancelled`);
        return; // Don't set error state for cancellations
      }
      console.error(`Panel ${panelIndex + 1} generation failed:`, error);
      setPanelImages(prev => ({
        ...prev,
        [panel.id]: {
          ...prev[panel.id],
          generating: null,
          error: error.response?.data?.error || error.message
        }
      }));
    }
  };

  // Upload an image from disk directly into a panel
  const uploadPanelImage = async (panel, file) => {
    if (!file) return;

    setPanelImages(prev => ({
      ...prev,
      [panel.id]: { ...prev[panel.id], generating: 'upload', error: null }
    }));

    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await api.post('/images/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      setPanelImages(prev => ({
        ...prev,
        [panel.id]: {
          ...prev[panel.id],
          path: response.data.path,
          generating: null,
          error: null,
          fitMode: prev[panel.id]?.fitMode || 'stretch',
          cropX: prev[panel.id]?.cropX ?? 0,
          cropY: prev[panel.id]?.cropY ?? 0,
          zoom: prev[panel.id]?.zoom ?? 1,
          brightness: prev[panel.id]?.brightness ?? 1,
          contrast: prev[panel.id]?.contrast ?? 1,
          saturation: prev[panel.id]?.saturation ?? 1
        }
      }));
      updatePanelArtwork(panel.id, response.data.path);
    } catch (error) {
      console.error('Panel image upload failed:', error);
      setPanelImages(prev => ({
        ...prev,
        [panel.id]: {
          ...prev[panel.id],
          generating: null,
          error: error.response?.data?.error || error.message
        }
      }));
    }
  };

  // Upload a reference image for a specific panel prompt
  const uploadPanelRefImage = async (panelId, file) => {
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append('image', file);
      const response = await api.post('/images/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setPanelImages(prev => ({
        ...prev,
        [panelId]: {
          ...prev[panelId],
          refImages: [...(prev[panelId]?.refImages || []), { path: response.data.path, annotations: [] }]
        }
      }));
    } catch (error) {
      console.error('Panel ref image upload failed:', error);
      alert('Upload failed: ' + (error.response?.data?.error || error.message));
    }
  };

  // Remove a per-panel reference image
  const removePanelRefImage = (panelId, index) => {
    setPanelImages(prev => ({
      ...prev,
      [panelId]: {
        ...prev[panelId],
        refImages: (prev[panelId]?.refImages || []).filter((_, i) => i !== index)
      }
    }));
  };

  // Refine a generated panel image using it as reference with improvement instructions
  const refinePanelImage = async (panel, panelIndex, refinementPrompt, provider = 'openai') => {
    if (!refinementPrompt?.trim()) return;
    const currentPath = panelImages[panel.id]?.path;
    if (!currentPath) return;

    setPanelImages(prev => ({
      ...prev,
      [panel.id]: { ...prev[panel.id], generating: provider, error: null, previousPath: currentPath }
    }));

    try {
      const aspectRatio = getPanelAspectRatio(panel);
      // Build the full panel prompt and append refinement instructions
      const fullPrompt = buildPanelPrompt(panel, panelIndex)
        + `\n\nREFINEMENT INSTRUCTIONS (apply these changes to the attached reference image):\n${refinementPrompt}`;
      // Current image is the main edit target, style refs are separate
      const response = await api.post('/images/generate-panel', {
        prompt: fullPrompt,
        panelId: panel.id,
        aspectRatio,
        referenceImages: getRefImagePaths(panel.id),
        linkedPanelImages: [currentPath],
        isRefinement: true,
        provider,
        openaiQuality
      }, { timeout: 600000 });

      setPanelImages(prev => ({
        ...prev,
        [panel.id]: {
          ...prev[panel.id],
          path: response.data.path,
          generating: null,
          error: null
        }
      }));
      updatePanelArtwork(panel.id, response.data.path);
    } catch (error) {
      console.error(`Panel ${panelIndex + 1} refinement failed:`, error);
      setPanelImages(prev => ({
        ...prev,
        [panel.id]: {
          ...prev[panel.id],
          generating: null,
          error: error.response?.data?.error || error.message
        }
      }));
    }
  };

  // Start inpaint mode for a panel
  const startInpaintMode = (panel, panelIndex) => {
    const imagePath = panelImages[panel.id]?.path;
    if (!imagePath) return;
    setInpaintMode({ panelId: panel.id, panelIndex, panel });
    setInpaintRect(null);
    setInpaintPrompt('');
    setInpaintGenerating(null);
    setInpaintDrawing(false);
    setInpaintStart(null);
    setLightboxImage(`http://localhost:3001${imagePath}`);
    setLightboxRefContext(null);
  };

  // Execute inpainting on a region
  const executeInpaint = async (provider = 'openai') => {
    if (!inpaintMode || !inpaintRect || !inpaintPrompt.trim()) return;
    const { panelId, panel } = inpaintMode;
    const currentPath = panelImages[panelId]?.path;
    if (!currentPath) return;

    setInpaintGenerating(provider);
    setPanelImages(prev => ({
      ...prev,
      [panelId]: { ...prev[panelId], generating: provider, previousPath: currentPath }
    }));

    try {
      const referenceImages = getRefImagePaths(panelId);
      const rawRefs = panelImages[panelId]?.refImages || [];
      const refAnnotations = rawRefs
        .filter(r => getRefAnnotations(r).length > 0)
        .map(r => ({ path: getRefPath(r), annotations: getRefAnnotations(r) }));

      const response = await api.post('/images/inpaint-region', {
        sourceImagePath: currentPath,
        rect: inpaintRect,
        prompt: inpaintPrompt,
        panelId,
        referenceImages,
        refAnnotations,
        provider,
        openaiQuality
      }, { timeout: 600000 });

      setPanelImages(prev => ({
        ...prev,
        [panelId]: {
          ...prev[panelId],
          path: response.data.path,
          generating: null,
          error: null
        }
      }));
      updatePanelArtwork(panelId, response.data.path);

      // Update lightbox to show result; clear rect for another pass
      setLightboxImage(`http://localhost:3001${response.data.path}`);
      setInpaintRect(null);
      setInpaintPrompt('');
      setInpaintGenerating(null);
    } catch (error) {
      console.error('Inpaint failed:', error);
      setPanelImages(prev => ({
        ...prev,
        [panelId]: {
          ...prev[panelId],
          generating: null,
          error: error.response?.data?.error || error.message
        }
      }));
      setInpaintGenerating(null);
    }
  };

  // Exit inpaint mode
  const exitInpaintMode = () => {
    setInpaintMode(null);
    setInpaintRect(null);
    setInpaintPrompt('');
    setInpaintDrawing(false);
    setInpaintStart(null);
    setInpaintGenerating(null);
    setLightboxImage(null);
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
    // Read from ref to avoid stale closure issues
    const panelImages = panelImagesRef.current;

    const ctx = canvas.getContext('2d');
    const canvasWidth = 2048;
    const canvasHeight = 3072;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Gutter size in pixels (margin between panels)
    const marginScale = panelMarginRef.current / 100;
    const gutterSize = 16 * marginScale;
    // Outer margin for the entire page
    const outerMargin = 12 * marginScale;

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

    // Separate regular and floating panels
    const regularPanels = panels.filter(p => !p.floating);
    const floatingPanels = panels.filter(p => p.floating);

    // First, load all images and sample their edge colors
    const loadedImages = [];
    const floatingLoadedImages = [];
    let totalR = 0, totalG = 0, totalB = 0, sampleCount = 0;

    for (const panel of regularPanels) {
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

    // Helper function to draw a wobbly/hand-drawn line
    const drawWobblyLine = (x1, y1, x2, y2) => {
      const segments = 12; // Number of segments for the wobble
      const wobbleAmount = 1.5 + (ctx.lineWidth * 0.15); // Scale wobble with line thickness

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

    // Find the divider line matching a panel edge
    const findMatchingLine = (edge, tapZone) => {
      const tolerance = 0.02;
      const { x, y, width, height } = tapZone;

      if (edge === 'top') {
        if (y < tolerance) return null;
        return lines.find(l => l.type === 'horizontal' && Math.abs(l.y - y) < tolerance && l.x1 <= x + tolerance && l.x2 >= x + width - tolerance) || null;
      }
      if (edge === 'bottom') {
        if (y + height > 1 - tolerance) return null;
        return lines.find(l => l.type === 'horizontal' && Math.abs(l.y - (y + height)) < tolerance && l.x1 <= x + tolerance && l.x2 >= x + width - tolerance) || null;
      }
      if (edge === 'left') {
        if (x < tolerance) return null;
        return lines.find(l => l.type === 'vertical' && Math.abs(l.x - x) < tolerance && l.y1 <= y + tolerance && l.y2 >= y + height - tolerance) || null;
      }
      if (edge === 'right') {
        if (x + width > 1 - tolerance) return null;
        return lines.find(l => l.type === 'vertical' && Math.abs(l.x - (x + width)) < tolerance && l.y1 <= y + tolerance && l.y2 >= y + height - tolerance) || null;
      }
      return null;
    };

    // Compute pixel-space corner offsets for a diagonal panel edge.
    // Returns { startOffset, endOffset } in pixels — the Y offset (for horizontal lines)
    // or X offset (for vertical lines) at each end of the panel edge.
    // Returns null if the line is straight (no diagonal).
    const getEdgeDiagonalOffsets = (line, edge, tapZone) => {
      if (line.type === 'horizontal') {
        const y1 = line.y1 != null ? line.y1 : line.y;
        const y2 = line.y2 != null ? line.y2 : line.y;
        if (Math.abs(y1 - y2) < 0.001) return null;

        // The panel edge runs from tapZone.x to tapZone.x+width (in normalized coords)
        // The line runs from line.x1 to line.x2
        // Interpolate the y offset at each panel edge boundary
        const lineSpan = line.x2 - line.x1;
        if (lineSpan < 0.001) return null;

        const tStart = (tapZone.x - line.x1) / lineSpan;
        const tEnd = (tapZone.x + tapZone.width - line.x1) / lineSpan;
        const yAtStart = (y1 + (y2 - y1) * tStart) * canvasHeight;
        const yAtEnd = (y1 + (y2 - y1) * tEnd) * canvasHeight;
        const baseY = line.y * canvasHeight;

        return {
          startOffset: yAtStart - baseY,
          endOffset: yAtEnd - baseY
        };
      } else {
        const x1 = line.x1 != null ? line.x1 : line.x;
        const x2 = line.x2 != null ? line.x2 : line.x;
        if (Math.abs(x1 - x2) < 0.001) return null;

        const lineSpan = line.y2 - line.y1;
        if (lineSpan < 0.001) return null;

        const tStart = (tapZone.y - line.y1) / lineSpan;
        const tEnd = (tapZone.y + tapZone.height - line.y1) / lineSpan;
        const xAtStart = (x1 + (x2 - x1) * tStart) * canvasWidth;
        const xAtEnd = (x1 + (x2 - x1) * tEnd) * canvasWidth;
        const baseX = line.x * canvasWidth;

        return {
          startOffset: xAtStart - baseX,
          endOffset: xAtEnd - baseX
        };
      }
    };

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

      // Check if any edge has a diagonal divider line
      const topLine = findMatchingLine('top', panel.tapZone);
      const bottomLine = findMatchingLine('bottom', panel.tapZone);
      const leftLine = findMatchingLine('left', panel.tapZone);
      const rightLine = findMatchingLine('right', panel.tapZone);

      const topDiag = topLine ? getEdgeDiagonalOffsets(topLine, 'top', panel.tapZone) : null;
      const bottomDiag = bottomLine ? getEdgeDiagonalOffsets(bottomLine, 'bottom', panel.tapZone) : null;
      const leftDiag = leftLine ? getEdgeDiagonalOffsets(leftLine, 'left', panel.tapZone) : null;
      const rightDiag = rightLine ? getEdgeDiagonalOffsets(rightLine, 'right', panel.tapZone) : null;

      const hasDiagonals = topDiag || bottomDiag || leftDiag || rightDiag;

      // Compute the 4 corners with diagonal offsets
      // TL = top-left, TR = top-right, BR = bottom-right, BL = bottom-left
      const tlX = adjustedX + (leftDiag ? leftDiag.startOffset : 0) + (topDiag ? 0 : 0);
      const tlY = adjustedY + (topDiag ? topDiag.startOffset : 0) + (leftDiag ? 0 : 0);
      const trX = adjustedX + adjustedW + (rightDiag ? rightDiag.startOffset : 0);
      const trY = adjustedY + (topDiag ? topDiag.endOffset : 0);
      const brX = adjustedX + adjustedW + (rightDiag ? rightDiag.endOffset : 0);
      const brY = adjustedY + adjustedH + (bottomDiag ? bottomDiag.endOffset : 0);
      const blX = adjustedX + (leftDiag ? leftDiag.endOffset : 0);
      const blY = adjustedY + adjustedH + (bottomDiag ? bottomDiag.startOffset : 0);

      ctx.save();
      if (hasDiagonals) {
        ctx.beginPath();
        ctx.moveTo(tlX, tlY);
        ctx.lineTo(trX, trY);
        ctx.lineTo(brX, brY);
        ctx.lineTo(blX, blY);
        ctx.closePath();
        ctx.clip();
      }

      // When diagonals are present, expand the draw area to the polygon's bounding box
      // so the image fills the full clipped region (the clip trims it to the right shape)
      const drawX = hasDiagonals ? Math.min(tlX, blX) : adjustedX;
      const drawY = hasDiagonals ? Math.min(tlY, trY) : adjustedY;
      const drawR = hasDiagonals ? Math.max(trX, brX) : adjustedX + adjustedW;
      const drawB = hasDiagonals ? Math.max(blY, brY) : adjustedY + adjustedH;
      const drawW = drawR - drawX;
      const drawH = drawB - drawY;

      // Trim percentage off each edge to remove AI-generated borders
      const edgeTrim = 0.03; // 3% off each edge
      const trimX = img.width * edgeTrim;
      const trimY = img.height * edgeTrim;
      const trimmedW = img.width - (trimX * 2);
      const trimmedH = img.height - (trimY * 2);

      // Apply per-panel image adjustments (brightness, contrast, saturation)
      const brightness = panelData?.brightness ?? 1;
      const contrast = panelData?.contrast ?? 1;
      const saturation = panelData?.saturation ?? 1;
      const hasFilters = brightness !== 1 || contrast !== 1 || saturation !== 1;
      if (hasFilters) {
        ctx.filter = `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`;
      }

      if (fitMode === 'crop') {
        // Crop mode: preserve aspect ratio, cover the panel, and allow repositioning + zoom
        const imgAspect = trimmedW / trimmedH;
        const panelAspect = drawW / drawH;

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

        // Draw to bounding box of clip polygon (clip trims to actual shape)
        ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, drawX, drawY, drawW, drawH);
      } else {
        // Stretch mode: scale to fit exactly (may distort), but trim edges
        ctx.drawImage(img, trimX, trimY, trimmedW, trimmedH, drawX, drawY, drawW, drawH);
      }

      // Reset filter after drawing
      if (hasFilters) {
        ctx.filter = 'none';
      }
      ctx.restore();
    }

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

    // Allow manual override of border color
    if (borderColorOverrideRef.current) {
      borderColor = borderColorOverrideRef.current;
    }

    // Draw hand-drawn style panel borders for regular panels
    ctx.strokeStyle = borderColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const panel of regularPanels) {
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

      // Find diagonal edges for this panel
      const topLine = findMatchingLine('top', panel.tapZone);
      const bottomLine = findMatchingLine('bottom', panel.tapZone);
      const leftLine = findMatchingLine('left', panel.tapZone);
      const rightLine = findMatchingLine('right', panel.tapZone);

      const topDiag = topLine ? getEdgeDiagonalOffsets(topLine, 'top', panel.tapZone) : null;
      const bottomDiag = bottomLine ? getEdgeDiagonalOffsets(bottomLine, 'bottom', panel.tapZone) : null;
      const leftDiag = leftLine ? getEdgeDiagonalOffsets(leftLine, 'left', panel.tapZone) : null;
      const rightDiag = rightLine ? getEdgeDiagonalOffsets(rightLine, 'right', panel.tapZone) : null;

      // Compute corner positions with diagonal offsets
      const tlX = adjustedX + (leftDiag ? leftDiag.startOffset : 0);
      const tlY = adjustedY + (topDiag ? topDiag.startOffset : 0);
      const trX = adjustedX + adjustedW + (rightDiag ? rightDiag.startOffset : 0);
      const trY = adjustedY + (topDiag ? topDiag.endOffset : 0);
      const brX = adjustedX + adjustedW + (rightDiag ? rightDiag.endOffset : 0);
      const brY = adjustedY + adjustedH + (bottomDiag ? bottomDiag.endOffset : 0);
      const blX = adjustedX + (leftDiag ? leftDiag.endOffset : 0);
      const blY = adjustedY + adjustedH + (bottomDiag ? bottomDiag.startOffset : 0);

      // Draw multiple passes for thicker, more organic look
      const bt = borderThicknessRef.current;
      if (bt > 0) {
        const borderScale = bt / 100;
        const baseLine = 6 + Math.random() * 3; // 6-9px base at 2048-wide canvas
        for (let pass = 0; pass < 3; pass++) {
          ctx.lineWidth = baseLine * borderScale;

          // Top edge (TL → TR)
          drawWobblyLine(tlX, tlY, trX, trY);
          // Right edge (TR → BR)
          drawWobblyLine(trX, trY, brX, brY);
          // Bottom edge (BR → BL)
          drawWobblyLine(brX, brY, blX, blY);
          // Left edge (BL → TL)
          drawWobblyLine(blX, blY, tlX, tlY);
        }
      }
    }

    // Render floating panels ON TOP of regular panels
    const floatingMargin = 3;
    for (const panel of floatingPanels) {
      const panelData = panelImages[panel.id];
      if (!panelData?.path) continue;

      let img;
      try {
        img = await loadImage(`http://localhost:3001${panelData.path}`);
      } catch (error) {
        console.error(`Failed to load floating panel image for ${panel.id}:`, error);
        continue;
      }

      // Use corners if available, fall back to tapZone rectangle
      const corners = panel.corners && panel.corners.length === 4
        ? panel.corners.map(c => ({ x: c.x * canvasWidth, y: c.y * canvasHeight }))
        : (() => {
            const { x, y, width, height } = panel.tapZone;
            const px = x * canvasWidth, py = y * canvasHeight;
            const pw = width * canvasWidth, ph = height * canvasHeight;
            return [
              { x: px, y: py }, { x: px + pw, y: py },
              { x: px + pw, y: py + ph }, { x: px, y: py + ph }
            ];
          })();

      // Shrink corners inward by floatingMargin for the inner (image) polygon
      const centroidX = corners.reduce((s, c) => s + c.x, 0) / 4;
      const centroidY = corners.reduce((s, c) => s + c.y, 0) / 4;
      const innerCorners = corners.map(c => {
        const dx = c.x - centroidX;
        const dy = c.y - centroidY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) return { ...c };
        const shrink = Math.min(floatingMargin, dist);
        return { x: c.x - (dx / dist) * shrink, y: c.y - (dy / dist) * shrink };
      });

      // Compute bounding box from corners (for image positioning)
      const bboxX = Math.min(...corners.map(c => c.x));
      const bboxY = Math.min(...corners.map(c => c.y));
      const bboxW = Math.max(...corners.map(c => c.x)) - bboxX;
      const bboxH = Math.max(...corners.map(c => c.y)) - bboxY;

      // Draw gutter-colored background within the outer polygon
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.fillStyle = gutterColor;
      ctx.fill();
      ctx.restore();

      // Draw image clipped to the inner polygon
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(innerCorners[0].x, innerCorners[0].y);
      for (let i = 1; i < innerCorners.length; i++) ctx.lineTo(innerCorners[i].x, innerCorners[i].y);
      ctx.closePath();
      ctx.clip();

      // Trim edges and apply image adjustments
      const edgeTrim = 0.03;
      const trimX = img.width * edgeTrim;
      const trimY = img.height * edgeTrim;
      const trimmedW = img.width - (trimX * 2);
      const trimmedH = img.height - (trimY * 2);

      const fitMode = panelData?.fitMode || 'stretch';
      const cropX = panelData?.cropX ?? 0;
      const cropY = panelData?.cropY ?? 0;
      const zoom = panelData?.zoom ?? 1;

      const brightness = panelData?.brightness ?? 1;
      const contrast = panelData?.contrast ?? 1;
      const saturation = panelData?.saturation ?? 1;
      const hasFilters = brightness !== 1 || contrast !== 1 || saturation !== 1;
      if (hasFilters) {
        ctx.filter = `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`;
      }

      if (fitMode === 'crop') {
        const imgAspect = trimmedW / trimmedH;
        const panelAspect = bboxW / bboxH;
        let baseSourceW, baseSourceH;
        if (imgAspect > panelAspect) {
          baseSourceH = trimmedH;
          baseSourceW = trimmedH * panelAspect;
        } else {
          baseSourceW = trimmedW;
          baseSourceH = trimmedW / panelAspect;
        }
        const sourceW = baseSourceW / zoom;
        const sourceH = baseSourceH / zoom;
        const maxOffsetX = Math.max(0, trimmedW - sourceW);
        const maxOffsetY = Math.max(0, trimmedH - sourceH);
        const sourceX = trimX + (maxOffsetX / 2) * (1 + cropX);
        const sourceY = trimY + (maxOffsetY / 2) * (1 + cropY);
        ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, bboxX, bboxY, bboxW, bboxH);
      } else {
        ctx.drawImage(img, trimX, trimY, trimmedW, trimmedH, bboxX, bboxY, bboxW, bboxH);
      }

      if (hasFilters) {
        ctx.filter = 'none';
      }
      ctx.restore();

      // Draw wobbly border along each edge of the polygon
      const btFloat = floatingBorderThicknessRef.current;
      if (btFloat > 0) {
        const borderScale = btFloat / 100;
        ctx.strokeStyle = borderColor;
        const baseLineFloat = 6 + Math.random() * 3;
        for (let pass = 0; pass < 3; pass++) {
          ctx.lineWidth = baseLineFloat * borderScale;
          for (let i = 0; i < innerCorners.length; i++) {
            const from = innerCorners[i];
            const to = innerCorners[(i + 1) % innerCorners.length];
            drawWobblyLine(from.x, from.y, to.x, to.y);
          }
        }
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
      formData.append('image', blob, `composited-${isCover ? 'cover' : pageId}.png`);

      const uploadResponse = await api.post('/images/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (isCover) {
        // Save to project as cover
        const savedPath = uploadResponse.data.path;
        const updatedCover = { ...comic.cover, image: savedPath, bakedImage: '' };
        await api.put(`/comics/${id}`, { cover: updatedCover });
        setComic(prev => ({ ...prev, cover: updatedCover }));
        setPage(prev => ({ ...prev, masterImage: savedPath + `?t=${Date.now()}`, bakedImage: '' }));
        showToast('Cover image updated!');
      } else {
        // Save to project as page
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

        showToast('Composited page saved!');
      }
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

          if (isCover) {
            await api.post('/images/save-to-project', {
              comicId: id,
              filename: uploadResponse.data.filename,
              imageType: 'cover-baked',
              pageNumber: 0
            });

            const bakedPath = `/projects/${id}/images/${id}_cover_baked.png`;
            const updatedComic = { ...comic };
            updatedComic.cover = { ...updatedComic.cover, bakedImage: bakedPath };
            await api.put(`/comics/${id}`, updatedComic);
            setComic(updatedComic);
          } else {
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
          }

          setPage(prev => ({ ...prev, bakedImage: `${(isCover ? `/projects/${id}/images/${id}_cover_baked.png` : `/projects/${id}/images/${id}_p${page.pageNumber}_baked.png`)}?t=${Date.now()}` }));
          showToast('Bubbles baked into image!');
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

      const referenceImages = getAllSelectedRefImagePaths();
      const response = await api.post('/images/generate-page', {
        prompt,
        size: '1024x1536', // Portrait for comic pages (GPT image supported size)
        referenceImages
      }, { timeout: 600000 });

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
        const updatedCover = { ...comic.cover, image: savedPath, prompt: coverPrompt, bakedImage: '' };
        await api.put(`/comics/${id}`, { cover: updatedCover });
        setComic(prev => ({ ...prev, cover: updatedCover }));
        setPage(prev => ({ ...prev, masterImage: savedPath + `?t=${Date.now()}`, bakedImage: '' }));
        showToast('Image saved to cover!');
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
      showToast('Image saved to page!');
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
      {/* Toast notification */}
      {toast && (
        <div style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 10000,
          padding: '0.6rem 1.2rem', borderRadius: '8px',
          background: toast.type === 'error' ? '#e74c3c' : '#27ae60',
          color: '#fff', fontSize: '0.9rem', fontWeight: 500,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          animation: 'fadeIn 0.2s ease'
        }}>
          {toast.message}
        </div>
      )}
      {lightboxImage && (
        <div
          onClick={() => {
            if (inpaintMode) { exitInpaintMode(); }
            else { setLightboxImage(null); setLightboxRefContext(null); }
          }}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.85)', zIndex: 10001,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            cursor: (lightboxRefContext || inpaintMode) ? 'default' : 'pointer'
          }}
        >
          {/* Close button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (inpaintMode) { exitInpaintMode(); }
              else { setLightboxImage(null); setLightboxRefContext(null); }
            }}
            style={{
              position: 'absolute', top: '16px', right: '16px',
              width: '36px', height: '36px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.2)', color: '#fff',
              border: '2px solid rgba(255,255,255,0.5)',
              fontSize: '18px', cursor: 'pointer', zIndex: 2,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0, lineHeight: 1
            }}
          >✕</button>

          {/* Instruction text for annotation mode */}
          {lightboxRefContext && !inpaintMode && (
            <div style={{
              position: 'absolute', top: '16px', left: '50%',
              transform: 'translateX(-50%)',
              color: '#fff', fontSize: '0.9rem', fontWeight: 'bold',
              background: 'rgba(0,0,0,0.6)',
              padding: '0.4rem 1rem', borderRadius: '6px',
              pointerEvents: 'none', zIndex: 2
            }}>
              Click to place markers (1, 2, 3...) — Click a marker to remove it
            </div>
          )}

          {/* Image container with annotations / inpaint rect */}
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', display: 'inline-block' }}>
            <img
              src={lightboxImage}
              alt="Full size preview"
              draggable={false}
              onClick={lightboxRefContext && !inpaintMode ? (e) => {
                e.stopPropagation();
                const rect = e.target.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width;
                const y = (e.clientY - rect.top) / rect.height;
                const { panelId, refIndex } = lightboxRefContext;
                setPanelImages(prev => {
                  if (refIndex === -1) {
                    const existing = prev[panelId]?.annotations || [];
                    const nextId = existing.length > 0 ? Math.max(...existing.map(a => a.id)) + 1 : 1;
                    return { ...prev, [panelId]: { ...prev[panelId], annotations: [...existing, { id: nextId, x, y }] } };
                  } else {
                    const refs = [...(prev[panelId]?.refImages || [])];
                    const ref = typeof refs[refIndex] === 'string'
                      ? { path: refs[refIndex], annotations: [] }
                      : { ...refs[refIndex] };
                    const nextId = ref.annotations.length > 0
                      ? Math.max(...ref.annotations.map(a => a.id)) + 1
                      : 1;
                    refs[refIndex] = { ...ref, annotations: [...ref.annotations, { id: nextId, x, y }] };
                    return { ...prev, [panelId]: { ...prev[panelId], refImages: refs } };
                  }
                });
              } : undefined}
              onMouseDown={inpaintMode && !inpaintGenerating ? (e) => {
                e.preventDefault();
                const rect = e.target.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width;
                const y = (e.clientY - rect.top) / rect.height;
                setInpaintDrawing(true);
                setInpaintStart({ x, y });
                setInpaintRect(null);
              } : undefined}
              onMouseMove={inpaintDrawing ? (e) => {
                const rect = e.target.getBoundingClientRect();
                const currentX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const currentY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
                setInpaintRect({
                  x: Math.min(inpaintStart.x, currentX),
                  y: Math.min(inpaintStart.y, currentY),
                  width: Math.abs(currentX - inpaintStart.x),
                  height: Math.abs(currentY - inpaintStart.y)
                });
              } : undefined}
              onMouseUp={inpaintDrawing ? () => setInpaintDrawing(false) : undefined}
              style={{
                maxWidth: '90vw', maxHeight: inpaintMode ? '75vh' : '90vh',
                display: 'block', borderRadius: '4px',
                cursor: (lightboxRefContext || inpaintMode) ? 'crosshair' : 'default',
                userSelect: inpaintMode ? 'none' : undefined
              }}
            />

            {/* Inpaint rectangle overlay */}
            {inpaintMode && inpaintRect && (
              <div style={{
                position: 'absolute',
                left: `${inpaintRect.x * 100}%`,
                top: `${inpaintRect.y * 100}%`,
                width: `${inpaintRect.width * 100}%`,
                height: `${inpaintRect.height * 100}%`,
                border: '2px dashed #00ff88',
                background: 'rgba(0, 255, 136, 0.15)',
                pointerEvents: 'none',
                boxSizing: 'border-box'
              }} />
            )}

            {/* Annotation circles */}
            {lightboxRefContext && !inpaintMode && (() => {
              const { panelId, refIndex } = lightboxRefContext;
              const annotations = refIndex === -1
                ? (panelImages[panelId]?.annotations || [])
                : getRefAnnotations((panelImages[panelId]?.refImages || [])[refIndex]);
              return annotations.map(ann => (
                <div
                  key={ann.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPanelImages(prev => {
                      if (refIndex === -1) {
                        return { ...prev, [panelId]: { ...prev[panelId], annotations: (prev[panelId]?.annotations || []).filter(a => a.id !== ann.id) } };
                      } else {
                        const refs = [...(prev[panelId]?.refImages || [])];
                        const ref = typeof refs[refIndex] === 'string'
                          ? { path: refs[refIndex], annotations: [] }
                          : { ...refs[refIndex] };
                        refs[refIndex] = { ...ref, annotations: ref.annotations.filter(a => a.id !== ann.id) };
                        return { ...prev, [panelId]: { ...prev[panelId], refImages: refs } };
                      }
                    });
                  }}
                  title={`Click to remove #${ann.id}`}
                  style={{
                    position: 'absolute',
                    left: `${ann.x * 100}%`, top: `${ann.y * 100}%`,
                    transform: 'translate(-50%, -50%)',
                    width: '28px', height: '28px', borderRadius: '50%',
                    background: '#e74c3c', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '14px', fontWeight: 'bold',
                    border: '2px solid #fff',
                    cursor: 'pointer', zIndex: 2,
                    boxShadow: '0 2px 6px rgba(0,0,0,0.5)'
                  }}
                >{ann.id}</div>
              ));
            })()}
          </div>

          {/* Inpaint controls panel */}
          {inpaintMode && (
            <div onClick={(e) => e.stopPropagation()} style={{
              background: 'rgba(0,0,0,0.85)',
              padding: '0.75rem 1rem', borderRadius: '8px',
              display: 'flex', flexDirection: 'column', gap: '0.5rem',
              minWidth: '400px', maxWidth: '600px',
              marginTop: '12px'
            }}>
              {!inpaintRect ? (
                <div style={{ color: '#ccc', fontSize: '0.9rem', textAlign: 'center' }}>
                  Draw a rectangle on the image to select the region to inpaint
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={inpaintPrompt}
                    onChange={(e) => setInpaintPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && inpaintPrompt.trim() && !inpaintGenerating) {
                        executeInpaint('openai');
                      }
                    }}
                    placeholder="Describe what to generate in this region..."
                    disabled={!!inpaintGenerating}
                    style={{
                      padding: '0.5rem', borderRadius: '4px',
                      border: '1px solid #555', background: '#222', color: '#fff',
                      fontSize: '0.85rem'
                    }}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                    <button
                      onClick={() => executeInpaint('openai')}
                      disabled={!inpaintPrompt.trim() || !!inpaintGenerating}
                      style={{
                        padding: '0.4rem 1rem', fontSize: '0.8rem',
                        background: inpaintGenerating ? '#95a5a6' : '#27ae60',
                        color: '#fff', border: 'none', borderRadius: '4px',
                        cursor: inpaintGenerating ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {inpaintGenerating === 'openai' ? 'Inpainting...' : 'Inpaint (ChatGPT)'}
                    </button>
                    <button
                      onClick={() => executeInpaint('gemini')}
                      disabled={!inpaintPrompt.trim() || !!inpaintGenerating}
                      style={{
                        padding: '0.4rem 1rem', fontSize: '0.8rem',
                        background: inpaintGenerating ? '#95a5a6' : '#4285f4',
                        color: '#fff', border: 'none', borderRadius: '4px',
                        cursor: inpaintGenerating ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {inpaintGenerating === 'gemini' ? 'Inpainting...' : 'Inpaint (Gemini)'}
                    </button>
                    <button
                      onClick={() => { setInpaintRect(null); setInpaintPrompt(''); }}
                      disabled={!!inpaintGenerating}
                      style={{
                        padding: '0.4rem 0.8rem', fontSize: '0.8rem',
                        background: '#555', color: '#fff', border: 'none',
                        borderRadius: '4px', cursor: 'pointer'
                      }}
                    >
                      Redraw
                    </button>
                    <button
                      onClick={exitInpaintMode}
                      disabled={!!inpaintGenerating}
                      style={{
                        padding: '0.4rem 0.8rem', fontSize: '0.8rem',
                        background: '#e74c3c', color: '#fff', border: 'none',
                        borderRadius: '4px', cursor: 'pointer'
                      }}
                    >
                      Done
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
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
              ? (isDrawingFloatingPanel ? 'Draw a rectangle for the floating panel' : 'Draw lines by dragging | Drag lines to reposition')
              : isAddingBubble
                ? 'Click on canvas to place bubble'
                : 'Drag to reposition | Select to edit'}
        </span>
        {editorMode === 'layout' && !isCover && (
          <button
            className={`btn ${isDrawingFloatingPanel ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setIsDrawingFloatingPanel(!isDrawingFloatingPanel)}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', background: isDrawingFloatingPanel ? '#e67e22' : undefined, border: isDrawingFloatingPanel ? 'none' : undefined, color: isDrawingFloatingPanel ? '#fff' : undefined }}
          >
            {isDrawingFloatingPanel ? 'Cancel' : '+ Floating Panel'}
          </button>
        )}
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
          {selectedPanel && panels.find(p => p.id === selectedPanel && p.floating) && (
            <button
              className="btn"
              onClick={() => deleteFloatingPanel(selectedPanel)}
              style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', background: '#c0392b', color: '#fff', border: 'none' }}
            >
              Delete Floating Panel
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
              if (isDraggingFloatingPanel) {
                setIsDraggingFloatingPanel(false);
                setDraggingFloatingPanelId(null);
              }
              if (isDrawingFloatingPanel && floatingPanelStart) {
                setFloatingPanelStart(null);
                setFloatingPanelEnd(null);
                setIsDrawingFloatingPanel(false);
              }
            }}
            style={{
              width: CANVAS_WIDTH,
              height: CANVAS_HEIGHT,
              background: page.masterImage ? 'transparent' : '#f5f5f5',
              border: '2px solid #ddd',
              borderRadius: '4px',
              position: 'relative',
              cursor: isDragging || isDraggingFloatingPanel || isDraggingCorner ? 'grabbing' : isDrawingFloatingPanel ? 'crosshair' : (editorMode === 'bubbles' ? (isAddingBubble ? 'crosshair' : 'default') : 'crosshair'),
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

            {/* Panel regions (regular panels only; floating panels rendered separately) */}
            {panelsComputed && panels.filter(p => !p.floating).map((panel, i) => (
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
                {panels.indexOf(panel) + 1}
              </div>
            ))}

            {/* Drawn lines with endpoint handles */}
            {lines.map((line, i) => (
              <React.Fragment key={`line-${i}`}>
                {line.type === 'horizontal' ? (
                  <>
                    {/* Horizontal line bar (faded when diagonal — SVG line replaces it) */}
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
                        borderRadius: '2px',
                        opacity: (line.y1 != null && line.y2 != null && Math.abs(line.y1 - line.y2) > 0.005) ? 0.25 : 1
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
                        top: `${(line.y1 != null ? line.y1 : line.y) * 100}%`,
                        width: '14px',
                        height: '14px',
                        background: selectedLineIndex === i ? '#00ff00' : '#e94560',
                        border: '2px solid #fff',
                        borderRadius: '50%',
                        transform: 'translate(-50%, -50%)',
                        cursor: 'move',
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
                        top: `${(line.y2 != null ? line.y2 : line.y) * 100}%`,
                        width: '14px',
                        height: '14px',
                        background: selectedLineIndex === i ? '#00ff00' : '#e94560',
                        border: '2px solid #fff',
                        borderRadius: '50%',
                        transform: 'translate(-50%, -50%)',
                        cursor: 'move',
                        zIndex: 25,
                        boxShadow: '0 0 4px rgba(0,0,0,0.5)'
                      }}
                    />
                  </>
                ) : (
                  <>
                    {/* Vertical line bar (faded when diagonal — SVG line replaces it) */}
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
                        borderRadius: '2px',
                        opacity: (line.x1 != null && line.x2 != null && Math.abs(line.x1 - line.x2) > 0.005) ? 0.25 : 1
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
                        left: `${(line.x1 != null ? line.x1 : line.x) * 100}%`,
                        top: `${line.y1 * 100}%`,
                        width: '14px',
                        height: '14px',
                        background: selectedLineIndex === i ? '#00ff00' : '#3498db',
                        border: '2px solid #fff',
                        borderRadius: '50%',
                        transform: 'translate(-50%, -50%)',
                        cursor: 'move',
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
                        left: `${(line.x2 != null ? line.x2 : line.x) * 100}%`,
                        top: `${line.y2 * 100}%`,
                        width: '14px',
                        height: '14px',
                        background: selectedLineIndex === i ? '#00ff00' : '#3498db',
                        border: '2px solid #fff',
                        borderRadius: '50%',
                        transform: 'translate(-50%, -50%)',
                        cursor: 'move',
                        zIndex: 25,
                        boxShadow: '0 0 4px rgba(0,0,0,0.5)'
                      }}
                    />
                  </>
                )}
              </React.Fragment>
            ))}

            {/* SVG overlay for diagonal line visualization */}
            <svg
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                zIndex: 22,
                pointerEvents: 'none',
                overflow: 'visible'
              }}
            >
              {lines.map((line, i) => {
                const isSelected = selectedLineIndex === i;

                if (line.type === 'horizontal') {
                  const y1 = line.y1 != null ? line.y1 : line.y;
                  const y2 = line.y2 != null ? line.y2 : line.y;
                  const isDiagonal = Math.abs(y1 - y2) > 0.005;
                  if (!isDiagonal) return null;

                  const sx = line.x1 * CANVAS_WIDTH;
                  const sy = y1 * CANVAS_HEIGHT;
                  const ex = line.x2 * CANVAS_WIDTH;
                  const ey = y2 * CANVAS_HEIGHT;
                  const lineColor = isSelected ? '#00ff00' : '#e94560';

                  return (
                    <g key={`diag-${i}`}>
                      {/* Wide invisible hit area */}
                      <line
                        x1={sx} y1={sy} x2={ex} y2={ey}
                        stroke="transparent"
                        strokeWidth="14"
                        style={{ pointerEvents: 'auto', cursor: 'ns-resize' }}
                        onMouseDown={(e) => handleLineMouseDown(e, i)}
                      />
                      {/* Visible diagonal line */}
                      <line
                        x1={sx} y1={sy} x2={ex} y2={ey}
                        stroke={lineColor}
                        strokeWidth="4"
                        strokeLinecap="round"
                        opacity="0.9"
                        style={{ pointerEvents: 'none', filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.5))' }}
                      />
                    </g>
                  );
                } else {
                  const x1 = line.x1 != null ? line.x1 : line.x;
                  const x2 = line.x2 != null ? line.x2 : line.x;
                  const isDiagonal = Math.abs(x1 - x2) > 0.005;
                  if (!isDiagonal) return null;

                  const sx = x1 * CANVAS_WIDTH;
                  const sy = line.y1 * CANVAS_HEIGHT;
                  const ex = x2 * CANVAS_WIDTH;
                  const ey = line.y2 * CANVAS_HEIGHT;
                  const lineColor = isSelected ? '#00ff00' : '#3498db';

                  return (
                    <g key={`diag-${i}`}>
                      <line
                        x1={sx} y1={sy} x2={ex} y2={ey}
                        stroke="transparent"
                        strokeWidth="14"
                        style={{ pointerEvents: 'auto', cursor: 'ew-resize' }}
                        onMouseDown={(e) => handleLineMouseDown(e, i)}
                      />
                      <line
                        x1={sx} y1={sy} x2={ex} y2={ey}
                        stroke={lineColor}
                        strokeWidth="4"
                        strokeLinecap="round"
                        opacity="0.9"
                        style={{ pointerEvents: 'none', filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.5))' }}
                      />
                    </g>
                  );
                }
              })}
            </svg>

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

            {/* Floating panel preview while drawing */}
            {isDrawingFloatingPanel && floatingPanelStart && floatingPanelEnd && (() => {
              const x = Math.min(floatingPanelStart.x, floatingPanelEnd.x);
              const y = Math.min(floatingPanelStart.y, floatingPanelEnd.y);
              const w = Math.abs(floatingPanelEnd.x - floatingPanelStart.x);
              const h = Math.abs(floatingPanelEnd.y - floatingPanelStart.y);
              if (w < 0.01 && h < 0.01) return null;
              return (
                <div
                  style={{
                    position: 'absolute',
                    left: `${x * 100}%`,
                    top: `${y * 100}%`,
                    width: `${w * 100}%`,
                    height: `${h * 100}%`,
                    border: '2px dashed #e67e22',
                    background: 'rgba(230, 126, 34, 0.15)',
                    zIndex: 35,
                    pointerEvents: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              );
            })()}

            {/* Floating panel overlays (SVG) */}
            {panels.filter(p => p.floating && p.corners).length > 0 && (
              <svg
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 32, pointerEvents: 'none', overflow: 'visible' }}
              >
                {panels.filter(p => p.floating && p.corners).map((panel) => {
                  const isSelected = selectedPanel === panel.id;
                  const pts = panel.corners.map(c => `${c.x * CANVAS_WIDTH},${c.y * CANVAS_HEIGHT}`).join(' ');
                  return (
                    <g key={`floating-${panel.id}`}>
                      {/* Polygon fill + outline */}
                      <polygon
                        points={pts}
                        fill={isSelected ? 'rgba(230, 126, 34, 0.25)' : 'rgba(230, 126, 34, 0.1)'}
                        stroke="#e67e22"
                        strokeWidth={isSelected ? 2 : 1.5}
                        strokeDasharray={isSelected ? 'none' : '6 3'}
                        style={{ pointerEvents: 'auto', cursor: 'grab' }}
                        data-floating-panel={panel.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPanel(panel.id);
                          setSelectedLineIndex(null);
                        }}
                      />
                      {/* "F" label at centroid */}
                      <text
                        x={panel.corners.reduce((s, c) => s + c.x, 0) / 4 * CANVAS_WIDTH}
                        y={panel.corners.reduce((s, c) => s + c.y, 0) / 4 * CANVAS_HEIGHT}
                        fill="#e67e22"
                        fontSize="12"
                        fontWeight="bold"
                        textAnchor="middle"
                        dominantBaseline="central"
                        style={{ pointerEvents: 'none' }}
                      >
                        {panels.indexOf(panel) + 1}
                      </text>
                      {/* Corner handles */}
                      {panel.corners.map((c, ci) => (
                        <circle
                          key={ci}
                          cx={c.x * CANVAS_WIDTH}
                          cy={c.y * CANVAS_HEIGHT}
                          r={isSelected ? 6 : 4}
                          fill="#e67e22"
                          stroke="#fff"
                          strokeWidth={2}
                          style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
                          data-corner-drag={panel.id}
                          data-corner-index={ci}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setIsDraggingCorner(true);
                            setDraggingCornerPanelId(panel.id);
                            setDraggingCornerIndex(ci);
                            setSelectedPanel(panel.id);
                            setSelectedLineIndex(null);
                          }}
                        />
                      ))}
                    </g>
                  );
                })}
              </svg>
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
                    const tailWidth = (bubble.tailWidth ?? 0.15) * bw; // wide tail base
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
                            setSidebarTab('panels');
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
                      setSidebarTab('panels');
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
                      padding: bubble.type === 'image' ? '2px' : '6px 8px',
                      boxSizing: 'border-box',
                      cursor: editorMode === 'bubbles' ? (bubble.locked ? 'default' : (isDraggingBubble ? 'grabbing' : 'grab')) : 'default',
                      zIndex: 50,
                      boxShadow: selectedBubbleId === bubble.id ? '0 0 10px rgba(0,255,0,0.5)' : 'none',
                      // Hand-drawn effect with slight rotation and rough filter
                      transform: `rotate(${(bubble.id.charCodeAt(bubble.id.length - 1) % 5) - 2}deg)`,
                      filter: 'url(#roughEdge)'
                    }}
                  >
                    {bubble.type === 'image' ? (
                      bubble.imageUrl ? (
                        <img
                          src={`http://localhost:3001${bubble.imageUrl}`}
                          alt="Bubble image"
                          crossOrigin="anonymous"
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain',
                            pointerEvents: 'none',
                            userSelect: 'none'
                          }}
                        />
                      ) : (
                        <span style={{ color: '#999', fontSize: '11px', pointerEvents: 'none', userSelect: 'none' }}>
                          {bubble.imageGenerating ? 'Generating...' : (editorMode === 'bubbles' ? 'Image' : '')}
                        </span>
                      )
                    ) : (
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
                    )}

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
                <h4>Panel {i + 1}{panel.floating && <span style={{ color: '#e67e22', fontSize: '0.7rem', marginLeft: '0.3rem' }}>(floating)</span>}</h4>
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

              {/* Default bubble colors */}
              <div style={{ marginBottom: '0.75rem', padding: '0.5rem', background: '#f5f5f5', borderRadius: '6px', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.75rem', color: '#666', fontWeight: 'bold' }}>Defaults:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                  <span style={{ fontSize: '0.7rem', color: '#888' }}>BG</span>
                  <ColorPicker
                    value={defaultBubbleStyle.bgColor}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDefaultBubbleStyle(prev => ({ ...prev, bgColor: val }));
                      api.put(`/comics/${id}`, { defaultBubbleStyle: { ...defaultBubbleStyle, bgColor: val } }).catch(err => console.error('Failed to save defaults:', err));
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: '28px', height: '22px', border: '1px solid #ccc', borderRadius: '3px' }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                  <span style={{ fontSize: '0.7rem', color: '#888' }}>Border</span>
                  <ColorPicker
                    value={defaultBubbleStyle.borderColor}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDefaultBubbleStyle(prev => ({ ...prev, borderColor: val }));
                      api.put(`/comics/${id}`, { defaultBubbleStyle: { ...defaultBubbleStyle, borderColor: val } }).catch(err => console.error('Failed to save defaults:', err));
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: '28px', height: '22px', border: '1px solid #ccc', borderRadius: '3px' }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                  <span style={{ fontSize: '0.7rem', color: '#888' }}>Text</span>
                  <ColorPicker
                    value={defaultBubbleStyle.textColor}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDefaultBubbleStyle(prev => ({ ...prev, textColor: val }));
                      api.put(`/comics/${id}`, { defaultBubbleStyle: { ...defaultBubbleStyle, textColor: val } }).catch(err => console.error('Failed to save defaults:', err));
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: '28px', height: '22px', border: '1px solid #ccc', borderRadius: '3px' }}
                  />
                </div>
              </div>

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
                          {['speech', 'thought', 'narration', 'image'].map(type => (
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

                      {/* Image Bubble Controls */}
                      {bubble.type === 'image' && (
                        <div style={{ marginBottom: '0.5rem' }}>
                          <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '0.25rem' }}>
                            Image Prompt:
                          </label>
                          <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.5rem' }}>
                            <input
                              type="text"
                              value={bubble.imagePrompt || ''}
                              onChange={(e) => { e.stopPropagation(); updateBubble(bubble.id, { imagePrompt: e.target.value }); }}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && bubble.imagePrompt) {
                                  e.preventDefault();
                                  generateBubbleImage(bubble.id, bubble.imagePrompt, 'openai');
                                }
                              }}
                              placeholder="e.g. a wooden chair"
                              style={{
                                flex: 1,
                                padding: '0.4rem',
                                borderRadius: '4px',
                                border: '1px solid #ccc',
                                fontSize: '0.85rem'
                              }}
                            />
                            <button
                              onClick={(e) => { e.stopPropagation(); generateBubbleImage(bubble.id, bubble.imagePrompt, 'openai'); }}
                              disabled={bubble.imageGenerating || !bubble.imagePrompt}
                              style={{
                                padding: '0.4rem 0.6rem',
                                background: bubble.imageGenerating ? '#ccc' : '#27ae60',
                                border: 'none',
                                borderRadius: '4px',
                                color: '#fff',
                                cursor: bubble.imageGenerating ? 'not-allowed' : 'pointer',
                                fontSize: '0.75rem',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {bubble.imageGenerating === 'openai' ? '⏳...' : 'GPT'}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); generateBubbleImage(bubble.id, bubble.imagePrompt, 'gemini'); }}
                              disabled={bubble.imageGenerating || !bubble.imagePrompt}
                              style={{
                                padding: '0.4rem 0.6rem',
                                background: bubble.imageGenerating ? '#ccc' : '#4285f4',
                                border: 'none',
                                borderRadius: '4px',
                                color: '#fff',
                                cursor: bubble.imageGenerating ? 'not-allowed' : 'pointer',
                                fontSize: '0.75rem',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {bubble.imageGenerating === 'gemini' ? '⏳...' : 'Gemini'}
                            </button>
                            <input
                              type="file"
                              accept="image/*"
                              id={`bubble-upload-${bubble.id}`}
                              style={{ display: 'none' }}
                              onChange={(e) => {
                                if (e.target.files[0]) {
                                  uploadBubbleImage(bubble.id, e.target.files[0]);
                                  e.target.value = '';
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <button
                              onClick={(e) => { e.stopPropagation(); document.getElementById(`bubble-upload-${bubble.id}`).click(); }}
                              disabled={bubble.imageGenerating}
                              style={{
                                padding: '0.4rem 0.6rem',
                                background: bubble.imageGenerating ? '#ccc' : '#8e44ad',
                                border: 'none',
                                borderRadius: '4px',
                                color: '#fff',
                                cursor: bubble.imageGenerating ? 'not-allowed' : 'pointer',
                                fontSize: '0.75rem',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {bubble.imageGenerating === 'upload' ? '⏳...' : 'Upload'}
                            </button>
                          </div>
                          {bubble.imageUrl && (
                            <div style={{ marginBottom: '0.5rem' }}>
                              <img
                                src={`http://localhost:3001${bubble.imageUrl}`}
                                alt="Generated"
                                style={{ width: '80px', height: '80px', objectFit: 'contain', borderRadius: '4px', border: '1px solid #ddd' }}
                              />
                              <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginTop: '0.5rem', marginBottom: '0.25rem' }}>
                                Refine:
                              </label>
                              <div style={{ display: 'flex', gap: '0.25rem' }}>
                                <input
                                  type="text"
                                  value={bubble.imageRefinePrompt || ''}
                                  onChange={(e) => { e.stopPropagation(); updateBubble(bubble.id, { imageRefinePrompt: e.target.value }); }}
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && bubble.imageRefinePrompt) {
                                      e.preventDefault();
                                      refineBubbleImage(bubble.id, bubble.imageRefinePrompt, bubble.imageUrl);
                                    }
                                  }}
                                  placeholder="e.g. make it more colorful"
                                  style={{
                                    flex: 1,
                                    padding: '0.4rem',
                                    borderRadius: '4px',
                                    border: '1px solid #ccc',
                                    fontSize: '0.85rem'
                                  }}
                                />
                                <button
                                  onClick={(e) => { e.stopPropagation(); refineBubbleImage(bubble.id, bubble.imageRefinePrompt, bubble.imageUrl); }}
                                  disabled={bubble.imageGenerating || !bubble.imageRefinePrompt}
                                  style={{
                                    padding: '0.4rem 0.8rem',
                                    background: bubble.imageGenerating ? '#ccc' : '#8e44ad',
                                    border: 'none',
                                    borderRadius: '4px',
                                    color: '#fff',
                                    cursor: (bubble.imageGenerating || !bubble.imageRefinePrompt) ? 'not-allowed' : 'pointer',
                                    fontSize: '0.8rem',
                                    whiteSpace: 'nowrap'
                                  }}
                                >
                                  {bubble.imageGenerating === 'refine' ? '⏳...' : 'Refine'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Font Selector (hidden for image bubbles) */}
                      {bubble.type !== 'image' && (
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
                      )}

                      {/* Colors */}
                      <div style={{ marginBottom: '0.5rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div>
                          <label style={{ fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: '0.2rem' }}>
                            Background
                          </label>
                          <ColorPicker
                            value={bubble.bgColor || '#ffffff'}
                            onChange={(e) => updateBubble(bubble.id, { bgColor: e.target.value, bgTransparent: false })}
                            onClick={(e) => e.stopPropagation()}
                            disabled={bubble.bgTransparent}
                            style={{
                              width: '40px',
                              height: '28px',
                              border: '1px solid #ccc',
                              borderRadius: '4px'
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
                            <ColorPicker
                              value={bubble.borderColor || '#000000'}
                              onChange={(e) => updateBubble(bubble.id, { borderColor: e.target.value })}
                              onClick={(e) => e.stopPropagation()}
                              disabled={bubble.noBorder}
                              style={{ width: '32px', height: '24px', border: '1px solid #ccc', borderRadius: '4px' }}
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
                          <ColorPicker
                            value={bubble.textColor || '#000000'}
                            onChange={(e) => updateBubble(bubble.id, { textColor: e.target.value })}
                            onClick={(e) => e.stopPropagation()}
                            style={{ width: '40px', height: '28px', border: '1px solid #ccc', borderRadius: '4px' }}
                          />
                        </div>
                      </div>

                      {/* Sentences (hidden for image bubbles) */}
                      {bubble.type !== 'image' && (
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
                              {['[slowly]', '[whispering]', '[shouting]', '[frightened]', '[surprised]', '[amazed]', '[sad]', '[hopeful]', '[worried]', '[excited]', '[confused]','[sighs]', '[pause]'].map(tag => {
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
                            {/* Alternative texts */}
                            {(sentence.alternatives || []).map((alt, altIdx) => (
                              <div key={altIdx} style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.25rem', alignItems: 'center' }}>
                                <input
                                  type="text"
                                  defaultValue={alt.text}
                                  onBlur={(e) => {
                                    const updatedAlts = [...(sentence.alternatives || [])];
                                    updatedAlts[altIdx] = { ...updatedAlts[altIdx], text: e.target.value.trim() };
                                    updateSentence(bubble.id, sentence.id, { alternatives: updatedAlts.filter(a => a.text) });
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  placeholder="Alternative text"
                                  style={{
                                    flex: 1,
                                    padding: '0.3rem',
                                    borderRadius: '3px',
                                    border: '1px solid #e0c080',
                                    background: '#fef9ef',
                                    fontSize: '0.8rem'
                                  }}
                                />
                                <button
                                  onClick={(e) => { e.stopPropagation(); generateAlternativeAudio(bubble.id, sentence.id, altIdx); }}
                                  disabled={generatingAudio[`${sentence.id}-alt-${altIdx}`] || !alt.text || !selectedVoiceId}
                                  style={{
                                    padding: '0.2rem 0.4rem',
                                    fontSize: '0.7rem',
                                    background: alt.audioUrl ? '#27ae60' : generatingAudio[`${sentence.id}-alt-${altIdx}`] ? '#95a5a6' : '#3498db',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '3px',
                                    cursor: generatingAudio[`${sentence.id}-alt-${altIdx}`] ? 'wait' : 'pointer',
                                    whiteSpace: 'nowrap'
                                  }}
                                >
                                  {generatingAudio[`${sentence.id}-alt-${altIdx}`] ? '...' : alt.audioUrl ? 'Regen' : 'Gen Audio'}
                                </button>
                                {alt.audioUrl && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (audioRef.current) audioRef.current.pause();
                                      const audio = new Audio(`http://localhost:3001/projects/${id}/audio/${alt.audioUrl}.mp3`);
                                      audioRef.current = audio;
                                      audio.play();
                                    }}
                                    style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem', background: '#27ae60', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
                                  >
                                    ▶
                                  </button>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const updatedAlts = (sentence.alternatives || []).filter((_, i) => i !== altIdx);
                                    updateSentence(bubble.id, sentence.id, { alternatives: updatedAlts });
                                  }}
                                  style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem', background: '#e74c3c', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
                                >
                                  x
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const updatedAlts = [...(sentence.alternatives || []), { text: '', audioUrl: '' }];
                                updateSentence(bubble.id, sentence.id, { alternatives: updatedAlts });
                              }}
                              style={{
                                padding: '0.2rem 0.5rem',
                                fontSize: '0.7rem',
                                background: 'transparent',
                                color: '#e67e22',
                                border: '1px dashed #e67e22',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                marginBottom: '0.25rem'
                              }}
                            >
                              + Alternative
                            </button>

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
                                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (audioRef.current) audioRef.current.pause();
                                        const audio = new Audio(`http://localhost:3001/projects/${id}/audio/${sentence.audioUrl}.mp3`);
                                        audioRef.current = audio;
                                        audio.play();
                                      }}
                                      style={{
                                        padding: '0.1rem 0.35rem',
                                        fontSize: '0.6rem',
                                        background: '#27ae60',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: '3px',
                                        cursor: 'pointer'
                                      }}
                                      title="Play saved audio"
                                    >
                                      ▶ Saved
                                    </button>
                                  </span>
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

                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    setSavingText(prev => ({ ...prev, [sentence.id]: true }));
                                    try {
                                      const cleanedText = sentence.text ? stripAudioTags(sentence.text) : '';
                                      const normWord = (s) => (s || '').toLowerCase().replace(/[.,!?;:"""''¿¡…\[\]]/g, '').trim();
                                      const cleanWord = (s) => (s || '').replace(/[.,!?;:"""''¿¡…\[\]]+/g, '').trim();
                                      const audioTagWords = new Set(['slowly', 'whispering', 'shouting', 'frightened', 'surprised', 'amazed', 'hopeful', 'worried', 'excited', 'pause', 'sighs', 'laughs', 'cries', 'gasps', 'whispers', 'shouts', 'sad', 'angry', 'happy', 'fearful', 'fearfully', 'very']);

                                      // Build fresh words from text, always using current text as-is
                                      const existingWords = sentence.words || [];
                                      const textWords = cleanedText.split(/\s+/).filter(w => w && !audioTagWords.has(normWord(w)));
                                      const allWords = textWords.map(w => {
                                        const normalised = normWord(w);
                                        const existing = existingWords.find(ew => normWord(ew.text) === normalised);
                                        return {
                                          id: existing?.id || `word-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                                          text: w,
                                          meaning: '',
                                          baseForm: '',
                                          startTimeMs: existing?.startTimeMs,
                                          endTimeMs: existing?.endTimeMs,
                                          vocabQuiz: existing?.vocabQuiz || false
                                        };
                                      });

                                      // Auto-fill meaning/baseForm via batch lookup
                                      const wordsNeedingLookup = allWords.filter(w => !w.meaning);
                                      if (wordsNeedingLookup.length > 0 && cleanedText) {
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
                                            wordsNeedingLookup.forEach((w, i) => {
                                              if (lookupResults[i] && !lookupResults[i].isName) {
                                                w.meaning = cleanWord(lookupResults[i].meaning || '');
                                                w.baseForm = cleanWord(lookupResults[i].baseForm || '');
                                              }
                                            });
                                          }
                                        } catch (lookupError) {
                                          console.error('Batch word lookup failed:', lookupError);
                                        }
                                      }

                                      // Update local state with cleaned text + words
                                      const updatedBubbles = bubbles.map(b => {
                                        if (b.id !== bubble.id) return b;
                                        return {
                                          ...b,
                                          sentences: (b.sentences || []).map(s =>
                                            s.id === sentence.id ? { ...s, text: cleanedText, words: allWords } : s
                                          )
                                        };
                                      });
                                      setBubbles(updatedBubbles);

                                      // Persist to database
                                      if (isCover) {
                                        const coverPrompt = panels[0]?.content || '';
                                        await api.put(`/comics/${id}/cover`, {
                                          image: page.masterImage,
                                          prompt: coverPrompt,
                                          bubbles: updatedBubbles
                                        });
                                      } else {
                                        let panelsToSave = panels;
                                        if (!panelsComputed) {
                                          const floatingPanels = panels.filter(p => p.floating);
                                          const recomputed = computePanelsFromLines(lines, pageId);
                                          panelsToSave = [...recomputed, ...floatingPanels];
                                          setPanels(panelsToSave);
                                          setPanelsComputed(true);
                                        }
                                        const updatedComic = { ...comic };
                                        if (promptSettingsSource !== 'collection') {
                                          updatedComic.promptSettings = promptSettings;
                                        }
                                        const pageIndex = updatedComic.pages.findIndex(p => p.id === pageId);
                                        updatedComic.pages[pageIndex] = {
                                          ...page,
                                          lines,
                                          panels: panelsToSave,
                                          bubbles: updatedBubbles
                                        };
                                        await api.put(`/comics/${id}`, updatedComic);
                                        setComic(updatedComic);
                                        setPage(updatedComic.pages[pageIndex]);
                                      }
                                    } catch (error) {
                                      console.error('Failed to save text:', error);
                                      alert('Failed to save text');
                                    }
                                    setSavingText(prev => ({ ...prev, [sentence.id]: false }));
                                  }}
                                  disabled={!sentence.text || savingText[sentence.id]}
                                  style={{
                                    padding: '0.25rem 0.5rem',
                                    fontSize: '0.65rem',
                                    background: (!sentence.text || savingText[sentence.id]) ? '#95a5a6' : '#e67e22',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '3px',
                                    cursor: (!sentence.text || savingText[sentence.id]) ? 'default' : 'pointer'
                                  }}
                                  title="Save cleaned text and build word dictionary without regenerating audio"
                                >
                                  {savingText[sentence.id] ? 'Saving...' : 'Save Text'}
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
                                        saveAudio(bubble.id, sentence.id, page.pageNumber, panelIdx + 1, i + 1, sIdx + 1);
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

                              {(sentence.words || []).length > 0 && (
                                <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.15rem' }}>
                                  <span style={{ flex: 1, minWidth: 0, fontSize: '0.65rem', color: '#999', paddingLeft: '0.25rem' }}>Word</span>
                                  <span style={{ flex: 1, minWidth: 0, fontSize: '0.65rem', color: '#999', paddingLeft: '0.25rem' }}>Meaning</span>
                                  <span style={{ flex: 1, minWidth: 0, fontSize: '0.65rem', color: '#999', paddingLeft: '0.25rem' }}>Base Form</span>
                                  <span style={{ width: '110px', flexShrink: 0 }}></span>
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
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (audioRef.current) audioRef.current.pause();
                                      const sanitized = word.text.toLowerCase().replace(/[.,!?;:"""''¿¡…\[\](){}\/\\]/g, '').trim().replace(/\s+/g, '_');
                                      if (sanitized) {
                                        const audio = new Audio(`http://localhost:3001/projects/${id}/audio/words/${sanitized}.mp3`);
                                        audioRef.current = audio;
                                        audio.play().catch(() => {});
                                      }
                                    }}
                                    disabled={!word.text}
                                    style={{
                                      padding: '0.15rem 0.25rem',
                                      background: 'transparent',
                                      border: '1px solid #3498db',
                                      borderRadius: '2px',
                                      color: '#3498db',
                                      cursor: word.text ? 'pointer' : 'default',
                                      fontSize: '0.6rem',
                                      flexShrink: 0,
                                      opacity: word.text ? 1 : 0.3
                                    }}
                                    title="Play word audio"
                                  >
                                    ▶
                                  </button>
                                  {word.baseForm && word.baseForm.toLowerCase() !== word.text.toLowerCase() && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (audioRef.current) audioRef.current.pause();
                                        const sanitized = word.baseForm.toLowerCase().replace(/[.,!?;:"""''¿¡…\[\](){}\/\\]/g, '').trim().replace(/\s+/g, '_');
                                        if (sanitized) {
                                          const audio = new Audio(`http://localhost:3001/projects/${id}/audio/words/${sanitized}.mp3`);
                                          audioRef.current = audio;
                                          audio.play().catch(() => {});
                                        }
                                      }}
                                      style={{
                                        padding: '0.15rem 0.25rem',
                                        background: 'transparent',
                                        border: '1px solid #9b59b6',
                                        borderRadius: '2px',
                                        color: '#9b59b6',
                                        cursor: 'pointer',
                                        fontSize: '0.6rem',
                                        flexShrink: 0
                                      }}
                                      title="Play base form audio"
                                    >
                                      ▶B
                                    </button>
                                  )}
                                  <label
                                    onClick={(e) => e.stopPropagation()}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    title="Include in Vocabulary Quiz"
                                    style={{ display: 'flex', alignItems: 'center', flexShrink: 0, cursor: 'pointer', gap: '1px' }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={word.vocabQuiz || false}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => updateWord(bubble.id, sentence.id, word.id, { vocabQuiz: e.target.checked })}
                                      style={{ margin: 0, cursor: 'pointer' }}
                                    />
                                    <span style={{ fontSize: '0.6rem', color: '#666' }}>Q</span>
                                  </label>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); removeWord(bubble.id, sentence.id, word.id); }}
                                    onMouseDown={(e) => e.stopPropagation()}
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

                        <button
                          onClick={(e) => { e.stopPropagation(); updateBubble(bubble.id, { locked: !bubble.locked }); }}
                          style={{
                            padding: '0.3rem 0.6rem',
                            background: bubble.locked ? '#e67e22' : '#95a5a6',
                            border: 'none',
                            borderRadius: '3px',
                            color: '#fff',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            width: '100%',
                            marginTop: '0.5rem'
                          }}
                        >
                          {bubble.locked ? 'Unlock Bubble' : 'Lock Bubble'}
                        </button>
                      </div>
                      )}

                      {/* Font Size (hidden for image bubbles) */}
                      {bubble.type !== 'image' && (
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
                      )}

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

                      {/* Sound effect (no audio) - hidden for image bubbles */}
                      {bubble.type !== 'image' && (
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
                      )}

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

                          {/* Tail Width */}
                          <div style={{ marginBottom: '0.5rem' }}>
                            <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '0.25rem' }}>
                              Tail Width: {Math.round((bubble.tailWidth ?? 0.15) * 100)}%
                            </label>
                            <input
                              type="range"
                              min="10"
                              max="50"
                              value={Math.round((bubble.tailWidth ?? 0.15) * 100)}
                              onChange={(e) => updateBubble(bubble.id, { tailWidth: parseInt(e.target.value) / 100 })}
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
                              max="300"
                              value={Math.round((bubble.tailLength ?? 0.35) * 100)}
                              onChange={(e) => updateBubble(bubble.id, { tailLength: parseInt(e.target.value) / 100 })}
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
                <h3
                  style={{ color: '#888', cursor: 'pointer', userSelect: 'none', fontSize: '0.95rem' }}
                  onClick={() => setPromptSettingsOpen(prev => !prev)}
                >
                  {promptSettingsOpen ? '▼' : '▶'} Global Prompt Settings
                </h3>
                {promptSettingsOpen && (
                  <button
                    className="btn btn-primary"
                    onClick={savePromptSettings}
                    style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
                  >
                    Save Settings
                  </button>
                )}
              </div>

              {promptSettingsOpen && <>
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

              {/* Style Bible Reference Images */}
              {promptSettings.styleBibleImages && promptSettings.styleBibleImages.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ fontSize: '0.95rem', color: '#e94560', fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }}>
                    Style Reference Images ({promptSettings.styleBibleImages.length})
                  </label>
                  {promptSettings.styleBibleImages.map((img, idx) => (
                    <div key={img.id || idx} style={{ background: '#fff', borderRadius: '4px', padding: '0.75rem', marginBottom: '0.75rem', border: '1px solid #ccc' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                        <img
                          src={`http://localhost:3001${img.image}`}
                          alt={img.name || `Style ref ${idx + 1}`}
                          style={{ height: '80px', borderRadius: '4px', border: '1px solid #999', flexShrink: 0, cursor: 'pointer' }}
                          onClick={() => { setLightboxImage(`http://localhost:3001${img.image}`); setLightboxRefContext(null); }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#333', marginBottom: '0.25rem' }}>{img.name || `Style ref ${idx + 1}`}</div>
                          <p style={{ fontSize: '0.8rem', color: '#666', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '80px', overflow: 'hidden' }}>
                            {img.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

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
                      {char.image && (
                        <img
                          src={`http://localhost:3001${char.image}`}
                          alt={char.name}
                          style={{ height: '50px', borderRadius: '4px', border: '1px solid #999', flexShrink: 0 }}
                        />
                      )}
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

              </>}

              {/* ChatGPT Quality Toggle */}
              <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.8rem', color: '#888' }}>ChatGPT Quality:</label>
                <button
                  onClick={() => setOpenaiQuality('high')}
                  style={{
                    padding: '0.2rem 0.6rem',
                    fontSize: '0.75rem',
                    background: openaiQuality === 'high' ? '#27ae60' : '#e0e0e0',
                    color: openaiQuality === 'high' ? '#fff' : '#666',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontWeight: openaiQuality === 'high' ? 'bold' : 'normal'
                  }}
                >
                  High
                </button>
                <button
                  onClick={() => setOpenaiQuality('medium')}
                  style={{
                    padding: '0.2rem 0.6rem',
                    fontSize: '0.75rem',
                    background: openaiQuality === 'medium' ? '#e67e22' : '#e0e0e0',
                    color: openaiQuality === 'medium' ? '#fff' : '#666',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontWeight: openaiQuality === 'medium' ? 'bold' : 'normal'
                  }}
                >
                  Medium (~4x cheaper)
                </button>
              </div>

              {/* Page-level Bible Refs (shared by all panels) */}
              {(promptSettings.styleBibleImages?.length > 0 || (promptSettings.characters || []).some(c => c.image)) && (
                <div style={{ marginBottom: '1rem' }}>
                  <button
                    onClick={() => setShowPageBiblePicker(!showPageBiblePicker)}
                    style={{
                      padding: '0.35rem 0.75rem',
                      fontSize: '0.8rem',
                      background: pageBibleRefs.length > 0 ? '#e8d5f5' : '#f0f0f0',
                      color: pageBibleRefs.length > 0 ? '#6c3483' : '#555',
                      border: `1px solid ${pageBibleRefs.length > 0 ? '#6c3483' : '#ccc'}`,
                      borderRadius: '4px',
                      cursor: 'pointer',
                      width: '100%'
                    }}
                  >
                    Page Refs{pageBibleRefs.length > 0 ? ` (${pageBibleRefs.length} selected — shared by all panels)` : ' (none — click to select)'}
                  </button>
                  {showPageBiblePicker && (
                    <div style={{
                      background: '#fff', border: '1px solid #ccc', borderRadius: '8px',
                      padding: '0.75rem', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      marginTop: '0.5rem', maxHeight: '300px', overflowY: 'auto'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontWeight: 'bold', fontSize: '0.8rem', color: '#333' }}>Page-level Refs (all panels)</span>
                        <div style={{ display: 'flex', gap: '0.3rem' }}>
                          <button onClick={() => {
                            const allIds = [
                              ...(promptSettings.styleBibleImages || []).map(img => String(img.id)),
                              ...(promptSettings.characters || []).filter(c => c.image).map(c => String(c.id))
                            ];
                            setPageBibleRefs(allIds);
                          }}
                            style={{ fontSize: '0.65rem', background: 'none', border: '1px solid #ccc', borderRadius: '3px', cursor: 'pointer', padding: '0.1rem 0.3rem' }}>
                            All
                          </button>
                          <button onClick={() => setPageBibleRefs([])}
                            style={{ fontSize: '0.65rem', background: 'none', border: '1px solid #ccc', borderRadius: '3px', cursor: 'pointer', padding: '0.1rem 0.3rem' }}>
                            None
                          </button>
                          <button onClick={() => setShowPageBiblePicker(false)}
                            style={{ fontSize: '0.65rem', background: 'none', border: '1px solid #ccc', borderRadius: '3px', cursor: 'pointer', padding: '0.1rem 0.3rem' }}>
                            Close
                          </button>
                        </div>
                      </div>
                      {(promptSettings.styleBibleImages || []).length > 0 && (
                        <div style={{ fontSize: '0.7rem', color: '#888', marginBottom: '0.3rem', fontWeight: 'bold' }}>Scenes</div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                        {(promptSettings.styleBibleImages || []).map(img => {
                          const isSelected = pageBibleRefs.includes(String(img.id));
                          return (
                            <div key={img.id}
                              onClick={() => {
                                setPageBibleRefs(prev => isSelected
                                  ? prev.filter(id => id !== String(img.id))
                                  : [...prev, String(img.id)]
                                );
                              }}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '0.5rem',
                                cursor: 'pointer', border: isSelected ? '2px solid #6c3483' : '2px solid transparent',
                                borderRadius: '6px', padding: '3px', background: isSelected ? '#f0e6f6' : '#f9f9f9'
                              }}>
                              <img src={`http://localhost:3001${img.image}`} alt={img.name}
                                style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                              <span style={{ fontSize: '0.7rem', color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {img.name || (img.description ? img.description.split(',')[0].substring(0, 40) : 'Style ref')}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {(promptSettings.characters || []).filter(c => c.image).length > 0 && (
                        <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '0.5rem', marginBottom: '0.3rem', fontWeight: 'bold' }}>Characters</div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                        {(promptSettings.characters || []).filter(c => c.image).map(char => {
                          const isSelected = pageBibleRefs.includes(String(char.id));
                          return (
                            <div key={char.id}
                              onClick={() => {
                                setPageBibleRefs(prev => isSelected
                                  ? prev.filter(id => id !== String(char.id))
                                  : [...prev, String(char.id)]
                                );
                              }}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '0.5rem',
                                cursor: 'pointer', border: isSelected ? '2px solid #6c3483' : '2px solid transparent',
                                borderRadius: '6px', padding: '3px', background: isSelected ? '#f0e6f6' : '#f9f9f9'
                              }}>
                              <img src={`http://localhost:3001${char.image}`} alt={char.name}
                                style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                              <span style={{ fontSize: '0.7rem', color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {char.name}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Panel Contents (also used for cover) */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ fontSize: '0.95rem', color: '#e94560', fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }}>
                  {isCover ? 'Cover Content' : `Panel Contents (${panels.length})`}
                </label>
                {panels.length === 0 ? (
                  <p style={{ color: '#888', fontSize: '0.85rem' }}>
                    Compute panels first to add content
                  </p>
                ) : (
                  panels.map((panel, i) => (
                    <div key={panel.id} style={{ marginBottom: '1rem', padding: '0.75rem', background: i % 2 === 0 ? '#f0f0f0' : '#fff', borderRadius: '8px', border: '2px solid #bbb' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <label style={{ fontSize: '0.85rem', color: '#666', fontWeight: 'bold' }}>
                          {isCover ? 'Cover' : `Panel ${i + 1}`}
                          {!isCover && (
                          <span style={{ fontWeight: 'normal', marginLeft: '0.5rem', color: '#999' }}>
                            ({(panel.tapZone.width * 100).toFixed(0)}% × {(panel.tapZone.height * 100).toFixed(0)}%)
                          </span>
                          )}
                          <button
                            onClick={() => {
                              const prompt = buildPanelPrompt(panel, i);
                              const win = window.open('', '_blank', 'width=800,height=600');
                              win.document.write(`<html><head><title>Panel ${i + 1} Prompt</title></head><body><pre style="white-space:pre-wrap;word-wrap:break-word;font-family:monospace;font-size:13px;padding:1rem;max-width:800px">${prompt.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></body></html>`);
                            }}
                            style={{ marginLeft: '0.5rem', fontSize: '0.6rem', color: '#2980b9', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                          >
                            View Prompt
                          </button>
                        </label>
                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                          {panelImages[panel.id]?.generating && panelImages[panel.id]?.generating !== 'upload' ? (
                            <button
                              onClick={() => stopPanelGeneration(panel.id)}
                              style={{
                                padding: '0.25rem 0.5rem',
                                fontSize: '0.7rem',
                                background: '#e74c3c',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                              }}
                            >
                              Stop ({panelImages[panel.id]?.generating === 'openai' ? 'ChatGPT' : 'Gemini'})
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => generatePanelImage(panel, i, 'openai')}
                                disabled={panelImages[panel.id]?.generating || !panel.content?.trim()}
                                style={{
                                  padding: '0.25rem 0.5rem',
                                  fontSize: '0.7rem',
                                  background: panelImages[panel.id]?.generating ? '#95a5a6' : panel.content?.trim() ? '#27ae60' : '#ccc',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: panelImages[panel.id]?.generating || !panel.content?.trim() ? 'not-allowed' : 'pointer'
                                }}
                              >
                                ChatGPT
                              </button>
                              <button
                                onClick={() => generatePanelImage(panel, i, 'gemini')}
                                disabled={panelImages[panel.id]?.generating || !panel.content?.trim()}
                                style={{
                                  padding: '0.25rem 0.5rem',
                                  fontSize: '0.7rem',
                                  background: panelImages[panel.id]?.generating ? '#95a5a6' : panel.content?.trim() ? '#4285f4' : '#ccc',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: panelImages[panel.id]?.generating || !panel.content?.trim() ? 'not-allowed' : 'pointer'
                                }}
                              >
                                Gemini
                              </button>
                            </>
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            id={`panel-upload-${panel.id}`}
                            style={{ display: 'none' }}
                            onChange={(e) => {
                              if (e.target.files[0]) {
                                uploadPanelImage(panel, e.target.files[0]);
                                e.target.value = '';
                              }
                            }}
                          />
                          <button
                            onClick={() => document.getElementById(`panel-upload-${panel.id}`).click()}
                            disabled={panelImages[panel.id]?.generating}
                            style={{
                              padding: '0.25rem 0.5rem',
                              fontSize: '0.7rem',
                              background: panelImages[panel.id]?.generating ? '#95a5a6' : '#8e44ad',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: panelImages[panel.id]?.generating ? 'not-allowed' : 'pointer'
                            }}
                          >
                            {panelImages[panel.id]?.generating === 'upload' ? '⏳...' : 'Upload'}
                          </button>
                          <button
                            onClick={() => setBiblePickerPanelId(biblePickerPanelId === panel.id ? null : panel.id)}
                            style={{
                              padding: '0.25rem 0.5rem',
                              fontSize: '0.7rem',
                              background: (panel.selectedBibleRefs?.length > 0) ? '#e8d5f5' : '#f0f0f0',
                              color: (panel.selectedBibleRefs?.length > 0) ? '#6c3483' : '#555',
                              border: `1px solid ${(panel.selectedBibleRefs?.length > 0) ? '#6c3483' : '#ccc'}`,
                              borderRadius: '4px',
                              cursor: 'pointer'
                            }}
                          >
                            Refs{panel.selectedBibleRefs?.length > 0 ? ` (${panel.selectedBibleRefs.length})` : ''}
                          </button>
                        </div>
                      </div>
                      {/* Bible Refs Picker Popover */}
                      {biblePickerPanelId === panel.id && (
                        <div style={{
                          background: '#fff', border: '1px solid #ccc', borderRadius: '8px',
                          padding: '0.75rem', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                          marginBottom: '0.5rem', maxHeight: '250px', overflowY: 'auto'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                            <span style={{ fontWeight: 'bold', fontSize: '0.8rem', color: '#333' }}>Select Bible Refs</span>
                            <div style={{ display: 'flex', gap: '0.3rem' }}>
                              <button onClick={() => selectAllBibleRefs(panel.id)}
                                style={{ fontSize: '0.65rem', background: 'none', border: '1px solid #ccc', borderRadius: '3px', cursor: 'pointer', padding: '0.1rem 0.3rem' }}>
                                All
                              </button>
                              <button onClick={() => clearAllBibleRefs(panel.id)}
                                style={{ fontSize: '0.65rem', background: 'none', border: '1px solid #ccc', borderRadius: '3px', cursor: 'pointer', padding: '0.1rem 0.3rem' }}>
                                None
                              </button>
                              <button onClick={() => setBiblePickerPanelId(null)}
                                style={{ fontSize: '0.65rem', background: 'none', border: '1px solid #ccc', borderRadius: '3px', cursor: 'pointer', padding: '0.1rem 0.3rem' }}>
                                Close
                              </button>
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                            {(promptSettings.styleBibleImages || []).map(img => {
                              const isSelected = (panel.selectedBibleRefs || []).includes(String(img.id));
                              return (
                                <div key={img.id}
                                  onClick={() => togglePanelBibleRef(panel.id, img.id)}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    cursor: 'pointer', border: isSelected ? '2px solid #6c3483' : '2px solid transparent',
                                    borderRadius: '6px', padding: '3px', background: isSelected ? '#f0e6f6' : '#f9f9f9'
                                  }}>
                                  <img src={`http://localhost:3001${img.image}`} alt={img.name}
                                    style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                                  <span style={{ fontSize: '0.7rem', color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {img.name || (img.description ? img.description.split(',')[0].substring(0, 40) : 'Style ref')}
                                  </span>
                                </div>
                              );
                            })}
                            {(promptSettings.characters || []).filter(c => c.image).map(char => {
                              const isSelected = (panel.selectedBibleRefs || []).includes(String(char.id));
                              return (
                                <div key={char.id}
                                  onClick={() => togglePanelBibleRef(panel.id, char.id)}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    cursor: 'pointer', border: isSelected ? '2px solid #6c3483' : '2px solid transparent',
                                    borderRadius: '6px', padding: '3px', background: isSelected ? '#f0e6f6' : '#f9f9f9'
                                  }}>
                                  <img src={`http://localhost:3001${char.image}`} alt={char.name}
                                    style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                                  <span style={{ fontSize: '0.7rem', color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {char.name}
                                  </span>
                                </div>
                              );
                            })}
                            {(!promptSettings.styleBibleImages?.length && !(promptSettings.characters || []).some(c => c.image)) && (
                              <p style={{ fontSize: '0.75rem', color: '#999', margin: 0 }}>
                                No style bible images or character images available. Add them in Comic Settings.
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                      <div style={{ position: 'relative', width: '100%' }}>
                        {/* Highlight overlay behind textarea — uses zero-width markers */}
                        {hasHighlights(panel.content) && (
                          <div
                            aria-hidden="true"
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              right: 0,
                              bottom: 0,
                              padding: '0.5rem',
                              fontSize: '0.85rem',
                              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                              lineHeight: '1.15',
                              letterSpacing: 'normal',
                              whiteSpace: 'pre-wrap',
                              wordWrap: 'break-word',
                              overflowWrap: 'break-word',
                              overflow: 'hidden',
                              pointerEvents: 'none',
                              borderRadius: '4px',
                              border: '1px solid transparent',
                              boxSizing: 'border-box',
                              color: 'transparent'
                            }}
                            dangerouslySetInnerHTML={{
                              __html: (panel.content || '')
                                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                                .replace(/\u2060([\s\S]*?)\u2061/g, '<mark style="background:#ffe066;color:transparent;border-radius:2px">$1</mark>')
                            }}
                          />
                        )}
                        <textarea
                          ref={el => { panelTextareaRefs.current[panel.id] = el; }}
                          value={panel.content || ''}
                          onChange={(e) => updatePanelContent(panel.id, e.target.value)}
                          placeholder={`Describe what happens in panel ${i + 1}...`}
                          style={{
                            width: '100%',
                            minHeight: '80px',
                            padding: '0.5rem',
                            borderRadius: '4px',
                            border: '1px solid #ccc',
                            background: hasHighlights(panel.content) ? 'transparent' : '#fff',
                            color: '#333',
                            caretColor: '#333',
                            fontSize: '0.85rem',
                            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                            lineHeight: '1.15',
                            letterSpacing: 'normal',
                            resize: 'vertical',
                            position: 'relative',
                            zIndex: 1,
                            boxSizing: 'border-box'
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem' }}>
                        <button
                          onClick={() => toggleHighlight(panel.id)}
                          title="Highlight selected text (select text first)"
                          style={{
                            padding: '0.2rem 0.5rem',
                            fontSize: '0.75rem',
                            background: '#ffe066',
                            color: '#333',
                            border: '1px solid #e6c800',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                        >
                          Highlight Selection
                        </button>
                        {hasHighlights(panel.content) && (
                          <button
                            onClick={() => clearHighlights(panel.id)}
                            title="Clear all highlights"
                            style={{
                              padding: '0.2rem 0.5rem',
                              fontSize: '0.75rem',
                              background: '#eee',
                              color: '#666',
                              border: '1px solid #ccc',
                              borderRadius: '4px',
                              cursor: 'pointer'
                            }}
                          >
                            Clear Highlights
                          </button>
                        )}
                      </div>
                      {/* Per-panel reference images */}
                      <button
                        onClick={() => setShowPanelRefs(prev => ({ ...prev, [panel.id]: !prev[panel.id] }))}
                        style={{
                          marginTop: '0.4rem',
                          padding: '0.2rem 0.5rem',
                          fontSize: '0.7rem',
                          background: (panelImages[panel.id]?.refImages?.length > 0 || panel.selectedBibleRefs?.length > 0) ? '#e8d5f5' : '#f5f5f5',
                          color: '#555',
                          border: '1px solid #ccc',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          width: '100%',
                          textAlign: 'left'
                        }}
                      >
                        {showPanelRefs[panel.id] ? '▾' : '▸'} Ref Images
                        {(panelImages[panel.id]?.refImages?.length > 0 || panel.selectedBibleRefs?.length > 0)
                          ? ` (${(panelImages[panel.id]?.refImages?.length || 0) + (panel.selectedBibleRefs?.length || 0)})`
                          : ''}
                      </button>
                      {showPanelRefs[panel.id] && <div style={{ marginTop: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                        {(panelImages[panel.id]?.refImages || []).map((ref, ri) => (
                          <div key={ri} style={{ position: 'relative', display: 'inline-block' }}>
                            <img
                              src={`http://localhost:3001${getRefPath(ref)}`}
                              alt={`Ref ${ri + 1}`}
                              onClick={() => {
                                setLightboxImage(`http://localhost:3001${getRefPath(ref)}`);
                                setLightboxRefContext({ panelId: panel.id, refIndex: ri });
                              }}
                              style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #ccc', cursor: 'pointer' }}
                            />
                            {getRefAnnotations(ref).map(ann => (
                              <div key={ann.id} style={{
                                position: 'absolute',
                                left: `${ann.x * 100}%`, top: `${ann.y * 100}%`,
                                transform: 'translate(-50%, -50%)',
                                width: '12px', height: '12px', borderRadius: '50%',
                                background: '#e74c3c', color: '#fff',
                                fontSize: '7px', fontWeight: 'bold',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                border: '1px solid #fff', pointerEvents: 'none'
                              }}>{ann.id}</div>
                            ))}
                            <button
                              onClick={() => removePanelRefImage(panel.id, ri)}
                              style={{
                                position: 'absolute', top: '-4px', right: '-4px',
                                width: '14px', height: '14px', borderRadius: '50%',
                                background: '#e74c3c', color: '#fff', border: 'none',
                                fontSize: '0.55rem', lineHeight: '14px', textAlign: 'center',
                                cursor: 'pointer', padding: 0
                              }}
                            >x</button>
                          </div>
                        ))}
                        <input
                          type="file"
                          accept="image/*"
                          id={`panel-ref-upload-${panel.id}`}
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            if (e.target.files[0]) {
                              uploadPanelRefImage(panel.id, e.target.files[0]);
                              e.target.value = '';
                            }
                          }}
                        />
                        <button
                          onClick={() => document.getElementById(`panel-ref-upload-${panel.id}`).click()}
                          style={{
                            padding: '0.2rem 0.4rem',
                            fontSize: '0.65rem',
                            background: '#f0f0f0',
                            color: '#555',
                            border: '1px dashed #aaa',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                        >
                          + Ref Image
                        </button>
                        {/* Link other panels' images as references */}
                        {panels.filter(p => p.id !== panel.id && panelImages[p.id]?.path).length > 0 && (
                          <>
                            <span style={{ fontSize: '0.6rem', color: '#999', marginLeft: '0.2rem' }}>|</span>
                            {panels.map((p, pi) => {
                              if (p.id === panel.id || !panelImages[p.id]?.path) return null;
                              const alreadyLinked = (panelImages[panel.id]?.refImages || []).some(r => getRefPath(r) === panelImages[p.id].path);
                              return (
                                <button
                                  key={p.id}
                                  onClick={() => {
                                    if (!alreadyLinked) {
                                      setPanelImages(prev => ({
                                        ...prev,
                                        [panel.id]: {
                                          ...prev[panel.id],
                                          refImages: [...(prev[panel.id]?.refImages || []), { path: panelImages[p.id].path, annotations: panelImages[p.id]?.annotations || [] }]
                                        }
                                      }));
                                    }
                                  }}
                                  disabled={alreadyLinked}
                                  title={alreadyLinked ? `Panel ${pi + 1} already linked` : `Use Panel ${pi + 1}'s image as reference`}
                                  style={{
                                    padding: '0.15rem 0.35rem',
                                    fontSize: '0.6rem',
                                    background: alreadyLinked ? '#ddd' : '#e8f4fc',
                                    color: alreadyLinked ? '#999' : '#2980b9',
                                    border: `1px solid ${alreadyLinked ? '#ccc' : '#2980b9'}`,
                                    borderRadius: '3px',
                                    cursor: alreadyLinked ? 'default' : 'pointer',
                                    opacity: alreadyLinked ? 0.6 : 1
                                  }}
                                >
                                  P{pi + 1}
                                </button>
                              );
                            })}
                          </>
                        )}
                        {/* Cross-page panel references */}
                        {otherPagePanels.length > 0 && (
                          <>
                            <span style={{ fontSize: '0.6rem', color: '#999', marginLeft: '0.2rem' }}>|</span>
                            <button
                              onClick={() => setShowOtherPages(prev => ({ ...prev, [panel.id]: !prev[panel.id] }))}
                              style={{
                                padding: '0.15rem 0.35rem',
                                fontSize: '0.6rem',
                                background: showOtherPages[panel.id] ? '#d5e8d4' : '#f5f5f5',
                                color: '#666',
                                border: '1px solid #aaa',
                                borderRadius: '3px',
                                cursor: 'pointer'
                              }}
                              title="Show panels from other pages"
                            >
                              {showOtherPages[panel.id] ? '▾' : '▸'} Other pages
                            </button>
                            {showOtherPages[panel.id] && otherPagePanels.map((op) => {
                              const alreadyLinked = (panelImages[panel.id]?.refImages || []).some(r => getRefPath(r) === op.artworkImage);
                              return (
                                <button
                                  key={op.panelId}
                                  onClick={() => {
                                    if (!alreadyLinked) {
                                      setPanelImages(prev => ({
                                        ...prev,
                                        [panel.id]: {
                                          ...prev[panel.id],
                                          refImages: [...(prev[panel.id]?.refImages || []), { path: op.artworkImage, annotations: [] }]
                                        }
                                      }));
                                    }
                                  }}
                                  disabled={alreadyLinked}
                                  title={alreadyLinked ? `Pg${op.pageNumber}-P${op.panelIndex + 1} already linked` : `Use Page ${op.pageNumber}, Panel ${op.panelIndex + 1} as reference`}
                                  style={{
                                    padding: '0.15rem 0.35rem',
                                    fontSize: '0.6rem',
                                    background: alreadyLinked ? '#ddd' : '#e8f0fc',
                                    color: alreadyLinked ? '#999' : '#6a1b9a',
                                    border: `1px solid ${alreadyLinked ? '#ccc' : '#6a1b9a'}`,
                                    borderRadius: '3px',
                                    cursor: alreadyLinked ? 'default' : 'pointer',
                                    opacity: alreadyLinked ? 0.6 : 1
                                  }}
                                >
                                  Pg{op.pageNumber}-P{op.panelIndex + 1}
                                </button>
                              );
                            })}
                          </>
                        )}
                      </div>}
                      {/* Framing options */}
                      <div style={{ marginTop: '0.3rem', display: 'flex', flexWrap: 'wrap', gap: '0.15rem 0.5rem', alignItems: 'center' }}>
                        {(() => {
                          const framingKeys = ['subjectSmall', 'cameraFar', 'negativeSpace', 'wideMargins', 'fullEnvironment', 'safeCrop'];
                          const allChecked = framingKeys.every(k => !!panelFraming[panel.id]?.[k]);
                          return (
                            <label style={{ fontSize: '0.65rem', color: '#444', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.15rem', fontWeight: 'bold' }}>
                              <input
                                type="checkbox"
                                checked={allChecked}
                                onChange={(e) => {
                                  const val = e.target.checked;
                                  setPanelFraming(prev => ({
                                    ...prev,
                                    [panel.id]: {
                                      ...prev[panel.id],
                                      ...Object.fromEntries(framingKeys.map(k => [k, val]))
                                    }
                                  }));
                                }}
                                style={{ margin: 0, width: '12px', height: '12px' }}
                              />
                              All
                            </label>
                          );
                        })()}
                        {[
                          { key: 'subjectSmall', label: 'Subject small' },
                          { key: 'cameraFar', label: 'Camera far' },
                          { key: 'negativeSpace', label: 'Negative space' },
                          { key: 'wideMargins', label: 'Wide margins' },
                          { key: 'fullEnvironment', label: 'Full environment' },
                          { key: 'safeCrop', label: 'Safe crop' },
                        ].map(opt => (
                          <label key={opt.key} style={{ fontSize: '0.65rem', color: '#666', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                            <input
                              type="checkbox"
                              checked={!!panelFraming[panel.id]?.[opt.key]}
                              onChange={(e) => setPanelFraming(prev => ({
                                ...prev,
                                [panel.id]: { ...prev[panel.id], [opt.key]: e.target.checked }
                              }))}
                              style={{ margin: 0, width: '12px', height: '12px' }}
                            />
                            {opt.label}
                          </label>
                        ))}
                      </div>
                      {/* Camera angle rotation */}
                      <div style={{ marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.2rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.6rem', color: '#999', marginRight: '0.1rem' }}>Angle:</span>
                        {[
                          { value: -90, label: '-90°' },
                          { value: -75, label: '-75°' },
                          { value: -50, label: '-50°' },
                          { value: -25, label: '-25°' },
                          { value: 0, label: '0°' },
                          { value: 25, label: '+25°' },
                          { value: 50, label: '+50°' },
                          { value: 75, label: '+75°' },
                          { value: 90, label: '+90°' },
                          { value: 180, label: '180°' },
                        ].map(opt => {
                          const current = panelFraming[panel.id]?.cameraAngle || 0;
                          const isSelected = current === opt.value;
                          return (
                            <button
                              key={opt.value}
                              onClick={() => setPanelFraming(prev => ({
                                ...prev,
                                [panel.id]: { ...prev[panel.id], cameraAngle: opt.value }
                              }))}
                              style={{
                                padding: '0.1rem 0.3rem',
                                fontSize: '0.6rem',
                                background: isSelected ? (opt.value === 0 ? '#999' : '#2980b9') : '#f0f0f0',
                                color: isSelected ? '#fff' : '#666',
                                border: `1px solid ${isSelected ? (opt.value === 0 ? '#777' : '#2471a3') : '#ccc'}`,
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontWeight: isSelected ? 'bold' : 'normal',
                                minWidth: '30px',
                                textAlign: 'center'
                              }}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                        {panelImages[panel.id]?.path && (panelFraming[panel.id]?.cameraAngle || 0) !== 0 && (
                          <>
                            <button
                              onClick={() => generatePanelImage(panel, i, 'openai', true)}
                              disabled={panelImages[panel.id]?.generating || !panel.content?.trim()}
                              style={{
                                padding: '0.1rem 0.4rem',
                                fontSize: '0.6rem',
                                background: panelImages[panel.id]?.generating ? '#ccc' : '#27ae60',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: panelImages[panel.id]?.generating ? 'not-allowed' : 'pointer',
                                marginLeft: '0.3rem'
                              }}
                            >
                              Re-gen (GPT)
                            </button>
                            <button
                              onClick={() => generatePanelImage(panel, i, 'gemini', true)}
                              disabled={panelImages[panel.id]?.generating || !panel.content?.trim()}
                              style={{
                                padding: '0.1rem 0.4rem',
                                fontSize: '0.6rem',
                                background: panelImages[panel.id]?.generating ? '#ccc' : '#4285f4',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: panelImages[panel.id]?.generating ? 'not-allowed' : 'pointer'
                              }}
                            >
                              Re-gen (Gemini)
                            </button>
                          </>
                        )}
                      </div>
                      {/* Generating indicator */}
                      {panelImages[panel.id]?.generating && (
                        <div style={{
                          marginTop: '0.5rem',
                          padding: '0.5rem',
                          background: '#f0f0f0',
                          borderRadius: '4px',
                          textAlign: 'center'
                        }}>
                          <div style={{
                            height: '3px',
                            background: 'linear-gradient(90deg, #e94560 0%, #e94560 30%, #eee 30%, #eee 70%, #e94560 70%)',
                            backgroundSize: '200% 100%',
                            borderRadius: '2px',
                            animation: 'shimmer 1.5s infinite linear',
                            marginBottom: '0.4rem'
                          }} />
                          <span style={{ fontSize: '0.75rem', color: '#666' }}>
                            Generating with {panelImages[panel.id].generating === 'openai' ? 'ChatGPT' : 'Gemini'}...
                          </span>
                          <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
                        </div>
                      )}
                      {/* Panel image preview + refinement */}
                      {panelImages[panel.id]?.path && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <div style={{ position: 'relative', display: 'inline-block' }}>
                            <img
                              src={`http://localhost:3001${panelImages[panel.id].path}`}
                              alt={`Panel ${i + 1}`}
                              onClick={() => { setLightboxImage(`http://localhost:3001${panelImages[panel.id].path}`); setLightboxRefContext({ panelId: panel.id, refIndex: -1 }); }}
                              style={{
                                maxWidth: '100%',
                                maxHeight: '150px',
                                display: 'block',
                                borderRadius: '4px',
                                border: '1px solid #ddd',
                                cursor: 'pointer',
                                opacity: panelImages[panel.id]?.generating ? 0.4 : 1,
                                transition: 'opacity 0.3s'
                              }}
                            />
                            {(panelImages[panel.id]?.annotations || []).map(ann => (
                              <div key={ann.id} style={{
                                position: 'absolute',
                                left: `${ann.x * 100}%`, top: `${ann.y * 100}%`,
                                transform: 'translate(-50%, -50%)',
                                width: '18px', height: '18px', borderRadius: '50%',
                                background: '#e74c3c', color: '#fff',
                                fontSize: '10px', fontWeight: 'bold',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                border: '1.5px solid #fff', pointerEvents: 'none',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.4)'
                              }}>{ann.id}</div>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                            <input
                              type="text"
                              value={panelRefinePrompts[panel.id] || ''}
                              onChange={(e) => setPanelRefinePrompts(prev => ({ ...prev, [panel.id]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && panelRefinePrompts[panel.id]) {
                                  e.preventDefault();
                                  refinePanelImage(panel, i, panelRefinePrompts[panel.id], 'openai');
                                }
                              }}
                              placeholder="Refine: e.g. remove the extra chair"
                              style={{
                                flex: 1,
                                padding: '0.4rem',
                                borderRadius: '4px',
                                border: '1px solid #ccc',
                                fontSize: '0.8rem'
                              }}
                            />
                            <button
                              onClick={() => refinePanelImage(panel, i, panelRefinePrompts[panel.id], 'openai')}
                              disabled={panelImages[panel.id]?.generating || !panelRefinePrompts[panel.id]?.trim()}
                              style={{
                                padding: '0.4rem 0.6rem',
                                background: (panelImages[panel.id]?.generating || !panelRefinePrompts[panel.id]?.trim()) ? '#ccc' : '#8e44ad',
                                border: 'none',
                                borderRadius: '4px',
                                color: '#fff',
                                cursor: (panelImages[panel.id]?.generating || !panelRefinePrompts[panel.id]?.trim()) ? 'not-allowed' : 'pointer',
                                fontSize: '0.75rem',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {panelImages[panel.id]?.generating === 'openai' ? '⏳...' : 'Refine (GPT)'}
                            </button>
                            <button
                              onClick={() => refinePanelImage(panel, i, panelRefinePrompts[panel.id], 'gemini')}
                              disabled={panelImages[panel.id]?.generating || !panelRefinePrompts[panel.id]?.trim()}
                              style={{
                                padding: '0.4rem 0.6rem',
                                background: (panelImages[panel.id]?.generating || !panelRefinePrompts[panel.id]?.trim()) ? '#ccc' : '#4285f4',
                                border: 'none',
                                borderRadius: '4px',
                                color: '#fff',
                                cursor: (panelImages[panel.id]?.generating || !panelRefinePrompts[panel.id]?.trim()) ? 'not-allowed' : 'pointer',
                                fontSize: '0.75rem',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {panelImages[panel.id]?.generating === 'gemini' ? '⏳...' : 'Refine (Gemini)'}
                            </button>
                            {panelImages[panel.id]?.previousPath && (
                              <button
                                onClick={() => {
                                  const prevPath = panelImages[panel.id].previousPath;
                                  setPanelImages(prev => ({
                                    ...prev,
                                    [panel.id]: { ...prev[panel.id], path: prevPath, previousPath: null }
                                  }));
                                  updatePanelArtwork(panel.id, prevPath);
                                }}
                                disabled={panelImages[panel.id]?.generating}
                                style={{
                                  padding: '0.4rem 0.6rem',
                                  background: '#e67e22',
                                  border: 'none',
                                  borderRadius: '4px',
                                  color: '#fff',
                                  cursor: panelImages[panel.id]?.generating ? 'not-allowed' : 'pointer',
                                  fontSize: '0.75rem',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                Revert
                              </button>
                            )}
                            <button
                              onClick={() => startInpaintMode(panel, i)}
                              disabled={panelImages[panel.id]?.generating || !panelImages[panel.id]?.path}
                              style={{
                                padding: '0.4rem 0.6rem',
                                background: (!panelImages[panel.id]?.path || panelImages[panel.id]?.generating) ? '#ccc' : '#8e44ad',
                                border: 'none',
                                borderRadius: '4px',
                                color: '#fff',
                                cursor: (!panelImages[panel.id]?.path || panelImages[panel.id]?.generating) ? 'not-allowed' : 'pointer',
                                fontSize: '0.75rem',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              Inpaint Region
                            </button>
                            {(() => {
                              const currentPath = panelImages[panel.id]?.path;
                              const alreadyRef = (panelImages[panel.id]?.refImages || []).some(r => getRefPath(r) === currentPath);
                              return (
                                <button
                                  onClick={() => {
                                    if (!alreadyRef) {
                                      setPanelImages(prev => ({
                                        ...prev,
                                        [panel.id]: {
                                          ...prev[panel.id],
                                          refImages: [...(prev[panel.id]?.refImages || []), { path: currentPath, annotations: prev[panel.id]?.annotations || [] }]
                                        }
                                      }));
                                    }
                                  }}
                                  disabled={alreadyRef || panelImages[panel.id]?.generating}
                                  title={alreadyRef ? 'Already added as ref' : 'Use this generated image as a reference image'}
                                  style={{
                                    padding: '0.4rem 0.6rem',
                                    background: alreadyRef ? '#ccc' : '#27ae60',
                                    border: 'none',
                                    borderRadius: '4px',
                                    color: '#fff',
                                    cursor: alreadyRef || panelImages[panel.id]?.generating ? 'not-allowed' : 'pointer',
                                    fontSize: '0.75rem',
                                    whiteSpace: 'nowrap'
                                  }}
                                >
                                  {alreadyRef ? 'Ref Added' : 'Use as Ref'}
                                </button>
                              );
                            })()}
                          </div>
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

                  {/* Full Page Mode (not used for cover — cover uses panel-by-panel) */}
                  {!showCompositePreview && !isCover && (
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

                  {/* Panel by Panel Mode (always shown for cover) */}
                  {(showCompositePreview || isCover) && (
                    <div style={{ marginBottom: '1rem' }}>
                      {!isCover && (
                      <>
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
                      </>
                      )}

                      {/* Batch Generate & Composite Buttons */}
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                        {!isCover && (
                        <>
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
                        </>
                        )}
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
                          {isCover ? 'Apply Adjustments to Cover' : 'Save Composite as Page'}
                        </button>
                      </div>

                      {/* Border Thickness Slider */}
                      {panels.some(p => panelImages[p.id]?.path) && !isCover && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                          <span style={{ fontSize: '0.75rem', color: '#666', width: '100px' }}>Border Thickness:</span>
                          <input
                            type="range"
                            min="0"
                            max="1500"
                            step="10"
                            value={borderThickness}
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              setBorderThickness(val);
                              borderThicknessRef.current = val;
                              setTimeout(() => compositePageFromPanels(), 50);
                            }}
                            style={{ flex: 1 }}
                          />
                          <span style={{ fontSize: '0.7rem', color: '#999', width: '35px' }}>
                            {borderThickness === 0 ? 'Off' : `${borderThickness}%`}
                          </span>
                        </div>
                      )}

                      {/* Border Color Override */}
                      {panels.some(p => panelImages[p.id]?.path) && !isCover && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                          <span style={{ fontSize: '0.75rem', color: '#666', width: '100px' }}>Border Color:</span>
                          <input
                            type="color"
                            value={borderColorOverride || '#1a1a1a'}
                            onChange={(e) => {
                              setBorderColorOverride(e.target.value);
                              borderColorOverrideRef.current = e.target.value;
                              setTimeout(() => compositePageFromPanels(), 50);
                            }}
                            style={{ width: '30px', height: '24px', border: 'none', padding: 0, cursor: 'pointer' }}
                          />
                          <span style={{ fontSize: '0.7rem', color: '#999' }}>
                            {borderColorOverride || 'Auto'}
                          </span>
                          {borderColorOverride && (
                            <button
                              onClick={() => {
                                setBorderColorOverride('');
                                borderColorOverrideRef.current = '';
                                setTimeout(() => compositePageFromPanels(), 50);
                              }}
                              style={{ fontSize: '0.65rem', padding: '2px 6px', background: '#eee', border: '1px solid #ccc', borderRadius: '3px', cursor: 'pointer' }}
                            >
                              Auto
                            </button>
                          )}
                        </div>
                      )}

                      {/* Floating Panel Border Thickness Slider */}
                      {panels.some(p => p.floating && panelImages[p.id]?.path) && !isCover && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                          <span style={{ fontSize: '0.75rem', color: '#666', width: '100px' }}>Floating Border:</span>
                          <input
                            type="range"
                            min="0"
                            max="1500"
                            step="10"
                            value={floatingBorderThickness}
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              setFloatingBorderThickness(val);
                              floatingBorderThicknessRef.current = val;
                              setTimeout(() => compositePageFromPanels(), 50);
                            }}
                            style={{ flex: 1 }}
                          />
                          <span style={{ fontSize: '0.7rem', color: '#999', width: '35px' }}>
                            {floatingBorderThickness === 0 ? 'Off' : `${floatingBorderThickness}%`}
                          </span>
                        </div>
                      )}

                      {/* Panel Margin Slider */}
                      {panels.some(p => panelImages[p.id]?.path) && !isCover && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                          <span style={{ fontSize: '0.75rem', color: '#666', width: '100px' }}>Panel Margin:</span>
                          <input
                            type="range"
                            min="0"
                            max="300"
                            step="10"
                            value={panelMargin}
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              setPanelMargin(val);
                              panelMarginRef.current = val;
                              setTimeout(() => compositePageFromPanels(), 50);
                            }}
                            style={{ flex: 1 }}
                          />
                          <span style={{ fontSize: '0.7rem', color: '#999', width: '35px' }}>
                            {panelMargin === 0 ? 'None' : `${panelMargin}%`}
                          </span>
                        </div>
                      )}

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
                          <h4 style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.5rem' }}>{isCover ? 'Cover' : 'Panel'} Fit & Position</h4>
                          {panels.map((panel, i) => {
                            const panelData = panelImages[panel.id];
                            if (!panelData?.path) return null;
                            const isExpanded = isCover || expandedPanelControls[panel.id];

                            return (
                              <div key={panel.id} style={{ marginBottom: '0.75rem', padding: '0.5rem', background: '#fff', borderRadius: '4px', border: '1px solid #ddd' }}>
                                <div
                                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: isCover ? 'default' : 'pointer', userSelect: 'none' }}
                                  onClick={() => !isCover && setExpandedPanelControls(prev => ({ ...prev, [panel.id]: !prev[panel.id] }))}
                                >
                                  {!isCover && <span style={{ fontSize: '0.7rem', color: '#999' }}>{expandedPanelControls[panel.id] ? '▼' : '▶'}</span>}
                                  <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#333', flex: 1 }}>{isCover ? 'Cover' : `Panel ${i + 1}`}</span>
                                  <span style={{ fontSize: '0.7rem', color: '#888' }}>
                                    {panelData?.fitMode === 'crop' ? 'Crop' : 'Stretch'}
                                    {((panelData?.brightness ?? 1) !== 1 || (panelData?.contrast ?? 1) !== 1 || (panelData?.saturation ?? 1) !== 1) ? ' · Adjusted' : ''}
                                  </span>
                                </div>
                                {isExpanded && <>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                                  <button
                                    onClick={() => {
                                      setPanelImages(prev => ({
                                        ...prev,
                                        [panel.id]: { ...prev[panel.id], fitMode: 'stretch' }
                                      }));
                                      savePanelAdjustments(panel.id, { fitMode: 'stretch' });
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
                                      savePanelAdjustments(panel.id, { fitMode: 'crop' });
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
                                  <button
                                    onClick={async () => {
                                      if (!panelData?.path) return;
                                      try {
                                        const response = await api.post('/images/flip', { imagePath: panelData.path });
                                        setPanelImages(prev => ({
                                          ...prev,
                                          [panel.id]: { ...prev[panel.id], path: response.data.path }
                                        }));
                                        updatePanelArtwork(panel.id, response.data.path);
                                        setTimeout(() => compositePageFromPanels(), 50);
                                      } catch (err) {
                                        console.error('Flip failed:', err);
                                      }
                                    }}
                                    style={{
                                      padding: '0.2rem 0.5rem',
                                      fontSize: '0.7rem',
                                      background: '#ddd',
                                      color: '#666',
                                      border: 'none',
                                      borderRadius: '3px',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    Flip
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
                                          const val = parseInt(e.target.value) / 100;
                                          setPanelImages(prev => ({
                                            ...prev,
                                            [panel.id]: { ...prev[panel.id], cropX: val }
                                          }));
                                          savePanelAdjustments(panel.id, { cropX: val });
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
                                          const val = parseInt(e.target.value) / 100;
                                          setPanelImages(prev => ({
                                            ...prev,
                                            [panel.id]: { ...prev[panel.id], cropY: val }
                                          }));
                                          savePanelAdjustments(panel.id, { cropY: val });
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
                                          const val = parseInt(e.target.value) / 100;
                                          setPanelImages(prev => ({
                                            ...prev,
                                            [panel.id]: { ...prev[panel.id], zoom: val }
                                          }));
                                          savePanelAdjustments(panel.id, { zoom: val });
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
                                        savePanelAdjustments(panel.id, { cropX: 0, cropY: 0, zoom: 1 });
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
                                {/* Image Adjustments: Brightness, Contrast, Saturation */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginTop: '0.5rem', borderTop: '1px solid #eee', paddingTop: '0.4rem' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.15rem' }}>
                                    <span style={{ fontSize: '0.7rem', color: '#888' }}>Adjustments</span>
                                    <button
                                      onClick={() => {
                                        setPanelImages(prev => ({
                                          ...prev,
                                          [panel.id]: { ...prev[panel.id], saturation: 0 }
                                        }));
                                        savePanelAdjustments(panel.id, { saturation: 0 });
                                        setTimeout(() => compositePageFromPanels(), 50);
                                      }}
                                      style={{
                                        padding: '0.1rem 0.35rem',
                                        fontSize: '0.6rem',
                                        background: (panelData?.saturation ?? 1) === 0 ? '#8e44ad' : '#ddd',
                                        color: (panelData?.saturation ?? 1) === 0 ? 'white' : '#666',
                                        border: 'none',
                                        borderRadius: '3px',
                                        cursor: 'pointer'
                                      }}
                                    >
                                      B&W
                                    </button>
                                    {((panelData?.brightness ?? 1) !== 1 || (panelData?.contrast ?? 1) !== 1 || (panelData?.saturation ?? 1) !== 1) && (
                                      <button
                                        onClick={() => {
                                          setPanelImages(prev => ({
                                            ...prev,
                                            [panel.id]: { ...prev[panel.id], brightness: 1, contrast: 1, saturation: 1 }
                                          }));
                                          savePanelAdjustments(panel.id, { brightness: 1, contrast: 1, saturation: 1 });
                                          setTimeout(() => compositePageFromPanels(), 50);
                                        }}
                                        style={{
                                          padding: '0.1rem 0.35rem',
                                          fontSize: '0.6rem',
                                          background: '#95a5a6',
                                          color: 'white',
                                          border: 'none',
                                          borderRadius: '3px',
                                          cursor: 'pointer'
                                        }}
                                      >
                                        Reset
                                      </button>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.7rem', color: '#666', width: '55px' }}>Bright:</span>
                                    <input
                                      type="range"
                                      min="50"
                                      max="300"
                                      value={Math.round((panelData?.brightness ?? 1) * 100)}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value) / 100;
                                        setPanelImages(prev => ({
                                          ...prev,
                                          [panel.id]: { ...prev[panel.id], brightness: val }
                                        }));
                                        savePanelAdjustments(panel.id, { brightness: val });
                                        setTimeout(() => compositePageFromPanels(), 50);
                                      }}
                                      style={{ flex: 1 }}
                                    />
                                    <span style={{ fontSize: '0.65rem', color: '#999', width: '35px' }}>
                                      {Math.round((panelData?.brightness ?? 1) * 100)}%
                                    </span>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.7rem', color: '#666', width: '55px' }}>Contrast:</span>
                                    <input
                                      type="range"
                                      min="50"
                                      max="150"
                                      value={Math.round((panelData?.contrast ?? 1) * 100)}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value) / 100;
                                        setPanelImages(prev => ({
                                          ...prev,
                                          [panel.id]: { ...prev[panel.id], contrast: val }
                                        }));
                                        savePanelAdjustments(panel.id, { contrast: val });
                                        setTimeout(() => compositePageFromPanels(), 50);
                                      }}
                                      style={{ flex: 1 }}
                                    />
                                    <span style={{ fontSize: '0.65rem', color: '#999', width: '35px' }}>
                                      {Math.round((panelData?.contrast ?? 1) * 100)}%
                                    </span>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.7rem', color: '#666', width: '55px' }}>Saturatn:</span>
                                    <input
                                      type="range"
                                      min="0"
                                      max="200"
                                      value={Math.round((panelData?.saturation ?? 1) * 100)}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value) / 100;
                                        setPanelImages(prev => ({
                                          ...prev,
                                          [panel.id]: { ...prev[panel.id], saturation: val }
                                        }));
                                        savePanelAdjustments(panel.id, { saturation: val });
                                        setTimeout(() => compositePageFromPanels(), 50);
                                      }}
                                      style={{ flex: 1 }}
                                    />
                                    <span style={{ fontSize: '0.65rem', color: '#999', width: '35px' }}>
                                      {Math.round((panelData?.saturation ?? 1) * 100)}%
                                    </span>
                                  </div>
                                </div>
                                </>}
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

        {/* Notes Panel */}
        <div style={{
          width: '280px',
          background: '#f5f5f5',
          borderRadius: '12px',
          padding: '1rem',
          border: '1px solid #ddd',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          height: 'calc(100vh - 180px)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', color: '#333' }}>Notes</h3>
            <button
              onClick={async () => {
                try {
                  await api.put(`/comics/${id}`, { notes: comicNotes });
                  showToast('Notes saved!');
                } catch (err) {
                  console.error('Failed to save notes:', err);
                }
              }}
              style={{
                padding: '0.25rem 0.5rem',
                fontSize: '0.7rem',
                background: '#27ae60',
                color: '#fff',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer'
              }}
            >
              Save
            </button>
          </div>
          <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.4rem' }}>
            <button
              onClick={toggleNotesHighlight}
              title="Highlight selected text (select text first)"
              style={{
                padding: '0.15rem 0.4rem',
                fontSize: '0.7rem',
                background: '#ffe066',
                color: '#333',
                border: '1px solid #e6c800',
                borderRadius: '3px',
                cursor: 'pointer'
              }}
            >
              Highlight
            </button>
            {hasHighlights(comicNotes) && (
              <button
                onClick={clearNotesHighlights}
                title="Clear all highlights"
                style={{
                  padding: '0.15rem 0.4rem',
                  fontSize: '0.7rem',
                  background: '#eee',
                  color: '#666',
                  border: '1px solid #ccc',
                  borderRadius: '3px',
                  cursor: 'pointer'
                }}
              >
                Clear
              </button>
            )}
          </div>
          <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
            {hasHighlights(comicNotes) && (
              <div
                aria-hidden="true"
                ref={(el) => {
                  if (el && notesTextareaRef.current) {
                    el.scrollTop = notesTextareaRef.current.scrollTop;
                  }
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  padding: '0.5rem',
                  fontSize: '0.8rem',
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                  lineHeight: '1.4',
                  whiteSpace: 'pre-wrap',
                  wordWrap: 'break-word',
                  overflowWrap: 'break-word',
                  overflow: 'hidden',
                  pointerEvents: 'none',
                  borderRadius: '6px',
                  border: '1px solid transparent',
                  boxSizing: 'border-box',
                  color: 'transparent'
                }}
                dangerouslySetInnerHTML={{
                  __html: (comicNotes || '')
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    .replace(/\u2060([\s\S]*?)\u2061/g, '<mark style="background:#ffe066;color:transparent;border-radius:2px">$1</mark>')
                }}
              />
            )}
            <textarea
              ref={notesTextareaRef}
              value={comicNotes}
              onChange={(e) => {
                setComicNotes(e.target.value);
                setComic(prev => prev ? { ...prev, notes: e.target.value } : prev);
              }}
              onScroll={(e) => {
                // Sync highlight overlay scroll
                const overlay = e.target.previousSibling;
                if (overlay) overlay.scrollTop = e.target.scrollTop;
                // Save scroll position
                try { sessionStorage.setItem(`notes-scroll-${id}`, e.target.scrollTop); } catch {}
              }}
              placeholder="Paste or type notes here... (shared across all pages in this comic)"
              style={{
                position: 'relative',
                zIndex: 1,
                width: '100%',
                height: '100%',
                padding: '0.5rem',
                borderRadius: '6px',
                border: '1px solid #ccc',
                background: hasHighlights(comicNotes) ? 'transparent' : '#fff',
                caretColor: '#333',
                fontSize: '0.8rem',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                lineHeight: '1.4',
                resize: 'none',
                boxSizing: 'border-box'
              }}
            />
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
                    const tailWidth = (bubble.tailWidth ?? 0.15) * bw;
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
                      padding: bubble.type === 'image' ? '2px' : '6px 8px',
                      boxSizing: 'border-box',
                      zIndex: 50,
                      transform: `rotate(${(bubble.id.charCodeAt(bubble.id.length - 1) % 5) - 2}deg)`,
                      filter: `url(#roughEdge${filtSuffix})`
                    }}
                  >
                    {bubble.type === 'image' && bubble.imageUrl ? (
                      <img
                        src={`http://localhost:3001${bubble.imageUrl}`}
                        alt="Bubble image"
                        crossOrigin="anonymous"
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    ) : (
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
                    )}
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

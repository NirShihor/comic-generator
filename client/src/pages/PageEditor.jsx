import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';

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

  // Sort groups by their top-left position for consistent ordering
  const sortedGroups = Object.values(groups).sort((a, b) => {
    const aMinY = Math.min(...a.map(c => c.y1));
    const bMinY = Math.min(...b.map(c => c.y1));
    if (Math.abs(aMinY - bMinY) > 0.01) return aMinY - bMinY;
    const aMinX = Math.min(...a.map(c => c.x1));
    const bMinX = Math.min(...b.map(c => c.x1));
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

    const vPos = y < 0.4 ? 'top' : y < 0.7 ? 'middle' : 'bottom';
    const hPos = x < 0.4 ? 'left' : x < 0.7 ? 'center' : 'right';
    const widthDesc = width > 0.9 ? 'full-width' : width > 0.6 ? 'wide' : 'half-width';
    const heightDesc = height > 0.6 ? 'tall' : height > 0.4 ? 'half-height' : 'short';

    return `Panel ${i + 1} = ${vPos}-${hPos}, ${widthDesc}, ${heightDesc}`;
  });

  return `EXACTLY ${count} panels:\n${descriptions.join('\n')}`;
}

function PageEditor() {
  const { id, pageId } = useParams();
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

  // Image generation state
  const [generatedImage, setGeneratedImage] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [generationError, setGenerationError] = useState(null);
  const [additionalInstructions, setAdditionalInstructions] = useState('');

  const canvasRef = useRef(null);

  const CANVAS_WIDTH = 400;
  const CANVAS_HEIGHT = 600;
  const SNAP_THRESHOLD = 0.03; // Snap to lines/edges within 3%

  useEffect(() => {
    loadComic();
  }, [id, pageId]);

  const loadComic = async () => {
    try {
      const response = await api.get(`/comics/${id}`);
      setComic(response.data);
      const currentPage = response.data.pages.find(p => p.id === pageId);
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
    } catch (error) {
      console.error('Failed to load comic:', error);
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

  const handleMouseUp = () => {
    // Stop dragging
    if (isDragging) {
      setIsDragging(false);
      setDragLineIndex(null);
      return;
    }

    if (!isDrawing || !drawStart || !drawEnd) {
      setIsDrawing(false);
      return;
    }

    const dx = Math.abs(drawEnd.x - drawStart.x);
    const dy = Math.abs(drawEnd.y - drawStart.y);

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
      const y = (drawStart.y + drawEnd.y) / 2;
      const snapPoints = getSnapPoints();
      const snappedY = snapToNearest(y, snapPoints.y);

      newLine = {
        type: 'horizontal',
        y: snappedY,
        x1: Math.min(drawStart.x, drawEnd.x),
        x2: Math.max(drawStart.x, drawEnd.x)
      };
    } else {
      // Vertical line
      const x = (drawStart.x + drawEnd.x) / 2;
      const snapPoints = getSnapPoints();
      const snappedX = snapToNearest(x, snapPoints.x);

      newLine = {
        type: 'vertical',
        x: snappedX,
        y1: Math.min(drawStart.y, drawEnd.y),
        y2: Math.max(drawStart.y, drawEnd.y)
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
      let panelsToSave = panels;
      if (!panelsComputed) {
        panelsToSave = computePanelsFromLines(lines, pageId);
        setPanels(panelsToSave);
        setPanelsComputed(true);
      }

      const updatedComic = { ...comic };
      const pageIndex = updatedComic.pages.findIndex(p => p.id === pageId);
      updatedComic.pages[pageIndex] = {
        ...page,
        lines,
        panels: panelsToSave
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

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('image', file);

    try {
      const uploadResponse = await api.post('/images/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      await api.post('/images/save-to-project', {
        comicId: id,
        filename: uploadResponse.data.filename,
        imageType: 'page',
        pageNumber: page.pageNumber
      });

      const updatedComic = { ...comic };
      const pageIndex = updatedComic.pages.findIndex(p => p.id === pageId);
      updatedComic.pages[pageIndex].masterImage = `/projects/${id}/images/${id}_p${page.pageNumber}.png`;

      await api.put(`/comics/${id}`, updatedComic);
      setComic(updatedComic);
      setPage(updatedComic.pages[pageIndex]);
    } catch (error) {
      console.error('Failed to upload image:', error);
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
    const settings = comic.promptSettings || {};
    const isFirstPage = page.pageNumber === 1;

    let prompt = '';

    // Style Bible
    if (settings.styleBible) {
      prompt += `🎨 STYLE BIBLE\n${settings.styleBible}\n\n`;
    }

    // Page Layout
    const layout = generateLayoutDescription(panels);
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

    // Text / Lettering
    if (settings.textLettering) {
      prompt += `TEXT / LETTERING\n${settings.textLettering}\n\n`;
    }

    // Global Do Not
    if (settings.globalDoNot) {
      prompt += `GLOBAL DO NOT\n${settings.globalDoNot}\n\n`;
    }

    // Hard Negatives
    if (settings.hardNegatives) {
      prompt += `HARD NEGATIVES\n${settings.hardNegatives}\n\n`;
    }

    // Page-specific template
    if (isFirstPage && settings.firstPageTemplate) {
      prompt += `PAGE 1 INSTRUCTIONS\n${settings.firstPageTemplate}\n\n`;
    } else if (!isFirstPage && settings.otherPagesTemplate) {
      prompt += `PAGE ${page.pageNumber} INSTRUCTIONS\n${settings.otherPagesTemplate}\n\n`;
    }

    // Panel Content
    prompt += `PAGE ${page.pageNumber} — PANEL CONTENT\n\n`;
    panels.forEach((panel, i) => {
      prompt += `Panel ${i + 1}:\n${panel.content || '(No content specified)'}\n\n`;
    });

    // Additional instructions
    if (additionalInstructions.trim()) {
      prompt += `ADDITIONAL INSTRUCTIONS:\n${additionalInstructions}\n`;
    }

    return prompt;
  };

  const generatePageImage = async () => {
    if (!panelsComputed || panels.length === 0) {
      alert('Please compute panels and add content first.');
      return;
    }

    setIsGenerating(true);
    setGenerationError(null);

    try {
      const prompt = buildFullPrompt();
      console.log('Generating with prompt:', prompt);

      const response = await api.post('/images/generate-page', {
        prompt,
        size: '1024x1536' // Portrait for comic pages
      });

      setGeneratedImage({
        path: response.data.path,
        revisedPrompt: response.data.revisedPrompt
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
      await api.post('/images/save-to-project', {
        comicId: id,
        filename,
        imageType: 'page',
        pageNumber: page.pageNumber
      });

      const updatedComic = { ...comic };
      const pageIndex = updatedComic.pages.findIndex(p => p.id === pageId);
      updatedComic.pages[pageIndex].masterImage = `/projects/${id}/images/${id}_p${page.pageNumber}.png`;

      await api.put(`/comics/${id}`, updatedComic);
      setComic(updatedComic);
      setPage(updatedComic.pages[pageIndex]);
      alert('Image saved to page!');
    } catch (error) {
      console.error('Failed to save image:', error);
      alert('Failed to save image');
    }
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

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to={`/comic/${id}`} style={{ color: '#888', textDecoration: 'none', marginBottom: '0.5rem', display: 'block' }}>
            ← Back to {comic.title}
          </Link>
          <h1>Page {page.pageNumber}</h1>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
            Upload Image
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
          </label>
          <button className="btn btn-primary" onClick={savePage}>
            Save Page
          </button>
        </div>
      </div>

      <div className="panel-editor">
        <div style={{ flex: 1 }}>
          {/* Toolbar */}
          <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: '#888', fontSize: '0.85rem' }}>
              Draw lines by dragging | Drag lines to reposition
            </span>
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
          </div>

          {/* Canvas */}
          <div
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => {
              if (isDrawing) {
                setIsDrawing(false);
                setDrawStart(null);
                setDrawEnd(null);
              }
              if (isDragging) {
                setIsDragging(false);
                setDragLineIndex(null);
              }
            }}
            style={{
              width: CANVAS_WIDTH,
              height: CANVAS_HEIGHT,
              background: page.masterImage ? 'transparent' : '#1a1a2e',
              border: '2px solid #16213e',
              borderRadius: '4px',
              position: 'relative',
              cursor: isDragging ? 'grabbing' : 'crosshair',
              overflow: 'hidden',
              userSelect: 'none'
            }}
          >
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
                  background: 'rgba(255,255,255,0.1)',
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
                  background: 'rgba(255,255,255,0.1)',
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

            {/* Drawn lines */}
            {lines.map((line, i) => (
              line.type === 'horizontal' ? (
                <div
                  key={`line-${i}`}
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
              ) : (
                <div
                  key={`line-${i}`}
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
              )
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
                  background: '#ffff00',
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
                  background: '#ffff00',
                  transform: 'translateX(-50%)',
                  zIndex: 30,
                  opacity: 0.8,
                  pointerEvents: 'none',
                  borderRadius: '2px'
                }}
              />
            )}

            {/* Instructions */}
            {lines.length === 0 && (
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
            <div style={{ marginTop: '1rem', padding: '1rem', background: '#0f3460', borderRadius: '8px' }}>
              <h3 style={{ marginBottom: '0.5rem', fontSize: '0.9rem', color: '#888' }}>Layout Description:</h3>
              <pre style={{
                fontSize: '0.85rem',
                whiteSpace: 'pre-wrap',
                color: '#fff',
                margin: 0
              }}>
                {layoutDescription}
              </pre>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="sidebar">
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
                    background: i === 0 ? '#333' : '#16213e',
                    border: 'none',
                    borderRadius: '3px',
                    color: i === 0 ? '#666' : '#fff',
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
                    background: i === panels.length - 1 ? '#333' : '#16213e',
                    border: 'none',
                    borderRadius: '3px',
                    color: i === panels.length - 1 ? '#666' : '#fff',
                    cursor: i === panels.length - 1 ? 'default' : 'pointer'
                  }}
                >
                  ▼
                </button>
              </div>
            </div>
          ))}

          {selectedPanelData && (
            <div style={{ marginTop: '1rem', padding: '1rem', background: '#0f3460', borderRadius: '8px' }}>
              <h3 style={{ marginBottom: '0.5rem' }}>
                Panel {panels.findIndex(p => p.id === selectedPanel) + 1} Content
              </h3>
              <p style={{ fontSize: '0.8rem', color: '#888', marginBottom: '0.5rem' }}>
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
                  border: '1px solid #16213e',
                  background: '#1a1a2e',
                  color: '#fff',
                  fontSize: '0.85rem',
                  resize: 'vertical'
                }}
              />
            </div>
          )}

          {/* Image Generation Section */}
          {panelsComputed && panels.length > 0 && (
            <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#1a1a2e', borderRadius: '8px', border: '1px solid #16213e' }}>
              <h3 style={{ marginBottom: '1rem' }}>Generate Page Image</h3>

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
                    border: '1px solid #16213e',
                    background: '#0f3460',
                    color: '#fff',
                    fontSize: '0.85rem',
                    resize: 'vertical'
                  }}
                />
              </div>

              {/* Buttons */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
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
                  {isGenerating ? 'Generating...' : 'Generate Image'}
                </button>
              </div>

              {/* Prompt Preview */}
              {showPromptPreview && (
                <div style={{ marginTop: '1rem' }}>
                  <h4 style={{ fontSize: '0.85rem', color: '#888', marginBottom: '0.5rem' }}>Full Prompt:</h4>
                  <pre style={{
                    background: '#0f3460',
                    padding: '1rem',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    whiteSpace: 'pre-wrap',
                    maxHeight: '300px',
                    overflow: 'auto',
                    color: '#ccc'
                  }}>
                    {buildFullPrompt()}
                  </pre>
                </div>
              )}

              {/* Error */}
              {generationError && (
                <div style={{
                  marginTop: '1rem',
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
                <div style={{ marginTop: '1rem' }}>
                  <h4 style={{ marginBottom: '0.5rem' }}>Generated Image:</h4>
                  <img
                    src={`http://localhost:3001${generatedImage.path}`}
                    alt="Generated page"
                    style={{
                      width: '100%',
                      borderRadius: '4px',
                      border: '1px solid #16213e'
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
                  {generatedImage.revisedPrompt && (
                    <details style={{ marginTop: '0.5rem' }}>
                      <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: '#888' }}>
                        DALL-E's revised prompt
                      </summary>
                      <p style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>
                        {generatedImage.revisedPrompt}
                      </p>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PageEditor;

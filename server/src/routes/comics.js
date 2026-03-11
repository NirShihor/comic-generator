const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const PROJECTS_DIR = path.join(__dirname, '../../projects');

// Ensure projects directory exists
async function ensureProjectsDir() {
  try {
    await fs.mkdir(PROJECTS_DIR, { recursive: true });
  } catch (err) {
    // Directory exists
  }
}

// Get all comic projects
router.get('/', async (req, res) => {
  try {
    await ensureProjectsDir();
    const files = await fs.readdir(PROJECTS_DIR);
    const comics = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const content = await fs.readFile(path.join(PROJECTS_DIR, file), 'utf-8');
        comics.push(JSON.parse(content));
      }
    }

    res.json(comics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single comic project
router.get('/:id', async (req, res) => {
  try {
    const filePath = path.join(PROJECTS_DIR, `${req.params.id}.json`);
    const content = await fs.readFile(filePath, 'utf-8');
    res.json(JSON.parse(content));
  } catch (error) {
    res.status(404).json({ error: 'Comic not found' });
  }
});

// Default prompt templates
const getDefaultPromptTemplates = () => ({
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

  characterBible: [],

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
No decorative borders that look like panels.`
});

// Create new comic project
router.post('/', async (req, res) => {
  try {
    await ensureProjectsDir();

    const comic = {
      id: `comic-${uuidv4().slice(0, 8)}`,
      title: req.body.title || 'Untitled Comic',
      description: req.body.description || '',
      coverImage: '',
      level: req.body.level || 'beginner',
      language: 'es',
      targetLanguage: 'en',
      pages: [],
      promptTemplates: getDefaultPromptTemplates(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await fs.writeFile(
      path.join(PROJECTS_DIR, `${comic.id}.json`),
      JSON.stringify(comic, null, 2)
    );

    // Create comic assets folder
    await fs.mkdir(path.join(PROJECTS_DIR, comic.id, 'images'), { recursive: true });
    await fs.mkdir(path.join(PROJECTS_DIR, comic.id, 'audio'), { recursive: true });

    res.json(comic);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update comic project
router.put('/:id', async (req, res) => {
  try {
    const filePath = path.join(PROJECTS_DIR, `${req.params.id}.json`);
    const comic = {
      ...req.body,
      updatedAt: new Date().toISOString()
    };

    await fs.writeFile(filePath, JSON.stringify(comic, null, 2));
    res.json(comic);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add page to comic
router.post('/:id/pages', async (req, res) => {
  try {
    const filePath = path.join(PROJECTS_DIR, `${req.params.id}.json`);
    const content = await fs.readFile(filePath, 'utf-8');
    const comic = JSON.parse(content);

    const page = {
      id: `${req.params.id}-page-${comic.pages.length + 1}`,
      pageNumber: comic.pages.length + 1,
      masterImage: '',
      dividerLines: {
        horizontal: [],  // Array of y positions (0-1)
        vertical: []     // Array of { y1, y2, x } for partial vertical lines
      },
      panels: []  // Computed from dividerLines, each with tapZone and content
    };

    comic.pages.push(page);
    comic.updatedAt = new Date().toISOString();

    await fs.writeFile(filePath, JSON.stringify(comic, null, 2));
    res.json(page);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update page (dividerLines and panels)
router.put('/:id/pages/:pageId', async (req, res) => {
  try {
    const filePath = path.join(PROJECTS_DIR, `${req.params.id}.json`);
    const content = await fs.readFile(filePath, 'utf-8');
    const comic = JSON.parse(content);

    const pageIndex = comic.pages.findIndex(p => p.id === req.params.pageId);
    if (pageIndex === -1) {
      return res.status(404).json({ error: 'Page not found' });
    }

    // Update page fields
    if (req.body.dividerLines !== undefined) {
      comic.pages[pageIndex].dividerLines = req.body.dividerLines;
    }
    if (req.body.panels !== undefined) {
      comic.pages[pageIndex].panels = req.body.panels;
    }
    if (req.body.masterImage !== undefined) {
      comic.pages[pageIndex].masterImage = req.body.masterImage;
    }

    comic.updatedAt = new Date().toISOString();

    await fs.writeFile(filePath, JSON.stringify(comic, null, 2));
    res.json(comic.pages[pageIndex]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Legacy: Update page panels (tap zones) - keep for backwards compatibility
router.put('/:id/pages/:pageId/panels', async (req, res) => {
  try {
    const filePath = path.join(PROJECTS_DIR, `${req.params.id}.json`);
    const content = await fs.readFile(filePath, 'utf-8');
    const comic = JSON.parse(content);

    const pageIndex = comic.pages.findIndex(p => p.id === req.params.pageId);
    if (pageIndex === -1) {
      return res.status(404).json({ error: 'Page not found' });
    }

    comic.pages[pageIndex].panels = req.body.panels;
    comic.updatedAt = new Date().toISOString();

    await fs.writeFile(filePath, JSON.stringify(comic, null, 2));
    res.json(comic.pages[pageIndex]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export comic in iOS app format
router.get('/:id/export', async (req, res) => {
  try {
    const filePath = path.join(PROJECTS_DIR, `${req.params.id}.json`);
    const content = await fs.readFile(filePath, 'utf-8');
    const comic = JSON.parse(content);

    // Transform to iOS app format
    const exportedComic = {
      id: comic.id,
      title: comic.title,
      description: comic.description,
      coverImage: comic.coverImage,
      level: comic.level,
      totalPages: comic.pages.length,
      estimatedMinutes: comic.pages.length * 2,
      language: comic.language,
      targetLanguage: comic.targetLanguage,
      version: '1.0',
      pages: comic.pages.map(page => ({
        id: page.id,
        pageNumber: page.pageNumber,
        masterImage: page.masterImage,
        panels: page.panels.map(panel => ({
          id: panel.id,
          artworkImage: panel.artworkImage,
          panelOrder: panel.panelOrder,
          tapZone: {
            x: panel.tapZone.x,
            y: panel.tapZone.y,
            width: panel.tapZone.width,
            height: panel.tapZone.height
          },
          bubbles: panel.bubbles || []
        }))
      }))
    };

    res.json(exportedComic);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

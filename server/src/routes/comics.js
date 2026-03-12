const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');

const PROJECTS_DIR = path.join(__dirname, '../../projects');
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

// Sanitize title for filenames (lowercase, replace spaces with underscores, remove special chars)
function sanitizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .substring(0, 50);
}

// Crop a region from an image and save it
async function cropAndSaveScene(sourceImagePath, outputPath, region, imageWidth, imageHeight) {
  try {
    // region is in percentage (0-1), convert to pixels
    const left = Math.round(region.x * imageWidth);
    const top = Math.round(region.y * imageHeight);
    const width = Math.round(region.width * imageWidth);
    const height = Math.round(region.height * imageHeight);

    await sharp(sourceImagePath)
      .extract({ left, top, width, height })
      .toFile(outputPath);

    return true;
  } catch (error) {
    console.error('Error cropping scene:', error);
    return false;
  }
}

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
• Black & white only. Human-drawn underground noir comic. Rough ink on paper.
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
No photorealism. No hyper-detail. No noir gore.`,

  cameraInks: `Bold silhouettes and strong negative space.
Slightly imperfect anatomy and perspective (human-made).
Hand-drawn panel borders, slightly wobbly.
Keep lighting high-contrast with clear shadow shapes (no gradients).`,

  characters: [],

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
      level: req.body.level || 'beginner',
      language: 'es',
      targetLanguage: 'en',
      cover: {
        image: '',        // Full cover image path
        sceneImage: ''    // Scene image for audio/interaction
      },
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

    const page = comic.pages[pageIndex];
    const sanitizedTitle = sanitizeTitle(comic.title);
    const imagesDir = path.join(PROJECTS_DIR, req.params.id, 'images');

    // Update page fields
    if (req.body.dividerLines !== undefined) {
      page.dividerLines = req.body.dividerLines;
    }
    if (req.body.panels !== undefined) {
      page.panels = req.body.panels;
    }
    if (req.body.masterImage !== undefined) {
      const oldMasterImage = page.masterImage;
      page.masterImage = req.body.masterImage;

      // If we have a new master image and panels, generate scene images
      if (req.body.masterImage && req.body.panels && req.body.panels.length > 0) {
        // Get the source image path
        let sourceImagePath;
        if (req.body.masterImage.startsWith('/uploads/')) {
          sourceImagePath = path.join(UPLOADS_DIR, req.body.masterImage.replace('/uploads/', ''));
        } else if (req.body.masterImage.startsWith('/projects/')) {
          sourceImagePath = path.join(PROJECTS_DIR, req.body.masterImage.replace('/projects/', ''));
        }

        if (sourceImagePath) {
          try {
            // Get image dimensions
            const metadata = await sharp(sourceImagePath).metadata();
            const imageWidth = metadata.width;
            const imageHeight = metadata.height;

            // Rename and copy master image with proper naming
            const pageFilename = `${sanitizedTitle}_p${page.pageNumber}.png`;
            const pageImagePath = path.join(imagesDir, pageFilename);
            await fs.copyFile(sourceImagePath, pageImagePath);
            page.masterImage = `/projects/${req.params.id}/images/${pageFilename}`;

            // Generate scene images for each panel
            for (let i = 0; i < req.body.panels.length; i++) {
              const panel = req.body.panels[i];
              const sceneFilename = `${sanitizedTitle}_p${page.pageNumber}_s${i + 1}.png`;
              const sceneImagePath = path.join(imagesDir, sceneFilename);

              // Panel tapZone contains x, y, width, height as percentages (0-1)
              await cropAndSaveScene(
                sourceImagePath,
                sceneImagePath,
                panel.tapZone,
                imageWidth,
                imageHeight
              );

              // Update panel with scene image path
              page.panels[i].artworkImage = `/projects/${req.params.id}/images/${sceneFilename}`;
            }

            console.log(`Generated ${req.body.panels.length} scene images for page ${page.pageNumber}`);
          } catch (err) {
            console.error('Error processing images:', err);
          }
        }
      }
    }

    comic.updatedAt = new Date().toISOString();

    await fs.writeFile(filePath, JSON.stringify(comic, null, 2));
    res.json(page);
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

// Update cover image
router.put('/:id/cover', async (req, res) => {
  try {
    const filePath = path.join(PROJECTS_DIR, `${req.params.id}.json`);
    const content = await fs.readFile(filePath, 'utf-8');
    const comic = JSON.parse(content);

    const sanitizedTitle = sanitizeTitle(comic.title);
    const imagesDir = path.join(PROJECTS_DIR, req.params.id, 'images');

    // Initialize cover if it doesn't exist
    if (!comic.cover) {
      comic.cover = { image: '', sceneImage: '' };
    }

    if (req.body.image) {
      // Get the source image path
      let sourceImagePath;
      if (req.body.image.startsWith('/uploads/')) {
        sourceImagePath = path.join(UPLOADS_DIR, req.body.image.replace('/uploads/', ''));
      } else if (req.body.image.startsWith('/projects/')) {
        sourceImagePath = path.join(PROJECTS_DIR, req.body.image.replace('/projects/', ''));
      }

      if (sourceImagePath) {
        try {
          // Save cover with proper naming
          const coverFilename = `${sanitizedTitle}_cover.png`;
          const coverImagePath = path.join(imagesDir, coverFilename);
          await fs.copyFile(sourceImagePath, coverImagePath);
          comic.cover.image = `/projects/${req.params.id}/images/${coverFilename}`;

          // Also save as scene (cover has one scene - the whole cover)
          const coverSceneFilename = `${sanitizedTitle}_cover_s1.png`;
          const coverSceneImagePath = path.join(imagesDir, coverSceneFilename);
          await fs.copyFile(sourceImagePath, coverSceneImagePath);
          comic.cover.sceneImage = `/projects/${req.params.id}/images/${coverSceneFilename}`;

          console.log(`Saved cover images: ${coverFilename}, ${coverSceneFilename}`);
        } catch (err) {
          console.error('Error saving cover:', err);
        }
      }
    }

    comic.updatedAt = new Date().toISOString();
    await fs.writeFile(filePath, JSON.stringify(comic, null, 2));
    res.json(comic.cover);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export comic in iOS app format (JSON only)
router.get('/:id/export', async (req, res) => {
  try {
    const filePath = path.join(PROJECTS_DIR, `${req.params.id}.json`);
    const content = await fs.readFile(filePath, 'utf-8');
    const comic = JSON.parse(content);
    const comicSlug = sanitizeTitle(comic.title);

    // Transform to iOS app format
    const exportedComic = transformToReaderFormat(comic, comicSlug);
    res.json(exportedComic);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Full export with files to a target directory
router.post('/:id/export-full', async (req, res) => {
  try {
    const { targetDir } = req.body;
    const filePath = path.join(PROJECTS_DIR, `${req.params.id}.json`);
    const content = await fs.readFile(filePath, 'utf-8');
    const comic = JSON.parse(content);
    const comicSlug = sanitizeTitle(comic.title);

    // Create export directory structure
    const exportDir = targetDir || path.join(PROJECTS_DIR, req.params.id, 'export', comicSlug);
    const imagesDir = path.join(exportDir, 'images');
    const audioDir = path.join(exportDir, 'audio');

    await fs.mkdir(imagesDir, { recursive: true });
    await fs.mkdir(audioDir, { recursive: true });

    // Transform to reader format
    const exportedComic = transformToReaderFormat(comic, comicSlug);

    // Copy images
    const copiedImages = [];
    const projectImagesDir = path.join(PROJECTS_DIR, req.params.id, 'images');

    // Copy cover image
    if (comic.cover?.masterImage) {
      const coverSourcePath = path.join(__dirname, '../..', comic.cover.masterImage);
      const coverDestPath = path.join(imagesDir, `${comicSlug}_cover.png`);
      try {
        await fs.copyFile(coverSourcePath, coverDestPath);
        copiedImages.push(`${comicSlug}_cover.png`);
      } catch (e) {
        console.log('Cover image not found:', coverSourcePath);
      }
    }

    // Copy page images and create panel crops
    for (const page of comic.pages) {
      if (page.masterImage) {
        const pageNum = page.pageNumber;
        const sourceImagePath = path.join(__dirname, '../..', page.masterImage);

        // Copy master page image
        const masterDestPath = path.join(imagesDir, `${comicSlug}_p${pageNum}.png`);
        try {
          await fs.copyFile(sourceImagePath, masterDestPath);
          copiedImages.push(`${comicSlug}_p${pageNum}.png`);

          // Get image dimensions for cropping
          const metadata = await sharp(sourceImagePath).metadata();
          const imgWidth = metadata.width;
          const imgHeight = metadata.height;

          // Create panel crops (scenes)
          for (const panel of page.panels || []) {
            const panelNum = panel.panelOrder;
            const sceneDestPath = path.join(imagesDir, `${comicSlug}_p${pageNum}_s${panelNum}.png`);
            const cropped = await cropAndSaveScene(
              sourceImagePath,
              sceneDestPath,
              panel.tapZone,
              imgWidth,
              imgHeight
            );
            if (cropped) {
              copiedImages.push(`${comicSlug}_p${pageNum}_s${panelNum}.png`);
            }
          }
        } catch (e) {
          console.log('Page image not found:', sourceImagePath);
        }
      }
    }

    // Write comic.json
    const comicJsonPath = path.join(exportDir, 'comic.json');
    await fs.writeFile(comicJsonPath, JSON.stringify(exportedComic, null, 2));

    res.json({
      success: true,
      exportDir,
      comicJson: comicJsonPath,
      copiedImages,
      message: `Exported to ${exportDir}`
    });
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to transform comic to reader format
function transformToReaderFormat(comic, comicSlug) {
  let wordCounter = 1;
  let sentenceCounter = 1;
  let bubbleCounter = 1;

  const pages = [];

  // Add cover page if exists
  if (comic.cover?.masterImage) {
    pages.push({
      id: `${comicSlug}-page-cover`,
      pageNumber: 1,
      masterImage: `${comicSlug}_cover`,
      panels: [{
        id: `${comicSlug}-panel-cover`,
        artworkImage: `${comicSlug}_cover`,
        panelOrder: 1,
        tapZone: { x: 0, y: 0, width: 1, height: 1 },
        bubbles: (comic.cover.bubbles || []).map(bubble => {
          const bubbleId = `${comicSlug}-bubble-cover-${bubbleCounter++}`;
          return {
            id: bubbleId,
            type: bubble.type || 'narration',
            position: {
              x: bubble.x,
              y: bubble.y,
              width: bubble.width,
              height: bubble.height
            },
            sentences: (bubble.sentences || []).map(sentence => {
              const sentenceId = `${comicSlug}-s${sentenceCounter++}`;
              return {
                id: sentenceId,
                text: sentence.text || '',
                translation: sentence.translation || '',
                audioUrl: `${comicSlug}_cover`,
                words: (sentence.words || []).map(word => ({
                  id: `${comicSlug}-w${wordCounter++}`,
                  text: word.text || '',
                  meaning: word.meaning || '',
                  baseForm: word.baseForm || word.text || ''
                }))
              };
            })
          };
        })
      }]
    });
  }

  // Add content pages
  for (const page of comic.pages) {
    const pageNum = pages.length + 1;
    const exportedPage = {
      id: `${comicSlug}-page-${page.pageNumber}`,
      pageNumber: pageNum,
      masterImage: `${comicSlug}_p${page.pageNumber}`,
      panels: (page.panels || []).map(panel => {
        const panelNum = panel.panelOrder;

        // Filter bubbles that belong to this panel
        const panelBubbles = (page.bubbles || []).filter(bubble => {
          const bubbleCenterX = bubble.x + (bubble.width || 0) / 2;
          const bubbleCenterY = bubble.y + (bubble.height || 0) / 2;
          return bubbleCenterX >= panel.tapZone.x &&
                 bubbleCenterX <= panel.tapZone.x + panel.tapZone.width &&
                 bubbleCenterY >= panel.tapZone.y &&
                 bubbleCenterY <= panel.tapZone.y + panel.tapZone.height;
        });

        return {
          id: `${comicSlug}-panel-${page.pageNumber}-${panelNum}`,
          artworkImage: `${comicSlug}_p${page.pageNumber}_s${panelNum}`,
          panelOrder: panelNum,
          tapZone: {
            x: panel.tapZone.x,
            y: panel.tapZone.y,
            width: panel.tapZone.width,
            height: panel.tapZone.height
          },
          bubbles: panelBubbles.map(bubble => {
            const bubbleId = `${comicSlug}-bubble-${page.pageNumber}-${panelNum}-${bubbleCounter++}`;
            return {
              id: bubbleId,
              type: bubble.type || 'speech',
              position: {
                x: bubble.x,
                y: bubble.y,
                width: bubble.width,
                height: bubble.height
              },
              sentences: (bubble.sentences || []).map((sentence, sIdx) => {
                const sentenceId = `${comicSlug}-s${sentenceCounter++}`;
                return {
                  id: sentenceId,
                  text: sentence.text || '',
                  translation: sentence.translation || '',
                  audioUrl: `${comicSlug}_p${page.pageNumber}_s${panelNum}`,
                  words: (sentence.words || []).map(word => ({
                    id: `${comicSlug}-w${wordCounter++}`,
                    text: word.text || '',
                    meaning: word.meaning || '',
                    baseForm: word.baseForm || word.text || ''
                  }))
                };
              })
            };
          })
        };
      })
    };
    pages.push(exportedPage);
  }

  return {
    id: `comic-${comicSlug}`,
    title: comic.title,
    description: comic.description || '',
    coverImage: `${comicSlug}_cover`,
    level: comic.level || 'beginner',
    totalPages: pages.length,
    estimatedMinutes: pages.length * 2,
    language: comic.language || 'es',
    targetLanguage: comic.targetLanguage || 'en',
    version: '1.0',
    pages,
    reviewWords: []
  };
}

module.exports = router;

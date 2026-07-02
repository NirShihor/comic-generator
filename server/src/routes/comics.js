const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const Comic = require('../models/Comic');
const ArchivedPage = require('../models/ArchivedPage');
const { sanitizeTitle, sanitizeWordForFilename, transformToReaderFormat, computePanelCorners } = require('../services/readerFormat');
const { objectStoreEnabled, uploadBundle } = require('../services/objectStore');

const PROJECTS_DIR = path.join(__dirname, '../../projects');
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

async function cropAndSaveScene(sourceImagePath, outputPath, region, imageWidth, imageHeight) {
  try {
    const left = Math.round(region.x * imageWidth);
    const top = Math.round(region.y * imageHeight);
    const width = Math.round(region.width * imageWidth);
    const height = Math.round(region.height * imageHeight);

    const pipeline = sharp(sourceImagePath)
      .extract({ left, top, width, height });

    if (outputPath.endsWith('.jpg')) {
      await pipeline.jpeg({ quality: 85 }).toFile(outputPath);
    } else {
      await pipeline.toFile(outputPath);
    }

    return true;
  } catch (error) {
    console.error('Error cropping scene:', error);
    return false;
  }
}

// Convert a source image to JPEG and save to outputPath.
// Caps width at maxWidth (default 1024) so exported art matches the reader's
// display resolution — the raw AI masters are 2048px, which is 4× the pixels a
// phone ever shows and bloats the download bundle for no visible benefit.
async function convertToJpeg(sourcePath, outputPath, maxWidth = 1024) {
  let pipe = sharp(sourcePath);
  if (maxWidth) pipe = pipe.resize(maxWidth, null, { withoutEnlargement: true });
  await pipe.jpeg({ quality: 85 }).toFile(outputPath);
}

// Like convertToJpeg, but bakes in brightness/contrast/saturation adjustments
// (each 1 = unchanged), so the values match the CSS-filter preview in the editor.
async function convertToJpegAdjusted(sourcePath, outputPath, adj = {}) {
  const brightness = adj.brightness ?? 1;
  const contrast = adj.contrast ?? 1;
  const saturation = adj.saturation ?? 1;
  const zoom = adj.zoom ?? 1;
  const cropX = adj.cropX ?? 0;   // -1 (left) .. 1 (right)
  const cropY = adj.cropY ?? 0;   // -1 (up)   .. 1 (down)
  const edgeTrim = adj.edgeTrim ?? 0;   // fraction trimmed off each edge

  let pipe = sharp(sourcePath);

  // Zoom + pan: crop a smaller window (zoom) positioned by cropX/cropY, then
  // resize back to the original dimensions. Panning only applies when zoomed in.
  if (zoom && zoom > 1) {
    const meta = await sharp(sourcePath).metadata();
    const w = meta.width || 0, h = meta.height || 0;
    if (w && h) {
      const vw = Math.max(1, Math.round(w / zoom));
      const vh = Math.max(1, Math.round(h / zoom));
      const clamp = (v, max) => Math.min(Math.max(v, 0), max);
      const left = clamp(Math.round((w - vw) * (cropX + 1) / 2), w - vw);
      const top = clamp(Math.round((h - vh) * (cropY + 1) / 2), h - vh);
      pipe = pipe.extract({ left, top, width: vw, height: vh }).resize(w, h);
    }
  } else if (edgeTrim > 0 && edgeTrim < 0.45) {
    // Trim a fixed fraction off every edge, then resize back — removes the thin
    // AI-drawn border that the cover otherwise keeps (pages already get this).
    const meta = await sharp(sourcePath).metadata();
    const w = meta.width || 0, h = meta.height || 0;
    if (w && h) {
      const tx = Math.round(w * edgeTrim);
      const ty = Math.round(h * edgeTrim);
      pipe = pipe.extract({ left: tx, top: ty, width: w - 2 * tx, height: h - 2 * ty }).resize(w, h);
    }
  }

  if (brightness !== 1 || saturation !== 1) {
    pipe = pipe.modulate({ brightness, saturation });
  }
  if (contrast !== 1) {
    // out = contrast*in + 128*(1-contrast) → contrast pivots around mid-grey.
    pipe = pipe.linear(contrast, 128 * (1 - contrast));
  }
  await pipe.jpeg({ quality: 85 }).toFile(outputPath);
}

async function ensureProjectDirs(comicId) {
  const imagesDir = path.join(PROJECTS_DIR, comicId, 'images');
  const audioDir = path.join(PROJECTS_DIR, comicId, 'audio');
  await fs.mkdir(imagesDir, { recursive: true });
  await fs.mkdir(audioDir, { recursive: true });
}

async function deleteFileIfExists(filePath) {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (err) {
    return false;
  }
}

async function deleteDirIfExists(dirPath) {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
    return true;
  } catch (err) {
    return false;
  }
}

const getDefaultPromptTemplates = () => ({
  styleBible: '',
  cameraInks: '',
  characters: [],
  globalDoNot: '',
  hardNegatives: ''
});

// Get all comic projects
router.get('/', async (req, res) => {
  try {
    const comics = await Comic.find().sort({ createdAt: -1 });
    res.json(comics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk-set the manual sort order for the reader catalog/library.
// Body: { orders: [{ id, order }, ...] } — explicit order per comic. All
// episodes of a collection get the SAME order so the series moves as one block;
// within a collection, episodeNumber decides the issue order.
// (Also accepts { ids: [...] } for a simple flat sequence.)
// Defined before "/:id" routes so "reorder" isn't treated as an id.
router.post('/reorder', async (req, res) => {
  try {
    const { orders, ids } = req.body;
    let ops;
    if (Array.isArray(orders)) {
      ops = orders.map(({ id, order }) => ({
        updateOne: { filter: { id }, update: { $set: { order: Number(order) || 0 } } }
      }));
    } else if (Array.isArray(ids)) {
      ops = ids.map((id, index) => ({
        updateOne: { filter: { id }, update: { $set: { order: index } } }
      }));
    } else {
      return res.status(400).json({ error: 'Provide orders [{id, order}] or ids []' });
    }
    if (ops.length > 0) {
      await Comic.bulkWrite(ops);
    }
    res.json({ success: true, count: ops.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single comic project
// Resolve prompt settings: from collection if comic belongs to one, otherwise from comic
router.get('/:id/prompt-settings', async (req, res) => {
  try {
    const comic = await Comic.findOne({ id: req.params.id });
    if (!comic) {
      return res.status(404).json({ error: 'Comic not found' });
    }

    // If comic belongs to a collection, try loading from collection
    if (comic.collectionId) {
      const Collection = require('../models/Collection');
      const collection = await Collection.findOne({ id: comic.collectionId });
      if (collection && collection.promptSettings) {
        // Check that the collection has meaningful data (not just an empty object)
        const ps = collection.promptSettings;
        const hasData = ps.styleBible || ps.styleBibleImages?.length > 0 ||
          ps.characters?.length > 0 || ps.masterStyleImage ||
          ps.cameraAndInks || ps.doNotInclude;
        if (hasData) {
          return res.json({
            source: 'collection',
            collectionId: comic.collectionId,
            collectionTitle: collection.title || comic.collectionTitle || '',
            promptSettings: collection.promptSettings
          });
        }
        // Collection exists but is empty — fall through to check comic/sibling
      }

      // Collection is empty or doesn't exist — check if this comic has settings to promote
      const comicPs = comic.promptSettings;
      const comicHasData = comicPs && (comicPs.styleBible || comicPs.styleBibleImages?.length > 0 ||
        comicPs.characters?.length > 0 || comicPs.masterStyleImage ||
        comicPs.cameraAndInks || comicPs.doNotInclude);
      if (comicHasData) {
        // Auto-sync comic settings to collection
        await Collection.findOneAndUpdate(
          { id: comic.collectionId },
          { $set: { promptSettings: comic.promptSettings, title: comic.collectionTitle || '' } },
          { upsert: true }
        );
        return res.json({
          source: 'collection',
          collectionId: comic.collectionId,
          collectionTitle: comic.collectionTitle || '',
          promptSettings: comic.promptSettings
        });
      }

      // No settings on this comic — look for a sibling comic that has prompt settings
      const sibling = await Comic.findOne({
        collectionId: comic.collectionId,
        id: { $ne: comic.id },
        'promptSettings.styleBible': { $exists: true, $ne: '' }
      });
      if (sibling && sibling.promptSettings) {
        // Auto-create the Collection document from the sibling's settings
        await Collection.findOneAndUpdate(
          { id: comic.collectionId },
          { $set: { promptSettings: sibling.promptSettings, title: comic.collectionTitle || sibling.collectionTitle || '' } },
          { upsert: true }
        );
        return res.json({
          source: 'collection',
          collectionId: comic.collectionId,
          collectionTitle: comic.collectionTitle || sibling.collectionTitle || '',
          promptSettings: sibling.promptSettings
        });
      }
    }

    // Fallback to comic-level settings
    res.json({
      source: 'comic',
      collectionId: comic.collectionId || null,
      collectionTitle: comic.collectionTitle || '',
      promptSettings: comic.promptSettings || {}
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const comic = await Comic.findOne({ id: req.params.id });
    if (!comic) {
      return res.status(404).json({ error: 'Comic not found' });
    }
    const comicObj = comic.toObject();
    // If comic belongs to a collection, use collection voices
    if (comic.collectionId) {
      const Collection = require('../models/Collection');
      const collection = await Collection.findOne({ id: comic.collectionId });
      if (collection?.voices?.length > 0) {
        comicObj.voices = collection.voices;
      }
    }
    res.json(comicObj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new comic project
router.post('/', async (req, res) => {
  try {
    const comicId = `comic-${uuidv4().slice(0, 8)}`;

    const comic = new Comic({
      id: comicId,
      title: req.body.title || 'Untitled Comic',
      titleEn: req.body.titleEn || '',
      description: req.body.description || '',
      level: req.body.level || 'beginner',
      language: 'es',
      targetLanguage: 'en',
      cover: {
        image: '',
        sceneImage: ''
      },
      voices: [],
      pages: [],
      promptTemplates: getDefaultPromptTemplates()
    });

    await comic.save();
    await ensureProjectDirs(comicId);

    res.json(comic);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update comic project
router.put('/:id', async (req, res) => {
  try {
    const updateData = { ...req.body };
    delete updateData.id; // Don't allow changing the id

    // Strip voices from page/cover saves — voices should only be updated
    // from the dedicated Voices tab (when voices is the primary payload).
    // Full-comic saves from PageEditor include stale/injected voices that
    // could accidentally overwrite the collection's voice config.
    if (updateData.voices && (updateData.pages || updateData.cover)) {
      delete updateData.voices;
    }

    // If updating voices and comic belongs to a collection, save to collection instead
    if (updateData.voices) {
      const existingComic = await Comic.findOne({ id: req.params.id });
      if (existingComic?.collectionId) {
        const Collection = require('../models/Collection');
        await Collection.findOneAndUpdate(
          { id: existingComic.collectionId },
          { $set: { voices: updateData.voices } },
          { upsert: true }
        );
        delete updateData.voices; // Don't store on comic level
      }
    }

    // If the client sends a pages array, merge by page ID instead of replacing
    // the entire array. This prevents stale client state from accidentally
    // wiping pages that were added/removed on the server since the client last
    // loaded the comic (a common race condition).
    let comic;
    if (updateData.pages && Array.isArray(updateData.pages)) {
      const incomingPages = updateData.pages;
      delete updateData.pages;

      comic = await Comic.findOne({ id: req.params.id });
      if (!comic) {
        return res.status(404).json({ error: 'Comic not found' });
      }

      // Update each existing page whose ID appears in the incoming data
      for (const incoming of incomingPages) {
        const existingIdx = comic.pages.findIndex(p => p.id === incoming.id);
        if (existingIdx >= 0) {
          // Merge: update all fields from the incoming page except the id
          const merged = { ...comic.pages[existingIdx].toObject?.() || comic.pages[existingIdx], ...incoming };
          comic.pages[existingIdx] = merged;
        }
        // Pages that only exist on the client (stale) are silently ignored
        // Pages that only exist on the server are preserved
      }

      // Build atomic update: set merged pages + any remaining fields
      const atomicSet = { pages: comic.pages.map(p => p.toObject?.() || p) };
      for (const [key, value] of Object.entries(updateData)) {
        atomicSet[key] = value;
      }

      await Comic.updateOne({ id: req.params.id }, { $set: atomicSet });
      // Reload to get clean Mongoose document
      comic = await Comic.findOne({ id: req.params.id });
    } else {
      comic = await Comic.findOneAndUpdate(
        { id: req.params.id },
        { $set: updateData },
        { new: true }
      );
    }

    if (!comic) {
      return res.status(404).json({ error: 'Comic not found' });
    }

    // Re-inject collection voices into response
    const comicObj = comic.toObject();
    if (comic.collectionId) {
      const Collection = require('../models/Collection');
      const collection = await Collection.findOne({ id: comic.collectionId });
      if (collection?.voices?.length > 0) {
        comicObj.voices = collection.voices;
      }
    }

    res.json(comicObj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Toggle comic lock
router.patch('/:id/lock', async (req, res) => {
  try {
    const comic = await Comic.findOne({ id: req.params.id });
    if (!comic) {
      return res.status(404).json({ error: 'Comic not found' });
    }
    comic.locked = !comic.locked;
    await comic.save();
    res.json({ locked: comic.locked });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add page to comic
router.post('/:id/pages', async (req, res) => {
  try {
    const comic = await Comic.findOne({ id: req.params.id });
    if (!comic) {
      return res.status(404).json({ error: 'Comic not found' });
    }

    const { afterPageNumber } = req.body || {};

    const page = {
      id: `page-${uuidv4()}`,
      pageNumber: 0, // will be set below
      masterImage: '',
      dividerLines: {
        horizontal: [],
        vertical: []
      },
      panels: []
    };

    if (afterPageNumber != null && afterPageNumber < comic.pages.length) {
      // Insert after the specified page number
      page.pageNumber = afterPageNumber + 1;

      // Find the insertion array index BEFORE renumbering
      const insertIdx = comic.pages.findIndex(p => p.pageNumber === afterPageNumber + 1);

      // Renumber all pages that come after the insertion point
      comic.pages.forEach(p => {
        if (p.pageNumber > afterPageNumber) {
          p.pageNumber += 1;
        }
      });

      // Insert at the correct position in the array
      if (insertIdx >= 0) {
        comic.pages.splice(insertIdx, 0, page);
      } else {
        comic.pages.push(page);
      }
    } else {
      // Append at the end (default)
      page.pageNumber = comic.pages.length + 1;
      comic.pages.push(page);
    }

    await comic.save();

    res.json(page);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update page (dividerLines and panels)
router.put('/:id/pages/:pageId', async (req, res) => {
  try {
    const comic = await Comic.findOne({ id: req.params.id });
    if (!comic) {
      return res.status(404).json({ error: 'Comic not found' });
    }

    const pageIndex = comic.pages.findIndex(p => p.id === req.params.pageId);
    if (pageIndex === -1) {
      return res.status(404).json({ error: 'Page not found' });
    }

    const page = comic.pages[pageIndex];
    const sanitizedTitle = sanitizeTitle(comic.title);
    const imagesDir = path.join(PROJECTS_DIR, req.params.id, 'images');

    if (req.body.dividerLines !== undefined) {
      page.dividerLines = req.body.dividerLines;
    }
    if (req.body.panels !== undefined) {
      page.panels = req.body.panels;
    }
    if (req.body.lines !== undefined) {
      page.lines = req.body.lines;
    }
    if (req.body.bubbles !== undefined) {
      page.bubbles = req.body.bubbles;
    }
    if (req.body.hotspots !== undefined) {
      page.hotspots = req.body.hotspots;
    }
    if (req.body.bakedImage !== undefined) {
      page.bakedImage = req.body.bakedImage;
    }
    if (req.body.masterImage !== undefined) {
      // Strip cache-buster query strings (e.g. ?t=123456)
      const cleanMasterImage = req.body.masterImage.split('?')[0];
      page.masterImage = cleanMasterImage;

      if (cleanMasterImage && req.body.panels && req.body.panels.length > 0) {
        let sourceImagePath;
        if (cleanMasterImage.startsWith('/uploads/')) {
          sourceImagePath = path.join(UPLOADS_DIR, cleanMasterImage.replace('/uploads/', ''));
        } else if (cleanMasterImage.startsWith('/projects/')) {
          sourceImagePath = path.join(PROJECTS_DIR, cleanMasterImage.replace('/projects/', ''));
        }

        if (sourceImagePath) {
          try {
            await ensureProjectDirs(req.params.id);
            const metadata = await sharp(sourceImagePath).metadata();
            const imageWidth = metadata.width;
            const imageHeight = metadata.height;

            const pageFilename = `${sanitizedTitle}_p${page.pageNumber}.png`;
            const pageImagePath = path.join(imagesDir, pageFilename);
            await fs.copyFile(sourceImagePath, pageImagePath);
            page.masterImage = `/projects/${req.params.id}/images/${pageFilename}`;

            for (let i = 0; i < req.body.panels.length; i++) {
              const panel = req.body.panels[i];
              const sceneFilename = `${sanitizedTitle}_p${page.pageNumber}_s${i + 1}.png`;
              const sceneImagePath = path.join(imagesDir, sceneFilename);

              await cropAndSaveScene(
                sourceImagePath,
                sceneImagePath,
                panel.tapZone,
                imageWidth,
                imageHeight
              );

              page.panels[i].artworkImage = `/projects/${req.params.id}/images/${sceneFilename}`;
            }

            console.log(`Generated ${req.body.panels.length} scene images for page ${page.pageNumber}`);
          } catch (err) {
            console.error('Error processing images:', err);
          }
        }
      }
    }

    await Comic.updateOne(
      { id: req.params.id, 'pages.id': req.params.pageId },
      { $set: { [`pages.${pageIndex}`]: page.toObject?.() || page } }
    );
    res.json(page);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Legacy: Update page panels (tap zones)
router.put('/:id/pages/:pageId/panels', async (req, res) => {
  try {
    const comic = await Comic.findOne({ id: req.params.id });
    if (!comic) {
      return res.status(404).json({ error: 'Comic not found' });
    }

    const pageIndex = comic.pages.findIndex(p => p.id === req.params.pageId);
    if (pageIndex === -1) {
      return res.status(404).json({ error: 'Page not found' });
    }

    comic.pages[pageIndex].panels = req.body.panels;
    await comic.save();

    res.json(comic.pages[pageIndex]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a single panel's fields (artwork, adjustments, etc.)
router.patch('/:id/pages/:pageId/panels/:panelId', async (req, res) => {
  try {
    const comic = await Comic.findOne({ id: req.params.id });
    if (!comic) {
      return res.status(404).json({ error: 'Comic not found' });
    }

    const pageIndex = comic.pages.findIndex(p => p.id === req.params.pageId);
    if (pageIndex === -1) {
      return res.status(404).json({ error: 'Page not found' });
    }

    const panel = comic.pages[pageIndex].panels.find(p => p.id === req.params.panelId);
    if (!panel) {
      return res.status(404).json({ error: 'Panel not found' });
    }

    // Merge provided fields onto the panel
    const allowedFields = ['artworkImage', 'fitMode', 'cropX', 'cropY', 'zoom', 'brightness', 'contrast', 'saturation', 'refImages', 'annotations'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        panel[field] = req.body[field];
      }
    }

    // Clear baked image if artwork changed — needs re-bake
    if (req.body.artworkImage && comic.pages[pageIndex].bakedImage) {
      comic.pages[pageIndex].bakedImage = '';
    }

    await comic.save();
    res.json(panel);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update cover image
router.put('/:id/cover', async (req, res) => {
  try {
    const comic = await Comic.findOne({ id: req.params.id });
    if (!comic) {
      return res.status(404).json({ error: 'Comic not found' });
    }

    const sanitizedTitle = sanitizeTitle(comic.title);
    const imagesDir = path.join(PROJECTS_DIR, req.params.id, 'images');

    if (!comic.cover) {
      comic.cover = { image: '', sceneImage: '', prompt: '' };
    }

    // Save the cover prompt if provided
    if (req.body.prompt !== undefined) {
      comic.cover.prompt = req.body.prompt;
    }

    if (req.body.bubbles !== undefined) {
      comic.cover.bubbles = req.body.bubbles;
    }

    if (req.body.image) {
      // Strip cache-busting query strings (e.g. ?t=123456) from image paths
      const cleanImage = req.body.image.split('?')[0];
      let sourceImagePath;
      if (cleanImage.startsWith('/uploads/')) {
        sourceImagePath = path.join(UPLOADS_DIR, cleanImage.replace('/uploads/', ''));
      } else if (cleanImage.startsWith('/projects/')) {
        sourceImagePath = path.join(PROJECTS_DIR, cleanImage.replace('/projects/', ''));
      }

      if (sourceImagePath) {
        try {
          await ensureProjectDirs(req.params.id);

          const coverFilename = `${sanitizedTitle}_cover.png`;
          const coverImagePath = path.join(imagesDir, coverFilename);
          await fs.copyFile(sourceImagePath, coverImagePath);
          comic.cover.image = `/projects/${req.params.id}/images/${coverFilename}`;

          const coverSceneFilename = `${sanitizedTitle}_cover_s1.png`;
          const coverSceneImagePath = path.join(imagesDir, coverSceneFilename);
          await fs.copyFile(sourceImagePath, coverSceneImagePath);
          comic.cover.sceneImage = `/projects/${req.params.id}/images/${coverSceneFilename}`;

          // Clear stale baked image when a new upload replaces the cover
          if (cleanImage.startsWith('/uploads/')) {
            comic.cover.bakedImage = '';
          }

          console.log(`Saved cover images: ${coverFilename}, ${coverSceneFilename}`);
        } catch (err) {
          console.error('Error saving cover:', err);
        }
      }
    }

    await comic.save();
    res.json(comic.cover);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export comic in iOS app format (JSON only)
router.get('/:id/export', async (req, res) => {
  try {
    const comic = await Comic.findOne({ id: req.params.id });
    if (!comic) {
      return res.status(404).json({ error: 'Comic not found' });
    }

    const comicSlug = sanitizeTitle(comic.title);
    const exportedComic = transformToReaderFormat(comic.toObject(), comicSlug);
    res.json(exportedComic);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Full export with files to a target directory
router.post('/:id/export-full', async (req, res) => {
  try {
    const { targetDir } = req.body;
    let comic = await Comic.findOne({ id: req.params.id });
    if (!comic) {
      return res.status(404).json({ error: 'Comic not found' });
    }

    // Ensure every sentence has a grammar explanation before baking the
    // bundle — exporting mid-generation (or before generating) otherwise
    // produces bundles without notes.
    let grammarNotesGenerated = 0;
    try {
      const { generateGrammarNotes } = require('../services/grammarNotes');
      const result = await generateGrammarNotes(comic);
      grammarNotesGenerated = result.updated;
      if (result.updated > 0) {
        console.log(`[Export] Generated ${result.updated} missing grammar notes before export`);
        comic = await Comic.findOne({ id: req.params.id });
      }
    } catch (e) {
      console.warn(`[Export] Skipping grammar note generation: ${e.message}`);
    }

    const comicObj = comic.toObject();
    const comicSlug = sanitizeTitle(comicObj.title);

    const exportDir = targetDir || path.join(PROJECTS_DIR, req.params.id, 'export', comicSlug);
    const imagesDir = path.join(exportDir, 'images');
    const audioDir = path.join(exportDir, 'audio');

    await fs.mkdir(imagesDir, { recursive: true });
    await fs.mkdir(audioDir, { recursive: true });

    // Clean up old images from previous exports (PNGs and stale _no_text JPEGs)
    try {
      const existingFiles = await fs.readdir(imagesDir);
      for (const file of existingFiles) {
        if (file.endsWith('.png') || file.endsWith('.jpg')) {
          await fs.unlink(path.join(imagesDir, file));
        }
      }
    } catch (e) {
      // Directory might not exist yet
    }

    const exportedComic = transformToReaderFormat(comicObj, comicSlug);

    const copiedImages = [];
    const copiedAudio = [];
    const projectAudioDir = path.join(PROJECTS_DIR, req.params.id, 'audio');

    if (comicObj.cover?.image) {
      let coverImage = comicObj.cover.bakedImage || comicObj.cover.image;
      // The cover's baked file (art + title bubble) is created reliably by the
      // editor, but the `cover.bakedImage` DB field doesn't always persist (race
      // with cover re-saves). So prefer the baked file on disk when it's at least
      // as new as the cover art — this is what reliably includes the title bubble.
      try {
        const bakedDiskPath = path.join(PROJECTS_DIR, req.params.id, 'images', `${req.params.id}_cover_baked.png`);
        const srcDiskPath = path.join(__dirname, '../..', (comicObj.cover.image || '').split('?')[0]);
        const [bakedStat, srcStat] = await Promise.all([fs.stat(bakedDiskPath), fs.stat(srcDiskPath)]);
        if (bakedStat.mtimeMs >= srcStat.mtimeMs) {
          coverImage = `/projects/${req.params.id}/images/${req.params.id}_cover_baked.png`;
        }
      } catch (e) {
        // No baked file (or art missing) — fall back to the chosen coverImage.
      }
      const cleanCoverImage = coverImage.split('?')[0];
      const coverSourcePath = path.join(__dirname, '../..', cleanCoverImage);
      const coverDestPath = path.join(imagesDir, `${comicSlug}_cover.jpg`);
      try {
        // Trim ~4% off each edge to drop the thin AI-drawn border the cover keeps.
        await convertToJpegAdjusted(coverSourcePath, coverDestPath, { edgeTrim: 0.04 });
        copiedImages.push(`${comicSlug}_cover.jpg`);
      } catch (e) {
        console.log('Cover image not found:', coverSourcePath);
      }
    }

    // Copy the landscape cover (reader detail-view banner) if one was generated.
    if (comicObj.cover?.landscapeImage) {
      const cleanLandscape = comicObj.cover.landscapeImage.split('?')[0];
      const landscapeSourcePath = path.join(__dirname, '../..', cleanLandscape);
      const landscapeDestPath = path.join(imagesDir, `${comicSlug}_cover_landscape.jpg`);
      try {
        await convertToJpegAdjusted(landscapeSourcePath, landscapeDestPath, {
          brightness: comicObj.cover.landscapeBrightness,
          contrast: comicObj.cover.landscapeContrast,
          saturation: comicObj.cover.landscapeSaturation,
          zoom: comicObj.cover.landscapeZoom,
          cropX: comicObj.cover.landscapeCropX,
          cropY: comicObj.cover.landscapeCropY
        });
        copiedImages.push(`${comicSlug}_cover_landscape.jpg`);
      } catch (e) {
        console.log('Landscape cover image not found:', landscapeSourcePath);
      }
    }

    // Copy collection cover image if this comic belongs to a collection
    if (comicObj.collectionId) {
      const Collection = require('../models/Collection');
      const collection = await Collection.findOne({ id: comicObj.collectionId });
      if (collection?.titleEn) {
        exportedComic.collectionTitleEn = collection.titleEn;
      }
      if (collection?.coverImage) {
        const cleanColCover = collection.coverImage.split('?')[0];
        const colCoverSource = path.join(__dirname, '../..', cleanColCover);
        const colCoverDest = path.join(imagesDir, 'collection_cover.jpg');
        try {
          await convertToJpeg(colCoverSource, colCoverDest);
          copiedImages.push('collection_cover.jpg');
          exportedComic.collectionCoverImage = 'collection_cover';
        } catch (e) {
          console.log('Collection cover image not found:', colCoverSource);
        }
      }
    }

    for (const page of comicObj.pages) {
      const pageImage = page.bakedImage || page.masterImage;
      if (pageImage) {
        const pageNum = page.pageNumber;
        const cleanPageImage = pageImage.split('?')[0];
        const sourceImagePath = path.join(__dirname, '../..', cleanPageImage);

        const masterDestPath = path.join(imagesDir, `${comicSlug}_p${pageNum}.jpg`);
        try {
          await convertToJpeg(sourceImagePath, masterDestPath);
          copiedImages.push(`${comicSlug}_p${pageNum}.jpg`);

          // If there's a baked image, also export the raw master as _no_text variant
          // for Speaking Practice Mode in the reader app
          const rawMasterPath = page.masterImage
            ? path.join(__dirname, '../..', page.masterImage.split('?')[0])
            : null;
          const hasBakedImage = page.bakedImage && page.masterImage && page.bakedImage !== page.masterImage;

          // Determine the source for panel crops and no_text variants
          const rawImagePath = hasBakedImage ? rawMasterPath : sourceImagePath;

          if (hasBakedImage && rawMasterPath) {
            const noTextDestPath = path.join(imagesDir, `${comicSlug}_p${pageNum}_no_text.jpg`);
            try {
              // Get image bubbles from this page
              const pageBubbles = page.bubbles || [];
              const imageBubbles = pageBubbles.filter(b => b.type === 'image' && b.imageUrl);

              if (imageBubbles.length > 0) {
                // Composite image bubbles onto the raw master
                const rawMeta = await sharp(rawMasterPath).metadata();
                const composites = [];
                for (const ib of imageBubbles) {
                  const imgPath = path.join(__dirname, '../..', ib.imageUrl.split('?')[0]);
                  try {
                    await fs.access(imgPath);
                    const left = Math.round(ib.x * rawMeta.width);
                    const top = Math.round(ib.y * rawMeta.height);
                    const width = Math.round(ib.width * rawMeta.width);
                    const height = Math.round(ib.height * rawMeta.height);
                    const resized = await sharp(imgPath).resize(width, height, { fit: 'fill' }).toBuffer();
                    composites.push({ input: resized, left, top });
                  } catch (e) {
                    console.log('Image bubble source not found, skipping:', imgPath);
                  }
                }
                await sharp(rawMasterPath).composite(composites).resize(1024, null, { withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(noTextDestPath);
              } else {
                // No image bubbles — just convert the raw master
                await convertToJpeg(rawMasterPath, noTextDestPath);
              }
              copiedImages.push(`${comicSlug}_p${pageNum}_no_text.jpg`);
            } catch (e) {
              console.log('Raw master image not found for no_text:', rawMasterPath);
            }
          }

          // Export the empty-bubbles variant (bubbles drawn, text blank) for the
          // reader's practice modes — bubbles are visible so they're tappable.
          if (page.emptyBubblesImage) {
            try {
              const emptySrc = path.join(__dirname, '../..', page.emptyBubblesImage.split('?')[0]);
              const emptyDest = path.join(imagesDir, `${comicSlug}_p${pageNum}_empty_bubbles.jpg`);
              await convertToJpeg(emptySrc, emptyDest);
              copiedImages.push(`${comicSlug}_p${pageNum}_empty_bubbles.jpg`);
            } catch (e) {
              console.log('Empty-bubbles image not found:', page.emptyBubblesImage);
            }
          }

          const metadata = await sharp(sourceImagePath).metadata();
          const imgWidth = metadata.width;
          const imgHeight = metadata.height;

          for (const panel of page.panels || []) {
            const panelNum = panel.panelOrder;
            // Compute crop region: use corners bounding box if diagonal dividers exist
            const corners = computePanelCorners(panel, page.lines);
            let cropRegion = panel.tapZone;
            if (corners && !panel.floating) {
              const xs = corners.map(c => c.x);
              const ys = corners.map(c => c.y);
              const minX = Math.max(0, Math.min(...xs));
              const minY = Math.max(0, Math.min(...ys));
              const maxX = Math.min(1, Math.max(...xs));
              const maxY = Math.min(1, Math.max(...ys));
              cropRegion = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
            }
            // Panel crop from baked image (with text)
            const sceneDestPath = path.join(imagesDir, `${comicSlug}_p${pageNum}_s${panelNum}.jpg`);

            // Floating panels with pre-baked crops: use the clean per-panel image
            // (generated client-side with only this panel rendered, no overlap artifacts)
            let usedBakedCrop = false;
            if (panel.floating) {
              console.log(`[Export] Floating panel p${pageNum}_s${panelNum}: bakedCropImage=${panel.bakedCropImage || 'NOT SET'}`);
            }
            if (panel.floating && panel.bakedCropImage) {
              try {
                const bakedCropPath = path.join(__dirname, '../..', panel.bakedCropImage.split('?')[0]);
                console.log(`[Export] Trying baked crop: ${bakedCropPath}`);
                await fs.access(bakedCropPath);
                await convertToJpeg(bakedCropPath, sceneDestPath);
                copiedImages.push(`${comicSlug}_p${pageNum}_s${panelNum}.jpg`);
                usedBakedCrop = true;
                console.log(`[Export] Used baked crop for p${pageNum}_s${panelNum}`);
              } catch (e) {
                console.log(`Baked crop not found for p${pageNum}_s${panelNum}: ${e.message}`);
              }
            }

            if (!usedBakedCrop) {
              const cropped = await cropAndSaveScene(
                sourceImagePath,
                sceneDestPath,
                cropRegion,
                imgWidth,
                imgHeight
              );
              if (cropped) {
                copiedImages.push(`${comicSlug}_p${pageNum}_s${panelNum}.jpg`);
              }
            }

            // Panel crop from no_text image (master + image bubbles) for Speaking Practice Mode
            if (hasBakedImage && rawMasterPath) {
              const noTextSceneDestPath = path.join(imagesDir, `${comicSlug}_p${pageNum}_s${panelNum}_no_text.jpg`);
              try {
                const noTextFullPath = path.join(imagesDir, `${comicSlug}_p${pageNum}_no_text.jpg`);
                const noTextMeta = await sharp(noTextFullPath).metadata();
                const rawCropped = await cropAndSaveScene(
                  noTextFullPath,
                  noTextSceneDestPath,
                  cropRegion,
                  noTextMeta.width,
                  noTextMeta.height
                );
                if (rawCropped) {
                  copiedImages.push(`${comicSlug}_p${pageNum}_s${panelNum}_no_text.jpg`);
                }
              } catch (e) {
                console.log('Failed to crop no_text panel:', e.message);
              }
            }
          }
        } catch (e) {
          console.log('Page image not found:', sourceImagePath);
        }
      }
    }

    // Copy audio files
    const allBubbles = [
      ...(comicObj.cover?.bubbles || []),
      ...(comicObj.pages || []).flatMap(p => p.bubbles || [])
    ];
    for (const bubble of allBubbles) {
      for (const sentence of bubble.sentences || []) {
        if (sentence.audioUrl) {
          const audioFilename = `${sentence.audioUrl}.mp3`;
          const audioSourcePath = path.join(projectAudioDir, audioFilename);
          const audioDestPath = path.join(audioDir, audioFilename);
          try {
            await fs.copyFile(audioSourcePath, audioDestPath);
            copiedAudio.push(audioFilename);
          } catch (e) {
            console.log('Audio file not found:', audioSourcePath);
          }
        }
        // Copy translation audio file (English)
        if (sentence.translationAudioUrl) {
          const transFilename = `${sentence.translationAudioUrl}.mp3`;
          const transSourcePath = path.join(projectAudioDir, transFilename);
          const transDestPath = path.join(audioDir, transFilename);
          try {
            await fs.copyFile(transSourcePath, transDestPath);
            copiedAudio.push(transFilename);
          } catch (e) {
            console.log('Translation audio file not found:', transSourcePath);
          }
        }
        // Copy alternative audio files
        for (const alt of sentence.alternatives || []) {
          if (alt.audioUrl) {
            const altFilename = `${alt.audioUrl}.mp3`;
            const altSourcePath = path.join(projectAudioDir, altFilename);
            const altDestPath = path.join(audioDir, altFilename);
            try {
              await fs.copyFile(altSourcePath, altDestPath);
              copiedAudio.push(altFilename);
            } catch (e) {
              console.log('Alternative audio file not found:', altSourcePath);
            }
          }
        }
      }
    }

    // Copy word audio files
    const copiedWordAudio = [];
    const wordAudioSourceDir = path.join(PROJECTS_DIR, req.params.id, 'audio', 'words');
    const wordAudioDestDir = path.join(audioDir, 'words');
    try {
      const wordFiles = await fs.readdir(wordAudioSourceDir);
      await fs.mkdir(wordAudioDestDir, { recursive: true });
      for (const file of wordFiles) {
        if (file.endsWith('.mp3')) {
          await fs.copyFile(
            path.join(wordAudioSourceDir, file),
            path.join(wordAudioDestDir, file)
          );
          copiedWordAudio.push(`words/${file}`);
        }
      }
    } catch (e) {
      console.log('No word audio files to copy');
    }

    // Copy hotspot slide images and audio
    const hotspotsImagesDir = path.join(imagesDir, 'hotspots');
    let copiedHotspotFiles = 0;
    for (const page of comicObj.pages || []) {
      for (let hIdx = 0; hIdx < (page.hotspots || []).length; hIdx++) {
        const hotspot = page.hotspots[hIdx];
        for (let sIdx = 0; sIdx < (hotspot.slides || []).length; sIdx++) {
          const slide = hotspot.slides[sIdx];
          // Copy slide image
          if (slide.imageUrl) {
            await fs.mkdir(hotspotsImagesDir, { recursive: true });
            const imageSourcePath = path.join(__dirname, '../..', slide.imageUrl);
            const imageExt = path.extname(slide.imageUrl) || '.jpg';
            const imageDestName = `${comicSlug}_p${page.pageNumber}_h${hIdx + 1}_slide${sIdx + 1}${imageExt}`;
            const imageDestPath = path.join(hotspotsImagesDir, imageDestName);
            try {
              await fs.copyFile(imageSourcePath, imageDestPath);
              copiedHotspotFiles++;
            } catch (e) {
              console.log('Hotspot image not found:', imageSourcePath);
            }
          }
          // Copy slide audio
          if (slide.audioUrl) {
            const audioFilename = `${slide.audioUrl}.mp3`;
            const audioSourcePath = path.join(projectAudioDir, audioFilename);
            const audioDestPath = path.join(audioDir, audioFilename);
            try {
              await fs.copyFile(audioSourcePath, audioDestPath);
              copiedHotspotFiles++;
            } catch (e) {
              console.log('Hotspot audio not found:', audioSourcePath);
            }
          }
          // Copy slide translation audio
          if (slide.translationAudioUrl) {
            const transFilename = `${slide.translationAudioUrl}.mp3`;
            const transSourcePath = path.join(projectAudioDir, transFilename);
            const transDestPath = path.join(audioDir, transFilename);
            try {
              await fs.copyFile(transSourcePath, transDestPath);
              copiedHotspotFiles++;
            } catch (e) {
              console.log('Hotspot translation audio not found:', transSourcePath);
            }
          }
        }
      }
    }
    if (copiedHotspotFiles > 0) {
      console.log(`Copied ${copiedHotspotFiles} hotspot files`);
    }

    const comicJsonPath = path.join(exportDir, 'comic.json');
    await fs.writeFile(comicJsonPath, JSON.stringify(exportedComic, null, 2));

    // Pre-build ZIP bundle for fast downloads
    const archiver = require('archiver');
    const fsSync = require('fs');
    const zipPath = path.join(exportDir, '..', `${comicSlug}.zip`);
    const zipOutput = fsSync.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 0 } });

    await new Promise((resolve, reject) => {
      zipOutput.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(zipOutput);
      archive.directory(exportDir, false);
      archive.finalize();
    });

    const zipStat = await fs.stat(zipPath);
    const zipSizeMB = Math.round(zipStat.size / (1024 * 1024) * 10) / 10;
    console.log(`Pre-built ZIP: ${zipPath} (${zipSizeMB} MB)`);

    // Auto-sync the fresh export to the fly.io volume in the BACKGROUND, so
    // the browser gets its response as soon as the local bundle is built
    // (skipped when this server IS the fly deployment). The fly upload can
    // take minutes; never block the export response on it.
    if (!process.env.FLY_APP_NAME) {
      const { execFile } = require('child_process');
      const syncScript = path.join(__dirname, '../../sync-store.sh');
      execFile(syncScript, [req.params.id], { timeout: 1200000 }, (err, stdout, stderr) => {
        if (err) console.warn(`[Export] Background fly sync failed (export is complete locally; run sync-store.sh manually): ${stderr || err.message}`);
        else console.log(`[Export] Background fly sync of ${req.params.id} complete`);
      });
      console.log(`[Export] Started background fly sync of ${req.params.id}`);
    }

    res.json({
      success: true,
      exportDir,
      comicJson: comicJsonPath,
      copiedImages,
      copiedAudio,
      copiedWordAudio,
      zipSizeMB,
      grammarNotesGenerated,
      flySyncing: !process.env.FLY_APP_NAME,
      message: `Exported to ${exportDir} (ZIP: ${zipSizeMB} MB)`
        + (grammarNotesGenerated > 0 ? ` — generated ${grammarNotesGenerated} missing grammar notes first` : '')
        + (!process.env.FLY_APP_NAME ? ' — syncing to fly in the background (re-download on the phone once it finishes)' : '')
    });
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete entire comic and all associated files
router.delete('/:id', async (req, res) => {
  try {
    const comic = await Comic.findOne({ id: req.params.id });
    if (!comic) {
      return res.status(404).json({ error: 'Comic not found' });
    }
    if (comic.locked) {
      return res.status(403).json({ error: 'Comic is locked. Unlock it before deleting.' });
    }

    const comicDir = path.join(PROJECTS_DIR, req.params.id);
    await deleteDirIfExists(comicDir);
    await Comic.deleteOne({ id: req.params.id });

    res.json({ success: true, message: 'Comic deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete or archive page from comic
router.delete('/:id/pages/:pageId', async (req, res) => {
  try {
    const archive = req.query.archive === 'true';
    const deleteAudio = req.query.deleteAudio === 'true';
    const comic = await Comic.findOne({ id: req.params.id });
    if (!comic) {
      return res.status(404).json({ error: 'Comic not found' });
    }

    const pageIndex = comic.pages.findIndex(p => p.id === req.params.pageId);
    if (pageIndex === -1) {
      return res.status(404).json({ error: 'Page not found' });
    }

    const page = comic.pages[pageIndex];
    const deletedFiles = [];

    // If archiving, save to ArchivedPage collection
    if (archive) {
      const archivedPage = new ArchivedPage({
        comicId: req.params.id,
        comicTitle: comic.title,
        pageId: page.id,
        originalPageNumber: page.pageNumber,
        masterImage: page.masterImage,
        lines: page.lines,
        dividerLines: page.dividerLines,
        panels: page.panels,
        bubbles: page.bubbles
      });
      await archivedPage.save();
    }

    // Delete audio files if requested (only when permanently deleting, not archiving)
    if (deleteAudio && !archive && page.bubbles) {
      const audioDir = path.join(PROJECTS_DIR, req.params.id, 'audio');
      for (const bubble of page.bubbles) {
        if (bubble.sentences) {
          for (const sentence of bubble.sentences) {
            if (sentence.audioUrl) {
              const audioPath = path.join(audioDir, path.basename(sentence.audioUrl));
              if (await deleteFileIfExists(audioPath)) {
                deletedFiles.push(sentence.audioUrl);
              }
            }
          }
        }
      }
    }

    comic.pages.splice(pageIndex, 1);

    comic.pages.forEach((p, idx) => {
      p.pageNumber = idx + 1;
    });

    await comic.save();

    res.json({
      success: true,
      message: archive ? 'Page archived' : 'Page deleted',
      archived: archive,
      deletedAudioFiles: deletedFiles
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get archived pages for a comic
router.get('/:id/archived-pages', async (req, res) => {
  try {
    const archivedPages = await ArchivedPage.find({ comicId: req.params.id })
      .sort({ archivedAt: -1 });
    res.json(archivedPages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Restore an archived page
router.post('/:id/archived-pages/:archivedPageId/restore', async (req, res) => {
  try {
    const comic = await Comic.findOne({ id: req.params.id });
    if (!comic) {
      return res.status(404).json({ error: 'Comic not found' });
    }

    const archivedPage = await ArchivedPage.findById(req.params.archivedPageId);
    if (!archivedPage) {
      return res.status(404).json({ error: 'Archived page not found' });
    }

    // Create new page from archived data
    const newPageNumber = comic.pages.length + 1;
    const restoredPage = {
      id: archivedPage.pageId,
      pageNumber: newPageNumber,
      masterImage: archivedPage.masterImage,
      lines: archivedPage.lines,
      dividerLines: archivedPage.dividerLines,
      panels: archivedPage.panels,
      bubbles: archivedPage.bubbles
    };

    comic.pages.push(restoredPage);
    await comic.save();

    // Delete from archive
    await ArchivedPage.findByIdAndDelete(req.params.archivedPageId);

    res.json({
      success: true,
      message: 'Page restored',
      page: restoredPage
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Permanently delete an archived page
router.delete('/:id/archived-pages/:archivedPageId', async (req, res) => {
  try {
    const archivedPage = await ArchivedPage.findById(req.params.archivedPageId);
    if (!archivedPage) {
      return res.status(404).json({ error: 'Archived page not found' });
    }

    await ArchivedPage.findByIdAndDelete(req.params.archivedPageId);

    res.json({
      success: true,
      message: 'Archived page permanently deleted'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete bubble from page
router.delete('/:id/pages/:pageId/bubbles/:bubbleId', async (req, res) => {
  try {
    const deleteAudio = req.query.deleteAudio === 'true';
    const comic = await Comic.findOne({ id: req.params.id });
    if (!comic) {
      return res.status(404).json({ error: 'Comic not found' });
    }

    const pageIndex = comic.pages.findIndex(p => p.id === req.params.pageId);
    if (pageIndex === -1) {
      return res.status(404).json({ error: 'Page not found' });
    }

    const page = comic.pages[pageIndex];
    const bubbleIndex = (page.bubbles || []).findIndex(b => b.id === req.params.bubbleId);
    if (bubbleIndex === -1) {
      return res.status(404).json({ error: 'Bubble not found' });
    }

    const bubble = page.bubbles[bubbleIndex];
    const deletedFiles = [];

    if (deleteAudio && bubble.sentences) {
      const audioDir = path.join(PROJECTS_DIR, req.params.id, 'audio');
      for (const sentence of bubble.sentences) {
        if (sentence.audioUrl) {
          const audioPath = path.join(audioDir, path.basename(sentence.audioUrl));
          if (await deleteFileIfExists(audioPath)) {
            deletedFiles.push(sentence.audioUrl);
          }
        }
      }
    }

    page.bubbles.splice(bubbleIndex, 1);
    await comic.save();

    res.json({
      success: true,
      message: 'Bubble deleted',
      deletedAudioFiles: deletedFiles
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete panel from page
router.delete('/:id/pages/:pageId/panels/:panelId', async (req, res) => {
  try {
    const comic = await Comic.findOne({ id: req.params.id });
    if (!comic) {
      return res.status(404).json({ error: 'Comic not found' });
    }

    const pageIndex = comic.pages.findIndex(p => p.id === req.params.pageId);
    if (pageIndex === -1) {
      return res.status(404).json({ error: 'Page not found' });
    }

    const page = comic.pages[pageIndex];
    const panelIndex = (page.panels || []).findIndex(p => p.id === req.params.panelId);
    if (panelIndex === -1) {
      return res.status(404).json({ error: 'Panel not found' });
    }

    page.panels.splice(panelIndex, 1);

    page.panels.forEach((p, idx) => {
      p.panelOrder = idx + 1;
    });

    await comic.save();

    res.json({ success: true, message: 'Panel deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Bundle upload (used by sync-store.sh to push exports to the fly volume over
// HTTPS instead of the flaky WireGuard sftp tunnel). Behind the same auth
// cookie as the rest of /api/comics. The uploaded tar contains
// `comic-<id>/export/...` entries; we extract it into PROJECTS_DIR.
// ---------------------------------------------------------------------------
// Pick the newest non-AppleDouble .zip in an export dir. A comic renamed after a
// previous export leaves several {slug}.zip files; the current one is the newest.
// (Picking the first alphabetically served stale content — e.g. "el_superviviente"
// instead of the renamed "la_casa_en_la_colina".)
async function newestBundleZip(dir) {
  let files;
  try { files = await fs.readdir(dir); } catch { return null; }
  const zips = files.filter(f => f.endsWith('.zip') && !f.startsWith('._'));
  if (zips.length <= 1) return zips[0] || null;
  const stamped = await Promise.all(zips.map(async f => {
    try { return { f, m: (await fs.stat(path.join(dir, f))).mtimeMs }; }
    catch { return { f, m: 0 }; }
  }));
  stamped.sort((a, b) => b.m - a.m);
  return stamped[0].f;
}

// Short version tag for a bundle, derived from its size + mtime so it changes on
// every re-export. Baked into the Tigris object key for cache-busting (see
// objectStore.bundleKey). Cheap — no full-file read.
async function bundleVersionFor(zipPath) {
  const crypto = require('crypto');
  const st = await fs.stat(zipPath);
  return crypto.createHash('sha1').update(`${st.size}-${st.mtimeMs}`).digest('hex').slice(0, 12);
}

const BUNDLE_TMP_DIR = path.join(PROJECTS_DIR, '.upload-tmp');
const bundleUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try { await fs.mkdir(BUNDLE_TMP_DIR, { recursive: true }); cb(null, BUNDLE_TMP_DIR); }
      catch (e) { cb(e); }
    },
    filename: (req, file, cb) => cb(null, `bundle-${req.params.id}-${Date.now()}.tar`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB ceiling
});

router.post('/:id/upload-bundle', bundleUpload.single('bundle'), async (req, res) => {
  const { execFile } = require('child_process');
  const id = req.params.id;
  if (!/^comic-[A-Za-z0-9_-]+$/.test(id)) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'Invalid comic id' });
  }
  if (!req.file) return res.status(400).json({ error: 'No bundle uploaded (expected field "bundle")' });

  const tarPath = req.file.path;
  try {
    // Replace the existing export atomically-ish: extract first, then swap.
    const exportDir = path.join(PROJECTS_DIR, id, 'export');
    await fs.rm(exportDir, { recursive: true, force: true });
    await new Promise((resolve, reject) => {
      execFile('tar', ['-xf', tarPath, '-C', PROJECTS_DIR], { maxBuffer: 1024 * 1024 * 64 }, (err, _o, stderr) => {
        if (err) reject(new Error(stderr || err.message)); else resolve();
      });
    });
    const sizeMB = Math.round(req.file.size / (1024 * 1024) * 10) / 10;
    console.log(`[upload-bundle] ${id}: extracted ${sizeMB} MB into ${exportDir}`);

    // Mirror the prebuilt zip to object storage (Tigris) so the reader can
    // download it from the CDN edge instead of streaming from this machine.
    let mirrored = false;
    if (objectStoreEnabled) {
      try {
        const zipFile = await newestBundleZip(exportDir);
        if (zipFile) {
          const zipPath = path.join(exportDir, zipFile);
          const version = await bundleVersionFor(zipPath);
          await uploadBundle(id, zipPath, version);
          await Comic.updateOne({ id }, { $set: { bundleVersion: version } });
          mirrored = true;
          console.log(`[upload-bundle] ${id}: mirrored ${zipFile} to object storage (v=${version})`);
        } else {
          console.warn(`[upload-bundle] ${id}: no .zip in export dir to mirror`);
        }
      } catch (e) {
        console.warn(`[upload-bundle] ${id}: object-store mirror failed: ${e.message}`);
      }
    }

    res.json({ success: true, id, sizeMB, mirrored });
  } catch (err) {
    console.error(`[upload-bundle] ${id} failed:`, err.message);
    res.status(500).json({ error: err.message });
  } finally {
    await fs.unlink(tarPath).catch(() => {});
  }
});

// One-shot backfill: mirror every comic's existing prebuilt zip from the volume
// to object storage, so already-synced comics get the CDN fast path without
// having to re-sync each one. Behind the same auth as the rest of /api/comics.
router.post('/mirror-bundles', async (req, res) => {
  if (!objectStoreEnabled) {
    return res.status(400).json({ error: 'Object storage not configured' });
  }
  try {
    const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
    const results = [];
    for (const e of entries) {
      if (!e.isDirectory() || !/^comic-/.test(e.name)) continue;
      const exportDir = path.join(PROJECTS_DIR, e.name, 'export');
      const zipFile = await newestBundleZip(exportDir);
      if (!zipFile) { results.push({ id: e.name, ok: false, error: 'no .zip' }); continue; }
      try {
        const zipPath = path.join(exportDir, zipFile);
        const st = await fs.stat(zipPath);
        const version = await bundleVersionFor(zipPath);
        await uploadBundle(e.name, zipPath, version);
        await Comic.updateOne({ id: e.name }, { $set: { bundleVersion: version } });
        results.push({ id: e.name, ok: true, zip: zipFile, bytes: st.size, version });
        console.log(`[mirror-bundles] mirrored ${e.name}/${zipFile} (${st.size} bytes, v=${version})`);
      } catch (err) {
        results.push({ id: e.name, ok: false, error: err.message });
        console.warn(`[mirror-bundles] ${e.name} failed: ${err.message}`);
      }
    }
    res.json({ mirrored: results.filter(r => r.ok).length, total: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const Comic = require('../models/Comic');
const ArchivedPage = require('../models/ArchivedPage');
const { sanitizeTitle, sanitizeWordForFilename, transformToReaderFormat, computePanelCorners } = require('../services/readerFormat');

const PROJECTS_DIR = path.join(__dirname, '../../projects');
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

async function cropAndSaveScene(sourceImagePath, outputPath, region, imageWidth, imageHeight) {
  try {
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
        return res.json({
          source: 'collection',
          collectionId: comic.collectionId,
          collectionTitle: collection.title || comic.collectionTitle || '',
          promptSettings: collection.promptSettings
        });
      }

      // No Collection document yet — look for a sibling comic that has prompt settings
      const sibling = await Comic.findOne({
        collectionId: comic.collectionId,
        id: { $ne: comic.id },
        'promptSettings.styleBible': { $exists: true, $ne: '' }
      });
      if (sibling && sibling.promptSettings) {
        // Auto-create the Collection document from the sibling's settings
        const newCollection = new Collection({
          id: comic.collectionId,
          title: comic.collectionTitle || sibling.collectionTitle || '',
          promptSettings: sibling.promptSettings
        });
        await newCollection.save();
        return res.json({
          source: 'collection',
          collectionId: comic.collectionId,
          collectionTitle: newCollection.title,
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

    const comic = await Comic.findOneAndUpdate(
      { id: req.params.id },
      { $set: updateData },
      { new: true }
    );

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

      // Renumber all pages that come after the insertion point
      comic.pages.forEach(p => {
        if (p.pageNumber > afterPageNumber) {
          p.pageNumber += 1;
        }
      });

      // Insert at the correct position in the array
      const insertIdx = comic.pages.findIndex(p => p.pageNumber === afterPageNumber + 2);
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
    if (req.body.bakedImage !== undefined) {
      page.bakedImage = req.body.bakedImage;
    }
    if (req.body.masterImage !== undefined) {
      page.masterImage = req.body.masterImage;

      if (req.body.masterImage && req.body.panels && req.body.panels.length > 0) {
        let sourceImagePath;
        if (req.body.masterImage.startsWith('/uploads/')) {
          sourceImagePath = path.join(UPLOADS_DIR, req.body.masterImage.replace('/uploads/', ''));
        } else if (req.body.masterImage.startsWith('/projects/')) {
          sourceImagePath = path.join(PROJECTS_DIR, req.body.masterImage.replace('/projects/', ''));
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

    await comic.save();
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
    const comic = await Comic.findOne({ id: req.params.id });
    if (!comic) {
      return res.status(404).json({ error: 'Comic not found' });
    }

    const comicObj = comic.toObject();
    const comicSlug = sanitizeTitle(comicObj.title);

    const exportDir = targetDir || path.join(PROJECTS_DIR, req.params.id, 'export', comicSlug);
    const imagesDir = path.join(exportDir, 'images');
    const audioDir = path.join(exportDir, 'audio');

    await fs.mkdir(imagesDir, { recursive: true });
    await fs.mkdir(audioDir, { recursive: true });

    const exportedComic = transformToReaderFormat(comicObj, comicSlug);

    const copiedImages = [];
    const copiedAudio = [];
    const projectAudioDir = path.join(PROJECTS_DIR, req.params.id, 'audio');

    if (comicObj.cover?.image) {
      const coverImage = comicObj.cover.bakedImage || comicObj.cover.image;
      const cleanCoverImage = coverImage.split('?')[0];
      const coverSourcePath = path.join(__dirname, '../..', cleanCoverImage);
      const coverDestPath = path.join(imagesDir, `${comicSlug}_cover.png`);
      try {
        await fs.copyFile(coverSourcePath, coverDestPath);
        copiedImages.push(`${comicSlug}_cover.png`);
      } catch (e) {
        console.log('Cover image not found:', coverSourcePath);
      }
    }

    for (const page of comicObj.pages) {
      const pageImage = page.bakedImage || page.masterImage;
      if (pageImage) {
        const pageNum = page.pageNumber;
        const cleanPageImage = pageImage.split('?')[0];
        const sourceImagePath = path.join(__dirname, '../..', cleanPageImage);

        const masterDestPath = path.join(imagesDir, `${comicSlug}_p${pageNum}.png`);
        try {
          await fs.copyFile(sourceImagePath, masterDestPath);
          copiedImages.push(`${comicSlug}_p${pageNum}.png`);

          // If there's a baked image, also export the raw master as _no_text variant
          // for Speaking Practice Mode in the reader app
          const rawMasterPath = page.masterImage
            ? path.join(__dirname, '../..', page.masterImage.split('?')[0])
            : null;
          const hasBakedImage = page.bakedImage && page.masterImage && page.bakedImage !== page.masterImage;

          // Determine the source for panel crops and no_text variants
          const rawImagePath = hasBakedImage ? rawMasterPath : sourceImagePath;

          if (hasBakedImage && rawMasterPath) {
            const noTextDestPath = path.join(imagesDir, `${comicSlug}_p${pageNum}_no_text.png`);
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
                await sharp(rawMasterPath).composite(composites).toFile(noTextDestPath);
              } else {
                // No image bubbles — just copy the raw master
                await fs.copyFile(rawMasterPath, noTextDestPath);
              }
              copiedImages.push(`${comicSlug}_p${pageNum}_no_text.png`);
            } catch (e) {
              console.log('Raw master image not found for no_text:', rawMasterPath);
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
            const sceneDestPath = path.join(imagesDir, `${comicSlug}_p${pageNum}_s${panelNum}.png`);
            const cropped = await cropAndSaveScene(
              sourceImagePath,
              sceneDestPath,
              cropRegion,
              imgWidth,
              imgHeight
            );
            if (cropped) {
              copiedImages.push(`${comicSlug}_p${pageNum}_s${panelNum}.png`);
            }

            // Panel crop from no_text image (master + image bubbles) for Speaking Practice Mode
            if (hasBakedImage && rawMasterPath) {
              const noTextSceneDestPath = path.join(imagesDir, `${comicSlug}_p${pageNum}_s${panelNum}_no_text.png`);
              try {
                const noTextFullPath = path.join(imagesDir, `${comicSlug}_p${pageNum}_no_text.png`);
                const noTextMeta = await sharp(noTextFullPath).metadata();
                const rawCropped = await cropAndSaveScene(
                  noTextFullPath,
                  noTextSceneDestPath,
                  cropRegion,
                  noTextMeta.width,
                  noTextMeta.height
                );
                if (rawCropped) {
                  copiedImages.push(`${comicSlug}_p${pageNum}_s${panelNum}_no_text.png`);
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

    const comicJsonPath = path.join(exportDir, 'comic.json');
    await fs.writeFile(comicJsonPath, JSON.stringify(exportedComic, null, 2));

    res.json({
      success: true,
      exportDir,
      comicJson: comicJsonPath,
      copiedImages,
      copiedAudio,
      copiedWordAudio,
      message: `Exported to ${exportDir}`
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

module.exports = router;

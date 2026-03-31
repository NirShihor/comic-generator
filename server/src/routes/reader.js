const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const Comic = require('../models/Comic');
const { sanitizeTitle, transformToReaderFormat } = require('../services/readerFormat');

const PROJECTS_DIR = path.join(__dirname, '../../projects');

// GET /api/reader/catalog — list published comics for the reader app store
router.get('/catalog', async (req, res) => {
  try {
    const comics = await Comic.find({ published: true }).lean();

    const catalog = comics.map(comic => {
      const comicSlug = sanitizeTitle(comic.title);
      const totalPages = (comic.pages || []).length + (comic.cover?.image ? 1 : 0);
      const coverImage = comic.cover?.bakedImage || comic.cover?.image || '';

      return {
        id: `comic-${comicSlug}`,
        title: comic.title,
        description: comic.description || '',
        coverThumbnailUrl: coverImage,
        level: comic.level || 'beginner',
        totalPages,
        estimatedMinutes: totalPages * 2,
        language: comic.language || 'es',
        fileSizeMB: 0,
        version: '1.0',
        downloadUrl: `/api/reader/comics/${comic.id}`,
        // Include collection info for grouping
        ...(comic.collectionId && { collectionId: comic.collectionId }),
        ...(comic.collectionTitle && { collectionTitle: comic.collectionTitle }),
        ...(comic.episodeNumber && { episodeNumber: comic.episodeNumber })
      };
    });

    res.json({
      comics: catalog,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Catalog error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reader/comics/:id — full comic data + asset manifest for download
router.get('/comics/:id', async (req, res) => {
  try {
    const comic = await Comic.findOne({ id: req.params.id });
    if (!comic) {
      return res.status(404).json({ error: 'Comic not found' });
    }

    const comicObj = comic.toObject();
    const comicSlug = sanitizeTitle(comicObj.title);
    const exportDir = path.join(PROJECTS_DIR, req.params.id, 'export', comicSlug);

    // Check if export directory exists; if not, return error
    try {
      await fs.access(exportDir);
    } catch {
      return res.status(409).json({
        error: 'Comic has not been exported yet. Please run Export Full Package first.'
      });
    }

    // Generate reader format
    const readerComic = transformToReaderFormat(comicObj, comicSlug);

    // Build asset manifest by reading export directory
    const basePath = `/projects/${req.params.id}/export/${comicSlug}`;

    const images = [];
    const audio = [];
    const wordAudio = [];

    // List image files
    const imagesDir = path.join(exportDir, 'images');
    try {
      const imageFiles = await fs.readdir(imagesDir);
      for (const file of imageFiles) {
        if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')) {
          images.push(`${basePath}/images/${file}`);
        }
      }
    } catch (e) {
      // images dir might not exist
    }

    // List sentence audio files
    const audioDir = path.join(exportDir, 'audio');
    try {
      const audioFiles = await fs.readdir(audioDir);
      for (const file of audioFiles) {
        if (file.endsWith('.mp3')) {
          audio.push(`${basePath}/audio/${file}`);
        }
      }
    } catch (e) {
      // audio dir might not exist
    }

    // List word audio files
    const wordAudioDir = path.join(exportDir, 'audio', 'words');
    try {
      const wordFiles = await fs.readdir(wordAudioDir);
      for (const file of wordFiles) {
        if (file.endsWith('.mp3')) {
          wordAudio.push(`${basePath}/audio/words/${file}`);
        }
      }
    } catch (e) {
      // words dir might not exist
    }

    res.json({
      comic: readerComic,
      assets: {
        images,
        audio,
        wordAudio
      }
    });
  } catch (error) {
    console.error('Reader comic error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

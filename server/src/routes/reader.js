const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const archiver = require('archiver');
const sharp = require('sharp');
const Comic = require('../models/Comic');
const Collection = require('../models/Collection');
const { sanitizeTitle, transformToReaderFormat } = require('../services/readerFormat');

const PROJECTS_DIR = path.join(__dirname, '../../projects');

// Calculate total size of a directory recursively (in bytes)
async function getDirectorySize(dirPath) {
  let totalSize = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalSize += await getDirectorySize(fullPath);
      } else {
        const stat = await fs.stat(fullPath);
        totalSize += stat.size;
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return totalSize;
}

// GET /api/reader/catalog — list published comics for the reader app store
router.get('/catalog', async (req, res) => {
  try {
    const comics = await Comic.find({ published: true }).lean();

    // Look up collection metadata for enriching catalog entries
    const collectionIds = [...new Set(comics.map(c => c.collectionId).filter(Boolean))];
    const collections = collectionIds.length > 0
      ? await Collection.find({ id: { $in: collectionIds } }).lean()
      : [];
    const collectionMap = {};
    for (const col of collections) {
      collectionMap[col.id] = col;
    }

    const catalog = await Promise.all(comics.map(async (comic) => {
      const comicSlug = sanitizeTitle(comic.title);
      const totalPages = (comic.pages || []).length + (comic.cover?.image ? 1 : 0);
      const coverImage = comic.cover?.bakedImage || comic.cover?.image || '';

      // Calculate export directory size
      const exportDir = path.join(PROJECTS_DIR, comic.id, 'export', comicSlug);
      const sizeBytes = await getDirectorySize(exportDir);
      const sizeMB = Math.round(sizeBytes / (1024 * 1024) * 10) / 10;

      // Collection metadata
      const collection = comic.collectionId ? collectionMap[comic.collectionId] : null;

      return {
        id: `comic-${comicSlug}`,
        title: comic.title,
        description: comic.description || '',
        coverThumbnailUrl: coverImage ? `/api/reader/cover-thumbnail/${comic.id}` : '',
        level: comic.level || 'beginner',
        totalPages,
        estimatedMinutes: totalPages * 2,
        language: comic.language || 'es',
        fileSizeMB: sizeMB,
        version: '1.0',
        downloadUrl: `/api/reader/comics/${comic.id}`,
        // Include collection info for grouping
        ...(comic.collectionId && { collectionId: comic.collectionId }),
        ...(comic.collectionTitle && { collectionTitle: comic.collectionTitle }),
        ...(comic.episodeNumber && { episodeNumber: comic.episodeNumber }),
        ...(collection?.description && { collectionDescription: collection.description }),
        ...(collection?.coverImage && { collectionCoverThumbnailUrl: `/api/reader/collection-thumbnail/${comic.collectionId}` })
      };
    }));

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

// GET /api/reader/comics/:id/bundle — download comic as a single ZIP file
router.get('/comics/:id/bundle', async (req, res) => {
  console.log(`[BUNDLE] Request received for comic: ${req.params.id}`);
  try {
    const comic = await Comic.findOne({ id: req.params.id });
    if (!comic) {
      return res.status(404).json({ error: 'Comic not found' });
    }

    const comicObj = comic.toObject();
    const comicSlug = sanitizeTitle(comicObj.title);
    const exportDir = path.join(PROJECTS_DIR, req.params.id, 'export', comicSlug);

    // Check if export directory exists
    try {
      await fs.access(exportDir);
    } catch {
      return res.status(409).json({
        error: 'Comic has not been exported yet. Please run Export Full Package first.'
      });
    }

    const fsSync = require('fs');

    // Use pre-built ZIP from export if available
    const prebuiltZipPath = path.join(exportDir, '..', `${comicSlug}.zip`);
    let zipPath;
    let tempZip = false;

    try {
      await fs.access(prebuiltZipPath);
      zipPath = prebuiltZipPath;
      console.log(`[BUNDLE] Using pre-built ZIP: ${prebuiltZipPath}`);
    } catch {
      // Fallback: build ZIP on the fly
      console.log(`[BUNDLE] No pre-built ZIP found, building on the fly...`);
      const readerComic = transformToReaderFormat(comicObj, comicSlug);
      const comicJsonPath = path.join(exportDir, 'comic.json');
      await fs.writeFile(comicJsonPath, JSON.stringify(readerComic, null, 2));

      const os = require('os');
      zipPath = path.join(os.tmpdir(), `${comicSlug}-${Date.now()}.zip`);
      tempZip = true;
      const output = fsSync.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 0 } });

      await new Promise((resolve, reject) => {
        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(exportDir, false);
        archive.finalize();
      });
    }

    // Send the file with Content-Length so the client can track progress
    const stat = await fs.stat(zipPath);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${comicSlug}.zip"`);

    console.log(`[BUNDLE] ZIP ready: ${stat.size} bytes, sending to client...`);
    const fileStream = fsSync.createReadStream(zipPath);
    fileStream.pipe(res);

    // Clean up temp file after response is done (only if we built it on the fly)
    if (tempZip) {
      res.on('finish', () => { fs.unlink(zipPath).catch(() => {}); });
      res.on('error', () => { fs.unlink(zipPath).catch(() => {}); });
    }
  } catch (error) {
    console.error('Bundle error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// GET /api/reader/cover-thumbnail/:id — serve a small JPEG thumbnail of the cover
router.get('/cover-thumbnail/:id', async (req, res) => {
  try {
    const comic = await Comic.findOne({ id: req.params.id }).lean();
    if (!comic) {
      return res.status(404).json({ error: 'Comic not found' });
    }

    const coverPath = comic.cover?.bakedImage || comic.cover?.image;
    if (!coverPath) {
      return res.status(404).json({ error: 'No cover image' });
    }

    const fullPath = path.join(__dirname, '../..', coverPath);
    try {
      await fs.access(fullPath);
    } catch {
      return res.status(404).json({ error: 'Cover file not found' });
    }

    const thumbnail = await sharp(fullPath)
      .resize(240, 360, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toBuffer();

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(thumbnail);
  } catch (error) {
    console.error('Cover thumbnail error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reader/collection-thumbnail/:collectionId — serve a JPEG thumbnail of the collection cover
router.get('/collection-thumbnail/:collectionId', async (req, res) => {
  try {
    const collection = await Collection.findOne({ id: req.params.collectionId }).lean();
    if (!collection || !collection.coverImage) {
      return res.status(404).json({ error: 'No collection cover image' });
    }

    const fullPath = path.join(__dirname, '../..', collection.coverImage);
    try {
      await fs.access(fullPath);
    } catch {
      return res.status(404).json({ error: 'Cover file not found' });
    }

    const thumbnail = await sharp(fullPath)
      .resize(240, 360, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toBuffer();

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(thumbnail);
  } catch (error) {
    console.error('Collection thumbnail error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

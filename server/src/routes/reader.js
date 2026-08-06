const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const archiver = require('archiver');
const sharp = require('sharp');
const Comic = require('../models/Comic');
const Collection = require('../models/Collection');
const { sanitizeTitle, transformToReaderFormat } = require('../services/readerFormat');
const { generateFlowReply } = require('../services/flowPractice');
const { generateSpeech, generateSpeechTimed } = require('../services/tts');
const { objectStoreEnabled, bundleExists, presignedBundleUrl } = require('../services/objectStore');
const OpenAI = require('openai');

const PROJECTS_DIR = path.join(__dirname, '../../projects');

// POST /api/reader/tts — synthesize speech (MP3) for a short piece of text.
// Body: { text, voice?, instructions? }. Returns audio/mpeg.
router.post('/tts', async (req, res) => {
  try {
    const { text } = req.body || {};
    const audio = await generateSpeech({ text });
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'no-store');
    res.send(audio);
  } catch (error) {
    console.error('[TTS] error:', error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// POST /api/reader/tts-timed — synthesize speech with character-level timing,
// for lip-syncing an avatar. Body: { text, voice?, speed? }.
// Returns JSON: { audio: <base64 mp3>, alignment: { characters,
// character_start_times_seconds, character_end_times_seconds } }.
router.post('/tts-timed', async (req, res) => {
  try {
    const { text, voice, speed } = req.body || {};
    const { audioBase64, alignment } = await generateSpeechTimed({ text, voiceId: voice, speed });
    res.set('Cache-Control', 'no-store');
    res.json({ audio: audioBase64, alignment });
  } catch (error) {
    console.error('[TTS-timed] error:', error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// POST /api/reader/flow-practice — one turn of the Flow Practice conversation.
// Body: { comicTitle, sourceLang, targetLang, level?, vocab: [{text, meaning}],
//         messages: [{role: "user"|"assistant", content}] }  (empty messages = opener)
// Returns: { reply, usage }
router.post('/flow-practice', async (req, res) => {
  try {
    const { comicTitle, sourceLang, targetLang, level, vocab, messages } = req.body || {};
    if (!Array.isArray(vocab) || vocab.length === 0) {
      return res.status(400).json({ error: 'vocab must be a non-empty array of { text, meaning }' });
    }
    const { reply, usage } = await generateFlowReply({
      comicTitle, sourceLang, targetLang, level, vocab, messages,
    });
    res.json({ reply, usage });
  } catch (error) {
    console.error('[FlowPractice] error:', error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

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
// Public: the global admin notebook (grammar pages) for the reader app.
router.get('/notebook', async (req, res) => {
  try {
    const NotebookNote = require('../models/NotebookNote');
    const notes = await NotebookNote.find().sort({ order: 1, createdAt: 1 }).lean();
    res.json({ notes: notes.map(n => ({ id: n.id, title: n.title || '', body: n.body || '' })) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/catalog', async (req, res) => {
  try {
    const comics = await Comic.find({ published: true })
      .sort({ order: 1, createdAt: 1 })
      .lean();

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
        ...(comic.titleEn && { titleEn: comic.titleEn }),
        description: comic.description || '',
        coverThumbnailUrl: coverImage ? `/api/reader/cover-thumbnail/${comic.id}` : '',
        level: comic.level || 'beginner',
        totalPages,
        estimatedMinutes: totalPages * 2,
        language: comic.language || 'es',
        fileSizeMB: sizeMB,
        version: '1.0',
        downloadUrl: `/api/reader/comics/${comic.id}`,
        order: comic.order || 0,
        // Include collection info for grouping
        ...(comic.collectionId && { collectionId: comic.collectionId }),
        ...(comic.collectionTitle && { collectionTitle: comic.collectionTitle }),
        ...(collection?.titleEn && { collectionTitleEn: collection.titleEn }),
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

    // List hotspot image files
    const hotspotImages = [];
    const hotspotImagesDir = path.join(exportDir, 'images', 'hotspots');
    try {
      const hotspotFiles = await fs.readdir(hotspotImagesDir);
      for (const file of hotspotFiles) {
        if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')) {
          hotspotImages.push(`${basePath}/images/hotspots/${file}`);
        }
      }
    } catch (e) {
      // hotspots dir might not exist
    }

    res.json({
      comic: readerComic,
      assets: {
        images,
        audio,
        wordAudio,
        ...(hotspotImages.length > 0 && { hotspotImages })
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
    // Fast path: if the bundle is mirrored to object storage, redirect there so
    // the download comes from the Tigris CDN edge near the user. Older comics
    // not yet re-synced fall through to streaming from the volume below.
    if (objectStoreEnabled) {
      try {
        // The mirrored object key is versioned by content hash (cache-busting),
        // so we need the comic's current bundleVersion to build the right key.
        const meta = await Comic.findOne({ id: req.params.id }, { bundleVersion: 1 }).lean();
        const version = meta?.bundleVersion || '';
        if (await bundleExists(req.params.id, version)) {
          const url = await presignedBundleUrl(req.params.id, version, 3600);
          console.log(`[BUNDLE] Redirecting ${req.params.id} to object storage (v=${version || 'legacy'})`);
          return res.redirect(302, url);
        }
      } catch (e) {
        console.warn(`[BUNDLE] object-store check failed, serving from volume: ${e.message}`);
      }
    }

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

    // Prefer the source cover (uploads/projects); fall back to the exported cover
    // (projects/<id>/export/<slug>/images/<slug>_cover.jpg), which — unlike the
    // uploads source — is reliably synced to this server via the bundle sync.
    const candidates = [];
    const coverPath = comic.cover?.bakedImage || comic.cover?.image;
    if (coverPath) candidates.push(path.join(__dirname, '../..', coverPath));
    const slug = sanitizeTitle(comic.title);
    candidates.push(path.join(PROJECTS_DIR, comic.id, 'export', slug, 'images', `${slug}_cover.jpg`));

    let fullPath = null;
    for (const c of candidates) {
      try { await fs.access(c); fullPath = c; break; } catch {}
    }
    if (!fullPath) {
      return res.status(404).json({ error: 'Cover file not found' });
    }

    const thumbnail = await sharp(fullPath)
      .resize(240, 360, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toBuffer();

    res.setHeader('Content-Type', 'image/jpeg');
    // Cacheable for an hour: covers change rarely (on re-export), and a
    // cached success means a transient fetch failure can't blank the cover.
    res.setHeader('Cache-Control', 'public, max-age=3600');
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

    // Prefer the collection's source cover; fall back to an exported
    // collection_cover.jpg from any episode's synced export dir.
    const candidates = [];
    if (collection?.coverImage) candidates.push(path.join(__dirname, '../..', collection.coverImage));
    const episodes = await Comic.find({ collectionId: req.params.collectionId }).select('id title').lean();
    for (const ep of episodes) {
      const slug = sanitizeTitle(ep.title);
      candidates.push(path.join(PROJECTS_DIR, ep.id, 'export', slug, 'images', 'collection_cover.jpg'));
    }

    let fullPath = null;
    for (const c of candidates) {
      try { await fs.access(c); fullPath = c; break; } catch {}
    }
    if (!fullPath) {
      return res.status(404).json({ error: 'No collection cover image' });
    }

    const thumbnail = await sharp(fullPath)
      .resize(240, 360, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toBuffer();

    res.setHeader('Content-Type', 'image/jpeg');
    // Cacheable for an hour: covers change rarely (on re-export), and a
    // cached success means a transient fetch failure can't blank the cover.
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(thumbnail);
  } catch (error) {
    console.error('Collection thumbnail error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/reader/explain — a short, contextual grammar explanation of a Spanish
// word AS USED in its sentence. Uses a cheap model. Body: { word, sentence, translation }.
router.post('/explain', async (req, res) => {
  try {
    const { word, sentence, translation } = req.body || {};
    if (!word || !String(word).trim()) {
      return res.status(400).json({ error: 'word is required' });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Explanations are not configured on the server.' });
    }
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const system = [
      'You are a warm, concise Spanish tutor for an English-speaking learner reading a comic.',
      'You are given a Spanish WORD, the SENTENCE it appears in, and the English meaning of that sentence.',
      'Explain what the word is doing in THIS sentence: its part of speech and grammatical role, and why it is there.',
      '- If it is a verb form, give the infinitive and a short present-tense conjugation table (me/te/se/nos/se or yo/tú/él…).',
      '- If it is a reflexive/object pronoun, article, or preposition, say what it refers back to or connects.',
      'Ground every point in the actual sentence and quote small fragments of it.',
      'Keep it short — a few short paragraphs. Friendly, concrete, plain text (no markdown headings). Do not pad.'
    ].join('\n');

    const user = `WORD: "${word}"\nSENTENCE: "${sentence || ''}"\nENGLISH: "${translation || ''}"\n\nExplain "${word}" as it is used here.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      max_tokens: 450,
      temperature: 0.3
    });

    const explanation = completion.choices?.[0]?.message?.content?.trim() || '';
    if (!explanation) return res.status(502).json({ error: 'No explanation was returned.' });
    res.json({ explanation });
  } catch (error) {
    console.error('reader/explain error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

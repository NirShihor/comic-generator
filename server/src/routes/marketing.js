const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const OpenAI = require('openai');
const Comic = require('../models/Comic');

const PROJECTS_DIR = path.join(__dirname, '../../projects');
const LOGO_PATH = path.join(__dirname, '../../assets/comigo-bubble.png');

// The canonical "mini movie poster" template (locked 2026-09-01):
// 1080x1350, brand violet, white hook line (no full stop) + larger yellow
// question, page art white-bordered with offset shadow, quiet footer
// (logo bubble / "Interactive Spanish stories" / comigo.net). No CTA, no
// hashtags on the image — posts are entertainment, not adverts.
const VIOLET = { r: 0x6e, g: 0x40, b: 0xf0, alpha: 1 };

// Newest export slug folder for a comic (same rule as sync-store.sh).
async function exportImagesDir(comicId) {
  const exportDir = path.join(PROJECTS_DIR, comicId, 'export');
  const entries = await fs.readdir(exportDir, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
  if (dirs.length === 0) throw new Error('No export found — export the comic first');
  let newest = dirs[0], newestM = 0;
  for (const d of dirs) {
    const st = await fs.stat(path.join(exportDir, d));
    if (st.mtimeMs > newestM) { newestM = st.mtimeMs; newest = d; }
  }
  return { slug: newest, dir: path.join(exportDir, newest, 'images') };
}

// GET /api/marketing/:comicId/images — export images usable as poster art.
router.get('/:comicId/images', async (req, res) => {
  try {
    const { slug, dir } = await exportImagesDir(req.params.comicId);
    const files = (await fs.readdir(dir)).filter(f =>
      /\.(jpg|png)$/i.test(f) && !f.includes('empty_bubbles'));
    // Full pages first, then panels, no-text variants last within each group.
    const rank = f => (f.match(/_p\d+\.(jpg|png)$/i) ? 0 : f.includes('cover') ? 1 : 2) + (f.includes('no_text') ? 0.5 : 0);
    files.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    res.json({
      images: files.map(f => ({
        file: f,
        url: `/projects/${req.params.comicId}/export/${slug}/images/${f}`
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/marketing/poster — render the canonical poster.
// Body: { comicId, imageFile, line1, line2 }
router.post('/poster', async (req, res) => {
  try {
    const { comicId, imageFile, line1 = '', line2 = '' } = req.body;
    const brightness = Math.min(2, Math.max(0.5, Number(req.body.brightness) || 1));
    const saturation = Math.min(2, Math.max(0.3, Number(req.body.saturation) || 1));
    if (!comicId || !imageFile) return res.status(400).json({ error: 'comicId and imageFile are required' });
    if (!/^[\w.\-áéíóúñü]+$/i.test(imageFile)) return res.status(400).json({ error: 'Bad image filename' });
    const { dir } = await exportImagesDir(comicId);
    const src = path.join(dir, imageFile);

    // Art as large as the card allows: tighter headline block and footer than
    // v1 (artH 900 → 990). Wide/landscape art is width-capped so it can never
    // run off the canvas; height then follows the aspect ratio.
    const W = 1080, H = 1350;
    let artH = 990;
    const meta = await sharp(src).metadata();
    let artW = Math.round(artH * meta.width / meta.height);
    if (artW > W - 90) {
      artW = W - 90;
      artH = Math.round(artW * meta.height / meta.width);
    }
    let artPipe = sharp(src).resize(artW, artH);
    if (brightness !== 1 || saturation !== 1) artPipe = artPipe.modulate({ brightness, saturation });
    const art = await artPipe
      .extend({ top: 6, bottom: 6, left: 6, right: 6, background: '#FFFFFF' })
      .png().toBuffer();
    const shadow = Buffer.from(
      `<svg width="${artW + 26}" height="${artH + 26}"><rect x="14" y="14" width="${artW + 12}" height="${artH + 12}" rx="6" fill="rgba(0,0,0,0.55)"/></svg>`);
    const artX = Math.round((W - artW - 12) / 2), artY = 226;

    const logo = await sharp(LOGO_PATH).resize({ width: 140 }).png().toBuffer();
    const logoMeta = await sharp(logo).metadata();

    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Long lines must never clip: shrink the font until the line fits inside
    // the canvas with margins (0.56 ≈ avg glyph width / font size for bold
    // Helvetica — conservative, verified against the overflowing case).
    const fit = (t, base) => Math.min(base, Math.floor((W - 90) / (0.56 * Math.max(1, String(t).length))));
    const f1 = fit(line1, 56), f2 = fit(line2, 76);
    // NOTE: Helvetica resolves on macOS (where the generator runs); on Linux
    // sharp falls back to the system sans — acceptable, but posters are
    // expected to be rendered locally.
    const text = Buffer.from(`<svg width="${W}" height="${H}">
      <text x="${W / 2}" y="90" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${f1}" font-weight="800" fill="#FFFFFF">${esc(line1)}</text>
      <text x="${W / 2}" y="182" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${f2}" font-weight="800" fill="#FFD23F">${esc(line2)}</text>
      <text x="${W / 2}" y="${H - 60}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="700" fill="#FFFFFF" opacity="0.92">Interactive Spanish stories</text>
      <text x="${W / 2}" y="${H - 24}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="26" font-weight="600" fill="#FFFFFF" opacity="0.7">comigo.net</text>
    </svg>`);

    const outDir = path.join(PROJECTS_DIR, comicId, 'marketing');
    await fs.mkdir(outDir, { recursive: true });
    const name = `poster-${Date.now()}.png`;
    await sharp({ create: { width: W, height: H, channels: 4, background: VIOLET } })
      .composite([
        { input: shadow, left: artX - 7, top: artY - 7 },
        { input: art, left: artX, top: artY },
        { input: logo, left: Math.round((W - logoMeta.width) / 2), top: H - 92 - logoMeta.height },
        { input: text, left: 0, top: 0 },
      ])
      .flatten({ background: VIOLET })
      .png().toFile(path.join(outDir, name));
    res.json({ url: `/projects/${comicId}/marketing/${name}`, file: name });
  } catch (error) {
    console.error('Poster render error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Shared context for the GPT endpoints: what this comic is about.
async function comicContext(comicId) {
  const comic = await Comic.findOne({ id: comicId }).lean();
  if (!comic) throw new Error('Comic not found');
  const lines = [];
  const pages = (comic.pages || []).slice(0, 2);
  for (const page of pages) {
    const walk = bubbles => {
      for (const b of bubbles || [])
        for (const sent of b.sentences || [])
          if (sent.text) lines.push(sent.text);
    };
    walk(page.bubbles);
    for (const panel of page.panels || []) walk(panel.bubbles);
  }
  return {
    title: comic.title,
    description: comic.description || '',
    collection: comic.collectionTitle || '',
    dialogue: lines.slice(0, 20).join(' / ')
  };
}

// POST /api/marketing/hooks — 3 hook/question pairs for a poster.
router.post('/hooks', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: 'OpenAI API key not configured' });
    const ctx = await comicContext(req.body.comicId);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `You write "mini movie poster" text for Comigo, original Spanish comics for language learners.
Comic: "${ctx.title}" (series: ${ctx.collection}). About: ${ctx.description}
Opening dialogue (Spanish): ${ctx.dialogue}

Write 3 poster options. Each is TWO short English lines:
- line1: a hook that sets the scene (NO full stop at the end, max 42 characters)
- line2: the question that makes people stop scrolling (ends with ?, max 26 characters)
Rules: intrigue without spoiling; never mention learning Spanish or the app; no exclamation marks.
Return ONLY a JSON array: [{ "line1": "...", "line2": "..." }, ...]`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a precise copywriter. Always respond with valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      max_completion_tokens: 300
    });
    const m = completion.choices[0].message.content.match(/\[[\s\S]*\]/);
    if (!m) return res.status(500).json({ error: 'Could not parse suggestions' });
    res.json({ hooks: JSON.parse(m[0]) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/marketing/caption — Instagram caption + hashtags for a poster.
router.post('/caption', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: 'OpenAI API key not configured' });
    const { comicId, line1 = '', line2 = '' } = req.body;
    const ctx = await comicContext(comicId);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `Write an Instagram caption for a Comigo poster.
Comic: "${ctx.title}" (series: ${ctx.collection}). About: ${ctx.description}
Poster text: "${line1} — ${line2}"

Style (match exactly): 2–3 short lines continuing the poster's intrigue (one emoji max), then a line naming the comic and series with one phrase about what it is, then "Every bubble is voiced. Every word explains itself when you tap it.", then "📖 comigo.net", then ONE line of 6–8 hashtags mixing English and Spanish learning tags. Never say "download", never oversell, no spoilers.
Return the caption as plain text only.`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 350
    });
    res.json({ caption: completion.choices[0].message.content.trim() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/marketing/:comicId/audios — every sentence with its audio file,
// in reading order, for building reel segments.
router.get('/:comicId/audios', async (req, res) => {
  try {
    const { slug } = await exportImagesDir(req.params.comicId);
    const jsonPath = path.join(PROJECTS_DIR, req.params.comicId, 'export', slug, 'comic.json');
    const comic = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
    const out = [];
    for (const page of comic.pages || []) {
      const walk = bubbles => {
        for (const b of bubbles || [])
          for (const sent of b.sentences || [])
            if (sent.text && sent.audioUrl) out.push({
              page: page.pageNumber, text: sent.text,
              translation: sent.translation || '',
              file: `${sent.audioUrl}.mp3`,
              ...(sent.translationAudioUrl && { translationFile: `${sent.translationAudioUrl}.mp3` })
            });
      };
      walk(page.bubbles);
      for (const panel of page.panels || []) walk(panel.bubbles);
    }
    res.json({ audios: out });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/marketing/reel — render a 9:16 Reel from panel/audio segments.
// Body: { comicId, segments: [{ imageFile, audioFile? , seconds? }],
//         question, brightness?, saturation? }
// Each art segment slow-zooms while its real Spanish audio plays, then a
// violet question card, then the logo end card. No music — the voices are
// the soundtrack (add an Instagram track at post time if wanted).
router.post('/reel', async (req, res) => {
  const { execFile } = require('child_process');
  const os = require('os');
  const run = (cmd, args) => new Promise((resolve, reject) =>
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64 }, (err, so, se) =>
      err ? reject(new Error(se || err.message)) : resolve(so)));
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'reel-'));
  try {
    const { comicId, segments = [], question = '' } = req.body;
    const brightness = Math.min(2, Math.max(0.5, Number(req.body.brightness) || 1));
    const saturation = Math.min(2, Math.max(0.3, Number(req.body.saturation) || 1));
    if (!comicId || segments.length === 0) return res.status(400).json({ error: 'comicId and segments are required' });
    if (segments.length > 6) return res.status(400).json({ error: 'Max 6 segments' });
    const { slug, dir } = await exportImagesDir(comicId);
    const audioDir = path.join(PROJECTS_DIR, comicId, 'export', slug, 'audio');
    const W = 1080, H = 1920, FPS = 25;

    const parts = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!/^[\w.\-áéíóúñü]+$/i.test(seg.imageFile || '')) throw new Error('Bad image filename');
      // Pre-process the art: brightness/colour, cover-crop to 9:16 at 2x.
      let pipe = sharp(path.join(dir, seg.imageFile)).resize(W * 2, H * 2, { fit: 'cover' });
      if (brightness !== 1 || saturation !== 1) pipe = pipe.modulate({ brightness, saturation });
      const still = path.join(tmp, `art${i}.png`);
      await pipe.png().toFile(still);

      let dur = Math.min(8, Math.max(1.2, Number(seg.seconds) || 2.5));
      let audioArgs = ['-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo'];
      if (seg.audioFile) {
        if (!/^[\w.\-áéíóúñü]+$/i.test(seg.audioFile)) throw new Error('Bad audio filename');
        const ap = path.join(audioDir, seg.audioFile);
        const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', ap]);
        dur = Math.min(10, parseFloat(probe) + 0.45);
        audioArgs = ['-i', ap];
      }
      const out = path.join(tmp, `seg${i}.mp4`);
      // Slow push-in: upscaled still through zoompan (zoom step per frame).
      await run('ffmpeg', ['-y', '-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', still,
        ...audioArgs,
        '-filter_complex',
        `[0:v]zoompan=z='min(zoom+0.0009,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:fps=${FPS}:s=${W}x${H}[v];[1:a]apad[a]`,
        '-map', '[v]', '-map', '[a]', '-t', String(dur),
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-ar', '44100', out]);
      parts.push(out);
    }

    // Question card (2s) and end card (1.8s), sharp-rendered like the posters.
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fitQ = Math.min(88, Math.floor((W - 100) / (0.56 * Math.max(1, String(question).length))));
    const qCard = path.join(tmp, 'qcard.png');
    await sharp({ create: { width: W, height: H, channels: 4, background: VIOLET } })
      .composite([{ input: Buffer.from(`<svg width="${W}" height="${H}">
          <text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${fitQ}" font-weight="800" fill="#FFD23F">${esc(question)}</text>
        </svg>`), left: 0, top: 0 }])
      .flatten({ background: VIOLET }).png().toFile(qCard);
    const logo = await sharp(LOGO_PATH).resize({ width: 300 }).png().toBuffer();
    const logoMeta = await sharp(logo).metadata();
    const eCard = path.join(tmp, 'ecard.png');
    await sharp({ create: { width: W, height: H, channels: 4, background: VIOLET } })
      .composite([
        { input: logo, left: Math.round((W - logoMeta.width) / 2), top: Math.round(H / 2 - logoMeta.height) },
        { input: Buffer.from(`<svg width="${W}" height="${H}">
            <text x="${W / 2}" y="${H / 2 + 90}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="44" font-weight="700" fill="#FFFFFF">Interactive Spanish stories</text>
            <text x="${W / 2}" y="${H / 2 + 150}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="36" font-weight="600" fill="#FFFFFF" opacity="0.75">comigo.net</text>
          </svg>`), left: 0, top: 0 }
      ])
      .flatten({ background: VIOLET }).png().toFile(eCard);
    for (const [img, dur, name] of [[qCard, question ? 2.0 : 0, 'qseg'], [eCard, 1.8, 'eseg']]) {
      if (dur === 0) continue;
      const out = path.join(tmp, `${name}.mp4`);
      await run('ffmpeg', ['-y', '-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', img,
        '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
        '-vf', `scale=${W}:${H}`, '-t', String(dur),
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-ar', '44100', out]);
      parts.push(out);
    }

    // Concat everything.
    const inputs = parts.flatMap(f => ['-i', f]);
    const n = parts.length;
    const filter = parts.map((_, i) => `[${i}:v][${i}:a]`).join('') + `concat=n=${n}:v=1:a=1[v][a]`;
    const outDir = path.join(PROJECTS_DIR, comicId, 'marketing');
    await fs.mkdir(outDir, { recursive: true });
    const name = `reel-${Date.now()}.mp4`;
    await run('ffmpeg', ['-y', ...inputs, '-filter_complex', filter, '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', path.join(outDir, name)]);
    res.json({ url: `/projects/${comicId}/marketing/${name}`, file: name });
  } catch (error) {
    console.error('Reel render error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

// POST /api/marketing/upload-audio — user's own audio (music, VO) for reels.
// Saved under projects/<id>/marketing/uploads/; referenced as "upload:<name>".
const audioUpload = require('multer')({
  storage: require('multer').memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }
});
router.post('/upload-audio', audioUpload.single('audio'), async (req, res) => {
  try {
    const { comicId } = req.body;
    if (!comicId || !req.file) return res.status(400).json({ error: 'comicId and audio file are required' });
    if (!/\.(mp3|m4a|wav|aac|ogg)$/i.test(req.file.originalname)) return res.status(400).json({ error: 'Audio files only (mp3/m4a/wav/aac/ogg)' });
    const upDir = path.join(PROJECTS_DIR, comicId, 'marketing', 'uploads');
    await fs.mkdir(upDir, { recursive: true });
    const name = `${Date.now()}-${req.file.originalname.replace(/[^\w.\-]/g, '_')}`;
    await fs.writeFile(path.join(upDir, name), req.file.buffer);
    res.json({ file: `upload:${name}`, label: req.file.originalname });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/marketing/:comicId/voices — the ElevenLabs cast attached to this
// comic (falling back to its collection's voices).
router.get('/:comicId/voices', async (req, res) => {
  try {
    const comic = await Comic.findOne({ id: req.params.comicId }, { voices: 1, collectionId: 1 }).lean();
    if (!comic) return res.status(404).json({ error: 'Comic not found' });
    let voices = comic.voices || [];
    if (voices.length === 0 && comic.collectionId) {
      const Collection = require('../models/Collection');
      const col = await Collection.findOne({ id: comic.collectionId }, { voices: 1 }).lean();
      voices = col?.voices || [];
    }
    res.json({ voices: voices.map(v => ({ name: v.name, voiceId: v.voiceId, settings: v.settings || {} })) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/marketing/translate-line — English → Spanish for a reel line.
router.post('/translate-line', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: 'OpenAI API key not configured' });
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: `Translate to natural Castilian Spanish for a comic voice-over. Return ONLY the Spanish text, nothing else.\n\n${text}` }],
      max_completion_tokens: 200
    });
    res.json({ spanish: completion.choices[0].message.content.trim() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/marketing/reel-line-audio — generate a spoken line with one of the
// comic's ElevenLabs voices (same call shape as the panel generator) and save
// it as a reel-audio upload. Body: { comicId, voiceId, text, languageCode?,
// modelId?, stability?, similarityBoost?, speed? }
router.post('/reel-line-audio', async (req, res) => {
  try {
    if (!process.env.ELEVENLABS_API_KEY) return res.status(400).json({ error: 'ELEVENLABS_API_KEY not configured' });
    const { comicId, voiceId, text, languageCode,
            modelId = 'eleven_v3', stability = 0.5, similarityBoost = 0.75, speed = 1.0 } = req.body;
    if (!comicId || !voiceId || !text) return res.status(400).json({ error: 'comicId, voiceId and text are required' });
    const body = { text, model_id: modelId, voice_settings: { stability, similarity_boost: similarityBoost, speed } };
    if (languageCode) body.language_code = languageCode;
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      body: JSON.stringify(body),
    });
    if (!r.ok) return res.status(502).json({ error: `ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}` });
    const upDir = path.join(PROJECTS_DIR, comicId, 'marketing', 'uploads');
    await fs.mkdir(upDir, { recursive: true });
    const name = `line-${Date.now()}.mp3`;
    await fs.writeFile(path.join(upDir, name), Buffer.from(await r.arrayBuffer()));
    res.json({ file: `upload:${name}`, label: text.slice(0, 60) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Lay the comic's real ElevenLabs lines over a clip, with the clip's own
// audio kept, ducked under the voices, or muted. Voices play sequentially
// from 0.5s with short gaps; video stream is copied untouched.
async function mixVoicesOnto(comicId, videoPath, voiceFiles, ambient, outPath) {
  const { execFile } = require('child_process');
  const run = (cmd, args) => new Promise((resolve, reject) =>
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64 }, (err, so, se) =>
      err ? reject(new Error(se || err.message)) : resolve(so)));
  const { slug } = await exportImagesDir(comicId);
  const audioDir = path.join(PROJECTS_DIR, comicId, 'export', slug, 'audio');
  const inputs = ['-i', videoPath];
  const parts = [];
  let at = 0.5;
  for (let i = 0; i < voiceFiles.length; i++) {
    const f = voiceFiles[i];
    // "upload:<name>" = user's own audio from marketing/uploads; otherwise a
    // comic export audio file.
    let ap;
    if (f.startsWith('upload:')) {
      const n = f.slice(7);
      if (!/^[\w.\-]+$/i.test(n)) throw new Error('Bad upload filename');
      ap = path.join(PROJECTS_DIR, comicId, 'marketing', 'uploads', n);
    } else {
      if (!/^[\w.\-áéíóúñü]+$/i.test(f)) throw new Error('Bad audio filename');
      ap = path.join(audioDir, f);
    }
    const dur = parseFloat(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', ap]));
    inputs.push('-i', ap);
    const ms = Math.round(at * 1000);
    parts.push(`[${i + 1}:a]adelay=${ms}|${ms}[v${i}]`);
    at += dur + 0.35;
  }
  const ambVol = ambient === 'mute' ? 0 : ambient === 'duck' ? 0.25 : 1;
  const chains = [`[0:a]volume=${ambVol}[amb]`, ...parts];
  const mixIn = ['[amb]', ...voiceFiles.map((_, i) => `[v${i}]`)].join('');
  chains.push(`${mixIn}amix=inputs=${voiceFiles.length + 1}:duration=first:normalize=0[a]`);
  await run('ffmpeg', ['-y', ...inputs, '-filter_complex', chains.join(';'),
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', outPath]);
}

// Append the branded finish to a clip: optional violet question card (2s)
// then the logo end card (1.8s) — turns a raw generation into a Reel that
// signs off as Comigo. Re-encodes to a uniform 1080x1920/25fps for concat.
async function finishClip(comicId, videoPath, question, outPath) {
  const { execFile } = require('child_process');
  const os = require('os');
  const run = (cmd, args) => new Promise((resolve, reject) =>
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64 }, (err, so, se) =>
      err ? reject(new Error(se || err.message)) : resolve(so)));
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'finish-'));
  try {
    const W = 1080, H = 1920, FPS = 25;
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const cards = [];
    if (question) {
      const fitQ = Math.min(88, Math.floor((W - 100) / (0.56 * String(question).length)));
      const qp = path.join(tmp, 'q.png');
      await sharp({ create: { width: W, height: H, channels: 4, background: VIOLET } })
        .composite([{ input: Buffer.from(`<svg width="${W}" height="${H}"><text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${fitQ}" font-weight="800" fill="#FFD23F">${esc(question)}</text></svg>`), left: 0, top: 0 }])
        .flatten({ background: VIOLET }).png().toFile(qp);
      cards.push([qp, 2.0]);
    }
    const logo = await sharp(LOGO_PATH).resize({ width: 300 }).png().toBuffer();
    const lm = await sharp(logo).metadata();
    const ep = path.join(tmp, 'e.png');
    await sharp({ create: { width: W, height: H, channels: 4, background: VIOLET } })
      .composite([
        { input: logo, left: Math.round((W - lm.width) / 2), top: Math.round(H / 2 - lm.height) },
        { input: Buffer.from(`<svg width="${W}" height="${H}"><text x="${W / 2}" y="${H / 2 + 90}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="44" font-weight="700" fill="#FFFFFF">Interactive Spanish stories</text><text x="${W / 2}" y="${H / 2 + 150}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="36" font-weight="600" fill="#FFFFFF" opacity="0.75">comigo.net</text></svg>`), left: 0, top: 0 }
      ]).flatten({ background: VIOLET }).png().toFile(ep);
    cards.push([ep, 1.8]);

    const parts = [];
    const main = path.join(tmp, 'main.mp4');
    await run('ffmpeg', ['-y', '-i', videoPath,
      '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=${FPS}`,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '44100', '-ac', '2', main]);
    parts.push(main);
    for (let i = 0; i < cards.length; i++) {
      const [png, dur] = cards[i];
      const seg = path.join(tmp, `card${i}.mp4`);
      await run('ffmpeg', ['-y', '-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', png,
        '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
        '-vf', `scale=${W}:${H}`, '-t', String(dur),
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-ar', '44100', '-ac', '2', seg]);
      parts.push(seg);
    }
    const inputs = parts.flatMap(f => ['-i', f]);
    const filter = parts.map((_, i) => `[${i}:v][${i}:a]`).join('') + `concat=n=${parts.length}:v=1:a=1[v][a]`;
    await run('ffmpeg', ['-y', ...inputs, '-filter_complex', filter, '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outPath]);
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// POST /api/marketing/veo-remix — re-audio an EXISTING generated clip without
// paying for a new generation. Body: { comicId, file, voiceAudio: [..], ambient }
router.post('/veo-remix', async (req, res) => {
  try {
    const { comicId, file, voiceAudio = [], ambient = 'duck' } = req.body;
    if (!comicId || !file || !/^[\w.\-]+\.mp4$/.test(file)) return res.status(400).json({ error: 'comicId and a valid file are required' });
    const src = path.join(PROJECTS_DIR, comicId, 'marketing', file);
    const name = `${file.replace(/\.mp4$/, '')}-mix-${Date.now()}.mp4`;
    const out = path.join(PROJECTS_DIR, comicId, 'marketing', name);
    const { question = '', endCard = false } = req.body;
    if (voiceAudio.length === 0 && ambient === 'keep' && !question && !endCard) return res.status(400).json({ error: 'Nothing to change' });
    let cur = src;
    if (voiceAudio.length > 0 || ambient !== 'keep') { await mixVoicesOnto(comicId, src, voiceAudio, ambient, out); cur = out; }
    if (question || endCard) {
      const fin = out.replace(/\.mp4$/, '-fin.mp4');
      await finishClip(comicId, cur, question, fin);
      const finName = path.basename(fin);
      return res.json({ url: `/projects/${comicId}/marketing/${finName}`, file: finName });
    }
    res.json({ url: `/projects/${comicId}/marketing/${name}`, file: name });
  } catch (error) {
    console.error('Veo remix error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/marketing/veo-clip — generate a video clip with Veo (Gemini API),
// guided by up to 3 directional images from the comic's export and a text
// brief. Same SDK + key as comic image generation.
// Body: { comicId, prompt, imageFiles?: [..up to 3], model?: 'fast'|'quality'|'lite',
//         aspectRatio?: '9:16'|'16:9' }
router.post('/veo-clip', async (req, res) => {
  try {
    const { GoogleGenAI } = require('@google/genai');
    if (!process.env.GEMINI_API_KEY) return res.status(400).json({ error: 'GEMINI_API_KEY not configured' });
    const { comicId, prompt, imageFiles = [], aspectRatio = '9:16' } = req.body;
    const tier = { fast: 'veo-3.1-fast-generate-preview', quality: 'veo-3.1-generate-preview', lite: 'veo-3.1-lite-generate-preview' }[req.body.model || 'fast'];
    if (!comicId || !prompt) return res.status(400).json({ error: 'comicId and prompt are required' });
    if (imageFiles.length > 3) return res.status(400).json({ error: 'Max 3 directional images' });
    const { dir } = await exportImagesDir(comicId);

    const refs = [];
    for (const f of imageFiles) {
      if (!/^[\w.\-áéíóúñü]+$/i.test(f)) return res.status(400).json({ error: 'Bad image filename' });
      // Veo refs don't need full-res: cap at 1024px to keep the request light.
      const buf = await sharp(path.join(dir, f)).resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
      refs.push({ image: { imageBytes: buf.toString('base64'), mimeType: 'image/jpeg' } });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const request = { model: tier, prompt, config: { aspectRatio, numberOfVideos: 1 } };
    if (req.body.negativePrompt) request.config.negativePrompt = String(req.body.negativePrompt);
    if (refs.length) request.config.referenceImages = refs;

    let op;
    try {
      op = await ai.models.generateVideos(request);
    } catch (e) {
      // Some tiers reject referenceImages — retry with the first image as the
      // starting frame instead, which every tier supports.
      if (refs.length && /reference/i.test(e.message)) {
        console.warn('[veo] referenceImages rejected, retrying as first-frame:', e.message);
        op = await ai.models.generateVideos({ model: tier, prompt, image: refs[0].image, config: { aspectRatio, numberOfVideos: 1 } });
      } else throw e;
    }
    const started = Date.now();
    while (!op.done) {
      if (Date.now() - started > 8 * 60 * 1000) throw new Error('Veo generation timed out');
      await new Promise(r => setTimeout(r, 8000));
      op = await ai.operations.getVideosOperation({ operation: op });
    }
    const vids = op.response?.generatedVideos || [];
    if (!vids.length) {
      const why = op.response?.raiMediaFilteredReasons?.join('; ') || op.error?.message || 'no video returned (possibly filtered)';
      return res.status(502).json({ error: `Veo returned nothing: ${why}` });
    }
    const outDir = path.join(PROJECTS_DIR, comicId, 'marketing');
    await fs.mkdir(outDir, { recursive: true });
    let name = `veo-${Date.now()}.mp4`;
    await ai.files.download({ file: vids[0].video, downloadPath: path.join(outDir, name) });
    // Optional voice overlay straight after generation.
    const voiceAudio = req.body.voiceAudio || [];
    const ambient = req.body.ambient || 'keep';
    if (voiceAudio.length > 0 || ambient !== 'keep') {
      const mixed = name.replace(/\.mp4$/, '-mix.mp4');
      await mixVoicesOnto(comicId, path.join(outDir, name), voiceAudio, ambient, path.join(outDir, mixed));
      name = mixed;
    }
    const { question: finQ = '', endCard = false } = req.body;
    if (finQ || endCard) {
      const fin = name.replace(/\.mp4$/, '-fin.mp4');
      await finishClip(comicId, path.join(outDir, name), finQ, path.join(outDir, fin));
      name = fin;
    }
    res.json({ url: `/projects/${comicId}/marketing/${name}`, file: name, model: tier });
  } catch (error) {
    console.error('Veo clip error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

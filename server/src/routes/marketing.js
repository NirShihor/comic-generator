const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const OpenAI = require('openai');
const Comic = require('../models/Comic');
// OpenAI image model used for every ChatGPT-provider image call in this file.
// Tried gpt-image-2.5-sunburst on 2026-09-10 — it drifted photorealistic and lost the
// hand-drawn comic look, so reverted the same day. gpt-image-2.5-flare untested.
const OPENAI_IMAGE_MODEL = 'gpt-image-2';

const PROJECTS_DIR = path.join(__dirname, '../../projects');
const LOGO_PATH = path.join(__dirname, '../../assets/comigo-bubble.png');
// Luckiest Guy — the app's display font (the "Spanish." on the reader's
// landing screen). sharp renders SVG text through fontconfig, which only
// sees installed fonts, so copy it into the user's font folder once.
const DISPLAY_FONT = 'Luckiest Guy';
const BUBBLE_FONT = 'Comic Relief';   // fallback bubble font for English text drawn into bubbles
// The page editor's bubble fonts (Google fonts, bundled in assets/fonts) by fontId.
const BUBBLE_FONT_FAMILY = { bangers: 'Bangers', 'permanent-marker': 'Permanent Marker', 'patrick-hand': 'Patrick Hand', caveat: 'Caveat', 'indie-flower': 'Indie Flower', 'comic-neue': 'Comic Neue' };
try {
  const fsSync = require('fs');
  const dir = process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Fonts') : path.join(os.homedir(), '.fonts');
  const fdir = path.join(__dirname, '../../assets/fonts');
  for (const f of fsSync.readdirSync(fdir).filter(f => /\.ttf$/i.test(f))) {
    const src = path.join(fdir, f), dst = path.join(dir, f);
    if (!fsSync.existsSync(dst)) { fsSync.mkdirSync(dir, { recursive: true }); fsSync.copyFileSync(src, dst); }
  }
} catch (e) { console.warn('[marketing] could not install fonts:', e.message); }

// The canonical "mini movie poster" template (locked 2026-09-01):
// 1080x1350, brand violet, white hook line (no full stop) + larger yellow
// question, page art white-bordered with offset shadow, quiet footer
// (logo bubble / "Interactive Spanish stories" / comigo.net). No CTA, no
// hashtags on the image — posts are entertainment, not adverts.
const VIOLET = { r: 0x6e, g: 0x40, b: 0xf0, alpha: 1 };

// Newest export slug folder for a comic (same rule as sync-store.sh).
async function exportImagesDir(comicId) {
  const exportDir = path.join(PROJECTS_DIR, comicId, 'export');
  let entries;
  try {
    entries = await fs.readdir(exportDir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('This comic has never been exported — run "Export Full Package" on it first (the Marketing tab works from the exported images and audio)');
    throw e;
  }
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

// GET /api/marketing/:comicId/style-images — every reference image the comic's
// art was made from (master style, character sheets, location sheets — from
// the collection's prompt settings, else the comic's) plus marketing images
// generated or uploaded so far. Tokens: "ref:<path>", "gen:<name>", "upload:<name>".
router.get('/:comicId/style-images', async (req, res) => {
  try {
    const comic = await Comic.findOne({ id: req.params.comicId }).lean();
    if (!comic) return res.status(404).json({ error: 'Comic not found' });
    let ps = comic.promptSettings || {};
    if (comic.collectionId) {
      const Collection = require('../models/Collection');
      const col = await Collection.findOne({ id: comic.collectionId }).lean();
      const cps = col?.promptSettings;
      if (cps && (cps.masterStyleImage || cps.characters?.length || cps.styleBibleImages?.length)) ps = cps;
    }
    const ok = p => typeof p === 'string' && /^\/(projects|uploads)\//.test(p) && !p.includes('..');
    const style = [];
    if (ok(ps.masterStyleImage)) style.push({ file: `ref:${ps.masterStyleImage}`, url: ps.masterStyleImage, name: 'Master style' });
    for (const l of ps.styleBibleImages || []) if (ok(l.image)) style.push({ file: `ref:${l.image}`, url: l.image, name: l.name || 'style' });
    const characters = (ps.characters || []).filter(c => ok(c.image)).map(c => ({ file: `ref:${c.image}`, url: c.image, name: c.name || 'character' }));
    const mDir = path.join(PROJECTS_DIR, req.params.comicId, 'marketing');
    const listDir = async (dir, prefix, urlBase) => {
      let names = [];
      try { names = (await fs.readdir(dir)).filter(f => /\.(png|jpe?g|webp)$/i.test(f)); } catch { return []; }
      const withTime = await Promise.all(names.map(async f => ({ f, t: (await fs.stat(path.join(dir, f))).mtimeMs })));
      return withTime.sort((a, b) => b.t - a.t).map(({ f }) => ({ file: `${prefix}${f}`, url: `${urlBase}/${f}`, name: f }));
    };
    const generated = (await listDir(mDir, 'gen:', `/projects/${req.params.comicId}/marketing`)).filter(i => /^gen-/.test(i.name));
    const uploads = await listDir(path.join(mDir, 'uploads'), 'upload:', `/projects/${req.params.comicId}/marketing/uploads`);
    res.json({ groups: [
      { kind: 'style', label: 'Style & locations', images: style },
      { kind: 'characters', label: 'Characters', images: characters },
      { kind: 'generated', label: 'Generated for marketing', images: generated },
      { kind: 'uploads', label: 'Uploaded', images: uploads },
    ] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/marketing/:comicId/image — remove a generated or uploaded
// marketing image. Body: { file: 'gen:<name>' | 'upload:<name>' }
router.delete('/:comicId/image', async (req, res) => {
  try {
    const file = String(req.body?.file || req.query?.file || '');
    let p;
    if (file.startsWith('gen:') && /^[\w.\-]+$/.test(file.slice(4))) p = path.join(PROJECTS_DIR, req.params.comicId, 'marketing', file.slice(4));
    else if (file.startsWith('upload:') && /^[\w.\-]+$/.test(file.slice(7))) p = path.join(PROJECTS_DIR, req.params.comicId, 'marketing', 'uploads', file.slice(7));
    else return res.status(400).json({ error: 'Only generated (gen:) or uploaded (upload:) images can be deleted' });
    await fs.unlink(p).catch(e => { if (e.code !== 'ENOENT') throw e; });
    res.json({ ok: true, file });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/marketing/keep-image — copy a generated image (from /uploads, the
// studio/inpaint output area, or anywhere the server serves) into the comic's
// marketing folder so it persists and shows up in every picker.
// Body: { comicId, path } → { file: 'gen:<name>', url }
router.post('/keep-image', async (req, res) => {
  try {
    const { comicId, path: p } = req.body;
    if (!comicId || typeof p !== 'string' || !/^\/(projects|uploads)\/[\w\-./ ]+$/.test(p) || p.includes('..')) return res.status(400).json({ error: 'comicId and a valid path are required' });
    const src = path.join(__dirname, '../..', p.split('?')[0]);
    const outDir = path.join(PROJECTS_DIR, comicId, 'marketing');
    await fs.mkdir(outDir, { recursive: true });
    const name = `gen-${Date.now()}.png`;
    await sharp(src).png().toFile(path.join(outDir, name));
    res.json({ file: `gen:${name}`, url: `/projects/${comicId}/marketing/${name}` });
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
    const src = resolveSlideImage(comicId, await exportDirOrNull(comicId), imageFile);

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
      err ? reject(new Error(String(se || err.message).trim().split('\n').slice(-6).join('\n'))) : resolve(so)));
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
    const logo = await sharp(LOGO_PATH).resize({ width: 640 }).png().toBuffer();
    const logoMeta = await sharp(logo).metadata();
    const eCard = path.join(tmp, 'ecard.png');
    await sharp({ create: { width: W, height: H, channels: 4, background: VIOLET } })
      .composite([
        { input: logo, left: Math.round((W - logoMeta.width) / 2), top: Math.round(H / 2 - logoMeta.height) },
        { input: Buffer.from(`<svg width="${W}" height="${H}">
            <text x="${W / 2}" y="${H / 2 + 130}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="72" font-weight="700" fill="#FFFFFF">Interactive Spanish stories</text>
            <text x="${W / 2}" y="${H / 2 + 330}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="110" font-weight="800" fill="#FFFFFF">comigo.net</text>
          </svg>`), left: 0, top: 0 }
      ])
      .flatten({ background: VIOLET }).png().toFile(eCard);
    for (const [img, dur, name] of [[qCard, question ? 2.0 : 0, 'qseg'], [eCard, 1.8, 'eseg']]) {
      if (dur === 0) continue;
      const out = path.join(tmp, `${name}.mp4`);
      await run('ffmpeg', ['-y', '-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', img,
        '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
        '-vf', `scale=${W}:${H},setsar=1`, '-t', String(dur),
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

// POST /api/marketing/upload-image — user's own image for a carousel slide.
// Saved under projects/<id>/marketing/uploads/; referenced as "upload:<name>".
const imageUpload = require('multer')({
  storage: require('multer').memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});
router.post('/upload-image', imageUpload.single('image'), async (req, res) => {
  try {
    const { comicId } = req.body;
    if (!comicId || !req.file) return res.status(400).json({ error: 'comicId and image file are required' });
    if (!/\.(jpg|jpeg|png|webp)$/i.test(req.file.originalname)) return res.status(400).json({ error: 'Image files only (jpg/png/webp)' });
    const upDir = path.join(PROJECTS_DIR, comicId, 'marketing', 'uploads');
    await fs.mkdir(upDir, { recursive: true });
    const name = `${Date.now()}-${req.file.originalname.replace(/[^\w.\-]/g, '_')}`;
    await fs.writeFile(path.join(upDir, name), req.file.buffer);
    res.json({ file: `upload:${name}`, url: `/projects/${comicId}/marketing/uploads/${name}`, label: req.file.originalname });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/marketing/upload-clip — your own video as the reel's base. It's
// normalised to 1080x1920 H.264 (letterboxed if not 9:16) and saved in the
// comic's marketing folder, so the usual voice / subtitle / card finishing
// (veo-remix) can be applied to it like any generated clip.
const clipUpload = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 400 * 1024 * 1024 } });
router.post('/upload-clip', clipUpload.single('clip'), async (req, res) => {
  const { execFile } = require('child_process');
  const os = require('os');
  const run = (cmd, args) => new Promise((resolve, reject) =>
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64 }, (err, so, se) => err ? reject(new Error((se || err.message).slice(-800))) : resolve(so)));
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'clip-'));
  try {
    const { comicId } = req.body;
    if (!comicId || !req.file) return res.status(400).json({ error: 'comicId and a video file are required' });
    if (!/\.(mp4|mov|m4v|webm)$/i.test(req.file.originalname)) return res.status(400).json({ error: 'Video files only (mp4/mov/m4v/webm)' });
    const src = path.join(tmp, 'in' + path.extname(req.file.originalname).toLowerCase());
    await fs.writeFile(src, req.file.buffer);
    const outDir = path.join(PROJECTS_DIR, comicId, 'marketing');
    await fs.mkdir(outDir, { recursive: true });
    const name = `own-${Date.now()}.mp4`;
    const hasAudio = /audio/i.test(await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', src]).catch(() => ''));
    // Screen recordings often carry the content small on a black canvas. Find
    // the real picture with cropdetect (sampled across the clip) and crop to
    // it when the border is substantial; then fit to 9:16 over a blurred,
    // darkened copy of the picture instead of black bars.
    const dims = (await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src])).trim().split(',').map(Number);
    let cropF = '';
    if (req.body.autocrop !== 'false') {
      const det = await new Promise(resolve => execFile('ffmpeg', ['-v', 'info', '-i', src, '-vf', 'select=not(mod(n\\,10)),cropdetect=limit=28:round=2:reset=0', '-frames:v', '60', '-f', 'null', '-'], { maxBuffer: 1024 * 1024 * 16 }, (e, so, se) => resolve(se || '')));
      const found = [...det.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].pop();
      if (found && dims[0] && dims[1]) {
        const [w, h, x, y] = found.slice(1).map(Number);
        if (w > 16 && h > 16 && (w * h) < 0.9 * dims[0] * dims[1]) cropF = `crop=${w}:${h}:${x}:${y},`;
      }
    }
    const fitChain = `[0:v]${cropF}split=2[bgi][fgi];[bgi]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:4,eq=brightness=-0.22:saturation=0.8[bg];[fgi]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=25,setsar=1,format=yuv420p[v]`;
    const args = ['-y', '-i', src];
    if (!hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo');
    args.push('-filter_complex', fitChain, '-map', '[v]', '-map', hasAudio ? '0:a:0' : '1:a',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest', '-movflags', '+faststart', path.join(outDir, name));
    await run('ffmpeg', args);
    console.log(`[upload-clip] ${req.file.originalname} ${dims.join('x')} → ${name}${cropF ? ' (auto-cropped ' + cropF.replace(/,$/, '') + ')' : ''}`);
    const dur = parseFloat(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(outDir, name)]));
    res.json({ url: `/projects/${comicId}/marketing/${name}`, file: name, seconds: Math.round(dur * 10) / 10, label: req.file.originalname });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

// POST /api/marketing/challenge-reel — a "challenge" reel built straight from
// a page in the database (story, practice or reel page): an optional intro
// clip, then the SPANISH run (the page with its bubbles empty; each bubble's
// baked Spanish text — or just a green highlight — appears while its audio
// plays), then a violet prompt slide, then the ENGLISH run (English written
// into the bubbles — or a highlight — while the English audio plays).
// Body: { comicId, pageId, introFile?, spanish: { on, showText, gap, hold },
//         prompt: { on, line1, line2, seconds }, english: { on, showText, gap, hold } }
router.post('/challenge-reel', async (req, res) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'challenge-'));
  try {
    const { execFile } = require('child_process');
    const fsSync = require('fs');
    const run = (cmd, args) => new Promise((resolve, reject) =>
      execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64 }, (err, so, se) => err ? reject(new Error(String(se || err.message).trim().split('\n').slice(-6).join('\n'))) : resolve(so)));
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const num = (v, d, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Number(v) : d));
    const { comicId, pageId } = req.body;
    if (!comicId || !pageId) return res.status(400).json({ error: 'comicId and pageId are required' });
    const introFile = req.body.introFile && /^[\w.\-]+\.mp4$/.test(req.body.introFile) ? req.body.introFile : null;
    const sp = { on: req.body.spanish?.on !== false, showText: req.body.spanish?.showText !== false, gap: num(req.body.spanish?.gap, 0.6, 0, 5), hold: num(req.body.spanish?.hold, 1.0, 0, 10),
      // word popups (the reader's word card: word, meaning, base form) — { bubbleId: [wordIndex...] }
      words: req.body.spanish?.words && typeof req.body.spanish.words === 'object' ? req.body.spanish.words : {},
      popupDelay: num(req.body.spanish?.popupDelay, 1.0, 0, 5), popupHold: num(req.body.spanish?.popupHold, 2.5, 0.5, 10) };
    const pr = { on: req.body.prompt?.on !== false, line1: String(req.body.prompt?.line1 ?? 'How much did you understand?').trim().slice(0, 80), line2: String(req.body.prompt?.line2 ?? 'Can you say it in Spanish?').trim().slice(0, 80), seconds: num(req.body.prompt?.seconds, 3.5, 1, 15), style: ['text', 'bubbles', 'page'].includes(req.body.prompt?.style) ? req.body.prompt.style : 'page',
      // style 'page': the slide is another (baked) reel page — its bubbles pop in one by one when `reveal` is set.
      pageId: req.body.prompt?.pageId ? String(req.body.prompt.pageId) : '', reveal: req.body.prompt?.reveal !== false, gap: num(req.body.prompt?.gap, 0.7, 0, 5),
      // what goes in the slide's bubbles: the bake as-is ('baked') or the bubbles' English translations written in ('english', default)
      text: req.body.prompt?.text === 'english' ? 'english' : 'baked',
      // the house English narrator reads each bubble as it appears (generated once and cached per text)
      voice: req.body.prompt?.voice !== false,
      // pause after the last bubble (and its line) before the slide ends
      hold: num(req.body.prompt?.hold, 1.0, 0, 15),
      // slide background: keep the page's own (violet), or swap the violet for a gradient / plain colour
      bg: ['page', 'gradient', 'black', 'white'].includes(req.body.prompt?.bg) ? req.body.prompt.bg : 'page',
      // the bubble text is typed in, line by line, while its line is read
      typewriter: req.body.prompt?.typewriter === true };
    const en = { on: req.body.english?.on !== false, showText: req.body.english?.showText !== false, gap: num(req.body.english?.gap, 0.6, 0, 5), hold: num(req.body.english?.hold, 1.0, 0, 10) };
    const W = 1080, H = 1920, FPS = 25;
    console.log('[challenge-reel]', comicId, pageId, JSON.stringify({ spanish: sp, prompt: pr, english: en, introFile }));
    const mdir = path.join(PROJECTS_DIR, comicId, 'marketing');
    await fs.mkdir(mdir, { recursive: true });
    const comic = await Comic.findOne({ id: comicId }, { pages: 1, practicePages: 1, reelPages: 1 }).lean();
    if (!comic) return res.status(404).json({ error: 'Comic not found' });
    const page = [...(comic.pages || []), ...(comic.practicePages || []), ...(comic.reelPages || [])].find(pg => pg.id === pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    const localFile = url => url ? path.join(__dirname, '../..', String(url).split('?')[0]) : null;
    const bakedImg = localFile(page.bakedImage), emptyImg = localFile(page.emptyBubblesImage);
    if (!bakedImg || !fsSync.existsSync(bakedImg)) return res.status(400).json({ error: 'This page has not been baked yet — bake it in the page editor first' });
    const baseImg = emptyImg && fsSync.existsSync(emptyImg) ? emptyImg : null;
    if (!baseImg) return res.status(400).json({ error: 'This page has no empty-bubbles bake — re-bake it in the page editor (the bake also produces the empty-bubbles image)' });
    // Bubbles in reading order: pinned orderIndex if every bubble has one, else top-to-bottom.
    let bubbles = (page.bubbles || []).filter(b => !b.hidden && !b.isSoundEffect && b.type !== 'image' && (b.sentences || [])[0]?.text && Number.isFinite(b.x) && Number.isFinite(b.width));
    bubbles = bubbles.every(b => Number.isFinite(b.orderIndex)) ? [...bubbles].sort((a, b) => a.orderIndex - b.orderIndex) : [...bubbles].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    if (bubbles.length === 0) return res.status(400).json({ error: 'No bubbles with text on this page' });
    const audioFile = name => { if (!name) return null; const f = path.join(PROJECTS_DIR, comicId, 'audio', `${name}.mp3`); return fsSync.existsSync(f) ? f : null; };
    const audioLen = async f => f ? (parseFloat(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f])) || 1.5) : 1.5;

    // Page fitted into the frame; every overlay is positioned in frame pixels.
    const meta = await sharp(baseImg).metadata();
    const scale = Math.min(W / meta.width, H / meta.height);
    const pw = Math.round(meta.width * scale / 2) * 2, ph = Math.round(meta.height * scale / 2) * 2;
    const px0 = Math.round((W - pw) / 2), py0 = Math.round((H - ph) / 2);
    const basePng = path.join(tmp, 'base.png'); await sharp(baseImg).resize(pw, ph).png().toFile(basePng);
    const bakedPng = path.join(tmp, 'baked.png'); await sharp(bakedImg).resize(pw, ph).png().toFile(bakedPng);
    const rectOf = b => { const x = Math.max(0, Math.round(b.x * pw)), y = Math.max(0, Math.round(b.y * ph)); return { x, y, w: Math.min(pw - x, Math.max(2, Math.round(b.width * pw))), h: Math.min(ph - y, Math.max(2, Math.round(b.height * ph))) }; };
    // The bubble's baked Spanish text: a straight crop of the baked page.
    const cropPng = async (name, r) => { const out = path.join(tmp, name); await sharp(bakedPng).extract({ left: r.x, top: r.y, width: r.w, height: r.h }).png().toFile(out); return out; };
    // "Speaking" highlight when no text is shown: the bubble's white turns the app's green.
    const highlightPng = async (name, r) => {
      const out = path.join(tmp, name);
      const { data, info } = await sharp(basePng).extract({ left: r.x, top: r.y, width: r.w, height: r.h }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const rad = Math.min(info.width, info.height) * 0.3;   // rounded-rectangle mask, like the bubble outline
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const k = (y * info.width + x) * 4;
        const dx = Math.max(0, Math.max(rad - x, x - (info.width - 1 - rad))), dy = Math.max(0, Math.max(rad - y, y - (info.height - 1 - rad)));
        const inside = dx * dx + dy * dy <= rad * rad;
        const mn = Math.min(data[k], data[k + 1], data[k + 2]), mx = Math.max(data[k], data[k + 1], data[k + 2]);
        if (inside && mn > 195 && mx - mn < 18) { data[k] = 0x98; data[k + 1] = 0xF8; data[k + 2] = 0x72; }   // the bake's light-grey/white bubble fill
        else data[k + 3] = 0;
      }
      await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(out);
      return out;
    };
    // English written into the bubble with the reader's bubble font.
    const textPng = async (name, text, r, fontId) => {
      const out = path.join(tmp, name);
      const family = BUBBLE_FONT_FAMILY[fontId] || BUBBLE_FONT;
      text = text.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();   // drop ElevenLabs audio tags like [fade out slowly]
      const innerW = r.w * 0.86, innerH = r.h * 0.82;
      let size = 44, lines = [];
      for (; size >= 16; size -= 2) {
        const maxChars = Math.max(4, Math.floor(innerW / (0.52 * size)));
        const words = text.split(/\s+/); lines = []; let cur = '';
        for (const w of words) { if (cur && (cur + ' ' + w).length > maxChars) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; }
        if (cur) lines.push(cur);
        if (lines.length * size * 1.15 <= innerH && Math.max(...lines.map(l => l.length)) <= maxChars) break;
      }
      const lineH = size * 1.15, totalH = lines.length * lineH;
      await sharp(Buffer.from(`<svg width="${r.w}" height="${r.h}" xmlns="http://www.w3.org/2000/svg">${lines.map((l, i) =>
        `<text x="${r.w / 2}" y="${(r.h - totalH) / 2 + i * lineH + size * 0.95}" text-anchor="middle" font-family="${family}, ${BUBBLE_FONT}, Helvetica, sans-serif" font-size="${size}" font-weight="${fontId === 'bangers' || fontId === 'permanent-marker' ? 400 : 700}" fill="#111111">${esc(l)}</text>`).join('')}</svg>`)).png().toFile(out);
      return out;
    };
    // One run: base page + per-bubble overlay (kept, or shown only while it speaks) + audio.
    const runSegment = async (name, items, gap, hold) => {
      let t = 0.6;
      for (const it of items) { it.start = t; it.len = await audioLen(it.audio); t += it.len + (it.extraDur || 0) + gap; }
      const dur = t - gap + hold;
      const args = ['-y', '-f', 'lavfi', '-t', String(dur), '-i', `color=c=0x111111:s=${W}x${H}:r=${FPS}`, '-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', basePng];
      const chain = [`[0:v][1:v]overlay=${px0}:${py0}[p0]`]; let cur = '[p0]';
      let inputIdx = 2, layer = 0;
      const overlays = [];   // [{png, x, y, enable, fadeAt}]
      items.forEach(it => {
        const slotEnd = it.start + it.len + (it.extraDur || 0);
        const on = it.transient ? `between(t,${it.start.toFixed(2)},${(slotEnd + 0.15).toFixed(2)})` : `gte(t,${it.start.toFixed(2)})`;
        overlays.push({ png: it.png, x: px0 + it.r.x, y: py0 + it.r.y, enable: on, fadeAt: it.start });
        for (const ex of it.extras || []) overlays.push({ png: ex.png, x: ex.x, y: ex.y, enable: `between(t,${(it.start + ex.from).toFixed(2)},${(it.start + ex.to).toFixed(2)})`, fadeAt: it.start + ex.from });
      });
      overlays.forEach((ov, k) => {
        args.push('-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', ov.png);
        chain.push(`[${inputIdx + k}:v]format=rgba,fade=t=in:st=${ov.fadeAt.toFixed(2)}:d=0.2:alpha=1[t${k}]`);
        const out = k === overlays.length - 1 ? '[vr]' : `[p${k + 1}]`;
        chain.push(`${cur}[t${k}]overlay=${ov.x}:${ov.y}:enable='${ov.enable}':format=auto${out}`); cur = out;
      });
      chain.push(`${cur}format=yuv420p,setsar=1[v]`);
      const withAudio = items.filter(it => it.audio);
      const first = 2 + overlays.length;
      withAudio.forEach(it => args.push('-i', it.audio));
      const achain = [`anullsrc=r=44100:cl=stereo,atrim=0:${dur.toFixed(2)}[sil]`]; let amix = '[sil]';
      withAudio.forEach((it, j) => { achain.push(`[${first + j}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=${Math.round(it.start * 1000)}|${Math.round(it.start * 1000)}[ra${j}]`); amix += `[ra${j}]`; });
      achain.push(`${amix}amix=inputs=${withAudio.length + 1}:normalize=0[a]`);
      const seg = path.join(tmp, `${name}.mp4`);
      await run('ffmpeg', [...args, '-filter_complex', [...chain, ...achain].join(';'), '-map', '[v]', '-map', '[a]', '-t', String(dur),
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-ar', '44100', '-ac', '2', seg]);
      return seg;
    };

    // The reader's word card (word, meaning in this sentence, base form) as a PNG,
    // with a little arrow towards the bubble. Returns { png, w, h, arrowUp }.
    const wordCardPng = async (name, w, arrowUp) => {
      const cw = 470, pad = 26, out = path.join(tmp, name);
      const word = String(w.text || '').replace(/[¿?¡!.,;:…]+/g, '').trim();
      const meaning = String(w.meaning || '').trim(), base = String(w.baseForm || '').trim(), baseMeaning = String(w.baseMeaning || '').trim();
      const showBase = base && base.toLowerCase() !== word.toLowerCase();
      const rows = [];
      rows.push({ t: word, size: 44, weight: 700, fill: '#111', dy: 0 });
      if (meaning) rows.push({ t: meaning, size: 30, weight: 400, fill: '#555', dy: 8 });
      if (showBase) { rows.push({ t: 'Base form', size: 22, weight: 500, fill: '#888', dy: 22, caps: true }); rows.push({ t: base + (baseMeaning ? '  ·  ' + baseMeaning : ''), size: 32, weight: 600, fill: '#222', dy: 6 }); }
      let y = pad + 8; const svgRows = [];
      for (const r of rows) { y += r.dy + r.size; svgRows.push(`<text x="${pad}" y="${y}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="${r.size}" font-weight="${r.weight}" fill="${r.fill}"${r.caps ? ' letter-spacing="1"' : ''}>${esc(r.caps ? r.t.toUpperCase() : r.t)}</text>`); }
      const ch = y + pad + 4, ah = 0, h = ch;   // no pointer/arrow on the card
      const speaker = `<g transform="translate(${cw - pad - 34},${pad + 14}) scale(1.35)" fill="#2f7cf6"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M14.5 8.5a4 4 0 0 1 0 7" fill="none" stroke="#2f7cf6" stroke-width="2" stroke-linecap="round"/><path d="M17 5.5a8 8 0 0 1 0 13" fill="none" stroke="#2f7cf6" stroke-width="2" stroke-linecap="round"/></g>`;
      const arrow = '';
      const cardY = arrowUp ? ah : 0;
      await sharp(Buffer.from(`<svg width="${cw}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="${cardY}" width="${cw}" height="${ch}" rx="22" fill="#fff"/><rect x="0" y="${cardY}" width="${cw}" height="${ch}" rx="22" fill="none" stroke="#000" stroke-opacity="0.12"/>${arrow}<g transform="translate(0,${cardY})">${svgRows.join('')}${speaker}</g></svg>`)).png().toFile(out);
      return { png: out, w: cw, h, arrowUp };
    };
    const parts = [];
    if (introFile) {
      const seg = path.join(tmp, 'intro.mp4');
      await run('ffmpeg', ['-y', '-i', path.join(mdir, introFile),
        '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=${FPS},setsar=1`,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '2', seg]);
      parts.push(seg);
    }
    if (sp.on) {
      const items = [];
      for (let i = 0; i < bubbles.length; i++) {
        const b = bubbles[i], r = rectOf(b), sen = b.sentences[0];
        const item = { r, audio: audioFile(sen.audioUrl), png: sp.showText ? await cropPng(`es${i}.png`, r) : await highlightPng(`esh${i}.png`, r), transient: !sp.showText };
        // Word popups for this bubble: shown one after another after the line is read.
        const picks = (sp.words[b.id] || []).map(Number).filter(n => Number.isFinite(n) && (sen.words || [])[n]);
        if (picks.length) {
          const len = await audioLen(item.audio);
          const arrowUp = (b.y + b.height / 2) < 0.5;   // bubble in the top half → card below it, arrow up
          item.extras = []; let from = len + sp.popupDelay;
          for (let k = 0; k < picks.length; k++) {
            const card = await wordCardPng(`wc${i}_${k}.png`, sen.words[picks[k]], arrowUp);
            const cx = px0 + Math.round((b.x + b.width / 2) * pw);
            // Keep the card well inside the page (never hugging an edge, so phone frames / margins can't crop it).
            const inset = Math.round(pw * 0.09);
            const x = Math.max(px0 + inset, Math.min(px0 + pw - card.w - inset, cx - card.w / 2));
            const y = arrowUp ? py0 + r.y + r.h + 10 : py0 + r.y - card.h - 10;
            item.extras.push({ png: card.png, x, y: Math.max(8, Math.min(H - card.h - 8, y)), from, to: from + sp.popupHold });
            from += sp.popupHold + 0.3;
          }
          item.extraDur = from - len;
          console.log('[challenge-reel] popups for bubble', b.id, item.extras.map(e => ({ x: e.x, y: e.y, from: e.from, to: e.to })));
        }
        items.push(item);
      }
      parts.push(await runSegment('spanish', items, sp.gap, sp.hold));
    }
    if (pr.on && pr.style === 'page' && !pr.pageId) return res.status(400).json({ error: 'Choose the slide page in the Prompt slide row (or switch the style to a generated slide)' });
    if (pr.on && pr.style === 'page' && pr.pageId) {
      const slide = [...(comic.pages || []), ...(comic.practicePages || []), ...(comic.reelPages || [])].find(pg => pg.id === pr.pageId);
      const sBaked = localFile(slide?.bakedImage), sEmpty = localFile(slide?.emptyBubblesImage);
      if (!slide || !sBaked || !fsSync.existsSync(sBaked)) return res.status(400).json({ error: 'The slide page has not been baked yet' });
      const sm = await sharp(sBaked).metadata();
      const sc = Math.min(W / sm.width, H / sm.height), sw = Math.round(sm.width * sc / 2) * 2, sh = Math.round(sm.height * sc / 2) * 2;
      const sx0 = Math.round((W - sw) / 2), sy0 = Math.round((H - sh) / 2);
      // Optional background swap: the slide page's violet (#6E40F0) is replaced pixel by
      // pixel with a gradient or plain colour; bubbles, text and logo are left alone.
      const swapBg = async (inFile, outFile) => {
        if (pr.bg === 'page') { await sharp(inFile).resize(sw, sh).png().toFile(outFile); return; }
        const { data, info } = await sharp(inFile).resize(sw, sh).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const bgBuf = pr.bg === 'gradient'
          ? await sharp(Buffer.from(`<svg width="${sw}" height="${sh}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#57BFEF"/><stop offset="0.5" stop-color="#6B8CF5"/><stop offset="1" stop-color="#9A83F5"/></linearGradient></defs><rect width="${sw}" height="${sh}" fill="url(#g)"/></svg>`)).ensureAlpha().raw().toBuffer()
          : await sharp({ create: { width: sw, height: sh, channels: 4, background: pr.bg === 'black' ? '#111111' : '#FFFFFF' } }).raw().toBuffer();
        for (let k = 0; k < data.length; k += 4) {
          const dr = data[k] - 0x6E, dg = data[k + 1] - 0x40, db = data[k + 2] - 0xF0;
          const d = Math.sqrt(dr * dr + dg * dg + db * db);
          if (d < 28) { data[k] = bgBuf[k]; data[k + 1] = bgBuf[k + 1]; data[k + 2] = bgBuf[k + 2]; }
          else if (d < 60) { const t = (d - 28) / 32; data[k] = Math.round(bgBuf[k] * (1 - t) + data[k] * t); data[k + 1] = Math.round(bgBuf[k + 1] * (1 - t) + data[k + 1] * t); data[k + 2] = Math.round(bgBuf[k + 2] * (1 - t) + data[k + 2] * t); }
        }
        await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(outFile);
      };
      const sBakedPng = path.join(tmp, 'sbaked.png'); await swapBg(sBaked, sBakedPng);
      const useEnglish = pr.text === 'english';
      if (useEnglish && !(sEmpty && fsSync.existsSync(sEmpty))) return res.status(400).json({ error: 'The slide page needs an empty-bubbles bake to write the English in — re-bake it in the page editor' });
      const canReveal = (pr.reveal || useEnglish || pr.typewriter) && sEmpty && fsSync.existsSync(sEmpty);
      const sBasePng = path.join(tmp, 'sbase.png'); await swapBg(canReveal ? sEmpty : sBaked, sBasePng);
      let sBubbles = (slide.bubbles || []).filter(b => !b.hidden && b.type !== 'image' && Number.isFinite(b.x) && Number.isFinite(b.width));
      sBubbles = sBubbles.every(b => Number.isFinite(b.orderIndex)) ? [...sBubbles].sort((a, b) => a.orderIndex - b.orderIndex) : [...sBubbles].sort((a, b) => (a.y - b.y) || (a.x - b.x));
      // What each bubble shows, and (optionally) the English narrator reading it.
      const spoken = [];
      for (let i = 0; i < sBubbles.length; i++) {
        const b = sBubbles[i], sen = (b.sentences || [])[0] || {};
        const shown = (useEnglish ? String(sen.translation || '') : String(sen.text || '')).replace(/\[[^\]]*\]/g, '').trim();
        let audio = null;
        if (pr.voice && shown) {
          const hash = require('crypto').createHash('md5').update(shown).digest('hex').slice(0, 10);
          const adir = path.join(PROJECTS_DIR, comicId, 'audio'); await fs.mkdir(adir, { recursive: true });
          const f = path.join(adir, `${comicId}_p${slide.pageNumber}_slide${i}_${hash}_en.mp3`);
          if (!fsSync.existsSync(f)) {
            if (!process.env.ELEVENLABS_API_KEY) return res.status(400).json({ error: 'ELEVENLABS_API_KEY not configured' });
            const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/GP1bgf0sjoFuuHkyrg8E', {
              method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
              body: JSON.stringify({ text: shown, model_id: 'eleven_v3', language_code: 'en', voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1.0 } }),
            });
            if (!r.ok) return res.status(502).json({ error: `ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}` });
            await fs.writeFile(f, Buffer.from(await r.arrayBuffer()));
          }
          audio = f;
        }
        spoken.push({ b, shown, audio, len: audio ? await audioLen(audio) : 0 });
      }
      // Timing: bubbles appear one after another; with a voice, each waits for the previous line.
      let t = 0.4;
      // Lines are always read one after another; without pop-in the bubbles are simply all visible from the start.
      for (const it of spoken) { it.start = t; it.show = pr.reveal ? t : 0; t += (pr.voice ? it.len + pr.gap : pr.gap); }
      const lastEnd = spoken.reduce((m, it) => Math.max(m, it.start + it.len), 0);
      const dur = Math.max(pr.seconds, lastEnd + pr.hold);   // hold = the pause after the last bubble
      // Surround: the page is 2:3 inside a 9:16 frame, so extend the background above and below.
      const surroundPng = path.join(tmp, 'ssurround.png');
      if (pr.bg === 'gradient') await sharp(Buffer.from(`<svg width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#57BFEF"/><stop offset="0.5" stop-color="#6B8CF5"/><stop offset="1" stop-color="#9A83F5"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`)).png().toFile(surroundPng);
      else await sharp({ create: { width: W, height: H, channels: 3, background: pr.bg === 'black' ? '#111111' : pr.bg === 'white' ? '#FFFFFF' : '#6E40F0' } }).png().toFile(surroundPng);
      const args = ['-y', '-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', surroundPng, '-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', sBasePng,
        '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo'];
      const chain = [`[0:v][1:v]overlay=${sx0}:${sy0}[s0]`]; let cur = '[s0]'; let k = 0;
      if (canReveal) {
        for (let i = 0; i < spoken.length; i++) {
          const { b, shown } = spoken[i];
          const x = Math.max(0, Math.round(b.x * sw)), y = Math.max(0, Math.round(b.y * sh));
          const r = { x, y, w: Math.min(sw - x, Math.max(2, Math.round(b.width * sw))), h: Math.min(sh - y, Math.max(2, Math.round(b.height * sh))) };
          // Either the bubble as baked (a straight crop of the baked slide), or its
          // English translation written into the empty bubble in the page's font.
          const png = useEnglish ? await textPng(`sb${i}.png`, shown || String(b.sentences?.[0]?.text || ''), r, b.fontId)
            : await (async () => { const o = path.join(tmp, `sb${i}.png`); await sharp(sBakedPng).extract({ left: r.x, top: r.y, width: r.w, height: r.h }).png().toFile(o); return o; })();
          const st = spoken[i].show.toFixed(2);
          if (pr.typewriter) {
            // Text-only layer (baked minus empty, or the written English), split into
            // text rows; each row is wiped in left→right over its share of the line.
            const textOnly = path.join(tmp, `stx${i}.png`);
            if (useEnglish) await fs.copyFile(png, textOnly);
            else {
              const [bk, em] = await Promise.all([sharp(sBakedPng).extract({ left: r.x, top: r.y, width: r.w, height: r.h }).ensureAlpha().raw().toBuffer(), sharp(sBasePng).extract({ left: r.x, top: r.y, width: r.w, height: r.h }).ensureAlpha().raw().toBuffer()]);
              for (let q = 0; q < bk.length; q += 4) { const d = Math.abs(bk[q] - em[q]) + Math.abs(bk[q + 1] - em[q + 1]) + Math.abs(bk[q + 2] - em[q + 2]); bk[q + 3] = d > 60 ? 255 : 0; }
              await sharp(bk, { raw: { width: r.w, height: r.h, channels: 4 } }).png().toFile(textOnly);
            }
            const { data: td, info: ti } = await sharp(textOnly).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            const rowInk = new Array(ti.height).fill(0);
            for (let yy = 0; yy < ti.height; yy++) for (let xx = 0; xx < ti.width; xx++) if (td[(yy * ti.width + xx) * 4 + 3] > 40) rowInk[yy]++;
            const bands = []; let inBand = false, b0 = 0;
            for (let yy = 0; yy <= ti.height; yy++) { const ink = yy < ti.height && rowInk[yy] > 0; if (ink && !inBand) { inBand = true; b0 = yy; } else if (!ink && inBand) { inBand = false; if (yy - b0 >= 4) bands.push({ y0: Math.max(0, b0 - 3), y1: Math.min(ti.height, yy + 3) }); } }
            for (const bd of bands) { let x0 = ti.width, x1 = 0; for (let yy = bd.y0; yy < bd.y1; yy++) for (let xx = 0; xx < ti.width; xx++) if (td[(yy * ti.width + xx) * 4 + 3] > 40) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; } bd.x0 = Math.max(0, x0 - 2); bd.x1 = Math.min(ti.width, x1 + 3); bd.w = Math.max(1, bd.x1 - bd.x0); }
            const totalW = bands.reduce((m, bd) => m + bd.w, 0) || 1;
            const typeLen = Math.max(0.8, (spoken[i].len || 1.2) * 0.9);
            let tAt = spoken[i].start;
            for (let bi = 0; bi < bands.length; bi++) {
              const bd = bands[bi], bpng = path.join(tmp, `stx${i}_${bi}.png`);
              await sharp(textOnly).extract({ left: bd.x0, top: bd.y0, width: bd.w, height: bd.y1 - bd.y0 }).png().toFile(bpng);
              const d = Math.max(0.15, typeLen * bd.w / totalW), s0 = tAt.toFixed(2), d0 = d.toFixed(2);
              args.push('-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', bpng);
              chain.push(`[${3 + k}:v]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(X,W*min(1,max(0,(T-${s0})/${d0}))),alpha(X,Y),0)'[sb${k}]`);
              const out = `[s${k + 1}]`;
              chain.push(`${cur}[sb${k}]overlay=x=${sx0 + r.x + bd.x0}:y=${sy0 + r.y + bd.y0}:enable='gte(t,${s0})':format=auto${out}`); cur = out; k++;
              tAt += d;
            }
            continue;
          }
          args.push('-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', png);
          chain.push(`[${3 + k}:v]format=rgba,scale=w='iw*(0.6+0.4*min(1,max(0,(t-${st})/0.3)))':h=-1:eval=frame,fade=t=in:st=${st}:d=0.15:alpha=1[sb${k}]`);
          const out = `[s${k + 1}]`;
          chain.push(`${cur}[sb${k}]overlay=x='${sx0 + r.x}+(${r.w}-w)/2':y='${sy0 + r.y}+(${r.h}-h)/2':enable='gte(t,${st})':format=auto${out}`); cur = out; k++;
        }
      }
      chain.push(`${cur}format=yuv420p,setsar=1[v]`);
      const withAudio = spoken.filter(it => it.audio); const firstA = 3 + k;
      withAudio.forEach(it => args.push('-i', it.audio));
      const achain = [`[2:a]atrim=0:${dur.toFixed(2)}[sil]`]; let amix = '[sil]';
      withAudio.forEach((it, j) => { achain.push(`[${firstA + j}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=${Math.round(it.start * 1000)}|${Math.round(it.start * 1000)}[pa${j}]`); amix += `[pa${j}]`; });
      achain.push(`${amix}amix=inputs=${withAudio.length + 1}:normalize=0[a]`);
      const seg = path.join(tmp, 'prompt.mp4');
      await run('ffmpeg', [...args, '-filter_complex', [...chain, ...achain].join(';'), '-map', '[v]', '-map', '[a]', '-t', String(dur),
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-ar', '44100', '-ac', '2', seg]);
      parts.push(seg);
    } else if (pr.on && (pr.line1 || pr.line2)) {
      // Comigo bubble logo on top (pops in), then the two lines: plain text, or
      // narration boxes in the page's own bubble font.
      const logo = await sharp(LOGO_PATH).resize({ width: 520 }).png().toBuffer();
      const lm = await sharp(logo).metadata();
      const logoPng = path.join(tmp, 'plogo.png'); await fs.writeFile(logoPng, logo);
      const els = [{ key: 'logo', png: logoPng, w: lm.width, h: lm.height, x: Math.round((W - lm.width) / 2), y: Math.round(H / 2 - lm.height - 260), def: { effect: 'pop', start: 0, dur: 0.5 } }];
      if (pr.style === 'bubbles') {
        const family = BUBBLE_FONT_FAMILY[bubbles[0]?.fontId] || BUBBLE_FONT;
        const boxLayer = async (name, text) => {
          const out = path.join(tmp, name), maxW = 860, pad = 36, size = 58, lineH = Math.round(size * 1.2);
          const maxChars = Math.max(8, Math.floor((maxW - 2 * pad) / (0.45 * size)));
          const words = text.split(/\s+/), lines = []; let cur = '';
          for (const w of words) { if (cur && (cur + ' ' + w).length > maxChars) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; }
          if (cur) lines.push(cur);
          const bw = maxW, bh = lines.length * lineH + 2 * pad;   // same width for every box
          const x0 = Math.round((W - bw) / 2);
          await sharp(Buffer.from(`<svg width="${W}" height="${bh + 12}" xmlns="http://www.w3.org/2000/svg"><rect x="${x0 + 6}" y="${6}" width="${bw}" height="${bh}" rx="10" ry="10" fill="#000" opacity="0.25"/><rect x="${x0}" y="0" width="${bw}" height="${bh}" rx="10" ry="10" fill="#FFFFFF" stroke="#000000" stroke-width="5"/>${lines.map((l, i) =>
            `<text x="${W / 2}" y="${pad + i * lineH + size * 0.92}" text-anchor="middle" font-family="${family}, ${BUBBLE_FONT}, Helvetica, sans-serif" font-size="${size}" fill="#111111">${esc(l)}</text>`).join('')}</svg>`)).png().toFile(out);
          return { png: out, w: W, h: bh + 12 };
        };
        let y = Math.round(H / 2 - 200);
        if (pr.line1) { const l = await boxLayer('c1.png', pr.line1); els.push({ key: 'line1', ...l, x: 0, y, def: { effect: 'pop', start: 0.35, dur: 0.4 } }); y += l.h + 40; }
        if (pr.line2) { const l = await boxLayer('c2.png', pr.line2); els.push({ key: 'line2', ...l, x: 0, y, def: { effect: 'pop', start: 0.9, dur: 0.4 } }); }
      } else {
        const fit = (t, base) => Math.min(base, Math.floor((W - 160) / (0.56 * Math.max(1, t.length))));
        const textLayer = async (name, text, size, fill) => {
          const h = Math.round(size * 1.4), out = path.join(tmp, name);
          await sharp(Buffer.from(`<svg width="${W}" height="${h}" xmlns="http://www.w3.org/2000/svg"><text x="${W / 2}" y="${Math.round(size * 1.02)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="800" fill="${fill}">${esc(text)}</text></svg>`)).png().toFile(out);
          return { png: out, w: W, h };
        };
        const s1 = fit(pr.line1, 84), s2 = fit(pr.line2, 84);
        if (pr.line1) els.push({ key: 'line1', ...(await textLayer('c1.png', pr.line1, s1, '#FFFFFF')), x: 0, y: Math.round(H / 2 - 40 - s1 * 1.02), def: { effect: 'slide-up', start: 0.35, dur: 0.45 } });
        if (pr.line2) els.push({ key: 'line2', ...(await textLayer('c2.png', pr.line2, s2, '#FFD23F')), x: 0, y: Math.round(H / 2 + 110 - s2 * 1.02), def: { effect: 'fade', start: 0.9, dur: 0.5 } });
      }
      parts.push(await layeredCardSegment(tmp, 'prompt', els, pr.seconds, {}, run));
    }
    if (en.on) {
      const items = [];
      for (let i = 0; i < bubbles.length; i++) {
        const b = bubbles[i], r = rectOf(b), sen = b.sentences[0];
        const text = String(sen.translation || '').replace(/\[[^\]]*\]/g, '').trim();
        if (en.showText && !text) continue;
        items.push({ r, audio: audioFile(sen.translationAudioUrl), png: en.showText ? await textPng(`en${i}.png`, text, r, b.fontId) : await highlightPng(`enh${i}.png`, r), transient: !en.showText });
      }
      if (items.length) parts.push(await runSegment('english', items, en.gap, en.hold));
    }
    if (parts.length === 0) return res.status(400).json({ error: 'Nothing to build — turn on at least one part' });
    const name = `challenge-${req.body.noSave ? 'check-' : ''}${Date.now()}.mp4`;
    // Overall loudness of the reel's audio (100 = as recorded; ElevenLabs lines are on the quiet side, so 130 by default).
    const volume = num(req.body.volume, 130, 30, 300) / 100;
    await run('ffmpeg', ['-y', ...parts.flatMap(f => ['-i', f]), '-filter_complex', parts.map((_, i) => `[${i}:v][${i}:a]`).join('') + `concat=n=${parts.length}:v=1:a=1[v][a0];[a0]volume=${volume.toFixed(2)},alimiter=limit=0.95[a]`,
      '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', path.join(mdir, name)]);
    // Remember the result (and the settings) on the page so a refresh doesn't lose it
    // (skipped for noSave builds, e.g. checks that must not touch the page's state).
    for (const list of req.body.noSave ? [] : ['pages', 'practicePages', 'reelPages']) {
      const idx = (comic[list] || []).findIndex(pg => pg.id === pageId);
      if (idx >= 0) await Comic.updateOne({ id: comicId }, { $set: { [`${list}.${idx}.reelVideo`]: name, [`${list}.${idx}.reelSettings`]: { spanish: sp, prompt: pr, english: en, volume: Math.round(volume * 100) } } }).catch(() => {});
    }
    res.json({ url: `/projects/${comicId}/marketing/${name}`, file: name, bubbles: bubbles.length });
  } catch (error) {
    console.error('Challenge reel error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

// POST /api/marketing/phone-frame — the reel playing inside a real iPhone 17
// (Apple's official product bezel: assets/iphone17/<colour>.png, screen area
// transparent) on the brand violet (or black / a blurred copy). Body:
// { comicId, file, margin (%), background 'violet'|'black'|'blur', offset (%
// vertical, like inset), phoneColor 'black'|'lavender'|'mist-blue'|'sage'|'white',
// statusBar (bool), fit 'fill'|'fit' }
const IPHONE17 = {
  // Apple's iPhone 17 portrait bezel, measured (all colours share the geometry).
  // `image` is the whole PNG incl. the buttons standing proud of the sides;
  // `body` the phone's outline; `screen` the transparent cut-out (rounded by
  // the bezel itself); `island` the opaque Dynamic Island inside the screen.
  image: { w: 1350, h: 2760 },
  body: { x: 27, y: 26, w: 1296, h: 2708, r: 256 },
  screen: { x: 72, y: 69, w: 1206, h: 2622, r: 215 },
  island: { x: 488, y: 111, w: 374, h: 109 },
  colors: ['black', 'lavender', 'mist-blue', 'sage', 'white'],
};
router.post('/phone-frame', async (req, res) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'phone-'));
  try {
    const { execFile } = require('child_process');
    const run = (cmd, args) => new Promise((resolve, reject) =>
      execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64 }, (err, so, se) => err ? reject(new Error(String(se || err.message).trim().split('\n').slice(-6).join('\n'))) : resolve(so)));
    const { comicId, file } = req.body;
    if (!comicId || !file || !/^[\w.\-]+\.mp4$/.test(file)) return res.status(400).json({ error: 'comicId and a valid file are required' });
    const margin = Math.min(25, Math.max(2, Number(req.body.margin) || 7)) / 100;
    const offset = Math.min(25, Math.max(-25, Number(req.body.offset) || 0)) / 100;
    const background = ['blur', 'black', 'violet'].includes(req.body.background) ? req.body.background : 'violet';
    const phoneColor = IPHONE17.colors.includes(req.body.phoneColor) ? req.body.phoneColor : 'black';
    const bezelFile = path.join(__dirname, '../../assets/iphone17', `${phoneColor}.png`);
    const mdir = path.join(PROJECTS_DIR, comicId, 'marketing');
    // Always frame the original, never an already framed/inset file.
    const original = file.replace(/(-(inset|phone)-\d+)+\.mp4$/, '.mp4');
    const base = original !== file && require('fs').existsSync(path.join(mdir, original)) ? original : file;
    const src = path.join(mdir, base);
    const W = 1080, H = 1920;
    // Scale the bezel so the phone's body fills the frame height minus the margin,
    // then place everything (body, screen, island) in frame pixels.
    const G = IPHONE17;
    const s = (H * (1 - 2 * margin)) / G.body.h;
    const iw = Math.round(G.image.w * s), ih = Math.round(G.image.h * s);
    const ix = Math.round((W - iw) / 2), iy = Math.round((H - ih) / 2 + offset * H);
    const at = (o) => ({ x: ix + Math.round(o.x * s), y: iy + Math.round(o.y * s), w: Math.round(o.w * s / 2) * 2, h: Math.round(o.h * s / 2) * 2, r: Math.round((o.r || 0) * s) });
    const body = at(G.body), scr = at(G.screen), isl = at(G.island);
    const sx = scr.x, sy = scr.y, sw = scr.w, sh = scr.h;
    // The bezel PNG, scaled to the frame.
    const bezelPng = path.join(tmp, 'bezel.png');
    await sharp(bezelFile).resize(iw, ih).png().toFile(bezelPng);
    // Status bar (over the reel, beside the island): 9:41 left; signal, wifi, battery right — white with a soft shadow.
    const statusBar = req.body.statusBar !== false;
    const fsz = Math.round(sw * 0.042), cy = isl.y + isl.h / 2;
    const rx0 = sx + sw - Math.round(sw * 0.075), gap = Math.round(fsz * 0.38);
    const batW = Math.round(fsz * 1.2), batH = Math.round(fsz * 0.58), batX = rx0 - batW - 4, batY = Math.round(cy - batH / 2);
    const battery = `<rect x="${batX}" y="${batY}" width="${batW}" height="${batH}" rx="${Math.round(batH * 0.3)}" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="2"/><rect x="${batX + 3}" y="${batY + 3}" width="${batW - 6}" height="${batH - 6}" rx="${Math.round(batH * 0.18)}" fill="#fff"/><rect x="${batX + batW + 1}" y="${Math.round(cy - batH * 0.18)}" width="3" height="${Math.round(batH * 0.36)}" rx="1.5" fill="#fff" fill-opacity="0.5"/>`;
    const wr = Math.round(fsz * 0.42), wx = batX - gap - wr;
    const wsw = Math.max(2, Math.round(fsz * 0.13));
    const wifi = [1, 0.66, 0.33].map(k => `<path d="M${wx - wr * k},${cy + wr * 0.3 - wr * k * 0.75} a${wr * k},${wr * k} 0 0 1 ${2 * wr * k},0" fill="none" stroke="#fff" stroke-width="${wsw}" stroke-linecap="round"/>`).join('') + `<circle cx="${wx}" cy="${cy + wr * 0.3}" r="${wsw * 0.8}" fill="#fff"/>`;
    const sigH = Math.round(fsz * 0.72), sigW = Math.round(fsz * 0.13), sigStep = Math.round(sigW * 1.7);
    const sigRight = wx - wr - gap;
    const signal = [0.4, 0.6, 0.8, 1].map((k, n) => `<rect x="${sigRight - (4 - n) * sigStep}" y="${cy + sigH / 2 - Math.round(sigH * k)}" width="${sigW}" height="${Math.round(sigH * k)}" rx="1.5" fill="#fff"/>`).join('');
    const status = statusBar ? `<g filter="url(#sh)"><text x="${sx + Math.round(sw * 0.105)}" y="${Math.round(cy + fsz * 0.36)}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="${fsz}" font-weight="700" fill="#fff">9:41</text>${signal}${wifi}${battery}</g>` : '';
    const statusPng = path.join(tmp, 'status.png');
    await sharp(Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><filter id="sh" x="-10%" y="-50%" width="120%" height="200%"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#000" flood-opacity="0.45"/></filter></defs>${status}</svg>`)).png().toFile(statusPng);
    // Shadow: a blurred MASK used as the alpha of a black layer (blurring an RGBA image
    // directly leaves a hard dark box around the transparent edges). Two parts: a soft
    // ambient halo all round the phone, so its sides sit off the background, and a
    // key shadow cast a little down and to the right.
    const shadowPng = path.join(tmp, 'shadow.png');
    const mask = await sharp(Buffer.from(`<svg width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#000"/>
      <rect x="${body.x - 14}" y="${body.y - 10}" width="${body.w + 28}" height="${body.h + 24}" rx="${body.r + 12}" fill="#fff" opacity="0.38"/>
      <rect x="${body.x + 8}" y="${body.y + 26}" width="${body.w}" height="${body.h}" rx="${body.r}" fill="#fff" opacity="0.55"/></svg>`)).blur(22).grayscale().raw().toBuffer({ resolveWithObject: true });
    await sharp({ create: { width: W, height: H, channels: 3, background: '#000000' } }).joinChannel(mask.data, { raw: { width: mask.info.width, height: mask.info.height, channels: 1 } }).png().toFile(shadowPng);
    // Screen: black, rounded like the cut-out (shows as bars above/below in 'fit').
    const screenPng = path.join(tmp, 'screen.png');
    await sharp(Buffer.from(`<svg width="${W}" height="${H}"><rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="${scr.r}" fill="#000"/></svg>`)).png().toFile(screenPng);
    // Mask for the reel: rounded like the screen, so its square corners never poke out past the body's rounded corners.
    const maskPng = path.join(tmp, 'mask.png');
    await sharp(Buffer.from(`<svg width="${sw}" height="${sh}"><rect width="${sw}" height="${sh}" fill="#000"/><rect x="0" y="0" width="${sw}" height="${sh}" rx="${scr.r}" fill="#fff"/></svg>`)).grayscale().png().toFile(maskPng);
    const bgChain = background === 'blur'
      ? `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=30:5,eq=brightness=-0.3:saturation=0.8[bg]`
      : `color=c=${background === 'violet' ? '0x6E40F0' : 'black'}:s=${W}x${H}:r=25[bg]`;
    // 'fit' (default): the WHOLE reel at the screen's width, nothing cropped, with black above
    // and below like a real 9:16 reel on a phone (the iPhone 17 screen is taller than 9:16);
    // 'fill': the reel fills the screen, scaled to its height and cropped at the sides.
    const fit = req.body.fit === 'fill' ? 'fill' : 'fit';
    const fgChain = fit === 'fill'
      ? `[0:v]scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${sw}:${sh}[fg0]`
      : `[0:v]scale=${sw}:${sh}:force_original_aspect_ratio=decrease,pad=${sw}:${sh}:(ow-iw)/2:(oh-ih)/2:color=black[fg0]`;
    // Entrance: the whole phone (shadow, screen, reel, bezel, status bar) is composed on a
    // transparent canvas and swung into place with a per-frame perspective transform —
    // it starts off to the right, turned away (its right edge receding) and a little
    // smaller, then eases flat into its final position. 'none' = just sits there.
    const entrance = req.body.entrance === 'none' ? 'none' : 'swing';
    const entSec = Math.min(4, Math.max(0.3, Number(req.body.entranceSeconds) || 1.2));
    const FPS = 25, F = Math.round(entSec * FPS);
    const E = `(1-pow(1-min(1,in/${F}),3))`;   // ease-out
    // Start corners of the canvas (as fractions of W/H): TL, TR, BL, BR — ends at the identity.
    const start = { x0: 0.42, y0: 0.07, x1: 1.04, y1: 0.17, x2: 0.42, y2: 0.93, x3: 1.04, y3: 0.83 };
    const kx = (k, endW) => `${(start[k] * W).toFixed(1)}+(${endW}-${(start[k] * W).toFixed(1)})*${E}`;
    const ky = (k, endH) => `${(start[k] * H).toFixed(1)}+(${endH}-${(start[k] * H).toFixed(1)})*${E}`;
    const persp = `perspective=x0='${kx('x0', 0)}':y0='${ky('y0', 0)}':x1='${kx('x1', W)}':y1='${ky('y1', 0)}':x2='${kx('x2', 0)}':y2='${ky('y2', H)}':x3='${kx('x3', W)}':y3='${ky('y3', H)}':sense=destination:eval=frame`;
    // Layers, bottom up, into the phone group: shadow, black screen, the reel (rounded), the bezel, the status bar.
    const group = `[3:v]format=rgba[g0];[g0][1:v]overlay=0:0:format=rgb[g1];${fgChain};[4:v]format=gray[mk];[fg0][mk]alphamerge[fg];[g1][fg]overlay=${sx}:${sy}:shortest=1:format=rgb[g2];[g2][2:v]overlay=${ix}:${iy}:format=rgb[g3];[g3][5:v]overlay=0:0:format=rgb[g4]`;
    const phone = entrance === 'swing' ? `[g4]format=yuva444p,${persp},format=rgba[ph]` : `[g4]format=rgba[ph]`;
    const filter = `${bgChain};${group};${phone};[bg][ph]overlay=0:0:format=auto,format=yuv420p[v]`;
    const name = `${base.replace(/\.mp4$/, '')}-phone-${Date.now()}.mp4`;
    await run('ffmpeg', ['-y', '-i', src, '-loop', '1', '-i', screenPng, '-loop', '1', '-i', bezelPng, '-loop', '1', '-i', shadowPng, '-loop', '1', '-i', maskPng, '-loop', '1', '-i', statusPng, '-filter_complex', filter, '-map', '[v]', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-shortest', '-movflags', '+faststart', path.join(mdir, name)]);
    res.json({ url: `/projects/${comicId}/marketing/${name}`, file: name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

// POST /api/marketing/inset — shrink a finished reel inside its 1080x1920
// frame (aspect kept) so Instagram's overlaid controls don't sit on the
// picture. Body: { comicId, file, margin (0–25, % of width each side),
// background: 'blur'|'black'|'violet', bias: 'centre'|'up' }
router.post('/inset', async (req, res) => {
  try {
    const { execFile } = require('child_process');
    const run = (cmd, args) => new Promise((resolve, reject) =>
      execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64 }, (err, so, se) => err ? reject(new Error(String(se || err.message).trim().split('\n').slice(-6).join('\n'))) : resolve(so)));
    const { comicId, file } = req.body;
    if (!comicId || !file || !/^[\w.\-]+\.mp4$/.test(file)) return res.status(400).json({ error: 'comicId and a valid file are required' });
    const margin = Math.min(25, Math.max(0, Number(req.body.margin) || 0)) / 100;
    // Vertical position: 0 = centred; negative moves the picture up, positive
    // down, as a percentage of the frame height (kept inside the frame).
    const offset = Math.min(25, Math.max(-25, Number(req.body.offset) || 0)) / 100;
    const background = ['blur', 'black', 'violet'].includes(req.body.background) ? req.body.background : 'blur';
    // Always work from the original reel: if this file is itself an inset
    // output, go back to the file it was made from so margins don't stack.
    const mdir = path.join(PROJECTS_DIR, comicId, 'marketing');
    const original = file.replace(/(-(inset|phone)-\d+)+\.mp4$/, '.mp4');
    const base = original !== file && require('fs').existsSync(path.join(mdir, original)) ? original : file;
    const src = path.join(mdir, base);
    const name = `${base.replace(/\.mp4$/, '')}-inset-${Date.now()}.mp4`;
    const W = 1080, H = 1920;
    const fw = Math.round(W * (1 - 2 * margin) / 2) * 2;                 // even dims for yuv420p
    const fh = Math.round(H * (1 - 2 * margin) / 2) * 2;
    // Quoted: commas inside min()/max() would otherwise split the overlay options.
    const y = `'min(H-h\\,max(0\\,(H-h)/2+${Math.round(offset * H)}))'`;
    const bgChain = background === 'blur'
      ? `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=30:5,eq=brightness=-0.3:saturation=0.8[bg]`
      : `color=c=${background === 'violet' ? '0x6E40F0' : 'black'}:s=${W}x${H}:r=25[bg]`;
    const filter = `${bgChain};[0:v]scale=${fw}:${fh}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:${y}:shortest=1,setsar=1,format=yuv420p[v]`;
    await run('ffmpeg', ['-y', '-i', src, '-filter_complex', filter, '-map', '[v]', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart',
      path.join(PROJECTS_DIR, comicId, 'marketing', name)]);
    res.json({ url: `/projects/${comicId}/marketing/${name}`, file: name });
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
// from 0.5s with short gaps. Each item may be a bare file token (legacy) or
// { file, es, en, lang } — with `subtitles` set ('es' | 'en' | 'match'),
// the matching text is burned in as a subtitle over each line's exact play
// window (same timeline as the audio delays, so sync is free). Without
// subtitles the video stream is copied untouched.
async function mixVoicesOnto(comicId, videoPath, voiceFiles, ambient, outPath, subtitles = 'none') {
  const { execFile } = require('child_process');
  const run = (cmd, args) => new Promise((resolve, reject) =>
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64 }, (err, so, se) =>
      err ? reject(new Error(String(se || err.message).trim().split('\n').slice(-6).join('\n'))) : resolve(so)));
  const { slug } = await exportImagesDir(comicId);
  const audioDir = path.join(PROJECTS_DIR, comicId, 'export', slug, 'audio');
  const items = voiceFiles.map(v => (typeof v === 'string' ? { file: v } : v));
  const inputs = ['-i', videoPath];
  const parts = [];
  const events = [];
  let at = 0.5;
  for (let i = 0; i < items.length; i++) {
    const f = String(items[i].file || '');
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
    if (subtitles && subtitles !== 'none') {
      const it = items[i];
      const text = subtitles === 'es' ? it.es
        : subtitles === 'en' ? it.en
        : (it.lang === 'en' ? it.en : it.es); // 'match' — the audio's own language
      if (text) events.push({ start: at, end: at + dur + 0.3, text: String(text) });
    }
    at += dur + 0.35;
  }
  const ambVol = ambient === 'mute' ? 0 : ambient === 'duck' ? 0.25 : 1;
  const chains = [`[0:a]volume=${ambVol}[amb]`, ...parts];
  const mixIn = ['[amb]', ...items.map((_, i) => `[v${i}]`)].join('');
  chains.push(`${mixIn}amix=inputs=${items.length + 1}:duration=first:normalize=0[a]`);
  // Subtitles are rendered as sharp/SVG PNGs (same engine as the posters, so
  // no libass/fontconfig dependency) and overlaid with timed enable=between()
  // — bold white with a black outline, sitting well above the bottom so
  // Reels/TikTok UI never covers them.
  const subPngs = [];
  let vChain = '';
  if (events.length) {
    const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0', videoPath]);
    const [Wv, Hv] = probe.trim().split(',').map(Number);
    const fs2 = Math.max(28, Math.round(64 * Wv / 1080));
    const lineH = Math.round(fs2 * 1.3);
    const maxChars = Math.max(10, Math.floor((Wv - Math.round(Wv * 0.08)) / (0.52 * fs2)));
    const escXml = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const wrap = t => {
      const words = String(t).replace(/\s+/g, ' ').trim().split(' ');
      const lines = [];
      let cur = '';
      for (const w of words) {
        if (cur && (cur + ' ' + w).length > maxChars) { lines.push(cur); cur = w; }
        else cur = cur ? `${cur} ${w}` : w;
      }
      if (cur) lines.push(cur);
      return lines;
    };
    for (let j = 0; j < events.length; j++) {
      const lines = wrap(events[j].text);
      const ph = lines.length * lineH + Math.round(fs2 * 0.5);
      const svg = `<svg width="${Wv}" height="${ph}" xmlns="http://www.w3.org/2000/svg">${lines.map((l, k) =>
        `<text x="${Wv / 2}" y="${Math.round((k + 0.85) * lineH)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${fs2}" font-weight="800" fill="#FFFFFF" stroke="#000000" stroke-width="${Math.max(4, Math.round(fs2 / 9))}" paint-order="stroke" stroke-linejoin="round">${escXml(l)}</text>`).join('')}</svg>`;
      const png = `${outPath}.sub${j}.png`;
      await sharp(Buffer.from(svg)).png().toFile(png);
      subPngs.push(png);
      inputs.push('-i', png);
    }
    const bottom = Math.round(380 * Hv / 1920);
    let prev = '[0:v]';
    for (let j = 0; j < events.length; j++) {
      const outLbl = j === events.length - 1 ? '[vout]' : `[sv${j}]`;
      chains.push(`${prev}[${items.length + 1 + j}:v]overlay=(main_w-overlay_w)/2:main_h-overlay_h-${bottom}:enable='between(t,${events[j].start.toFixed(2)},${events[j].end.toFixed(2)})'${outLbl}`);
      prev = outLbl;
    }
    vChain = '[vout]';
  }
  const args = ['-y', ...inputs, '-filter_complex', chains.join(';'),
    '-map', vChain || '0:v', '-map', '[a]'];
  if (vChain) args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p');
  else args.push('-c:v', 'copy');
  args.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outPath);
  try { await run('ffmpeg', args); }
  finally { for (const p of subPngs) fs.unlink(p).catch(() => {}); }
}

// Append the branded finish to a clip: optional violet question card (2s)
// then the logo end card (1.8s) — turns a raw generation into a Reel that
// signs off as Comigo. Re-encodes to a uniform 1080x1920/25fps for concat.
// Violet page on which every published comic's cover pops in, left to right,
// top to bottom, then holds. Grid picks the largest tiles that fit.
// Violet card whose layers (PNG elements with x/y and a default entrance) each
// enter with their own effect/start/duration — shared by the opening and
// sign-off cards. `anim` overrides per element key.
async function layeredCardSegment(tmp, name, elements, dur, anim, run) {
  const W = 1080, H = 1920, FPS = 25;
  const args = ['-y', '-f', 'lavfi', '-t', String(dur), '-i', `color=c=0x6E40F0:s=${W}x${H}:r=${FPS}`,
    '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo'];
  const chain = [];
  let cur = '[0:v]';
  elements.forEach((el, k) => {
    const idx = 2 + k;
    args.push('-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', el.png);
    const cfg = { ...el.def, ...(anim[el.key] || {}) };
    const S = Math.min(dur - 0.05, Math.max(0, Number(cfg.start) || 0)).toFixed(2);
    const D = Math.max(0.05, Math.min(dur, Number(cfg.dur) || 0.4)).toFixed(2);
    const P = `min(1,max(0,(t-${S})/${D}))`, E = `(1-pow(1-${P},3))`;
    const effect = ['none', 'fade', 'pop', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'typewriter'].includes(cfg.effect) ? cfg.effect : 'fade';
    let pre = `[${idx}:v]format=rgba`;
    let x = String(el.x), y = String(el.y);
    if (effect === 'fade') pre += `,fade=t=in:st=${S}:d=${D}:alpha=1`;
    else if (effect === 'pop') { pre += `,scale=w='iw*(0.35+0.65*${E})':h=-1:eval=frame,fade=t=in:st=${S}:d=${(D * 0.6).toFixed(2)}:alpha=1`; x = `(W-w)/2`; y = `${el.y}+(${el.h}-h)/2`; }
    else if (effect === 'slide-up') { pre += `,fade=t=in:st=${S}:d=${D}:alpha=1`; y = `${el.y}+(1-${E})*260`; }
    else if (effect === 'slide-down') { pre += `,fade=t=in:st=${S}:d=${D}:alpha=1`; y = `${el.y}-(1-${E})*260`; }
    else if (effect === 'slide-left') { pre += `,fade=t=in:st=${S}:d=${D}:alpha=1`; x = `${el.x}+(1-${E})*380`; }
    else if (effect === 'slide-right') { pre += `,fade=t=in:st=${S}:d=${D}:alpha=1`; x = `${el.x}-(1-${E})*380`; }
    else if (effect === 'typewriter') {
      // Reveal left→right by masking alpha (frame size stays constant).
      const Et = E.replace(/\bt\b/g, 'T');   // geq exposes time as T
      pre += `,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(X,W*${Et}),alpha(X,Y),0)'`;
    }
    chain.push(`${pre}[e${k}]`);
    const out = k === elements.length - 1 ? '[vend]' : `[c${k}]`;
    chain.push(`${cur}[e${k}]overlay=x='${x}':y='${y}':enable='gte(t,${S})':format=auto${out}`);
    cur = out;
  });
  chain.push(`${cur}format=yuv420p,setsar=1[v]`);
  const seg = path.join(tmp, `${name}.mp4`);
  await run('ffmpeg', [...args, '-filter_complex', chain.join(';'), '-map', '[v]', '-map', '1:a', '-t', String(dur),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-ar', '44100', '-ac', '2', seg]);
  return seg;
}

async function coversMosaicSegment(tmp, dur, run) {
  const W = 1080, H = 1920, FPS = 25;
  const fsSync = require('fs');
  const bySeries = (a, b) => String(a.collectionId || '').localeCompare(String(b.collectionId || '')) || (a.episodeNumber || 0) - (b.episodeNumber || 0);
  // Prefer the baked cover (title bubble on the art); fall back to the plain art.
  const coverFile = c => {
    for (const key of ['bakedImage', 'image']) {
      const v = c.cover?.[key]; if (!v) continue;
      const f = path.join(PROJECTS_DIR, String(v).replace(/^\/projects\//, ''));
      if (fsSync.existsSync(f)) return f;
    }
    return null;
  };
  const all = await Comic.find({}, { id: 1, 'cover.image': 1, 'cover.bakedImage': 1, collectionId: 1, episodeNumber: 1, published: 1 }).lean();
  const withCover = all.map(c => ({ ...c, file: coverFile(c) })).filter(c => c.file && fsSync.existsSync(c.file)).sort(bySeries);
  const files = withCover.filter(c => c.published).map(c => c.file);
  const N = files.length;
  if (N === 0) return null;
  const margin = 48, gap = 14;
  let cols = 3, tw = 0, th = 0, rows = 0;
  for (cols = 3; cols <= 8; cols++) {
    rows = Math.ceil(N / cols);
    tw = Math.floor((W - 2 * margin - (cols - 1) * gap) / cols); th = Math.round(tw * 1.5);
    if (rows * th + (rows - 1) * gap <= H - 2 * margin) break;
  }
  // Fill the last row's empty cells with unpublished covers so the page is complete.
  for (const c of withCover.filter(c => !c.published)) { if (files.length >= cols * rows) break; files.push(c.file); }
  const gridW = cols * tw + (cols - 1) * gap, gridH = rows * th + (rows - 1) * gap;
  const x0 = Math.round((W - gridW) / 2), y0 = Math.round((H - gridH) / 2);
  const mask = Buffer.from(`<svg width="${tw}" height="${th}"><rect x="0" y="0" width="${tw}" height="${th}" rx="14" ry="14" fill="#fff"/></svg>`);
  const tiles = [];
  for (let i = 0; i < files.length; i++) {
    const out = path.join(tmp, `cover${i}.png`);
    await sharp(files[i]).resize(tw, th, { fit: 'cover' }).composite([{ input: mask, blend: 'dest-in' }]).png().toFile(out);
    tiles.push({ png: out, x: x0 + (i % cols) * (tw + gap), y: y0 + Math.floor(i / cols) * (th + gap) });
  }
  // Timing: first tile at 0.15s, all in with at least ~1s of hold at the end.
  const step = Math.max(0.03, Math.min(0.14, (dur - 1.2) / files.length));
  const args = ['-y', '-f', 'lavfi', '-t', String(dur), '-i', `color=c=0x6E40F0:s=${W}x${H}:r=${FPS}`,
    '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo'];
  const chain = []; let cur = '[0:v]';
  tiles.forEach((t, k) => {
    args.push('-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', t.png);
    const S = (0.15 + k * step).toFixed(3), D = '0.18';
    const P = `min(1,max(0,(t-${S})/${D}))`, E = `(1-pow(1-${P},3))`;
    chain.push(`[${2 + k}:v]format=rgba,scale=w='iw*(0.5+0.5*${E})':h=-1:eval=frame,fade=t=in:st=${S}:d=0.1:alpha=1[t${k}]`);
    const out = k === tiles.length - 1 ? '[vm]' : `[m${k}]`;
    chain.push(`${cur}[t${k}]overlay=x='${t.x}+(${tw}-w)/2':y='${t.y}+(${th}-h)/2':enable='gte(t,${S})':format=auto${out}`);
    cur = out;
  });
  chain.push(`${cur}format=yuv420p,setsar=1[v]`);
  const seg = path.join(tmp, 'covers.mp4');
  await run('ffmpeg', [...args, '-filter_complex', chain.join(';'), '-map', '[v]', '-map', '1:a', '-t', String(dur),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-ar', '44100', '-ac', '2', seg]);
  return seg;
}

async function finishClip(comicId, videoPath, question, outPath, secs = {}) {
  const { questionSec = 2.0, endSec = 1.8, endCaption = '', midCaption = '',
          openingLine1 = '', openingLine2 = '', openingSec = 2.0, endAnim = {} } = secs;
  const { execFile } = require('child_process');
  const os = require('os');
  const run = (cmd, args) => new Promise((resolve, reject) =>
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64 }, (err, so, se) =>
      err ? reject(new Error(String(se || err.message).trim().split('\n').slice(-6).join('\n'))) : resolve(so)));
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'finish-'));
  try {
    const W = 1080, H = 1920, FPS = 25;
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const cards = [];
    if (question) {
      const fitQ = Math.min(88, Math.floor((W - 260) / (0.56 * String(question).length)));
      const qp = path.join(tmp, 'q.png');
      await sharp({ create: { width: W, height: H, channels: 4, background: VIOLET } })
        .composite([{ input: Buffer.from(`<svg width="${W}" height="${H}"><text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${fitQ}" font-weight="800" fill="#FFD23F">${esc(question)}</text></svg>`), left: 0, top: 0 }])
        .flatten({ background: VIOLET }).png().toFile(qp);
      cards.push([qp, questionSec]);
    }
    // Sign-off card as LAYERS (logo, tagline, yellow caption, comigo.net,
    // bottom caption), each with its own entrance — effect, start, duration —
    // so the card can have some life without touching the art elsewhere.
    const textPng = async (name, text, size, fill, weight = 700, opts = {}) => {
      const out = path.join(tmp, name);
      const family = opts.display ? DISPLAY_FONT : 'Helvetica, Arial, sans-serif';
      const textSvg = `<text x="${W / 2}" y="${Math.round(size * 1.02)}" text-anchor="middle" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(text)}</text>`;
      let h = Math.round(size * 1.4), squiggle = '';
      if (opts.squiggle) {
        // Hand-drawn yellow underline, the landing screen's squiggle (path in a
        // 240x10 box), stretched to the rendered width of the text.
        const probe = await sharp(Buffer.from(`<svg width="${W}" height="${h}" xmlns="http://www.w3.org/2000/svg">${textSvg}</svg>`)).png().trim().toBuffer({ resolveWithObject: true });
        const tw = probe.info.width + 8, sh = Math.round(tw * 0.03), sy = h + 2;
        const sx = tw / 240, x0 = (W - tw) / 2, k = sh / 10;
        const pt = (x, y) => `${(x0 + x * sx).toFixed(1)} ${(sy + y * k).toFixed(1)}`;
        squiggle = `<path d="M${pt(2, 5)} Q${pt(41, 1)} ${pt(80, 5)} Q${pt(120, 9)} ${pt(160, 5)} Q${pt(199, 1)} ${pt(238, 5)}" fill="none" stroke="#FFD23F" stroke-width="${Math.round(tw * 0.014)}" stroke-linecap="round"/>`;
        h += sh + 16;
      }
      await sharp(Buffer.from(`<svg width="${W}" height="${h}" xmlns="http://www.w3.org/2000/svg">${textSvg}${squiggle}</svg>`)).png().toFile(out);
      return { png: out, w: W, h };
    };
    // The squiggle alone, sized to a line of text, as its own layer (so it can
    // be drawn on screen with the typewriter entrance). Place it at
    // baseline + 0.38*size, i.e. just under the text.
    const squigglePng = async (name, text, size, weight = 800) => {
      const out = path.join(tmp, name);
      const textSvg = `<text x="${W / 2}" y="${Math.round(size * 1.02)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="#fff">${esc(text)}</text>`;
      const probe = await sharp(Buffer.from(`<svg width="${W}" height="${Math.round(size * 1.4)}" xmlns="http://www.w3.org/2000/svg">${textSvg}</svg>`)).png().trim().toBuffer({ resolveWithObject: true });
      const tw = probe.info.width + 8, sh = Math.round(tw * 0.03), sw = Math.round(tw * 0.014);
      const h = sh + sw * 2, sy = sw;
      const sx = tw / 240, x0 = (W - tw) / 2, k = sh / 10;
      const pt = (x, y) => `${(x0 + x * sx).toFixed(1)} ${(sy + y * k).toFixed(1)}`;
      await sharp(Buffer.from(`<svg width="${W}" height="${h}" xmlns="http://www.w3.org/2000/svg"><path d="M${pt(2, 5)} Q${pt(41, 1)} ${pt(80, 5)} Q${pt(120, 9)} ${pt(160, 5)} Q${pt(199, 1)} ${pt(238, 5)}" fill="none" stroke="#FFD23F" stroke-width="${sw}" stroke-linecap="round"/></svg>`)).png().toFile(out);
      return { png: out, w: W, h };
    };
    const logo = await sharp(LOGO_PATH).resize({ width: 640 }).png().toBuffer();
    const lm = await sharp(logo).metadata();
    const logoPng = path.join(tmp, 'logo.png');
    await fs.writeFile(logoPng, logo);
    const midSize = midCaption ? Math.min(64, Math.floor((W - 260) / (0.56 * midCaption.length))) : 0;
    const endElements = [
      { key: 'logo', png: logoPng, w: lm.width, h: lm.height, x: Math.round((W - lm.width) / 2), y: Math.round(H / 2 - lm.height - 80), def: { effect: 'pop', start: 0, dur: 0.5 } },
      { key: 'tagline', ...(await textPng('t1.png', 'Interactive Comics', 72, '#FFFFFF', 700, { squiggle: true })), x: 0, y: Math.round(H / 2 + 130 - 72 * 1.02), def: { effect: 'fade', start: 0.35, dur: 0.4 } },
      ...(midCaption ? [{ key: 'caption', ...(await textPng('t2.png', midCaption, midSize, '#FFD23F')), x: 0, y: Math.round(H / 2 + 250 - midSize * 1.02), def: { effect: 'slide-up', start: 0.6, dur: 0.45 } }] : []),
      { key: 'net', ...(await textPng('t3.png', 'comigo.net', 104, '#FFFFFF', 400, { display: true })), x: 0, y: Math.round(H / 2 + 420 - 104 * 1.02), def: { effect: 'fade', start: 0.9, dur: 0.5 } },
    ];
    if (endCaption) {
      const fsC = 68, lineHC = Math.round(fsC * 1.3);
      const maxC = Math.floor((W - 280) / (0.52 * fsC));
      const words = endCaption.replace(/\s+/g, ' ').trim().split(' ');
      const lines = []; let cur = '';
      for (const w of words) { if (cur && (cur + ' ' + w).length > maxC) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; }
      if (cur) lines.push(cur);
      const capPng = path.join(tmp, 'cap.png');
      const capH = lines.length * lineHC + 20;
      await sharp(Buffer.from(`<svg width="${W}" height="${capH}" xmlns="http://www.w3.org/2000/svg">${lines.map((l, k) =>
        `<text x="${W / 2}" y="${Math.round((k + 0.85) * lineHC)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${fsC}" font-weight="700" fill="#FFD23F">${esc(l)}</text>`).join('')}</svg>`)).png().toFile(capPng);
      endElements.push({ key: 'bottom', png: capPng, w: W, h: capH, x: 0, y: Math.round(H / 2 + 560), def: { effect: 'fade', start: Math.max(0, endSec - 2), dur: 0.4 } });
    }
    const endCardSpec = { elements: endElements, dur: endSec };

    const parts = [];
    // Optional opening title card (violet; white line 1 + yellow line 2, same
    // language as the poster) shown BEFORE the clip — the hook that earns the
    // watch. Text auto-shrinks so long lines never clip.
    if (openingLine1 || openingLine2) {
      const fitO = (t, base) => Math.min(base, Math.floor((W - 260) / (0.56 * Math.max(1, String(t).length))));
      // Same look as the sign-off card: violet, the Comigo bubble logo, then the
      // two lines underneath (white hook, yellow question) — each layer animated.
      const oLogo = await sharp(LOGO_PATH).resize({ width: 560 }).png().toBuffer();
      const olm = await sharp(oLogo).metadata();
      const oLogoPng = path.join(tmp, 'ologo.png');
      await fs.writeFile(oLogoPng, oLogo);
      const s1 = fitO(openingLine1, 84), s2 = fitO(openingLine2, 96);
      const openElements = [
        { key: 'logo', png: oLogoPng, w: olm.width, h: olm.height, x: Math.round((W - olm.width) / 2), y: Math.round(H / 2 - olm.height - 120), def: { effect: 'pop', start: 0, dur: 0.5 } },
        ...(openingLine1 ? [
          { key: 'line1', ...(await textPng('o1.png', openingLine1, s1, '#FFFFFF', 800)), x: 0, y: Math.round(H / 2 + 60 - s1 * 1.02), def: { effect: 'slide-up', start: 0.35, dur: 0.45 } },
          // Yellow squiggle under line 1, drawn on left to right.
          { key: 'squiggle', ...(await squigglePng('osq.png', openingLine1, s1)), x: 0, y: Math.round(H / 2 + 60 + s1 * 0.38), def: { effect: 'typewriter', start: 0.75, dur: 0.9 } },
        ] : []),
        ...(openingLine2 ? [{ key: 'line2', ...(await textPng('o2.png', openingLine2, s2, '#FFD23F', 800)), x: 0, y: Math.round(H / 2 + (openingLine1 ? 300 : 80) - s2 * 1.02), def: { effect: 'fade', start: 1.6, dur: 0.5 } }] : []),
      ];
      // With a hold set, the card lasts until its last entrance has finished plus the hold.
      const oAnim = secs.openingAnim || {};
      const animEnd = Math.max(...openElements.map(el => { const c = { ...el.def, ...(oAnim[el.key] || {}) }; return (Number(c.start) || 0) + (Number(c.dur) || 0.4); }));
      const oDur = secs.openingHold > 0 ? Math.max(openingSec, animEnd + secs.openingHold) : openingSec;
      parts.push(await layeredCardSegment(tmp, 'open', openElements, oDur, oAnim, run));
    }
    const main = path.join(tmp, 'main.mp4');
    // After an opening card, the clip fades in quickly rather than cutting hard.
    const mainFade = (openingLine1 || openingLine2) ? ',fade=t=in:st=0:d=0.35:color=0x6E40F0' : '';
    await run('ffmpeg', ['-y', '-i', videoPath,
      '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=${FPS},setsar=1${mainFade}`,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '44100', '-ac', '2', main]);
    parts.push(main);
    for (let i = 0; i < cards.length; i++) {
      const [png, dur, cap] = cards[i];
      const seg = path.join(tmp, `card${i}.mp4`);
      const args = ['-y', '-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', png];
      if (cap) args.push('-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', cap);
      args.push('-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo');
      if (cap) {
        const showAt = Math.max(0, dur - 2).toFixed(2);
        args.push('-filter_complex',
          `[0:v]scale=${W}:${H},setsar=1[b];[b][1:v]overlay=(main_w-overlay_w)/2:${Math.round(H / 2 + 560)}:enable='gte(t,${showAt})'[v]`,
          '-map', '[v]', '-map', '2:a');
      } else {
        args.push('-vf', `scale=${W}:${H},setsar=1`);
      }
      args.push('-t', String(dur), '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-ar', '44100', '-ac', '2', seg);
      await run('ffmpeg', args);
      parts.push(seg);
    }
    // Covers mosaic: every published comic's cover tiles in, one after another,
    // across a violet page — shown just before the sign-off card.
    if (secs.coversCard) {
      const seg = await coversMosaicSegment(tmp, secs.coversSec, run);
      if (seg) parts.push(seg);
    }
    // Animated sign-off card: violet base + each layer entering with its effect.
    parts.push(await layeredCardSegment(tmp, 'endcard', endCardSpec.elements, endCardSpec.dur, endAnim, run));
    const inputs = parts.flatMap(f => ['-i', f]);
    const filter = parts.map((_, i) => `[${i}:v][${i}:a]`).join('') + `concat=n=${parts.length}:v=1:a=1[v][a]`;
    await run('ffmpeg', ['-y', ...inputs, '-filter_complex', filter, '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outPath]);
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// User-dictated card lengths (seconds, clamped 0.5–10).
const cardSecs = body => ({
  questionSec: Math.min(10, Math.max(0.5, Number(body.questionSeconds) || 2)),
  endSec: Math.min(30, Math.max(0.5, Number(body.endCardSeconds) || 1.8)),
  endCaption: String(body.endCardCaption || '').trim().slice(0, 200),
  midCaption: String(body.endCardMidCaption || '').trim().slice(0, 120),
  openingLine1: String(body.openingLine1 || '').trim().slice(0, 80),
  openingLine2: String(body.openingLine2 || '').trim().slice(0, 80),
  openingSec: Math.min(10, Math.max(0.5, Number(body.openingSeconds) || 2)),
  // pause on the finished opening card AFTER its animation has ended (0 = just use openingSec)
  openingHold: Math.min(15, Math.max(0, Number(body.openingHold) || 0)),
  coversCard: body.coversCard === true,
  coversSec: Math.min(15, Math.max(1, Number(body.coversSeconds) || 3.5)),
  endAnim: parseAnim(body.endAnim, ['logo', 'tagline', 'caption', 'net', 'bottom']),
  openingAnim: parseAnim(body.openingAnim, ['logo', 'line1', 'squiggle', 'line2']),
});
// Per-element entrance settings ({ effect, start, dur }) for a layered card.
function parseAnim(src, keys) {
  const out = {}; src = src && typeof src === 'object' ? src : {};
  for (const k of keys) {
    const v = src[k]; if (!v || typeof v !== 'object') continue;
    out[k] = { effect: String(v.effect || 'fade'), start: Number(v.start) || 0, dur: Number(v.dur) || 0.4 };
  }
  return out;
}
const hasOpening = body => !!(String(body.openingLine1 || '').trim() || String(body.openingLine2 || '').trim());

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
    if (voiceAudio.length === 0 && ambient === 'keep' && !question && !endCard && !hasOpening(req.body)) return res.status(400).json({ error: 'Nothing to change' });
    let cur = src;
    if (voiceAudio.length > 0 || ambient !== 'keep') { await mixVoicesOnto(comicId, src, voiceAudio, ambient, out, req.body.subtitles || 'none'); cur = out; }
    if (question || endCard || hasOpening(req.body)) {
      const fin = out.replace(/\.mp4$/, '-fin.mp4');
      await finishClip(comicId, cur, question, fin, cardSecs(req.body));
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
    const dir = await exportDirOrNull(comicId);

    const refs = [];
    for (const f of imageFiles) {
      // A ref may be: a file from this comic's export; "upload:<name>" (your own
      // image, via /marketing/upload-image); or "comic:<otherComicId>:<file>"
      // (a page/panel from another comic — reels can mix stories).
      const p = await resolveRefImage(comicId, dir, f);
      // Veo refs don't need full-res: cap at 1024px to keep the request light.
      const buf = await sharp(p).resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
      refs.push({ image: { imageBytes: buf.toString('base64'), mimeType: 'image/jpeg' } });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    // Veo 3.1 accepts 4, 6 or 8 second generations.
    const durationSeconds = [4, 6, 8].includes(Number(req.body.durationSeconds)) ? Number(req.body.durationSeconds) : null;
    // Ask Veo for 1080p so the 9:16 output is native 1080x1920 rather than
    // 720x1280 upscaled by finishClip (Instagram/TikTok re-encode less harshly).
    const resolution = req.body.resolution === '1080p' ? '1080p' : '720p';
    const baseConfig = () => ({ aspectRatio, numberOfVideos: 1, ...(resolution === '1080p' ? { resolution } : {}), ...(durationSeconds ? { durationSeconds } : {}) });
    // Comic style lock (default on): Veo drifts towards live-action unless told,
    // in no uncertain terms, that the references define the rendering — not
    // just the subject. Prepended to the prompt and folded into the negatives.
    const styleLock = req.body.styleLock === true;   // opt-in; default request is exactly the pre-2026-09-16 one
    const basePrompt = styleLock ? `${VEO_STYLE_LOCK}\n\n${prompt}` : prompt;
    const userNegative = req.body.negativePrompt ? String(req.body.negativePrompt) : '';
    const negative = styleLock ? [userNegative, VEO_STYLE_NEGATIVE].filter(Boolean).join(', ') : userNegative;
    const request = { model: tier, prompt: basePrompt, config: baseConfig() };
    if (negative) request.config.negativePrompt = negative;
    // 'refs' = style references (Veo repaints); 'frames' = exact start/end:
    // image is the first frame, config.lastFrame the last — Veo animates
    // between them, so _no_text frames guarantee bubble-free endpoints.
    const mode = req.body.mode === 'frames' ? 'frames' : 'refs';
    if (mode === 'frames') {
      if (refs.length < 1) return res.status(400).json({ error: 'frames mode needs 1-2 images (start[, end])' });
      request.image = refs[0].image;
      if (refs[1]) request.config.lastFrame = refs[1].image;
    } else if (refs.length) {
      request.config.referenceImages = refs;
    }

    let op;
    // Some Veo tiers/modes reject `resolution`; drop it and retry rather than fail.
    const attempt = async r => {
      try { return await ai.models.generateVideos(r); }
      catch (e) {
        if (r.config?.resolution && /resolution/i.test(e.message)) {
          console.warn('[veo] resolution rejected, retrying without it');
          const { resolution, ...cfg } = r.config;
          return ai.models.generateVideos({ ...r, config: cfg });
        }
        throw e;
      }
    };
    try {
      op = await attempt(request);
    } catch (e) {
      // Veo 3.1 rejects negativePrompt in some modes ("not supported in your
      // use case") — fold the avoid-list into the prose prompt and retry.
      if (negative && /negative prompt/i.test(e.message)) {
        console.warn('[veo] negativePrompt rejected, folding into prompt');
        delete request.config.negativePrompt;
        request.prompt = `${basePrompt}\n\nStrictly avoid, do not include under any circumstances: ${negative}.`;
        try {
          op = await attempt(request);
        } catch (e2) {
          if (refs.length && /reference/i.test(e2.message)) {
            console.warn('[veo] referenceImages also rejected, retrying as first-frame:', e2.message);
            op = await attempt({ model: tier, prompt: request.prompt, image: refs[0].image, config: baseConfig() });
          } else throw e2;
        }
      } else if (refs.length && /reference/i.test(e.message)) {
        // Some tiers reject referenceImages — retry with the first image as
        // the starting frame instead, which every tier supports.
        console.warn('[veo] referenceImages rejected, retrying as first-frame:', e.message);
        op = await attempt({ model: tier, prompt: basePrompt, image: refs[0].image, config: baseConfig() });
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
    // Sidecar: Veo's own handle on this video, so it can be EXTENDED later
    // (POST /veo-extend) instead of regenerated from scratch.
    await fs.writeFile(path.join(outDir, `${name}.veo.json`), JSON.stringify({ video: vids[0].video, model: tier, prompt: basePrompt, resolution, createdAt: new Date().toISOString() }));
    name = await postProcessClip(comicId, outDir, name, req.body);
    res.json({ url: `/projects/${comicId}/marketing/${name}`, file: name, model: tier });
  } catch (error) {
    console.error('Veo clip error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Resolve a reel reference-image token to a path on disk (see veo-clip).
async function resolveRefImage(comicId, exportDir, f) {
  const s = String(f || '');
  const m = s.match(/^comic:([\w\-]+):(.+)$/);
  if (m) {
    if (!/^[\w.\-áéíóúñü]+$/i.test(m[2])) throw new Error('Bad image filename');
    const { dir } = await exportImagesDir(m[1]);
    return path.join(dir, m[2]);
  }
  return resolveSlideImage(comicId, exportDir, s);
}

// Resolve a slide image token: plain name = comic export image; "gen:<name>"
// = an AI-generated still in the comic's marketing folder.
function resolveSlideImage(comicId, exportDir, f) {
  const s = String(f || '');
  // "ref:<server path>" = a style-sheet / character / location reference image
  // (prompt settings) — any image the generator itself serves under /projects
  // or /uploads. No path tricks.
  if (s.startsWith('ref:')) {
    const rel = s.slice(4);
    if (!/^\/(projects|uploads)\/[\w\-./ ]+$/.test(rel) || rel.includes('..')) throw new Error('Bad reference image path');
    return path.join(__dirname, '../..', rel);
  }
  if (s.startsWith('gen:')) {
    const n = s.slice(4);
    if (!/^[\w.\-]+$/i.test(n)) throw new Error('Bad generated image name');
    return path.join(PROJECTS_DIR, comicId, 'marketing', n);
  }
  if (s.startsWith('upload:')) {
    const n = s.slice(7);
    if (!/^[\w.\-]+$/i.test(n)) throw new Error('Bad uploaded image name');
    return path.join(PROJECTS_DIR, comicId, 'marketing', 'uploads', n);
  }
  if (!/^[\w.\-áéíóúñü]+$/i.test(s)) throw new Error('Bad image filename');
  if (!exportDir) throw new Error('This comic has not been exported yet — export it, or use style/generated/uploaded images');
  return path.join(exportDir, s);
}

// Export images dir, or null when the comic was never exported (token images
// — ref:/gen:/upload:/comic: — don't need one).
async function exportDirOrNull(comicId) {
  try { return (await exportImagesDir(comicId)).dir; } catch { return null; }
}

// POST /api/marketing/carousel-image — generate a NEW still for a carousel
// slide with the comic image model (OPENAI_IMAGE_MODEL): reference image(s) from the
// comic + the user's prompt — the clips principle, for stills.
// Body: { comicId, prompt, refImageFiles?: [..max 3], size? }
router.post('/carousel-image', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: 'OpenAI API key not configured' });
    const { comicId, prompt, refImageFiles = [] } = req.body;
    const size = ['1024x1024', '1024x1536', '1536x1024'].includes(req.body.size) ? req.body.size : '1024x1536';
    if (!comicId || !prompt) return res.status(400).json({ error: 'comicId and prompt are required' });
    if (refImageFiles.length > 3) return res.status(400).json({ error: 'Max 3 reference images' });
    const dir = await exportDirOrNull(comicId);
    const { toFile } = require('openai');
    const mimeOf = p => (/\.png$/i.test(p) ? 'image/png' : /\.webp$/i.test(p) ? 'image/webp' : 'image/jpeg');
    const streams = await Promise.all(refImageFiles.map(async f => {
      const p = resolveSlideImage(comicId, dir, f);
      return toFile(require('fs').createReadStream(p), path.basename(p), { type: mimeOf(p) });
    }));
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const guard = 'Do not include any speech bubbles, captions, panel borders, or text unless the prompt explicitly asks for them. '
      + 'Render with clean, smooth, coherent painted shading: NO stipple, NO speckle, NO crackle or mottled noise texture, NO film grain, NO heavy uniform cross-hatching over surfaces. Surfaces should read flat and painterly, with texture only where the scene truly calls for it. '
      + 'Ration the detail: fine detail belongs only on the main subject and foreground; backgrounds and distant elements stay loose, soft and atmospheric — hazy silhouettes rather than micro-detail, no fields of tiny windows or repeated micro-patterns. ';
    let response;
    if (streams.length) {
      const refInstructions = `IMPORTANT: The attached image(s) are STYLE, CHARACTER and SCENE REFERENCES from this comic. Match their art style, characters and world exactly, but compose the NEW image described below — do not copy a reference's layout. ${guard}\n\n`;
      response = await openai.images.edit({ model: OPENAI_IMAGE_MODEL, image: streams, prompt: refInstructions + String(prompt), n: 1, size, quality: 'high' });
    } else {
      response = await openai.images.generate({ model: OPENAI_IMAGE_MODEL, prompt: guard + String(prompt), n: 1, size, quality: 'high' });
    }
    const d = response.data[0];
    const buffer = d.b64_json ? Buffer.from(d.b64_json, 'base64') : Buffer.from(await (await fetch(d.url)).arrayBuffer());
    const outDir = path.join(PROJECTS_DIR, comicId, 'marketing');
    await fs.mkdir(outDir, { recursive: true });
    const name = `gen-${Date.now()}.png`;
    await fs.writeFile(path.join(outDir, name), buffer);
    res.json({ file: `gen:${name}`, url: `/projects/${comicId}/marketing/${name}` });
  } catch (error) {
    console.error('Carousel image error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/marketing/carousel-suggest — GPT drafts the carousel's text from
// the ref images the user selected (it SEES them, poster-style grounding in
// the comic's real dialogue). Body: { comicId, slides: [{imageFile?}] } →
// { slides: [{title, es, en}] } matching the input order, every field
// optional/empty where the story grammar calls for silence.
router.post('/carousel-suggest', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: 'OpenAI API key not configured' });
    const { comicId, slides = [] } = req.body;
    if (!comicId || !Array.isArray(slides) || slides.length < 1) return res.status(400).json({ error: 'comicId and slides are required' });
    if (slides.length > 9) return res.status(400).json({ error: 'Max 9 slides' });
    const ctx = await comicContext(comicId);
    const { dir } = await exportImagesDir(comicId);
    const content = [{
      type: 'text',
      text: `You write "Story Hook" carousel text for Comigo — original Spanish comics for language learners. A carousel is a tiny story the viewer swipes through: a 15-second comic trailer.
Comic: "${ctx.title}" (series: ${ctx.collection}). About: ${ctx.description}
Real dialogue from the comic (Spanish, in order): ${ctx.dialogue}

I will show you ${slides.length} slide images in posting order. For EACH slide return an object { "title": "...", "es": "...", "en": "..." }:
- Slide 1: "title" only — an English hook that sets the scene and asks an implicit question (max 60 chars, no full stop needed). Leave es/en empty.
- Middle slides: "es" = ONE short Spanish line, strongly preferred VERBATIM from the real dialogue above, matching what the image shows; "en" = its short natural English translation. Leave title empty.
- The last slide you are given (if more than 2): pure atmosphere — "es" only (a name, a place, or a 2-4 word beat; can come from the dialogue), NO "en", no title.
- A slide marked [no image] is a text beat: give it a single dramatic English "title" (max 30 chars, e.g. "Why?"). Leave es/en empty.
Rules: intrigue without spoiling; never mention learning Spanish, apps, or downloading; no exclamation marks; no emojis.
Return ONLY a JSON array of ${slides.length} objects in slide order.`,
    }];
    for (let i = 0; i < slides.length; i++) {
      const f = slides[i]?.imageFile;
      let refPath = null;
      try { if (f) refPath = resolveSlideImage(comicId, dir, f); } catch { refPath = null; }
      if (refPath) {
        const buf = await sharp(refPath).resize({ width: 512, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
        content.push({ type: 'text', text: `Slide ${i + 1}:` });
        content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}`, detail: 'low' } });
      } else {
        content.push({ type: 'text', text: `Slide ${i + 1}: [no image]` });
      }
    }
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a precise copywriter. Always respond with valid JSON only.' },
        { role: 'user', content },
      ],
      max_completion_tokens: 600,
    });
    const m = completion.choices[0].message.content.match(/\[[\s\S]*\]/);
    if (!m) return res.status(500).json({ error: 'Could not parse suggestions' });
    const parsed = JSON.parse(m[0]);
    res.json({ slides: slides.map((_, i) => ({
      title: String(parsed[i]?.title || '').trim(),
      es: String(parsed[i]?.es || '').trim(),
      en: String(parsed[i]?.en || '').trim(),
    })) });
  } catch (error) {
    console.error('Carousel suggest error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/marketing/carousel-caption — Instagram caption for a rendered
// carousel: continues the story the slides tell (hook + Spanish lines), names
// the comic, then the house lines and hashtags. Same voice as the poster
// caption; the swipe itself is the entertainment. Body: { comicId, slides: [{title?, es?, en?}] }
router.post('/carousel-caption', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: 'OpenAI API key not configured' });
    const { comicId, slides = [] } = req.body;
    if (!comicId || !Array.isArray(slides) || slides.length < 1) return res.status(400).json({ error: 'comicId and slides are required' });
    const ctx = await comicContext(comicId);
    const story = slides.slice(0, 9).map((s, i) => {
      const bits = [];
      if (s.title) bits.push(`hook: "${String(s.title).slice(0, 140)}"`);
      if (s.es) bits.push(`ES: "${String(s.es).slice(0, 200)}"`);
      if (s.en) bits.push(`EN: "${String(s.en).slice(0, 200)}"`);
      return `Slide ${i + 1}: ${bits.join(' · ') || '(art only)'}`;
    }).join('\n');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `Write an Instagram caption for a Comigo carousel post (a swipeable tiny story from a comic).
Comic: "${ctx.title}" (series: ${ctx.collection}). About: ${ctx.description}
The slides, in swipe order:
${story}

Style (match exactly): first line invites the swipe and continues the slides' intrigue (one emoji max), then 1–2 short lines that pick up ONE Spanish phrase from the slides and glance at what it means, then a line naming the comic and series with one phrase about what it is, then "Every bubble is voiced. Every word explains itself when you tap it.", then "📖 comigo.net", then ONE line of 6–8 hashtags mixing English and Spanish learning tags. Never say "download", never oversell, no spoilers beyond what the slides show.
Return the caption as plain text only.`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 380
    });
    res.json({ caption: completion.choices[0].message.content.trim() });
  } catch (error) {
    console.error('Carousel caption error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/marketing/carousel — a swipeable tiny story: 1080x1350 slides in
// the poster's visual language. Each slide: optional art (white frame + shadow
// on violet), optional hook title (white, top), optional Spanish line (yellow)
// with a small English echo underneath; a slide with no image centers its text
// as a beat ("Why?"). Closing slide = Comigo sign-off (logo + two editable
// lines) — in-world, never an advert. Body:
// { comicId, slides: [{imageFile?, title?, es?, en?}], logo: {enabled?, line1?, line2?} }
router.post('/carousel', async (req, res) => {
  try {
    const { comicId, slides = [], logo = {} } = req.body;
    if (!comicId || !Array.isArray(slides) || slides.length < 1) return res.status(400).json({ error: 'comicId and at least one slide are required' });
    if (slides.length > 9) return res.status(400).json({ error: 'Max 9 story slides (Instagram caps carousels at 10 incl. the sign-off)' });
    const { dir } = await exportImagesDir(comicId);
    const W = 1080, H = 1350;
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const wrap = (t, maxChars) => {
      const words = String(t).replace(/\s+/g, ' ').trim().split(' ');
      const lines = [];
      let cur = '';
      for (const w of words) {
        if (cur && (cur + ' ' + w).length > maxChars) { lines.push(cur); cur = w; }
        else cur = cur ? `${cur} ${w}` : w;
      }
      if (cur) lines.push(cur);
      return lines;
    };
    const textBlock = (lines, yStart, lineH, size, weight, fill, opacity = 1) =>
      lines.map((l, k) => `<text x="${W / 2}" y="${yStart + k * lineH}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}"${opacity !== 1 ? ` opacity="${opacity}"` : ''}>${esc(l)}</text>`).join('');

    const outDir = path.join(PROJECTS_DIR, comicId, 'marketing', `carousel-${Date.now()}`);
    await fs.mkdir(outDir, { recursive: true });
    const urls = [];
    let n = 0;

    for (const s of slides) {
      n++;
      const title = String(s.title || '').trim().slice(0, 140);
      const es = String(s.es || '').trim().slice(0, 200);
      const en = String(s.en || '').trim().slice(0, 200);
      const titleLines = title ? wrap(title, 34) : [];
      const esLines = es ? wrap(es, 30) : [];
      const enLines = en ? wrap(en, 46) : [];
      const svgParts = [];
      const composites = [];
      const topH = titleLines.length ? 60 + titleLines.length * 74 + 26 : 0;
      const bandH = (esLines.length ? esLines.length * 78 + 18 : 0) + (enLines.length ? enLines.length * 54 : 0);
      const botH = bandH ? bandH + 70 : 0;
      if (s.imageFile) {
        const src = resolveSlideImage(comicId, dir, s.imageFile);
        const meta = await sharp(src).metadata();
        const zoneTop = topH || 70, zoneBottom = H - (botH || 70);
        let artH = zoneBottom - zoneTop - 20;
        let artW = Math.round(artH * meta.width / meta.height);
        if (artW > W - 90) { artW = W - 90; artH = Math.round(artW * meta.height / meta.width); }
        const bright = Math.min(2, Math.max(0.5, Number(s.brightness) || 1));
        const sat = Math.min(2, Math.max(0.3, Number(s.saturation) || 1));
        let artPipe = sharp(src).resize(artW, artH);
        if (bright !== 1 || sat !== 1) artPipe = artPipe.modulate({ brightness: bright, saturation: sat });
        const art = await artPipe
          .extend({ top: 6, bottom: 6, left: 6, right: 6, background: '#FFFFFF' }).png().toBuffer();
        const artX = Math.round((W - artW - 12) / 2);
        const artY = Math.round(zoneTop + ((zoneBottom - zoneTop) - artH - 12) / 2);
        composites.push({ input: Buffer.from(`<svg width="${artW + 26}" height="${artH + 26}"><rect x="14" y="14" width="${artW + 12}" height="${artH + 12}" rx="6" fill="rgba(0,0,0,0.55)"/></svg>`), left: artX - 7, top: artY - 7 });
        composites.push({ input: art, left: artX, top: artY });
        if (titleLines.length) svgParts.push(textBlock(titleLines, 118, 74, 58, 800, '#FFFFFF'));
        if (esLines.length || enLines.length) {
          let y = H - botH + 62;
          if (esLines.length) { svgParts.push(textBlock(esLines, y, 78, 62, 800, '#FFD23F')); y += esLines.length * 78 + 14; }
          if (enLines.length) svgParts.push(textBlock(enLines, y, 54, 40, 600, '#FFFFFF', 0.85));
        }
      } else {
        // Text-only beat: stack everything centered.
        const totalH = titleLines.length * 84 + (titleLines.length && (esLines.length || enLines.length) ? 40 : 0)
          + esLines.length * 92 + (esLines.length && enLines.length ? 16 : 0) + enLines.length * 58;
        let y = Math.round((H - totalH) / 2) + 60;
        if (titleLines.length) { svgParts.push(textBlock(titleLines, y, 84, 64, 800, '#FFFFFF')); y += titleLines.length * 84 + 40; }
        if (esLines.length) { svgParts.push(textBlock(esLines, y, 92, 72, 800, '#FFD23F')); y += esLines.length * 92 + 16; }
        if (enLines.length) svgParts.push(textBlock(enLines, y, 58, 42, 600, '#FFFFFF', 0.85));
      }
      const name = `slide-${String(n).padStart(2, '0')}.png`;
      await sharp({ create: { width: W, height: H, channels: 4, background: VIOLET } })
        .composite([...composites, { input: Buffer.from(`<svg width="${W}" height="${H}">${svgParts.join('')}</svg>`), left: 0, top: 0 }])
        .flatten({ background: VIOLET }).png().toFile(path.join(outDir, name));
      urls.push(`/projects/${comicId}/marketing/${path.basename(outDir)}/${name}`);
    }

    if (logo.enabled !== false) {
      n++;
      const l1 = String(logo.line1 ?? 'Spanish.').trim().slice(0, 80);
      const l2 = String(logo.line2 ?? 'One comic at a time.').trim().slice(0, 80);
      const lg = await sharp(LOGO_PATH).resize({ width: 560 }).png().toBuffer();
      const lm = await sharp(lg).metadata();
      const fitL = (t, base) => Math.min(base, Math.floor((W - 120) / (0.56 * Math.max(1, t.length))));
      const name = `slide-${String(n).padStart(2, '0')}.png`;
      await sharp({ create: { width: W, height: H, channels: 4, background: VIOLET } })
        .composite([
          { input: lg, left: Math.round((W - lm.width) / 2), top: Math.round(H / 2 - lm.height - 60) },
          { input: Buffer.from(`<svg width="${W}" height="${H}">${l1 ? `<text x="${W / 2}" y="${H / 2 + 120}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${fitL(l1, 94)}" font-weight="800" fill="#FFFFFF">${esc(l1)}</text>` : ''}${l2 ? `<text x="${W / 2}" y="${H / 2 + 230}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${fitL(l2, 77)}" font-weight="700" fill="#FFD23F">${esc(l2)}</text>` : ''}<text x="${W / 2}" y="${H - 90}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="80" font-weight="800" fill="#FFFFFF">comigo.net</text></svg>`), left: 0, top: 0 },
        ]).flatten({ background: VIOLET }).png().toFile(path.join(outDir, name));
      urls.push(`/projects/${comicId}/marketing/${path.basename(outDir)}/${name}`);
    }

    res.json({ urls, count: n });
  } catch (error) {
    console.error('Carousel render error:', error.message);
    res.status(500).json({ error: error.message });
  }
});


// The style clause prepended to every Veo prompt when the comic style lock is on.
const VEO_STYLE_LOCK = 'STYLE (non-negotiable): this is a 2D hand-drawn comic-book ILLUSTRATION brought to life — the reference images define the rendering, not just the subject. Keep their exact ink line work, coloured-pencil / painterly shading, flat colour and paper texture in EVERY frame. Characters, clothes and setting must look drawn, never photographed. Motion is cinematic, but the image stays an illustration throughout: no shift towards live action, photorealism, 3D, CGI or real skin/fabric/hair textures.';
const VEO_STYLE_NEGATIVE = 'photorealistic, live action, real people, photograph, film footage, 3D render, CGI, realistic skin texture, uncanny valley, text, captions, watermark';

// Base clip name (strip -mix / -fin suffixes) → the sidecar written at generation.
function veoSidecarPath(comicId, file) {
  const base = String(file || '').replace(/(-mix|-fin)+\.mp4$/, '.mp4');
  if (!/^veo-\d+\.mp4$/.test(base)) return null;
  return path.join(PROJECTS_DIR, comicId, 'marketing', `${base}.veo.json`);
}

// POST /api/marketing/veo-extend — continue an EXISTING generated clip with a
// new prompt (Veo 3.1 extension), instead of regenerating from scratch. Returns
// a raw clip; apply audio / cards with veo-remix as usual.
// Body: { comicId, file, prompt, styleLock? }
router.post('/veo-extend', async (req, res) => {
  try {
    const { GoogleGenAI } = require('@google/genai');
    if (!process.env.GEMINI_API_KEY) return res.status(400).json({ error: 'GEMINI_API_KEY not configured' });
    const { comicId, file, prompt } = req.body;
    if (!comicId || !file || !prompt) return res.status(400).json({ error: 'comicId, file and prompt are required' });
    const sc = veoSidecarPath(comicId, file);
    if (!sc) return res.status(400).json({ error: 'Not a generated clip' });
    let side;
    try { side = JSON.parse(await fs.readFile(sc, 'utf8')); }
    catch { return res.status(400).json({ error: 'This clip predates extension support (no Veo handle saved) — generate a fresh clip, then extend that one' }); }
    const styleLock = req.body.styleLock !== false;
    const fullPrompt = styleLock ? `${VEO_STYLE_LOCK}\n\n${prompt}` : prompt;
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    let op;
    try {
      op = await ai.models.generateVideos({ model: side.model, prompt: fullPrompt, video: side.video, config: { aspectRatio: '9:16', numberOfVideos: 1, ...(styleLock ? { negativePrompt: VEO_STYLE_NEGATIVE } : {}) } });
    } catch (e) {
      const msg = e.message || '';
      if (/resolution|1080/i.test(msg)) return res.status(400).json({ error: `Veo would not extend this clip (${msg.slice(0, 120)}). Extension currently works on 720p clips — generate with "720p (extendable)" and try again.` });
      if (/expired|not found|no longer/i.test(msg)) return res.status(400).json({ error: 'Veo no longer has this clip (handles expire after ~2 days) — generate a fresh clip, then extend that one' });
      throw e;
    }
    const started = Date.now();
    while (!op.done) {
      if (Date.now() - started > 8 * 60 * 1000) throw new Error('Veo extension timed out');
      await new Promise(r => setTimeout(r, 8000));
      op = await ai.operations.getVideosOperation({ operation: op });
    }
    const vids = op.response?.generatedVideos || [];
    if (!vids.length) {
      const why = op.response?.raiMediaFilteredReasons?.join('; ') || op.error?.message || 'no video returned (possibly filtered)';
      return res.status(502).json({ error: `Veo returned nothing: ${why}` });
    }
    const outDir = path.join(PROJECTS_DIR, comicId, 'marketing');
    const name = `veo-${Date.now()}.mp4`;
    await ai.files.download({ file: vids[0].video, downloadPath: path.join(outDir, name) });
    await fs.writeFile(path.join(outDir, `${name}.veo.json`), JSON.stringify({ video: vids[0].video, model: side.model, prompt: fullPrompt, extendedFrom: file, createdAt: new Date().toISOString() }));
    res.json({ url: `/projects/${comicId}/marketing/${name}`, file: name });
  } catch (error) {
    console.error('Veo extend error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/marketing/clip-frame — grab a frame from a generated clip as a
// reusable reference image (start a new generation from where this one ended,
// or from its best moment). Body: { comicId, file, at: seconds | 'last' }
router.post('/clip-frame', async (req, res) => {
  try {
    const { execFile } = require('child_process');
    const run = (cmd, args) => new Promise((resolve, reject) =>
      execFile(cmd, args, { maxBuffer: 1024 * 1024 * 16 }, (err, so, se) => err ? reject(new Error(se || err.message)) : resolve(so)));
    const { comicId, file } = req.body;
    if (!comicId || !file || !/^[\w.\-]+\.mp4$/.test(file)) return res.status(400).json({ error: 'comicId and a valid file are required' });
    const src = path.join(PROJECTS_DIR, comicId, 'marketing', file);
    const dur = parseFloat(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]));
    const at = req.body.at === 'last' ? Math.max(0, dur - 0.1) : Math.min(Math.max(0, Number(req.body.at) || 0), Math.max(0, dur - 0.05));
    const upDir = path.join(PROJECTS_DIR, comicId, 'marketing', 'uploads');
    await fs.mkdir(upDir, { recursive: true });
    const name = `${Date.now()}-frame-${req.body.at === 'last' ? 'last' : Math.round(at * 10) / 10}s.jpg`;
    await run('ffmpeg', ['-y', '-ss', String(at), '-i', src, '-frames:v', '1', '-q:v', '2', path.join(upDir, name)]);
    res.json({ file: `upload:${name}`, url: `/projects/${comicId}/marketing/uploads/${name}`, at });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Shared finishing for a freshly generated clip (Veo or Sora): optional voice
// overlay, then the opening / question / sign-off cards. Returns the final name.
async function postProcessClip(comicId, outDir, name, body) {
  const voiceAudio = body.voiceAudio || [];
  const ambient = body.ambient || 'keep';
  if (voiceAudio.length > 0 || ambient !== 'keep') {
    const mixed = name.replace(/\.mp4$/, '-mix.mp4');
    await mixVoicesOnto(comicId, path.join(outDir, name), voiceAudio, ambient, path.join(outDir, mixed), body.subtitles || 'none');
    name = mixed;
  }
  const { question: finQ = '', endCard = false } = body;
  if (finQ || endCard || hasOpening(body)) {
    const fin = name.replace(/\.mp4$/, '-fin.mp4');
    await finishClip(comicId, path.join(outDir, name), finQ, path.join(outDir, fin), cardSecs(body));
    name = fin;
  }
  return name;
}

// POST /api/marketing/sora-clip — the same brief through OpenAI's Sora 2.
// One reference image (the first selected) steers look + subject; 9:16 at
// 720x1280; 4, 8 or 12 seconds. Same voices / subtitles / cards afterwards.
// Body: as veo-clip, with model: 'sora' | 'sora-pro'.
router.post('/sora-clip', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: 'OpenAI API key not configured' });
    const { comicId, prompt, imageFiles = [] } = req.body;
    if (!comicId || !prompt) return res.status(400).json({ error: 'comicId and prompt are required' });
    const model = req.body.model === 'sora-pro' ? 'sora-2-pro' : 'sora-2';
    const d = Number(req.body.durationSeconds) || 8;
    const seconds = d <= 4 ? '4' : d <= 8 ? '8' : '12';
    const size = '720x1280';
    const dir = await exportDirOrNull(comicId);
    const { toFile } = require('openai');
    let input_reference;
    if (imageFiles.length) {
      // Sora wants the reference at exactly the output size.
      const p = await resolveRefImage(comicId, dir, imageFiles[0]);
      const buf = await sharp(p).resize(720, 1280, { fit: 'cover' }).jpeg({ quality: 92 }).toBuffer();
      input_reference = await toFile(buf, 'reference.jpg', { type: 'image/jpeg' });
    }
    const negative = req.body.negativePrompt ? String(req.body.negativePrompt).trim() : '';
    // Sora uses the reference as the OPENING FRAME, not as a style guide — so the
    // one thing that keeps it in the comic's look is telling it to preserve the
    // first frame's drawing style for the whole clip. Without this it animates
    // the frame into live action within a second.
    const styleClause = input_reference
      ? 'Animate the provided first frame. It is a hand-drawn 2D comic illustration: keep EXACTLY its drawing style — the same ink line work, shading, flat colours and paper texture — in every frame, start to finish. This is animated illustration, never live action, never photorealistic, no real skin/hair/fabric textures, no 3D render.\n\n'
      : 'A hand-drawn 2D comic-book illustration in motion (ink line work, painterly flat colour) — animated illustration, never live action or photorealistic.\n\n';
    const fullPrompt = styleClause + (negative ? `${prompt}\n\nDo not include: ${negative}.` : prompt);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log(`[sora] ${model} ${size} ${seconds}s, ref=${input_reference ? 1 : 0}, prompt len=${fullPrompt.length}`);
    let job = await openai.videos.create({ model, prompt: fullPrompt, size, seconds, ...(input_reference ? { input_reference } : {}) });
    const started = Date.now();
    while (job.status !== 'completed' && job.status !== 'failed') {
      if (Date.now() - started > 15 * 60 * 1000) throw new Error('Sora generation timed out');
      await new Promise(r => setTimeout(r, 8000));
      job = await openai.videos.retrieve(job.id);
    }
    if (job.status === 'failed') return res.status(502).json({ error: `Sora failed: ${job.error?.message || job.error?.code || 'unknown error'}` });
    const outDir = path.join(PROJECTS_DIR, comicId, 'marketing');
    await fs.mkdir(outDir, { recursive: true });
    let name = `sora-${Date.now()}.mp4`;
    const resp = await openai.videos.downloadContent(job.id, { variant: 'video' });
    await fs.writeFile(path.join(outDir, name), Buffer.from(await resp.arrayBuffer()));
    name = await postProcessClip(comicId, outDir, name, req.body);
    res.json({ url: `/projects/${comicId}/marketing/${name}`, file: name, model });
  } catch (error) {
    console.error('Sora clip error:', error.message);
    res.status(500).json({ error: error.message });
  }
});


// ---------------------------------------------------------------------------
// MOTION COMIC — the finished art, untouched, with only the camera and the
// atmosphere moving. No generative video: each shot is a still (page, panel,
// generated or uploaded image) pushed/panned by zoompan while its real voice
// line plays, optional drifting dust / light flicker / vignette / grain laid
// over as ffmpeg layers, then the usual opening / question / sign-off cards.
// Body: { comicId, shots: [{ imageFile, seconds?, move?: in|out|left|right|drift|still,
//         voice?: { file, es, en, lang } }], subtitles?: none|es|en|match,
//         fx?: { dust, flicker, vignette, grain }, + card fields as veo-clip }
// Dust: a sparse layer of soft white motes on a tall (2x frame height)
// transparent canvas, to be drifted over a shot; two layers at different
// speeds give a little parallax. Shared by the motion comic and story reel.
async function dustPng(tmp, name, count, rMin, rMax, alpha) {
  const W = 1080, H = 1920;
  const dots = [];
  for (let i = 0; i < count; i++) {
    const r = (rMin + Math.random() * (rMax - rMin)).toFixed(1);
    dots.push(`<circle cx="${(Math.random() * W).toFixed(0)}" cy="${(Math.random() * H * 2).toFixed(0)}" r="${r}" fill="white" fill-opacity="${(alpha * (0.5 + Math.random() * 0.5)).toFixed(2)}"/>`);
  }
  const out = path.join(tmp, name);
  await sharp(Buffer.from(`<svg width="${W}" height="${H * 2}" xmlns="http://www.w3.org/2000/svg">${dots.join('')}</svg>`)).blur(1.2).png().toFile(out);
  return out;
}

router.post('/motion-comic', async (req, res) => {
  const { execFile } = require('child_process');
  const os = require('os');
  const run = (cmd, args) => new Promise((resolve, reject) =>
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64 }, (err, so, se) =>
      err ? reject(new Error((se || err.message).slice(-1200))) : resolve(so)));
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'motion-'));
  try {
    const { comicId, shots = [], subtitles = 'none', fx = {} } = req.body;
    if (!comicId || !Array.isArray(shots) || shots.length < 1) return res.status(400).json({ error: 'comicId and at least one shot are required' });
    if (shots.length > 10) return res.status(400).json({ error: 'Max 10 shots' });
    const dir = await exportDirOrNull(comicId);
    let audioDir = null;
    try { const e = await exportImagesDir(comicId); audioDir = path.join(PROJECTS_DIR, comicId, 'export', e.slug, 'audio'); } catch {}
    const W = 1080, H = 1920, FPS = 25;
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Dust: two sparse layers of soft white motes on a tall transparent
    // canvas, drifted at different speeds for a little parallax.
    const dust1 = fx.dust ? await dustPng(tmp, 'dust1.png', 110, 0.8, 1.9, 0.38) : null;
    const dust2 = fx.dust ? await dustPng(tmp, 'dust2.png', 45, 1.8, 3.2, 0.26) : null;

    // Subtitle PNG (same look as the reel subtitles).
    const subPng = async (text, name) => {
      const fs2 = 64, lineH = Math.round(fs2 * 1.3), maxChars = Math.floor((W - Math.round(W * 0.08)) / (0.52 * fs2));
      const words = String(text).replace(/\s+/g, ' ').trim().split(' ');
      const lines = []; let cur = '';
      for (const w of words) { if (cur && (cur + ' ' + w).length > maxChars) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; }
      if (cur) lines.push(cur);
      const ph = lines.length * lineH + Math.round(fs2 * 0.5);
      const svg = `<svg width="${W}" height="${ph}" xmlns="http://www.w3.org/2000/svg">${lines.map((l, k) =>
        `<text x="${W / 2}" y="${Math.round((k + 0.85) * lineH)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${fs2}" font-weight="800" fill="#FFFFFF" stroke="#000000" stroke-width="7" paint-order="stroke" stroke-linejoin="round">${esc(l)}</text>`).join('')}</svg>`;
      const out = path.join(tmp, name);
      await sharp(Buffer.from(svg)).png().toFile(out);
      return out;
    };

    // Export images are 1024-wide JPEGs — fine for the app, soft for a 1080p
    // reel with a push-in. For export tokens, go back to the project's PNGs:
    // the 2048-wide master for text-free pages/panels, the baked PNG for
    // pages with bubbles, and floating-panel baked crops where they exist.
    const comicDoc = await Comic.findOne({ id: comicId }, { pages: 1, practicePages: 1, reelPages: 1 }).lean();
    const imagesDir = path.join(PROJECTS_DIR, comicId, 'images');
    const exists = async f => { try { await fs.access(f); return true; } catch { return false; } };
    const hiResSource = async (token) => {
      const fallback = resolveSlideImage(comicId, dir, token);
      const m = String(token).match(/_p(\d+)(?:_s(\d+))?(_no_text)?\.(jpg|png)$/i);
      if (!m || /^(ref|gen|upload|comic):/.test(token)) return { src: fallback, crop: null };
      const pageNum = Number(m[1]), panelOrder = m[2] ? Number(m[2]) : null, noText = !!m[3];
      const page = [...(comicDoc?.pages || []), ...(comicDoc?.practicePages || []), ...(comicDoc?.reelPages || [])].find(pg => pg.pageNumber === pageNum);
      const master = path.join(imagesDir, `${comicId}_p${pageNum}.png`);
      const baked = path.join(imagesDir, `${comicId}_p${pageNum}_baked.png`);
      if (panelOrder == null) {
        if (noText && await exists(master)) return { src: master, crop: null };
        if (!noText && await exists(baked)) return { src: baked, crop: null };
        if (await exists(master)) return { src: master, crop: null };
        return { src: fallback, crop: null };
      }
      const panel = (page?.panels || []).find(pn => pn.panelOrder === panelOrder);
      if (!noText) {
        const bakedCrop = path.join(imagesDir, `${comicId}_p${pageNum}_s${panelOrder}_baked.png`);
        if (await exists(bakedCrop)) return { src: bakedCrop, crop: null };
      }
      const base = noText ? master : (await exists(baked) ? baked : master);
      if (panel?.tapZone && await exists(base)) return { src: base, crop: panel.tapZone };
      return { src: fallback, crop: null };
    };

    const parts = [];
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i] || {};
      const { src, crop } = await hiResSource(shot.imageFile);
      let img = sharp(src);
      if (crop) {
        const meta = await img.metadata();
        const left = Math.round(crop.x * meta.width), top = Math.round(crop.y * meta.height);
        const width = Math.max(8, Math.min(meta.width - left, Math.round(crop.width * meta.width)));
        const height = Math.max(8, Math.min(meta.height - top, Math.round(crop.height * meta.height)));
        img = sharp(await img.extract({ left, top, width, height }).png().toBuffer());
      }
      // 2x oversampled frame so the push-in never goes soft. Two fits:
      //  fill — cover-crop to 9:16 (panels, portrait stills);
      //  fit  — the WHOLE image, centred over a blurred, darkened copy of
      //         itself (full pages, landscape art) so nothing is cut off.
      const fit = shot.fit === 'fit' ? 'fit' : 'fill';
      const still = path.join(tmp, `art${i}.png`);
      if (fit === 'fill') {
        await img.resize(W * 2, H * 2, { fit: 'cover', kernel: 'lanczos3' }).png().toFile(still);
      } else {
        const buf = await img.png().toBuffer();
        const bg = await sharp(buf).resize(W * 2, H * 2, { fit: 'cover' }).blur(45).modulate({ brightness: 0.55, saturation: 0.85 }).png().toBuffer();
        const fg = await sharp(buf).resize(Math.round(W * 2 * 0.94), Math.round(H * 2 * 0.94), { fit: 'inside', kernel: 'lanczos3' }).png().toBuffer();
        const fm = await sharp(fg).metadata();
        await sharp(bg).composite([{ input: fg, left: Math.round((W * 2 - fm.width) / 2), top: Math.round((H * 2 - fm.height) / 2) }]).png().toFile(still);
      }

      let dur = Math.min(15, Math.max(1.5, Number(shot.seconds) || 3));
      let audioArgs = ['-f', 'lavfi', '-t', '0', '-i', 'anullsrc=r=44100:cl=stereo'];
      let subText = '';
      if (shot.voice?.file) {
        const f = String(shot.voice.file);
        let ap;
        if (f.startsWith('upload:')) { const n = f.slice(7); if (!/^[\w.\-]+$/i.test(n)) throw new Error('Bad upload filename'); ap = path.join(PROJECTS_DIR, comicId, 'marketing', 'uploads', n); }
        else { if (!/^[\w.\-áéíóúñü]+$/i.test(f)) throw new Error('Bad audio filename'); if (!audioDir) throw new Error('Comic audio needs an export'); ap = path.join(audioDir, f); }
        const adur = parseFloat(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', ap]));
        dur = Math.max(dur, adur + 0.7);
        audioArgs = ['-i', ap];
        if (subtitles && subtitles !== 'none') {
          subText = subtitles === 'es' ? shot.voice.es : subtitles === 'en' ? shot.voice.en : (shot.voice.lang === 'en' ? shot.voice.en : shot.voice.es);
        }
      }
      const frames = Math.round(dur * FPS);
      const p = `(on/${frames})`;                       // 0 → 1 across the shot
      const ease = `(0.5-0.5*cos(PI*${p}))`;             // ease in-out
      const amt = fit === 'fit' ? 0.08 : 0.18;    // fit: whole image stays readable
      const zIn = `(1+${amt}*${ease})`, zOut = `(1+${amt}-${amt}*${ease})`;
      const centre = `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
      const moves = {
        in:    `z='${zIn}':${centre}`,
        out:   `z='${zOut}':${centre}`,
        left:  `z='${1 + amt * 0.7}':x='(iw-iw/zoom)*(1-${ease})':y='ih/2-(ih/zoom/2)'`,   // window slides left
        right: `z='${1 + amt * 0.7}':x='(iw-iw/zoom)*${ease}':y='ih/2-(ih/zoom/2)'`,
        up:    `z='${1 + amt * 0.7}':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(1-${ease})'`,
        down:  `z='${1 + amt * 0.7}':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*${ease}'`,
        drift: `z='(${1 + amt * 0.35}+${amt * 0.35}*${ease})':x='(iw-iw/zoom)*(0.3+0.4*${ease})':y='(ih-ih/zoom)*(0.6-0.3*${ease})'`,
        still: `z='${1 + amt * 0.2}':${centre}`,
      };
      const zp = moves[shot.move] || moves.in;

      const inputs = ['-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', still, ...audioArgs];
      let idx = 2;
      const chain = [`[0:v]zoompan=${zp}:d=1:fps=${FPS}:s=${W}x${H}[v0]`];
      let cur = '[v0]', n = 0;
      const next = () => `[v${++n}]`;
      if (fx.flicker) { const o = next(); chain.push(`${cur}geq=lum='p(X,Y)*(1+0.035*sin(2*PI*T*2.3)+0.02*sin(2*PI*T*7.1))':cb='p(X,Y)':cr='p(X,Y)'${o}`); cur = o; }
      if (dust1) {
        inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', dust1); const o1 = next();
        chain.push(`${cur}[${idx}:v]overlay=x='-20+10*sin(t/3)':y='-${H}+t*16':format=auto${o1}`); cur = o1; idx++;
        inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', dust2); const o2 = next();
        chain.push(`${cur}[${idx}:v]overlay=x='15*sin(t/4)':y='-${H}+t*34':format=auto${o2}`); cur = o2; idx++;
      }
      if (fx.grain) { const o = next(); chain.push(`${cur}noise=alls=9:allf=t+u${o}`); cur = o; }
      if (fx.vignette) { const o = next(); chain.push(`${cur}vignette=PI/4.6${o}`); cur = o; }
      if (subText) {
        const sp = await subPng(subText, `sub${i}.png`);
        inputs.push('-i', sp); const o = next();
        chain.push(`${cur}[${idx}:v]overlay=(main_w-overlay_w)/2:main_h-overlay_h-380${o}`); cur = o; idx++;
      }
      const oo = next();
      chain.push(`${cur}format=yuv420p,setsar=1${oo}`); cur = oo;
      chain.push(`[1:a]apad[a]`);
      const seg = path.join(tmp, `seg${i}.mp4`);
      await run('ffmpeg', ['-y', ...inputs, '-filter_complex', chain.join(';'), '-map', cur, '-map', '[a]', '-t', String(dur),
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-ar', '44100', '-ac', '2', seg]);
      parts.push(seg);
    }

    const cat = path.join(tmp, 'cat.mp4');
    const ins = parts.flatMap(f => ['-i', f]);
    // Overall loudness of the voice lines (100 = as recorded), with a limiter so a boost never clips.
    const volume = Math.min(300, Math.max(30, Number(req.body.volume) || 100)) / 100;
    const filter = parts.map((_, i) => `[${i}:v][${i}:a]`).join('') + `concat=n=${parts.length}:v=1:a=1[v][a0];[a0]volume=${volume.toFixed(2)},alimiter=limit=0.95[a]`;
    await run('ffmpeg', ['-y', ...ins, '-filter_complex', filter, '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', cat]);

    const outDir = path.join(PROJECTS_DIR, comicId, 'marketing');
    await fs.mkdir(outDir, { recursive: true });
    let name = `motion-${Date.now()}.mp4`;
    const { question = '', endCard = false } = req.body;
    if (question || endCard || hasOpening(req.body)) {
      await finishClip(comicId, cat, question, path.join(outDir, name), cardSecs(req.body));
    } else {
      await fs.copyFile(cat, path.join(outDir, name));
    }
    res.json({ url: `/projects/${comicId}/marketing/${name}`, file: name, shots: parts.length });
  } catch (error) {
    console.error('Motion comic error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

// POST /api/marketing/story-reel — a marketing reel built the way the
// challenge reel is: each shot is a story (or reel) page, or one of its
// panels, shown from its EMPTY-bubbles bake; the page's real speech bubbles
// then pop in one after another, exactly as baked, while each one's audio
// plays — with a slow camera move over the shot and the motion comic's
// atmosphere (dust, vignette, grain). Body:
// { comicId, shots: [{ pageId, panelOrder? (2+; omit = whole page), move,
//   fit 'fit'|'fill', bubbles 'text'|'highlight'|'none', gap, hold, seconds }],
//   fx: { dust, vignette, grain }, subtitles: 'none'|'en', volume (%),
//   + the motion comic's finishing fields (opening/question/covers/end card) }
router.post('/story-reel', async (req, res) => {
  const { execFile } = require('child_process');
  const fsSync = require('fs');
  const run = (cmd, args) => new Promise((resolve, reject) =>
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64 }, (err, so, se) =>
      err ? reject(new Error(String(se || err.message).trim().split('\n').slice(-6).join('\n'))) : resolve(so)));
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'story-'));
  try {
    const { comicId, shots = [], fx = {} } = req.body;
    if (!comicId || !Array.isArray(shots) || shots.length < 1) return res.status(400).json({ error: 'comicId and at least one shot are required' });
    if (shots.length > 12) return res.status(400).json({ error: 'Max 12 shots' });
    const num = (v, d, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Number(v) : d));
    const subtitles = req.body.subtitles === 'en' ? 'en' : 'none';
    const volume = num(req.body.volume, 130, 30, 300) / 100;
    const comic = await Comic.findOne({ id: comicId }, { pages: 1, reelPages: 1 }).lean();
    if (!comic) return res.status(404).json({ error: 'Comic not found' });
    const allPages = [...(comic.pages || []), ...(comic.reelPages || [])];
    const localFile = url => url ? path.join(__dirname, '../..', String(url).split('?')[0]) : null;
    const audioFile = name => { if (!name) return null; const f = path.join(PROJECTS_DIR, comicId, 'audio', `${name}.mp3`); return fsSync.existsSync(f) ? f : null; };
    const audioLen = async f => f ? (parseFloat(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f])) || 1.2) : 1.0;
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Composed at 2x (2160x3840) so the camera move never goes soft; the move
    // crops a window out of the 2x picture and scales it down to 1080x1920.
    const W = 1080, H = 1920, FPS = 25, X = 2;
    const dust1 = fx.dust ? await dustPng(tmp, 'dust1.png', 110, 0.8, 1.9, 0.38) : null;
    const dust2 = fx.dust ? await dustPng(tmp, 'dust2.png', 45, 1.8, 3.2, 0.26) : null;
    // English subtitle line, the motion comic's look (bold white, black outline).
    const subPng = async (text, name) => {
      const fs2 = 64, lineH = Math.round(fs2 * 1.3), maxChars = Math.floor((W - Math.round(W * 0.08)) / (0.52 * fs2));
      const words = String(text).replace(/\s+/g, ' ').trim().split(' ');
      const lines = []; let cur = '';
      for (const w of words) { if (cur && (cur + ' ' + w).length > maxChars) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; }
      if (cur) lines.push(cur);
      const ph = lines.length * lineH + Math.round(fs2 * 0.5);
      const out = path.join(tmp, name);
      await sharp(Buffer.from(`<svg width="${W}" height="${ph}" xmlns="http://www.w3.org/2000/svg">${lines.map((l, k) =>
        `<text x="${W / 2}" y="${Math.round((k + 0.85) * lineH)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${fs2}" font-weight="800" fill="#FFFFFF" stroke="#000000" stroke-width="7" paint-order="stroke" stroke-linejoin="round">${esc(l)}</text>`).join('')}</svg>`)).png().toFile(out);
      return out;
    };

    const parts = [];
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i] || {};
      const page = allPages.find(pg => pg.id === shot.pageId);
      if (!page) return res.status(400).json({ error: `Shot ${i + 1}: page not found` });
      const label = page.reelLabel || `page ${page.pageNumber}`;
      const bakedImg = localFile(page.bakedImage), emptyImg = localFile(page.emptyBubblesImage);
      if (!bakedImg || !fsSync.existsSync(bakedImg)) return res.status(400).json({ error: `Shot ${i + 1} (${label}) has not been baked yet — bake it in the page editor first` });
      if (!emptyImg || !fsSync.existsSync(emptyImg)) return res.status(400).json({ error: `Shot ${i + 1} (${label}) has no empty-bubbles bake — re-bake it in the page editor` });
      const mode = ['text', 'highlight', 'none'].includes(shot.bubbles) ? shot.bubbles : 'text';
      const fit = shot.fit === 'fill' ? 'fill' : 'fit';
      const gap = num(shot.gap, 0.6, 0, 5), hold = num(shot.hold, 1.0, 0, 10), minSec = num(shot.seconds, 0, 0, 30);
      // The shot's region of the page: a panel's tap zone, or the whole page.
      const panelOrder = Number(shot.panelOrder);
      const panel = panelOrder >= 2 ? (page.panels || []).find(p => p.panelOrder === panelOrder) : null;
      const region = panel?.tapZone && panel.tapZone.width > 0 ? panel.tapZone : { x: 0, y: 0, width: 1, height: 1 };
      const meta = await sharp(emptyImg).metadata();
      const PW = meta.width, PH = meta.height;
      const rx = Math.round(region.x * PW), ry = Math.round(region.y * PH);
      const rw = Math.max(8, Math.min(PW - rx, Math.round(region.width * PW))), rh = Math.max(8, Math.min(PH - ry, Math.round(region.height * PH)));
      // Placement of the region in the 2x frame: 'fill' cover-crops it to 9:16;
      // 'fit' shows all of it over a blurred, darkened copy (the motion comic's look).
      const FW = W * X, FH = H * X;
      let s, ox, oy;
      const regionBuf = await sharp(emptyImg).extract({ left: rx, top: ry, width: rw, height: rh }).png().toBuffer();
      const still = path.join(tmp, `art${i}.png`);
      if (fit === 'fill') {
        s = Math.max(FW / rw, FH / rh);
        ox = Math.round((FW - rw * s) / 2); oy = Math.round((FH - rh * s) / 2);
        await sharp(regionBuf).resize(FW, FH, { fit: 'cover', kernel: 'lanczos3' }).png().toFile(still);
      } else {
        s = Math.min(FW * 0.94 / rw, FH * 0.94 / rh);
        const fw = Math.round(rw * s), fh = Math.round(rh * s);
        ox = Math.round((FW - fw) / 2); oy = Math.round((FH - fh) / 2);
        const bg = await sharp(regionBuf).resize(FW, FH, { fit: 'cover' }).blur(45).modulate({ brightness: 0.55, saturation: 0.85 }).png().toBuffer();
        const fg = await sharp(regionBuf).resize(fw, fh, { kernel: 'lanczos3' }).png().toBuffer();
        await sharp(bg).composite([{ input: fg, left: ox, top: oy }]).png().toFile(still);
      }
      // The bubbles inside the region, in the page's own order (the reader's
      // playback order), pinned by orderIndex when every bubble has one.
      let bubbles = (page.bubbles || []).filter(b => !b.hidden && b.type !== 'image' && Number.isFinite(b.x) && Number.isFinite(b.width) && (b.sentences || [])[0]?.text);
      if (bubbles.every(b => Number.isFinite(b.orderIndex))) bubbles = [...bubbles].sort((a, b) => a.orderIndex - b.orderIndex);
      if (panel) bubbles = bubbles.filter(b => { const cx = b.x + b.width / 2, cy = b.y + b.height / 2; return cx >= region.x && cx <= region.x + region.width && cy >= region.y && cy <= region.y + region.height; });
      // Each bubble: its rectangle in page pixels, the overlay PNG (a crop of the
      // baked page, or the empty bubble turned the app's green), its audio.
      const items = [];
      let t = 0.5;
      for (let k = 0; k < bubbles.length && mode !== 'none'; k++) {
        const b = bubbles[k], sen = b.sentences[0];
        const bx = Math.max(0, Math.round(b.x * PW)), by = Math.max(0, Math.round(b.y * PH));
        const bw = Math.min(PW - bx, Math.max(2, Math.round(b.width * PW))), bh = Math.min(PH - by, Math.max(2, Math.round(b.height * PH)));
        const ow = Math.max(2, Math.round(bw * s)), oh = Math.max(2, Math.round(bh * s));
        const png = path.join(tmp, `b${i}_${k}.png`);
        if (mode === 'text') {
          await sharp(bakedImg).extract({ left: bx, top: by, width: bw, height: bh }).resize(ow, oh, { kernel: 'lanczos3' }).png().toFile(png);
        } else {
          const { data, info } = await sharp(emptyImg).extract({ left: bx, top: by, width: bw, height: bh }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          const rad = Math.min(info.width, info.height) * 0.3;
          for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
            const q = (y * info.width + x) * 4;
            const dx = Math.max(0, Math.max(rad - x, x - (info.width - 1 - rad))), dy = Math.max(0, Math.max(rad - y, y - (info.height - 1 - rad)));
            const inside = dx * dx + dy * dy <= rad * rad;
            const mn = Math.min(data[q], data[q + 1], data[q + 2]), mx = Math.max(data[q], data[q + 1], data[q + 2]);
            if (inside && mn > 195 && mx - mn < 18) { data[q] = 0x98; data[q + 1] = 0xF8; data[q + 2] = 0x72; } else data[q + 3] = 0;
          }
          await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).resize(ow, oh).png().toFile(png);
        }
        const audio = b.isSoundEffect ? null : audioFile(sen.audioUrl);
        const len = await audioLen(audio);
        items.push({ png, x: ox + Math.round((bx - rx) * s), y: oy + Math.round((by - ry) * s), w: ow, h: oh, audio, start: t, len,
          en: String(sen.translation || '').replace(/\[[^\]]*\]/g, '').trim() });
        t += len + gap;
      }
      const dur = Math.max(minSec, 1.5, (items.length ? t - gap : 0.5) + hold);
      // Compose at 2x: the still, then each bubble popping in (or lighting up while it speaks).
      const args = ['-y', '-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', still];
      const chain = []; let cur = '[0:v]'; let idx = 1;
      items.forEach((it, k) => {
        args.push('-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', it.png);
        const st = it.start.toFixed(2);
        const on = mode === 'highlight' ? `between(t,${st},${(it.start + it.len + 0.15).toFixed(2)})` : `gte(t,${st})`;
        chain.push(`[${idx}:v]format=rgba,scale=w='iw*(0.6+0.4*min(1,max(0,(t-${st})/0.25)))':h=-1:eval=frame,fade=t=in:st=${st}:d=0.12:alpha=1[o${k}]`);
        const out = `[c${k}]`;
        chain.push(`${cur}[o${k}]overlay=x='${it.x}+(${it.w}-w)/2':y='${it.y}+(${it.h}-h)/2':enable='${on}':format=auto${out}`); cur = out; idx++;
      });
      // The camera move: zoompan over the composed 2x video (one output frame per
      // input frame), eased across the shot — the motion comic's moves — and
      // scaled down to 1080x1920 on the way.
      const frames = Math.round(dur * FPS);
      const ease = `(0.5-0.5*cos(PI*min(1,on/${frames})))`;
      const amt = fit === 'fit' ? 0.08 : 0.18;
      const zIn = `(1+${amt}*${ease})`, zOut = `(1+${amt}-${amt}*${ease})`, zPan = (1 + amt * 0.7).toFixed(3);
      const centre = `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
      const moves = {
        in: `z='${zIn}':${centre}`, out: `z='${zOut}':${centre}`,
        left: `z='${zPan}':x='(iw-iw/zoom)*(1-${ease})':y='ih/2-(ih/zoom/2)'`, right: `z='${zPan}':x='(iw-iw/zoom)*${ease}':y='ih/2-(ih/zoom/2)'`,
        up: `z='${zPan}':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(1-${ease})'`, down: `z='${zPan}':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*${ease}'`,
        drift: `z='(${(1 + amt * 0.35).toFixed(3)}+${(amt * 0.35).toFixed(3)}*${ease})':x='(iw-iw/zoom)*(0.3+0.4*${ease})':y='(ih-ih/zoom)*(0.6-0.3*${ease})'`,
        still: `z='${(1 + amt * 0.2).toFixed(3)}':${centre}`,
      };
      chain.push(`${cur}zoompan=${moves[shot.move] || moves.in}:d=1:fps=${FPS}:s=${W}x${H}[mv]`); cur = '[mv]';
      if (dust1) {
        args.push('-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', dust1);
        chain.push(`${cur}[${idx}:v]overlay=x='-20+10*sin(t/3)':y='-${H}+t*16':format=auto[d1]`); cur = '[d1]'; idx++;
        args.push('-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', dust2);
        chain.push(`${cur}[${idx}:v]overlay=x='15*sin(t/4)':y='-${H}+t*34':format=auto[d2]`); cur = '[d2]'; idx++;
      }
      if (fx.grain) { chain.push(`${cur}noise=alls=9:allf=t+u[gr]`); cur = '[gr]'; }
      if (fx.vignette) { chain.push(`${cur}vignette=PI/4.6[vg]`); cur = '[vg]'; }
      if (subtitles === 'en') {
        for (let k = 0; k < items.length; k++) {
          if (!items[k].en) continue;
          const sp = await subPng(items[k].en, `sub${i}_${k}.png`);
          args.push('-i', sp);
          chain.push(`${cur}[${idx}:v]overlay=(main_w-overlay_w)/2:main_h-overlay_h-380:enable='between(t,${items[k].start.toFixed(2)},${(items[k].start + items[k].len + Math.min(gap, 0.3)).toFixed(2)})'[s${k}]`); cur = `[s${k}]`; idx++;
        }
      }
      chain.push(`${cur}format=yuv420p,setsar=1[v]`);
      // Audio: each bubble's line at its start, over silence.
      const withAudio = items.filter(it => it.audio); const firstA = idx;
      withAudio.forEach(it => args.push('-i', it.audio));
      const achain = [`anullsrc=r=44100:cl=stereo,atrim=0:${dur.toFixed(2)}[sil]`]; let amix = '[sil]';
      withAudio.forEach((it, j) => { achain.push(`[${firstA + j}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=${Math.round(it.start * 1000)}|${Math.round(it.start * 1000)}[ra${j}]`); amix += `[ra${j}]`; });
      achain.push(`${amix}amix=inputs=${withAudio.length + 1}:normalize=0[a]`);
      const seg = path.join(tmp, `seg${i}.mp4`);
      await run('ffmpeg', ['-y', ...args, '-filter_complex', [...chain, ...achain].join(';'), '-map', '[v]', '-map', '[a]', '-t', String(dur),
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-ar', '44100', '-ac', '2', seg]);
      parts.push(seg);
    }

    const cat = path.join(tmp, 'cat.mp4');
    await run('ffmpeg', ['-y', ...parts.flatMap(f => ['-i', f]), '-filter_complex',
      parts.map((_, i) => `[${i}:v][${i}:a]`).join('') + `concat=n=${parts.length}:v=1:a=1[v][a0];[a0]volume=${volume.toFixed(2)},alimiter=limit=0.95[a]`,
      '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', cat]);
    const outDir = path.join(PROJECTS_DIR, comicId, 'marketing');
    await fs.mkdir(outDir, { recursive: true });
    const name = `story-${Date.now()}.mp4`;
    const { question = '', endCard = false } = req.body;
    if (question || endCard || hasOpening(req.body)) await finishClip(comicId, cat, question, path.join(outDir, name), cardSecs(req.body));
    else await fs.copyFile(cat, path.join(outDir, name));
    res.json({ url: `/projects/${comicId}/marketing/${name}`, file: name, shots: parts.length });
  } catch (error) {
    console.error('Story reel error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

module.exports = router;

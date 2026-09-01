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

    const W = 1080, H = 1350, artH = 900;
    const meta = await sharp(src).metadata();
    const artW = Math.round(artH * meta.width / meta.height);
    let artPipe = sharp(src).resize(artW, artH);
    if (brightness !== 1 || saturation !== 1) artPipe = artPipe.modulate({ brightness, saturation });
    const art = await artPipe
      .extend({ top: 6, bottom: 6, left: 6, right: 6, background: '#FFFFFF' })
      .png().toBuffer();
    const shadow = Buffer.from(
      `<svg width="${artW + 26}" height="${artH + 26}"><rect x="14" y="14" width="${artW + 12}" height="${artH + 12}" rx="6" fill="rgba(0,0,0,0.55)"/></svg>`);
    const artX = Math.round((W - artW - 12) / 2), artY = 268;

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
      <text x="${W / 2}" y="104" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${f1}" font-weight="800" fill="#FFFFFF">${esc(line1)}</text>
      <text x="${W / 2}" y="204" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${f2}" font-weight="800" fill="#FFD23F">${esc(line2)}</text>
      <text x="${W / 2}" y="${H - 72}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="31" font-weight="700" fill="#FFFFFF" opacity="0.92">Interactive Spanish stories</text>
      <text x="${W / 2}" y="${H - 32}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="27" font-weight="600" fill="#FFFFFF" opacity="0.7">comigo.net</text>
    </svg>`);

    const outDir = path.join(PROJECTS_DIR, comicId, 'marketing');
    await fs.mkdir(outDir, { recursive: true });
    const name = `poster-${Date.now()}.png`;
    await sharp({ create: { width: W, height: H, channels: 4, background: VIOLET } })
      .composite([
        { input: shadow, left: artX - 7, top: artY - 7 },
        { input: art, left: artX, top: artY },
        { input: logo, left: Math.round((W - logoMeta.width) / 2), top: H - 108 - logoMeta.height },
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

module.exports = router;

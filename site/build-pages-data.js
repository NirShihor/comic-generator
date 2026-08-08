#!/usr/bin/env node
// Extract bubble data + audio + flood-filled highlight masks for the
// interactive sample pages. Ports the reader app's BubbleFill idea: seed in
// the bubble box, flood the light balloon interior (lum > 120, tolerance 30
// per channel vs seed), fail on leaks -> rectangular wash fallback.
// Writes site/interactive-pages.js (COMIGO_PAGES) for build.py to inline.

const fs = require('fs');
const path = require('path');
const sharp = require(path.join(__dirname, '..', 'server', 'node_modules', 'sharp'));

const ROOT = path.join(__dirname, '..');
const GREEN = [0x61, 0xF5, 0x27, Math.round(0.42 * 255)];

const SPECS = [
  ['comic-c19761b8', 'la_carta_negra', 2, 'page-carta1'],
  ['comic-9832e1ed', 'la_biblioteca', 3, 'page-biblioteca3'],
  ['comic-b904edef', 'la_casa_en_la_colina', 4, 'page-colina4'],
  ['comic-95264329', 'el_descubrimiento', 10, 'page-descubrimiento10'],
  ['comic-9314873c', 'la_llegada', 4, 'page-llegada4'],
  ['comic-1e2d6933', 'primer_turno', 4, 'page-primer4'],
  ['comic-55ff3083', 'la_mquina', 8, 'page-maquina8'],
  ['comic-eb61a751', 'la_casa', 4, 'page-casa4'],
  ['comic-5aeac58f', 'la_oferta', 9, 'page-oferta9'],
  ['comic-222fb233', 'los_cuervos_de_pino_negro', 2, 'page-cuervos2'],
];

const MIME = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav' };

function findAudio(base, name) {
  const dir = path.join(base, 'audio');
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir).find(f => f.startsWith(name + '.'));
  if (!hit) return null;
  const ext = path.extname(hit).toLowerCase();
  const data = fs.readFileSync(path.join(dir, hit)).toString('base64');
  return `data:${MIME[ext] || 'audio/mpeg'};base64,${data}`;
}

// Flood-fill the balloon interior within (and slightly beyond) the bubble box.
// Returns {maskPng, region:{x,y,w,h}} in normalized page coords, or null.
async function bubbleMask(imgPath, box) {
  const { data, info } = await sharp(imgPath).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const pad = Math.round(W * 0.02);
  const rx0 = Math.max(0, Math.round(box.x * W) - pad);
  const ry0 = Math.max(0, Math.round(box.y * H) - pad);
  const rx1 = Math.min(W - 1, Math.round((box.x + box.width) * W) + pad);
  const ry1 = Math.min(H - 1, Math.round((box.y + box.height) * H) + pad);
  const rw = rx1 - rx0 + 1, rh = ry1 - ry0 + 1;
  if (rw < 8 || rh < 8) return null;

  const px = (x, y) => {
    const i = (y * W + x) * C;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

  // Seed: scan a small grid near the box centre for a plausibly-light pixel.
  const cx = Math.round((box.x + box.width / 2) * W);
  const cy = Math.round((box.y + box.height / 2) * H);
  let seed = null;
  outer:
  for (let dy = 0; dy <= Math.round(rh * 0.35); dy += 2) {
    for (const sy of dy === 0 ? [0] : [-dy, dy]) {
      for (let dx = 0; dx <= Math.round(rw * 0.35); dx += 2) {
        for (const sx of dx === 0 ? [0] : [-dx, dx]) {
          const x = cx + sx, y = cy + sy;
          if (x <= rx0 || x >= rx1 || y <= ry0 || y >= ry1) continue;
          const [r, g, b] = px(x, y);
          if (lum(r, g, b) > 120) { seed = { x, y, r, g, b }; break outer; }
        }
      }
    }
  }
  if (!seed) return null;

  const TOL = 30;
  const filled = new Uint8Array(rw * rh);
  const stack = [[seed.x, seed.y]];
  let count = 0, borderHits = 0;
  while (stack.length) {
    const [x, y] = stack.pop();
    const li = (y - ry0) * rw + (x - rx0);
    if (filled[li]) continue;
    const [r, g, b] = px(x, y);
    const L = lum(r, g, b);
    // Anything plausibly interior spreads; only the dark outline stops the
    // flood (the strict seed tolerance left a pale ring inside the border).
    if (L <= 118) continue;
    filled[li] = 1;
    count++;
    if (x === rx0 || x === rx1 || y === ry0 || y === ry1) borderHits++;
    if (x > rx0) stack.push([x - 1, y]);
    if (x < rx1) stack.push([x + 1, y]);
    if (y > ry0) stack.push([x, y - 1]);
    if (y < ry1) stack.push([x, y + 1]);
  }

  // Leak checks, as in the app: a real balloon interior doesn't bleed out of
  // the padded box. Too many border pixels (or a trivial fill) -> no mask.
  if (count < rw * rh * 0.05) return null;
  if (borderHits > (rw + rh) * 0.06) return null;

  // NO dilation: growing the fill also eats INTO letter strokes from both
  // sides, ghosting the text once the mask is scaled down in the browser.
  // The relaxed flood already reaches the outline's anti-aliased edge.

  // Holes in the fill = the lettering (and any speckles) enclosed by the
  // balloon: unfilled pixels NOT reachable from the region border. Paint them
  // with the ORIGINAL artwork pixels, opaque — otherwise the browser's
  // downscaling of the mask blurs the thin letter gaps and the text washes
  // out under the green (the app preserves ink the same way).
  const outside = new Uint8Array(rw * rh);
  const bstack = [];
  for (let x = 0; x < rw; x++) { bstack.push(x, (rh - 1) * rw + x); }
  for (let y = 0; y < rh; y++) { bstack.push(y * rw, y * rw + rw - 1); }
  while (bstack.length) {
    const li = bstack.pop();
    if (outside[li] || filled[li]) continue;
    outside[li] = 1;
    const x = li % rw, y = (li / rw) | 0;
    if (x > 0) bstack.push(li - 1);
    if (x < rw - 1) bstack.push(li + 1);
    if (y > 0) bstack.push(li - rw);
    if (y < rh - 1) bstack.push(li + rw);
  }

  const rgba = Buffer.alloc(rw * rh * 4);
  for (let i = 0; i < rw * rh; i++) {
    if (filled[i]) {
      rgba[i * 4] = GREEN[0]; rgba[i * 4 + 1] = GREEN[1];
      rgba[i * 4 + 2] = GREEN[2]; rgba[i * 4 + 3] = GREEN[3];
    } else if (!outside[i]) {
      // enclosed hole — the ink
      const x = rx0 + (i % rw), y = ry0 + ((i / rw) | 0);
      const [r, g, b] = px(x, y);
      rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255;
    }
  }
  const maskPng = await sharp(rgba, { raw: { width: rw, height: rh, channels: 4 } })
    .png({ compressionLevel: 9 }).toBuffer();
  return {
    img: 'data:image/png;base64,' + maskPng.toString('base64'),
    x: rx0 / W, y: ry0 / H, w: rw / W, h: rh / H,
  };
}

(async () => {
  const pages = {};
  for (const [cid, slug, pageNo, key] of SPECS) {
    const base = path.join(ROOT, 'server', 'projects', cid, 'export', slug);
    const comic = JSON.parse(fs.readFileSync(path.join(base, 'comic.json')));
    const page = comic.pages.find(p => p.pageNumber === pageNo);
    // Full-res page image for a clean fill; mask coords are normalized anyway.
    const imgName = page.masterImage;
    const imgPath = ['jpg', 'png'].map(e => path.join(base, 'images', `${imgName}.${e}`)).find(fs.existsSync);
    const bubbles = [];
    for (const panel of page.panels || []) {
      for (const b of panel.bubbles || []) {
        if (b.isSoundEffect || b.hidden || !(b.sentences || []).length) continue;
        const sentences = b.sentences.map(s => ({
          es: s.text, en: s.translation || '',
          audio: s.audioUrl ? findAudio(base, s.audioUrl) : null,
        }));
        let fill = null;
        if (imgPath && !b.bgTransparent) {
          try { fill = await bubbleMask(imgPath, b.position); } catch (e) { fill = null; }
        }
        bubbles.push({
          x: +b.position.x.toFixed(4), y: +b.position.y.toFixed(4),
          w: +b.position.width.toFixed(4), h: +b.position.height.toFixed(4),
          sentences, ...(fill && { fill }),
        });
      }
    }
    const withFill = bubbles.filter(b => b.fill).length;
    console.log(`${key}: ${bubbles.length} bubbles, ${withFill} flood-filled`);
    pages[key] = { bubbles };
  }
  const out = path.join(__dirname, 'interactive-pages.js');
  fs.writeFileSync(out, 'const COMIGO_PAGES = ' + JSON.stringify(pages) + ';\n');
  console.log(`wrote ${out} (${Math.round(fs.statSync(out).size / 1024)}KB)`);
})();

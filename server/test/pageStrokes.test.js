const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const S = require('../src/services/strokesSvg');

// The geometry module exists twice (client ESM, server CJS); only the last
// line (the export) may differ.
test('client and server stroke geometry are the same code', () => {
  const body = f => fs.readFileSync(f, 'utf8').trim().split('\n').filter(l => !/^(export|module\.exports)/.test(l)).join('\n');
  assert.strictEqual(body(path.join(__dirname, '../src/services/strokesSvg.js')), body(path.join(__dirname, '../../client/src/utils/strokes.js')));
});

test('a straight arrow: tip at the end point, line pulled back behind the head', () => {
  const s = { x1: 0.1, y1: 0.5, x2: 0.9, y2: 0.5, width: 4, headEnd: true };
  const { d, heads, width } = S.shapes(s, 400, 600);
  assert.strictEqual(width, 4);
  assert.strictEqual(heads.length, 1);
  assert.deepStrictEqual(heads[0][0], [360, 300]);              // the tip
  const endX = Number(d.split(' L ')[1].split(' ')[0]);
  assert.ok(endX < 360 && endX > 340, `line ends short of the tip: ${d}`);
  assert.ok(heads[0][1][0] < 360 && heads[0][2][0] < 360, 'head base behind the tip');
  assert.ok(Math.abs(heads[0][1][1] - 300) > 3, 'head has width');
});

test('a curve bows to one side by default and both heads follow the tangents', () => {
  const s = { kind: 'curve', x1: 0.2, y1: 0.8, x2: 0.8, y2: 0.2, headStart: true, headEnd: true, width: 3 };
  const c = S.controls(s);
  assert.ok(c.c1x !== undefined && c.c2y !== undefined);
  const { d, heads } = S.shapes(s, 400, 600);
  assert.ok(d.startsWith('M ') && d.includes(' C '));
  assert.strictEqual(heads.length, 2);
  assert.deepStrictEqual(heads[0][0], [320, 120]);   // end tip
  assert.deepStrictEqual(heads[1][0], [80, 480]);    // start tip
  // widths scale with the drawing: 3px on 400 wide is 7.68px on 1024 wide
  assert.ok(Math.abs(S.shapes(s, 1024, 1536).width - 7.68) < 0.01);
});

test('dash styles and the SVG document', () => {
  assert.strictEqual(S.dashArray({ dash: 'solid' }, 4), null);
  assert.strictEqual(S.dashArray({ dash: 'dashed' }, 4), '12 8');
  assert.strictEqual(S.dashArray({ dash: 'dotted' }, 4), '0.1 8');
  const svg = S.strokesSvg([{ x1: 0, y1: 0, x2: 1, y2: 1, color: '#ff0000', dash: 'dotted', opacity: 0.5 }], 200, 300);
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"'));
  assert.ok(svg.includes('stroke="#ff0000"') && svg.includes('stroke-dasharray="0.1') && svg.includes('opacity="0.5"'));
  assert.ok(!S.strokesSvg([{ x1: 0, y1: 0, x2: 1, y2: 1, color: '"><script>' }], 10, 10).includes('<script'));
});

test('strokes composite onto an image with sharp (the no-text export)', async () => {
  const W = 200, H = 300;
  const base = await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const svg = S.strokesSvg([{ x1: 0.1, y1: 0.5, x2: 0.9, y2: 0.5, width: 6, color: '#000000', headEnd: true }], W, H);
  const { data: out, info } = await sharp(base).composite([{ input: Buffer.from(svg), left: 0, top: 0 }]).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => out[(y * W + x) * info.channels];
  assert.ok(px(100, 150) < 50, 'line pixel is dark');
  assert.ok(px(100, 50) > 200, 'off-line pixel stays white');
  assert.ok(px(176, 150) < 50, 'arrow head pixel is dark');
});

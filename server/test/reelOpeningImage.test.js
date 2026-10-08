const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const sharp = require('sharp');
const execFileAsync = promisify(execFile);
const { parseOpeningImage, openingImageSegment } = require('../src/routes/marketing')._openingImage;

test('opening image settings are validated and defaulted', () => {
  assert.strictEqual(parseOpeningImage(undefined), null);
  assert.strictEqual(parseOpeningImage({ enabled: true }), null, 'no image → no slide');
  assert.strictEqual(parseOpeningImage({ enabled: false, image: 'page_1.jpg' }), null);
  assert.deepStrictEqual(parseOpeningImage({ enabled: true, image: 'page_1.jpg' }),
    { image: 'page_1.jpg', seconds: 3, fit: 'inside', background: '#6E40F0', margin: 0, fade: true });
  assert.deepStrictEqual(parseOpeningImage({ enabled: true, image: 'ref:/uploads/x.png', seconds: 99, fit: 'cover', background: '#ffd23f', margin: 1000, fade: false }),
    { image: 'ref:/uploads/x.png', seconds: 60, fit: 'cover', background: '#FFD23F', margin: 300, fade: false });
  assert.strictEqual(parseOpeningImage({ enabled: true, image: 'p.jpg', seconds: 0.1, background: 'red' }).seconds, 0.5);
  assert.strictEqual(parseOpeningImage({ enabled: true, image: 'p.jpg', background: 'red' }).background, '#6E40F0');
});

// Renders a real segment with ffmpeg: a landscape test image on a colour,
// held for the chosen time, 1080x1920, with silent audio.
test('the still renders to a 1080x1920 segment of the chosen length', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-still-'));
  try {
    const img = path.join(tmp, 'page.png');
    await sharp({ create: { width: 800, height: 500, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toFile(img);
    // The resolver only accepts images under /uploads or /projects; point it at a copy there.
    const upDir = path.join(__dirname, '../uploads', '_test-reel-still');
    fs.mkdirSync(upDir, { recursive: true });
    const up = path.join(upDir, 'page.png');
    fs.copyFileSync(img, up);
    try {
      const run = async (cmd, args) => (await execFileAsync(cmd, args, { maxBuffer: 1 << 24 })).stdout;
      const still = parseOpeningImage({ enabled: true, image: 'ref:/uploads/_test-reel-still/page.png', seconds: 1.5, margin: 40, background: '#112233' });
      const seg = await openingImageSegment(tmp, 'comic-none', still, run);
      const probe = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', seg]));
      const v = probe.streams.find(s => s.codec_type === 'video'), a = probe.streams.find(s => s.codec_type === 'audio');
      assert.strictEqual(`${v.width}x${v.height}`, '1080x1920');
      assert.ok(a, 'has an audio stream (needed for concat)');
      assert.ok(Math.abs(parseFloat(probe.format.duration) - 1.5) < 0.15, probe.format.duration);
      // The middle of the frame is the red image; a corner is the background colour.
      const frame = path.join(tmp, 'mid.png');
      await run('ffmpeg', ['-y', '-ss', '0.5', '-i', seg, '-frames:v', '1', frame]);
      const { data, info } = await sharp(frame).raw().toBuffer({ resolveWithObject: true });
      const px = (x, y) => [...data.slice((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
      const mid = px(540, 960), corner = px(10, 10);
      assert.ok(mid[0] > 200 && mid[1] < 60 && mid[2] < 60, `middle is red: ${mid}`);
      assert.ok(corner[0] < 40 && corner[1] < 60 && corner[2] > 30, `corner is the background: ${corner}`);
    } finally { fs.rmSync(upDir, { recursive: true, force: true }); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

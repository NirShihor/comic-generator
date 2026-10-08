const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const sharp = require('sharp');
const execFileAsync = promisify(execFile);
const { parseOpeningImage, parseOpeningImages, openingImageSegment, finishClip, cardSecs } = require('../src/routes/marketing')._openingImage;

test('opening image settings are validated and defaulted', () => {
  assert.strictEqual(parseOpeningImage(undefined), null);
  assert.strictEqual(parseOpeningImage({ enabled: true }), null, 'no image → no slide');
  assert.strictEqual(parseOpeningImage({ enabled: false, image: 'page_1.jpg' }), null);
  assert.deepStrictEqual(parseOpeningImage({ enabled: true, image: 'page_1.jpg' }),
    { image: 'page_1.jpg', seconds: 3, fit: 'inside', background: '#6E40F0', margin: 0, zoom: 1, focusX: 0.5, focusY: 0.5, fade: true });
  assert.deepStrictEqual(parseOpeningImage({ enabled: true, image: 'ref:/uploads/x.png', seconds: 99, fit: 'cover', background: '#ffd23f', margin: 1000, zoom: 900, focusX: 0, focusY: 120, fade: false }),
    { image: 'ref:/uploads/x.png', seconds: 60, fit: 'cover', background: '#FFD23F', margin: 300, zoom: 4, focusX: 0, focusY: 1, fade: false });
  assert.strictEqual(parseOpeningImage({ enabled: true, image: 'p.jpg', seconds: 0.1, background: 'red' }).seconds, 0.5);
  assert.strictEqual(parseOpeningImage({ enabled: true, image: 'p.jpg', background: 'red' }).background, '#6E40F0');
});

test('several opening images come through in order, empty ones dropped, at most six', () => {
  assert.deepStrictEqual(parseOpeningImages({}), []);
  assert.deepStrictEqual(parseOpeningImages({ openingImages: 'nope' }), []);
  const two = parseOpeningImages({ openingImages: [{ image: 'page_1.jpg', seconds: 2 }, { image: '' }, { image: 'page_2.jpg', seconds: 4, fit: 'cover' }] });
  assert.deepStrictEqual(two.map(s => [s.image, s.seconds, s.fit]), [['page_1.jpg', 2, 'inside'], ['page_2.jpg', 4, 'cover']]);
  assert.strictEqual(parseOpeningImages({ openingImages: Array.from({ length: 9 }, (_, i) => ({ image: `p${i}.jpg` })) }).length, 6);
  // The older single-image shape still works.
  assert.deepStrictEqual(parseOpeningImages({ openingImage: { enabled: true, image: 'page_1.jpg' } }).map(s => s.image), ['page_1.jpg']);
  assert.deepStrictEqual(parseOpeningImages({ openingImage: { enabled: false, image: 'page_1.jpg' } }), []);
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
      // Zoomed in past the frame and focused on the top-left, the image is
      // cropped there: the top-left corner is now red, the bottom-right too
      // (the box is 1080 wide; a 800x500 image at inside-fit x 3 is 3240x2025).
      const zoomed = parseOpeningImage({ image: 'ref:/uploads/_test-reel-still/page.png', seconds: 0.5, zoom: 300, focusX: 0, focusY: 0, fade: false });
      const zseg = await openingImageSegment(tmp, 'comic-none', zoomed, run, { index: 2 });
      const zf = path.join(tmp, 'z.png');
      await run('ffmpeg', ['-y', '-i', zseg, '-frames:v', '1', zf]);
      const z = await sharp(zf).raw().toBuffer({ resolveWithObject: true });
      const zpx = (x, y) => [...z.data.slice((y * z.info.width + x) * z.info.channels, (y * z.info.width + x) * z.info.channels + 3)];
      assert.ok(zpx(5, 5)[0] > 200 && zpx(1075, 1915)[0] > 200, `zoomed still fills the frame: ${zpx(5, 5)} ${zpx(1075, 1915)}`);
      // A second still gets its own files and, following the first, fades in from its colour.
      const second = parseOpeningImage({ image: 'ref:/uploads/_test-reel-still/page.png', seconds: 1, fit: 'cover' });
      const seg2 = await openingImageSegment(tmp, 'comic-none', second, run, { index: 1, fadeIn: true });
      assert.notStrictEqual(seg2, seg);
      const first = path.join(tmp, 'first.png');
      await run('ffmpeg', ['-y', '-i', seg2, '-frames:v', '1', first]);
      const f = await sharp(first).raw().toBuffer({ resolveWithObject: true });
      const p0 = [...f.data.slice((960 * f.info.width + 540) * f.info.channels, (960 * f.info.width + 540) * f.info.channels + 3)];
      assert.ok(p0[0] < 120, `first frame starts on the background colour, not the image: ${p0}`);
      // A reel with no clip at all: the two stills, then the sign-off card.
      const reel = path.join(tmp, 'reel.mp4');
      const body = { openingImages: [{ image: 'ref:/uploads/_test-reel-still/page.png', seconds: 1.5 }, { image: 'ref:/uploads/_test-reel-still/page.png', seconds: 1, fit: 'cover' }], endCardSeconds: 2 };
      await finishClip('comic-none', null, '', reel, cardSecs(body));
      const rp = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', reel]));
      const rv = rp.streams.find(s => s.codec_type === 'video');
      assert.strictEqual(`${rv.width}x${rv.height}`, '1080x1920');
      assert.ok(Math.abs(parseFloat(rp.format.duration) - 4.5) < 0.25, `stills + sign-off: ${rp.format.duration}`);
    } finally { fs.rmSync(upDir, { recursive: true, force: true }); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

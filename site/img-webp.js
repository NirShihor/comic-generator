// Helper for build.py: encode <src> to <out> as WebP (max 640px wide, q82)
// using the generator server's sharp. Prints "encodedWxH origWxH".
// With a third argument "og": a 1200x630 JPEG instead (link previews).
const path = require('path');
const sharp = require(path.join(__dirname, '..', 'server', 'node_modules', 'sharp'));
const [src, out, mode] = process.argv.slice(2);
(async () => {
  const meta = await sharp(src).metadata();
  if (mode === 'og') {
    // 1200x630 (the link-preview shape), cut from the top of the page: the
    // opening panel, rather than a centre crop through the middle of the page.
    const info = await sharp(src).resize(1200, 630, { fit: 'cover', position: 'top' }).jpeg({ quality: 82, mozjpeg: true }).toFile(out);
    console.log(`${info.width}x${info.height} ${meta.width}x${meta.height}`);
    return;
  }
  const info = await sharp(src)
    .resize({ width: Math.min(640, meta.width) })
    .webp({ quality: 82, effort: 5 })
    .toFile(out);
  console.log(`${info.width}x${info.height} ${meta.width}x${meta.height}`);
})().catch(e => { console.error(e.message); process.exit(1); });

// Helper for build.py: encode <src> to <out> as WebP (max 640px wide, q82)
// using the generator server's sharp. Prints "encodedWxH origWxH".
const path = require('path');
const sharp = require(path.join(__dirname, '..', 'server', 'node_modules', 'sharp'));
const [src, out] = process.argv.slice(2);
(async () => {
  const meta = await sharp(src).metadata();
  const info = await sharp(src)
    .resize({ width: Math.min(640, meta.width) })
    .webp({ quality: 82, effort: 5 })
    .toFile(out);
  console.log(`${info.width}x${info.height} ${meta.width}x${meta.height}`);
})().catch(e => { console.error(e.message); process.exit(1); });

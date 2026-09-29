#!/usr/bin/env node
// Submit specific comigo.net URLs to IndexNow by hand, e.g. after a change the
// automatic post-deploy sync doesn't count as content (a layout-only change):
//   node server/scripts/indexnow-submit.js https://comigo.net/spanish-reading-practice/staying-safe
// Only public page URLs are accepted, and only once the key file is live.
const path = require('path');
const indexNow = require('../src/services/indexNow');

(async () => {
  const siteDir = path.join(__dirname, '../../site');
  const urls = process.argv.slice(2);
  const bad = urls.filter(u => !indexNow.isSubmittable(u));
  if (!urls.length || bad.length) {
    console.error(bad.length ? `Not public comigo.net page URLs: ${bad.join(' ')}` : 'Usage: indexnow-submit.js <url>...');
    process.exit(1);
  }
  const key = indexNow.readKey(siteDir);
  if (!key) { console.error('No key file in site/indexnow/'); process.exit(1); }
  if (!(await indexNow.keyFileLive(key))) {
    console.error(`https://comigo.net/${key}.txt is not live yet — deploy first.`);
    process.exit(1);
  }
  const r = await indexNow.submit(urls, { key });
  console.log(r.ok ? `Accepted: HTTP ${r.status} for ${urls.length} URL(s)` : `Not accepted: ${r.status ? `HTTP ${r.status}` : r.error}`);
  process.exit(r.ok ? 0 : 1);
})();

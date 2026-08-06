const mongoose = require('mongoose');
const { EJSON } = require('bson');
const fs = require('fs');
const path = require('path');

// Daily JSON dump of every collection, as insurance independent of Atlas's
// own backup tier. On Fly the dumps land on the persistent volume (which
// Fly additionally snapshots daily); locally they land in server/db-backups
// (picked up by Time Machine). EJSON canonical mode preserves ObjectIds and
// dates exactly, so a dump can be restored with scripts/restore-db.js.
const KEEP = 14;
const backupDir = fs.existsSync('/data')
  ? '/data/db-backups'
  : path.join(__dirname, '..', '..', 'db-backups');

async function dumpOnce() {
  const db = mongoose.connection.db;
  if (!db) return;
  const dump = {};
  for (const col of await db.listCollections().toArray()) {
    dump[col.name] = await db.collection(col.name).find().toArray();
  }
  fs.mkdirSync(backupDir, { recursive: true });
  const name = `db-${new Date().toISOString().slice(0, 10)}.ejson`;
  const file = path.join(backupDir, name);
  fs.writeFileSync(file, EJSON.stringify(dump, { relaxed: false }));
  const counts = Object.entries(dump).map(([k, v]) => `${k}:${v.length}`).join(' ');
  console.log(`[db-backup] wrote ${name} (${counts})`);

  // prune to the newest KEEP dumps
  const old = fs.readdirSync(backupDir)
    .filter(f => /^db-\d{4}-\d{2}-\d{2}\.ejson$/.test(f))
    .sort()
    .slice(0, -KEEP);
  for (const f of old) fs.unlinkSync(path.join(backupDir, f));
}

function startDailyBackups() {
  const run = () => dumpOnce().catch(e => console.error('[db-backup] failed:', e.message));
  // First dump shortly after boot (lets the DB connection settle), then daily.
  setTimeout(run, 30 * 1000);
  setInterval(run, 24 * 60 * 60 * 1000).unref();
}

module.exports = { startDailyBackups, dumpOnce, backupDir };

#!/usr/bin/env node
// Restore a db-backup EJSON dump (from src/services/dbBackup.js or the
// db-archive/ snapshots) into a MongoDB cluster.
//
//   node scripts/restore-db.js <dump.ejson> [mongo-uri]
//
// Defaults to MONGODB_URI from ../.env. REPLACES the contents of every
// collection present in the dump (drops then inserts) — collections not in
// the dump are left untouched.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');
const fs = require('fs');

const [file, uriArg] = process.argv.slice(2);
const uri = uriArg || process.env.MONGODB_URI;
if (!file || !uri) {
  console.error('usage: node scripts/restore-db.js <dump.ejson> [mongo-uri]');
  process.exit(1);
}

(async () => {
  const dump = EJSON.parse(fs.readFileSync(file, 'utf8'), { relaxed: false });
  const client = await MongoClient.connect(uri);
  const db = client.db();
  console.log(`restoring into db "${db.databaseName}" on ${uri.split('@')[1] || uri}`);
  for (const [name, docs] of Object.entries(dump)) {
    await db.collection(name).deleteMany({});
    if (docs.length) await db.collection(name).insertMany(docs);
    console.log(`  ${name}: ${docs.length} restored`);
  }
  await client.close();
  console.log('DONE');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

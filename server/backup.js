#!/usr/bin/env node

/**
 * MongoDB Backup Script
 * Exports all collections (Comics, ArchivedPages, Collections) as JSON files.
 *
 * Usage:
 *   node backup.js              # creates timestamped backup in ./backups/
 *   node backup.js --restore <folder>  # restores from a backup folder
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const fs = require('fs');

const Comic = require('./src/models/Comic');
const ArchivedPage = require('./src/models/ArchivedPage');
const Collection = require('./src/models/Collection');

const BACKUP_DIR = path.join(__dirname, 'backups');

async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set in .env');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');
}

async function backup() {
  await connect();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const folder = path.join(BACKUP_DIR, `backup-${timestamp}`);
  fs.mkdirSync(folder, { recursive: true });

  const models = [
    { name: 'comics', model: Comic },
    { name: 'archived_pages', model: ArchivedPage },
    { name: 'collections', model: Collection },
  ];

  let totalDocs = 0;
  for (const { name, model } of models) {
    const docs = await model.find({}).lean();
    const filePath = path.join(folder, `${name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(docs, null, 2));
    console.log(`  ${name}: ${docs.length} documents`);
    totalDocs += docs.length;
  }

  // Write metadata
  fs.writeFileSync(path.join(folder, '_meta.json'), JSON.stringify({
    timestamp: new Date().toISOString(),
    totalDocuments: totalDocs,
    collections: models.map(m => m.name),
  }, null, 2));

  console.log(`\nBackup complete: ${folder}`);
  console.log(`Total: ${totalDocs} documents`);

  await mongoose.disconnect();
}

async function restore(folderPath) {
  const absPath = path.resolve(folderPath);
  if (!fs.existsSync(absPath)) {
    console.error(`Backup folder not found: ${absPath}`);
    process.exit(1);
  }

  const meta = JSON.parse(fs.readFileSync(path.join(absPath, '_meta.json'), 'utf-8'));
  console.log(`Restoring backup from ${meta.timestamp} (${meta.totalDocuments} documents)`);
  console.log('WARNING: This will REPLACE all existing data in the database.');
  console.log('Press Ctrl+C within 5 seconds to cancel...\n');
  await new Promise(r => setTimeout(r, 5000));

  await connect();

  const models = [
    { name: 'comics', model: Comic },
    { name: 'archived_pages', model: ArchivedPage },
    { name: 'collections', model: Collection },
  ];

  for (const { name, model } of models) {
    const filePath = path.join(absPath, `${name}.json`);
    if (!fs.existsSync(filePath)) {
      console.log(`  ${name}: skipped (file not found)`);
      continue;
    }
    const docs = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    await model.deleteMany({});
    if (docs.length > 0) {
      await model.insertMany(docs);
    }
    console.log(`  ${name}: restored ${docs.length} documents`);
  }

  console.log('\nRestore complete.');
  await mongoose.disconnect();
}

const args = process.argv.slice(2);
if (args[0] === '--restore' && args[1]) {
  restore(args[1]).catch(err => { console.error(err); process.exit(1); });
} else {
  backup().catch(err => { console.error(err); process.exit(1); });
}

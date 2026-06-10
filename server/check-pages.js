require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const Comic = require('./src/models/Comic');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const comic = await Comic.findOne({ title: /CONOCER/i });
  if (!comic) { console.log('Comic not found'); process.exit(); }

  // Show panels for each page, focusing on artworkImage
  comic.pages.forEach((p, i) => {
    console.log(`\nPage ${p.pageNumber} (index ${i}):`);
    console.log(`  masterImage: ${p.masterImage ? p.masterImage.substring(p.masterImage.lastIndexOf('/') + 1, p.masterImage.indexOf('?') > 0 ? p.masterImage.indexOf('?') : undefined) : 'NONE'}`);
    console.log(`  panels: ${p.panels.length}`);
    p.panels.forEach((pnl, j) => {
      console.log(`    Panel ${j}: artworkImage=${pnl.artworkImage ? pnl.artworkImage.substring(pnl.artworkImage.lastIndexOf('/') + 1) : 'NONE'}`);
    });
  });

  process.exit();
});

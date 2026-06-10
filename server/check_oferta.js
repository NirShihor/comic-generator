const mongoose = require('mongoose');
require('dotenv').config({ path: '/Users/nirshihor/Desktop/coding/comic-generator/.env' });
const Comic = require('./src/models/Comic');
const { convertToReaderFormat } = require('./src/services/readerFormat');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const comic = await Comic.findOne({ title: /oferta/i }).lean();
  if (!comic) { console.log('Comic not found'); process.exit(0); }
  
  const readerData = convertToReaderFormat(comic);
  
  const page6 = readerData.pages.find(p => p.pageNumber === 7);
  if (!page6) {
    for (const p of readerData.pages) {
      console.log('Page:', p.pageNumber, 'panels:', p.panels?.length);
    }
    console.log('Page 6 not found at pageNumber 7, listing all pages above');
    process.exit(0);
  }
  
  console.log('Page 6 found, panels:', page6.panels?.length);
  for (const panel of page6.panels) {
    console.log('Panel order:', panel.panelOrder, 'bubbles:', panel.bubbles?.length);
    for (const bubble of panel.bubbles || []) {
      console.log('  Bubble type:', bubble.type, 'sentences:', bubble.sentences?.length, 'text:', bubble.sentences?.[0]?.text?.substring(0, 60));
      if (bubble.sentences?.[0]?.words) {
        console.log('  Words count:', bubble.sentences[0].words.length);
      }
    }
  }
  
  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });

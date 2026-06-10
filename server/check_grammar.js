const mongoose = require("mongoose");
require("dotenv").config({ path: "../.env" });
const Comic = require("./src/models/Comic");
const { transformToReaderFormat, sanitizeTitle } = require("./src/services/readerFormat");

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  // Find any comic with transformations
  const comics = await Comic.find({});
  let found = false;

  for (const comic of comics) {
    const allBubbles = [
      ...(comic.cover?.bubbles || []),
      ...(comic.pages || []).flatMap(p => p.bubbles || [])
    ];

    for (const bubble of allBubbles) {
      for (const sentence of bubble.sentences || []) {
        if (sentence.transformations && sentence.transformations.length > 0) {
          console.log("=== FOUND IN DB ===");
          console.log("Comic:", comic.title);
          console.log("Sentence:", sentence.text);
          console.log("Transformations:", JSON.stringify(sentence.transformations, null, 2));
          found = true;

          // Now check the export
          const slug = sanitizeTitle(comic.title);
          const reader = transformToReaderFormat(comic, slug);

          // Find this sentence in the reader output
          for (const page of reader.pages) {
            for (const panel of page.panels || []) {
              for (const bubble of panel.bubbles || []) {
                for (const s of bubble.sentences || []) {
                  if (s.transformations && s.transformations.length > 0) {
                    console.log("\n=== FOUND IN EXPORT ===");
                    console.log("Sentence:", s.text);
                    console.log("Transformations:", JSON.stringify(s.transformations, null, 2));
                  }
                }
              }
            }
          }
          break;
        }
      }
      if (found) break;
    }
    if (found) break;
  }

  if (!found) {
    console.log("No transformations found in any comic in the database.");
  }

  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });

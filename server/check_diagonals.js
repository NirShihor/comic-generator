const mongoose = require("mongoose");
const Comic = require("./src/models/Comic");

async function check() {
  await mongoose.connect("mongodb://localhost:27017/comic-generator");
  const comics = await Comic.find({});
  for (const comic of comics) {
    let hasDiagonal = false;
    let details = [];
    for (const page of comic.pages || []) {
      for (const line of page.lines || []) {
        if (line.type === "horizontal" && line.y1 !== undefined && line.y1 !== null && line.y2 !== undefined && line.y2 !== null) {
          if (Math.abs(line.y1 - line.y2) > 0.001) {
            hasDiagonal = true;
            details.push("p" + page.pageNumber + " h-diag");
          }
        }
        if (line.type === "vertical" && line.x1 !== undefined && line.x1 !== null && line.x2 !== undefined && line.x2 !== null) {
          if (Math.abs(line.x1 - line.x2) > 0.001) {
            hasDiagonal = true;
            details.push("p" + page.pageNumber + " v-diag");
          }
        }
      }
    }
    console.log(comic.title + ": hasDiagonal=" + hasDiagonal + (details.length > 0 ? " [" + details.join(", ") + "]" : ""));
  }
  await mongoose.disconnect();
}
check().catch(e => { console.error(e.message); process.exit(1); });

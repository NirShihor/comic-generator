const mongoose = require('mongoose');

// A reusable background image, stored in a single global library. Optionally
// labelled with a collection so it can be filtered/associated, but not owned by
// one — the same background can be reused across collections.
const BackgroundSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: String,               // free-text label
  image: String,              // stored path, e.g. /uploads/<file>.png
  collectionId: String,       // optional association
  collectionTitle: String,    // denormalised for display
  description: String
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

module.exports = mongoose.model('Background', BackgroundSchema);

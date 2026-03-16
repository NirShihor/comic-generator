const mongoose = require('mongoose');

// Import schemas from Comic model for consistency
const Comic = require('./Comic');

// ArchivedPage Schema - stores pages that have been archived instead of deleted
const ArchivedPageSchema = new mongoose.Schema({
  // Reference to original comic
  comicId: { type: String, required: true, index: true },
  comicTitle: String,

  // Original page data
  pageId: { type: String, required: true },
  originalPageNumber: Number,

  // Page content (same structure as Page in Comic)
  masterImage: String,
  lines: [mongoose.Schema.Types.Mixed],
  dividerLines: {
    horizontal: [Number],
    vertical: [mongoose.Schema.Types.Mixed]
  },
  panels: [mongoose.Schema.Types.Mixed],
  bubbles: [mongoose.Schema.Types.Mixed],

  // Archive metadata
  archivedAt: { type: Date, default: Date.now },
  archivedReason: String
}, {
  timestamps: true
});

// Index for faster queries
ArchivedPageSchema.index({ comicId: 1, archivedAt: -1 });

module.exports = mongoose.model('ArchivedPage', ArchivedPageSchema);

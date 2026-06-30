const mongoose = require('mongoose');

// A global admin notebook page that ships to all readers (grammar explanations, etc.).
const NotebookNoteSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  title: { type: String, default: '' },
  body: { type: String, default: '' },
  order: { type: Number, default: 0 },
}, { timestamps: true });

NotebookNoteSchema.index({ order: 1 });

module.exports = mongoose.model('NotebookNote', NotebookNoteSchema);

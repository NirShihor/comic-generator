const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const NotebookNote = require('../models/NotebookNote');

// Authoring routes (behind authMiddleware). The reader fetches the public copy
// from /api/reader/notebook.

// List all notes, ordered.
router.get('/', async (req, res) => {
  try {
    const notes = await NotebookNote.find().sort({ order: 1, createdAt: 1 });
    res.json({ notes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a note (appended to the end by default).
router.post('/', async (req, res) => {
  try {
    const count = await NotebookNote.countDocuments();
    const note = await NotebookNote.create({
      id: uuidv4(),
      title: req.body.title || '',
      body: req.body.body || '',
      order: typeof req.body.order === 'number' ? req.body.order : count,
    });
    res.json(note);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a note.
router.put('/:id', async (req, res) => {
  try {
    const update = {};
    if (req.body.title !== undefined) update.title = req.body.title;
    if (req.body.body !== undefined) update.body = req.body.body;
    if (req.body.order !== undefined) update.order = req.body.order;
    const note = await NotebookNote.findOneAndUpdate(
      { id: req.params.id }, { $set: update }, { new: true }
    );
    if (!note) return res.status(404).json({ error: 'Note not found' });
    res.json(note);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a note.
router.delete('/:id', async (req, res) => {
  try {
    await NotebookNote.deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reorder: body { ids: [...] } in the desired order.
router.post('/reorder', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    await Promise.all(ids.map((id, idx) => NotebookNote.updateOne({ id }, { $set: { order: idx } })));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

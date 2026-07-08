const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const Background = require('../models/Background');

// GET all backgrounds (newest first). Optional ?collectionId= filter.
router.get('/', async (req, res) => {
  try {
    const query = {};
    if (req.query.collectionId) query.collectionId = req.query.collectionId;
    const backgrounds = await Background.find(query).sort({ updatedAt: -1 });
    res.json(backgrounds);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create a background. Expects an already-uploaded image path (via
// /api/images/upload) plus a label and optional collection association.
router.post('/', async (req, res) => {
  try {
    const { name, image, collectionId, collectionTitle, description } = req.body;
    if (!image) return res.status(400).json({ error: 'image is required' });
    const background = await Background.create({
      id: crypto.randomUUID(),
      name: name || 'Untitled',
      image,
      collectionId: collectionId || '',
      collectionTitle: collectionTitle || '',
      description: description || ''
    });
    res.status(201).json(background);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update a background's label / collection / description.
router.put('/:id', async (req, res) => {
  try {
    const update = {};
    for (const f of ['name', 'collectionId', 'collectionTitle', 'description']) {
      if (req.body[f] !== undefined) update[f] = req.body[f];
    }
    const background = await Background.findOneAndUpdate(
      { id: req.params.id }, update, { new: true }
    );
    if (!background) return res.status(404).json({ error: 'Background not found' });
    res.json(background);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE a background (removes the library entry; the file on disk is left
// alone since pages that already used it keep their own copy).
router.delete('/:id', async (req, res) => {
  try {
    const result = await Background.findOneAndDelete({ id: req.params.id });
    if (!result) return res.status(404).json({ error: 'Background not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

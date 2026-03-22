const express = require('express');
const router = express.Router();
const Collection = require('../models/Collection');

// GET all collections
router.get('/', async (req, res) => {
  try {
    const collections = await Collection.find().sort({ updatedAt: -1 });
    res.json(collections);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET single collection by id
router.get('/:id', async (req, res) => {
  try {
    const collection = await Collection.findOne({ id: req.params.id });
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    res.json(collection);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create collection
router.post('/', async (req, res) => {
  try {
    const collection = new Collection(req.body);
    await collection.save();
    res.status(201).json(collection);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update collection (upsert - create if doesn't exist)
router.put('/:id', async (req, res) => {
  try {
    const collection = await Collection.findOneAndUpdate(
      { id: req.params.id },
      { ...req.body, id: req.params.id },
      { new: true, upsert: true, runValidators: true }
    );
    res.json(collection);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

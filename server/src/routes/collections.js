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

// Update collection identity (name / English title / description) and
// propagate the Spanish title to every comic in the collection — the reader
// groups episodes by each comic's own collectionTitle copy, so a rename that
// touches only the Collection doc (or one comic) splits the collection.
router.put('/:id/identity', async (req, res) => {
  try {
    const { title, titleEn, description } = req.body;
    const set = {};
    if (title !== undefined) set.title = title;
    if (titleEn !== undefined) set.titleEn = titleEn;
    if (description !== undefined) set.description = description;
    const collection = await Collection.findOneAndUpdate(
      { id: req.params.id },
      { $set: set },
      { new: true, upsert: true }
    );
    let comicsUpdated = 0;
    if (title !== undefined) {
      const Comic = require('../models/Comic');
      const r = await Comic.updateMany(
        { collectionId: req.params.id },
        { $set: { collectionTitle: title } }
      );
      comicsUpdated = r.modifiedCount || 0;
    }
    res.json({ collection, comicsUpdated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

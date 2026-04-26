const mongoose = require('mongoose');

// Character/Reference Schema (same as in Comic)
const CharacterSchema = new mongoose.Schema({
  id: String,
  name: String,
  description: String,
  image: String
}, { _id: false });

// Style Bible Image Schema (same as in Comic)
const StyleImageSchema = new mongoose.Schema({
  id: String,
  name: String,
  image: String,
  description: String
}, { _id: false });

// Voice Schema (same as in Comic)
const VoiceSchema = new mongoose.Schema({
  name: String,
  voiceId: String
}, { _id: false });

// Collection Schema
const CollectionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  title: String,
  description: String,
  coverImage: String,
  coverPrompt: String,
  coverBrightness: { type: Number, default: 1 },
  coverContrast: { type: Number, default: 1 },
  coverSaturation: { type: Number, default: 1 },
  voices: [VoiceSchema],
  promptSettings: {
    styleBible: String,
    styleBibleImages: [StyleImageSchema],
    cameraInks: String,
    characters: [CharacterSchema],
    globalDoNot: String,
    hardNegatives: String,
    masterStyleImage: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

module.exports = mongoose.model('Collection', CollectionSchema);

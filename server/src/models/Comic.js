const mongoose = require('mongoose');

// Word Schema (nested in Sentence)
const WordSchema = new mongoose.Schema({
  id: String,
  text: String,
  meaning: String,
  baseForm: String
}, { _id: false });

// Sentence Schema (nested in Bubble)
const SentenceSchema = new mongoose.Schema({
  id: String,
  text: String,
  translation: String,
  audioUrl: String,
  words: [WordSchema]
}, { _id: false });

// Bubble Schema (nested in Panel)
const BubbleSchema = new mongoose.Schema({
  id: String,
  type: { type: String, enum: ['speech', 'thought', 'narration'], default: 'speech' },
  x: Number,
  y: Number,
  width: Number,
  height: Number,
  // Tail properties
  tailX: Number,
  tailY: Number,
  tailSide: { type: String, enum: ['top', 'bottom', 'left', 'right'], default: 'bottom' },
  tailBaseX: Number,
  tailWidth: Number,
  tailCtrl1X: Number,
  tailCtrl1Y: Number,
  tailCtrl2X: Number,
  tailCtrl2Y: Number,
  showTail: { type: Boolean, default: true },
  rotation: Number, // Rotation angle in degrees (0 = tail at bottom)
  tailLength: Number, // Length of tail relative to bubble height
  tailCurve: Number, // Tail angle: negative = left, positive = right
  tailBend: Number, // Tail curvature: negative = bend left, positive = bend right
  textAngle: Number, // Rotation angle for text inside bubble
  isSoundEffect: Boolean, // If true, this is a sound effect text (no TTS audio)
  // Styling
  bgColor: String,
  bgTransparent: Boolean,
  borderColor: String,
  borderWidth: Number,
  noBorder: Boolean,
  // Font
  fontId: String,
  fontSize: Number,
  textColor: String,
  textAlign: { type: String, enum: ['left', 'center', 'right'], default: 'center' },
  italic: Boolean,
  uppercase: Boolean,
  cornerRadius: Number,
  // Content
  sentences: [SentenceSchema]
}, { _id: false });

// Panel Schema (nested in Page)
const PanelSchema = new mongoose.Schema({
  id: String,
  panelOrder: Number,
  tapZone: {
    x: Number,
    y: Number,
    width: Number,
    height: Number
  },
  artworkImage: String,
  content: String,
  bubbles: [BubbleSchema]
}, { _id: false });

// Line Schema (for panel dividers)
const LineSchema = new mongoose.Schema({
  type: { type: String, enum: ['horizontal', 'vertical'] },
  x: Number,
  y: Number,
  x1: Number,
  x2: Number,
  y1: Number,
  y2: Number
}, { _id: false });

// Page Schema (nested in Comic)
const PageSchema = new mongoose.Schema({
  id: String,
  pageNumber: Number,
  masterImage: String,
  lines: [LineSchema],
  // Legacy format support
  dividerLines: {
    horizontal: [Number],
    vertical: [mongoose.Schema.Types.Mixed]
  },
  panels: [PanelSchema],
  bubbles: [BubbleSchema]
}, { _id: false });

// Character Schema (for prompt templates)
const CharacterSchema = new mongoose.Schema({
  id: String,
  name: String,
  description: String
}, { _id: false });

// Voice Schema (for ElevenLabs voices)
const VoiceSchema = new mongoose.Schema({
  name: String,
  voiceId: String
}, { _id: false });

// Main Comic Schema
const ComicSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true },
  description: String,
  level: { type: String, enum: ['beginner', 'intermediate', 'advanced'], default: 'beginner' },
  language: { type: String, default: 'es' },
  targetLanguage: { type: String, default: 'en' },
  cover: {
    image: String,
    sceneImage: String
  },
  voices: [VoiceSchema],
  promptTemplates: {
    styleBible: String,
    cameraInks: String,
    characters: [CharacterSchema],
    globalDoNot: String,
    hardNegatives: String
  },
  promptSettings: {
    styleBible: String,
    cameraInks: String,
    characters: [CharacterSchema],
    globalDoNot: String,
    hardNegatives: String
  },
  pages: [PageSchema]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index for faster queries
ComicSchema.index({ title: 1 });
ComicSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Comic', ComicSchema);

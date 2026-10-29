const mongoose = require('mongoose');

// ---------------------------------------------------------------------------
// Story: the creative-development document for a collection (or a standalone
// comic). It lives beside Comic/Collection and never inside them: a comic is
// only created or touched at the hand-off stage, and existing comics are
// never modified by the story workshop.
//
// Everything the AI proposes is a *proposal* until the author accepts it.
// Accepted bible entries and decisions are the only material later prompts
// treat as fixed; the AI is told to propose an update rather than contradict
// them. Approving a stage snapshots it into `versions`, so later failures or
// rejected proposals can never damage approved work.
// ---------------------------------------------------------------------------

const BIBLE_CATEGORIES = [
  'character', 'relationship', 'location', 'timeline', 'fact', 'motivation',
  'object', 'mystery', 'revelation', 'arc', 'theme', 'other'
];

const ENTRY_STATUS = ['proposed', 'approved', 'rejected'];

// One Story Bible entry (a character, a location, an established fact, …).
const BibleEntrySchema = new mongoose.Schema({
  id: String,
  category: { type: String, enum: BIBLE_CATEGORIES, default: 'other' },
  name: String,                       // short label: "Elena Vega", "The black cards"
  text: String,                       // the entry itself (markdown-free prose)
  status: { type: String, enum: ENTRY_STATUS, default: 'proposed' },
  source: { type: String, enum: ['user', 'ai'], default: 'user' },
  createdAt: Date,
  updatedAt: Date,
  approvedAt: Date
}, { _id: false });

// A creative decision in one plain sentence ("The stranger is the sheriff's
// brother", "Comic 1 ends with the first card found on the church door").
const DecisionSchema = new mongoose.Schema({
  id: String,
  text: String,
  rationale: String,
  status: { type: String, enum: ['proposed', 'approved', 'rejected', 'superseded'], default: 'proposed' },
  source: { type: String, enum: ['user', 'ai'], default: 'user' },
  supersededBy: String,               // id of the decision that replaced this one
  createdAt: Date,
  updatedAt: Date,
  approvedAt: Date
}, { _id: false });

// One item the AI put forward in a reply. Accepting applies it to the bible
// or the decisions list; until then it changes nothing.
const ProposalItemSchema = new mongoose.Schema({
  id: String,
  kind: { type: String, enum: ['bible', 'decision'] },
  action: { type: String, enum: ['add', 'update', 'remove'], default: 'add' },
  category: String,                   // bible entries only
  targetId: String,                   // update/remove: the existing entry/decision id
  name: String,
  text: String,
  rationale: String,
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  resolvedAt: Date,
  resultId: String                    // id of the entry/decision created or changed on accept
}, { _id: false });

const ChallengeSchema = new mongoose.Schema({
  about: String,                      // what part of the story this is about
  problem: String,                    // the weakness, stated plainly
  suggestion: String                  // one concrete way to fix it
}, { _id: false });

const MessageSchema = new mongoose.Schema({
  id: String,
  role: { type: String, enum: ['user', 'assistant'] },
  content: String,                    // markdown
  challenges: [ChallengeSchema],      // assistant only: pushback on weak storytelling
  questions: [String],                // assistant only: what it needs from the author
  proposals: [ProposalItemSchema],    // assistant only
  model: String,
  usage: { input: Number, output: Number },
  error: String,                      // set when the AI call failed; the user message is kept
  createdAt: Date
}, { _id: false });

const ThreadSchema = new mongoose.Schema({
  id: String,
  stage: String,                      // 'development' now; later stages add their own threads
  episodeIndex: Number,               // per-episode threads (stages 2+)
  summary: String,                    // rolling summary of older turns no longer sent verbatim
  messages: [MessageSchema]
}, { _id: false });

const ConceptCharacterSchema = new mongoose.Schema({
  id: String,
  name: String,
  age: String,
  personality: String,
  relationships: String,
  notes: String
}, { _id: false });

const ConceptSchema = new mongoose.Schema({
  characters: [ConceptCharacterSchema],
  setting: String,                    // place
  period: String,                     // historical period / year
  genre: String,
  premise: String,                    // the basic idea, free text
  comicCount: Number,                 // intended number of comics in the collection
  pagesPerComic: Number,              // approximate story pages per comic
  cefr: { type: String, enum: ['A1', 'A2', 'B1', 'B2'], default: 'A1' },
  tone: String,
  notes: String
}, { _id: false });

const VersionSchema = new mongoose.Schema({
  id: String,
  stage: String,                      // which stage was approved
  note: String,
  snapshot: mongoose.Schema.Types.Mixed,
  createdAt: Date
}, { _id: false });

const STAGES = [
  'concept', 'development', 'script', 'review', 'adaptation', 'spanishReview', 'artwork'
];

const StorySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true },
  kind: { type: String, enum: ['collection', 'standalone'], default: 'collection' },
  collectionId: String,               // set at hand-off (or when attached to an existing collection)
  stage: { type: String, enum: STAGES, default: 'concept' },
  // Stage approvals: ISO date per stage key once the author approved it.
  approvals: mongoose.Schema.Types.Mixed,
  concept: ConceptSchema,
  bible: [BibleEntrySchema],
  decisions: [DecisionSchema],
  threads: [ThreadSchema],
  episodes: [mongoose.Schema.Types.Mixed],   // outlines/scripts arrive in stage 2+
  versions: [VersionSchema],
  // Per-story model overrides (env STORY_WRITER_MODEL / STORY_CRITIC_MODEL are the defaults).
  models: { writer: String, critic: String }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

StorySchema.index({ updatedAt: -1 });

module.exports = mongoose.model('Story', StorySchema);
module.exports.BIBLE_CATEGORIES = BIBLE_CATEGORIES;
module.exports.STAGES = STAGES;

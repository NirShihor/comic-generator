// Story workshop API (stage 1: concept, collaborative development, bible,
// decisions, approvals). Mounted at /api/stories. Nothing here reads or
// writes Comic/Collection documents.
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const Story = require('../models/Story');
const { BIBLE_CATEGORIES, STAGES } = Story;
const storyAi = require('../services/storyAi');

const nid = (prefix) => `${prefix}-${uuidv4().slice(0, 8)}`;
const str = (v, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? undefined : Number(v));

async function load(req, res) {
  const story = await Story.findOne({ id: req.params.id });
  if (!story) { res.status(404).json({ error: 'Story not found' }); return null; }
  return story;
}

function summarise(story) {
  const bible = story.bible || [], decisions = story.decisions || [];
  const messages = (story.threads || []).reduce((n, t) => n + (t.messages || []).length, 0);
  return {
    id: story.id, title: story.title, kind: story.kind, stage: story.stage,
    cefr: story.concept?.cefr, genre: story.concept?.genre,
    approvals: story.approvals || {},
    counts: {
      bibleApproved: bible.filter(e => e.status === 'approved').length,
      bibleProposed: bible.filter(e => e.status === 'proposed').length,
      decisionsApproved: decisions.filter(d => d.status === 'approved').length,
      messages
    },
    createdAt: story.createdAt, updatedAt: story.updatedAt
  };
}

function cleanConcept(input = {}) {
  const characters = Array.isArray(input.characters) ? input.characters : [];
  return {
    characters: characters
      .map(ch => ({
        id: str(ch.id, 40) || nid('char'),
        name: str(ch.name, 120), age: str(ch.age, 40), personality: str(ch.personality, 1000),
        relationships: str(ch.relationships, 1000), notes: str(ch.notes, 1000)
      }))
      .filter(ch => ch.name || ch.personality || ch.relationships || ch.notes),
    setting: str(input.setting, 500), period: str(input.period, 200), genre: str(input.genre, 200),
    premise: str(input.premise, 8000), tone: str(input.tone, 500), notes: str(input.notes, 8000),
    comicCount: num(input.comicCount), pagesPerComic: num(input.pagesPerComic),
    cefr: ['A1', 'A2', 'B1', 'B2'].includes(input.cefr) ? input.cefr : 'A1'
  };
}

// --- models in use (for the workshop footer) --------------------------------
router.get('/models', (req, res) => {
  res.json({ writer: storyAi.WRITER_MODEL, critic: storyAi.CRITIC_MODEL });
});

// --- stories ----------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const stories = await Story.find({}).sort({ updatedAt: -1 });
    res.json(stories.map(summarise));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const title = str(req.body?.title, 200);
    if (!title) return res.status(400).json({ error: 'A title is required' });
    const story = new Story({
      id: nid('story'), title,
      kind: req.body?.kind === 'standalone' ? 'standalone' : 'collection',
      stage: 'concept', approvals: {},
      concept: cleanConcept(req.body?.concept || {}),
      bible: [], decisions: [], threads: [], episodes: [], versions: []
    });
    await story.save();
    res.json(story);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try { const story = await load(req, res); if (story) res.json(story); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const story = await load(req, res); if (!story) return;
    const b = req.body || {};
    if (typeof b.title === 'string' && b.title.trim()) story.title = str(b.title, 200);
    if (b.stage && STAGES.includes(b.stage)) story.stage = b.stage;
    if (b.kind === 'collection' || b.kind === 'standalone') story.kind = b.kind;
    if (b.models && typeof b.models === 'object') {
      story.models = { writer: str(b.models.writer, 80) || undefined, critic: str(b.models.critic, 80) || undefined };
    }
    await story.save();
    res.json(story);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await Story.deleteOne({ id: req.params.id });
    if (!r.deletedCount) return res.status(404).json({ error: 'Story not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/concept', async (req, res) => {
  try {
    const story = await load(req, res); if (!story) return;
    story.concept = cleanConcept(req.body?.concept || req.body || {});
    story.markModified('concept');
    await story.save();
    res.json(story);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- threads ----------------------------------------------------------------
function getThread(story, stage, create) {
  let thread = (story.threads || []).find(t => t.stage === stage && t.episodeIndex == null);
  if (!thread && create) {
    thread = { id: nid('thread'), stage, messages: [] };
    story.threads.push(thread);
    thread = story.threads[story.threads.length - 1];
  }
  return thread;
}

router.get('/:id/threads/:stage', async (req, res) => {
  try {
    const story = await load(req, res); if (!story) return;
    res.json(getThread(story, req.params.stage, false) || { stage: req.params.stage, messages: [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Send the author's message and get the collaborator's reply. The author's
// message is saved before the model is called, so an API failure loses
// nothing; the failure is recorded as an assistant message with `error`.
router.post('/:id/threads/:stage/messages', async (req, res) => {
  try {
    if (req.params.stage !== 'development') return res.status(400).json({ error: 'Only the development thread exists in this stage of the workshop' });
    const story = await load(req, res); if (!story) return;
    const thread = getThread(story, 'development', true);
    let content = str(req.body?.content, 20000);
    if (!content) {
      if (thread.messages.length) return res.status(400).json({ error: 'Empty message' });
      content = storyAi.KICKOFF_MESSAGE;
    }
    thread.messages.push({ id: nid('msg'), role: 'user', content, createdAt: new Date() });
    if (story.stage === 'concept') story.stage = 'development';
    story.markModified('threads');
    await story.save();

    let reply;
    try {
      reply = await storyAi.developmentTurn(story, thread);
    } catch (err) {
      console.error('Story development turn failed:', err.message);
      thread.messages.push({ id: nid('msg'), role: 'assistant', content: '', error: err.message, createdAt: new Date() });
      story.markModified('threads');
      await story.save();
      return res.status(502).json({ error: err.message, story });
    }
    thread.messages.push({
      id: nid('msg'), role: 'assistant', content: reply.content,
      challenges: reply.challenges, questions: reply.questions,
      proposals: reply.proposals.map(p => ({ ...p, id: nid('prop'), status: 'pending' })),
      model: reply.model, usage: reply.usage, createdAt: new Date()
    });
    story.markModified('threads');
    await story.save();
    res.json(story);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Remove a failed assistant turn (and the author message before it) so the
// author can resend without a dead exchange in the history.
router.delete('/:id/threads/:stage/messages/:messageId', async (req, res) => {
  try {
    const story = await load(req, res); if (!story) return;
    const thread = getThread(story, req.params.stage, false);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    const idx = thread.messages.findIndex(m => m.id === req.params.messageId);
    if (idx < 0) return res.status(404).json({ error: 'Message not found' });
    const m = thread.messages[idx];
    const hasPending = (m.proposals || []).some(p => p.status !== 'pending') ;
    if (m.role === 'assistant' && hasPending) return res.status(400).json({ error: 'This reply has accepted or rejected proposals and is kept for the record' });
    thread.messages.splice(idx, 1);
    if (m.role === 'assistant' && idx > 0 && thread.messages[idx - 1].role === 'user') thread.messages.splice(idx - 1, 1);
    story.markModified('threads');
    await story.save();
    res.json(story);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- proposals --------------------------------------------------------------
function findProposal(story, proposalId) {
  for (const t of story.threads || []) for (const m of t.messages || []) for (const p of m.proposals || []) {
    if (p.id === proposalId) return p;
  }
  return null;
}

function applyProposal(story, p) {
  const now = new Date();
  if (p.kind === 'bible') {
    if (p.action === 'add') {
      const entry = { id: nid('entry'), category: BIBLE_CATEGORIES.includes(p.category) ? p.category : 'other', name: p.name || '', text: p.text, status: 'approved', source: 'ai', createdAt: now, updatedAt: now, approvedAt: now };
      story.bible.push(entry);
      return entry.id;
    }
    const target = story.bible.find(e => e.id === p.targetId);
    if (!target) throw new Error('The entry this proposal refers to no longer exists');
    if (p.action === 'update') {
      if (p.name) target.name = p.name;
      target.text = p.text; target.updatedAt = now;
      if (target.status !== 'approved') { target.status = 'approved'; target.approvedAt = now; }
    } else {
      target.status = 'rejected'; target.updatedAt = now;
    }
    return target.id;
  }
  // decision
  if (p.action === 'add') {
    const d = { id: nid('dec'), text: p.text, rationale: p.rationale || '', status: 'approved', source: 'ai', createdAt: now, updatedAt: now, approvedAt: now };
    story.decisions.push(d);
    return d.id;
  }
  const target = story.decisions.find(d => d.id === p.targetId);
  if (!target) throw new Error('The decision this proposal refers to no longer exists');
  if (p.action === 'update') {
    const d = { id: nid('dec'), text: p.text, rationale: p.rationale || '', status: 'approved', source: 'ai', createdAt: now, updatedAt: now, approvedAt: now };
    target.status = 'superseded'; target.supersededBy = d.id; target.updatedAt = now;
    story.decisions.push(d);
    return d.id;
  }
  target.status = 'rejected'; target.updatedAt = now;
  return target.id;
}

// Rejecting an "add" keeps a rejected record so the model is told not to
// propose it again.
function recordRejection(story, p) {
  const now = new Date();
  if (p.action !== 'add') return;
  if (p.kind === 'bible') {
    story.bible.push({ id: nid('entry'), category: BIBLE_CATEGORIES.includes(p.category) ? p.category : 'other', name: p.name || '', text: p.text, status: 'rejected', source: 'ai', createdAt: now, updatedAt: now });
  } else {
    story.decisions.push({ id: nid('dec'), text: p.text, rationale: p.rationale || '', status: 'rejected', source: 'ai', createdAt: now, updatedAt: now });
  }
}

router.post('/:id/proposals/:proposalId/:verdict', async (req, res) => {
  try {
    const { verdict } = req.params;
    if (!['accept', 'reject'].includes(verdict)) return res.status(400).json({ error: 'verdict must be accept or reject' });
    const story = await load(req, res); if (!story) return;
    const p = findProposal(story, req.params.proposalId);
    if (!p) return res.status(404).json({ error: 'Proposal not found' });
    if (p.status !== 'pending') return res.status(400).json({ error: `Proposal already ${p.status}` });
    if (verdict === 'accept') { p.resultId = applyProposal(story, p); p.status = 'accepted'; }
    else { recordRejection(story, p); p.status = 'rejected'; }
    p.resolvedAt = new Date();
    story.markModified('threads'); story.markModified('bible'); story.markModified('decisions');
    await story.save();
    res.json(story);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/:id/messages/:messageId/accept-all', async (req, res) => {
  try {
    const story = await load(req, res); if (!story) return;
    let msg = null;
    for (const t of story.threads || []) msg = msg || (t.messages || []).find(m => m.id === req.params.messageId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    const failures = [];
    for (const p of msg.proposals || []) {
      if (p.status !== 'pending') continue;
      try { p.resultId = applyProposal(story, p); p.status = 'accepted'; p.resolvedAt = new Date(); }
      catch (e) { failures.push({ id: p.id, error: e.message }); }
    }
    story.markModified('threads'); story.markModified('bible'); story.markModified('decisions');
    await story.save();
    res.json({ story, failures });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- bible & decisions (manual) --------------------------------------------
router.post('/:id/bible', async (req, res) => {
  try {
    const story = await load(req, res); if (!story) return;
    const b = req.body || {};
    const text = str(b.text, 4000);
    if (!text) return res.status(400).json({ error: 'text is required' });
    const now = new Date();
    const entry = { id: nid('entry'), category: BIBLE_CATEGORIES.includes(b.category) ? b.category : 'other', name: str(b.name, 200), text, status: b.status === 'proposed' ? 'proposed' : 'approved', source: 'user', createdAt: now, updatedAt: now, approvedAt: b.status === 'proposed' ? undefined : now };
    story.bible.push(entry);
    await story.save();
    res.json(story);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/bible/:entryId', async (req, res) => {
  try {
    const story = await load(req, res); if (!story) return;
    const e = story.bible.find(x => x.id === req.params.entryId);
    if (!e) return res.status(404).json({ error: 'Entry not found' });
    const b = req.body || {};
    if (typeof b.name === 'string') e.name = str(b.name, 200);
    if (typeof b.text === 'string' && b.text.trim()) e.text = str(b.text, 4000);
    if (BIBLE_CATEGORIES.includes(b.category)) e.category = b.category;
    if (['proposed', 'approved', 'rejected'].includes(b.status) && b.status !== e.status) {
      e.status = b.status;
      if (b.status === 'approved') e.approvedAt = new Date();
    }
    e.updatedAt = new Date();
    story.markModified('bible');
    await story.save();
    res.json(story);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/bible/:entryId', async (req, res) => {
  try {
    const story = await load(req, res); if (!story) return;
    const n = story.bible.length;
    story.bible = story.bible.filter(x => x.id !== req.params.entryId);
    if (story.bible.length === n) return res.status(404).json({ error: 'Entry not found' });
    await story.save();
    res.json(story);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/decisions', async (req, res) => {
  try {
    const story = await load(req, res); if (!story) return;
    const b = req.body || {};
    const text = str(b.text, 2000);
    if (!text) return res.status(400).json({ error: 'text is required' });
    const now = new Date();
    story.decisions.push({ id: nid('dec'), text, rationale: str(b.rationale, 2000), status: b.status === 'proposed' ? 'proposed' : 'approved', source: 'user', createdAt: now, updatedAt: now, approvedAt: b.status === 'proposed' ? undefined : now });
    await story.save();
    res.json(story);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/decisions/:decisionId', async (req, res) => {
  try {
    const story = await load(req, res); if (!story) return;
    const d = story.decisions.find(x => x.id === req.params.decisionId);
    if (!d) return res.status(404).json({ error: 'Decision not found' });
    const b = req.body || {};
    if (typeof b.text === 'string' && b.text.trim()) d.text = str(b.text, 2000);
    if (typeof b.rationale === 'string') d.rationale = str(b.rationale, 2000);
    if (['proposed', 'approved', 'rejected'].includes(b.status) && b.status !== d.status) {
      d.status = b.status;
      if (b.status === 'approved') d.approvedAt = new Date();
    }
    d.updatedAt = new Date();
    story.markModified('decisions');
    await story.save();
    res.json(story);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/decisions/:decisionId', async (req, res) => {
  try {
    const story = await load(req, res); if (!story) return;
    const n = story.decisions.length;
    story.decisions = story.decisions.filter(x => x.id !== req.params.decisionId);
    if (story.decisions.length === n) return res.status(404).json({ error: 'Decision not found' });
    await story.save();
    res.json(story);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- stage approval ---------------------------------------------------------
// Snapshots the approved material of a stage. Stage 1 approves the story
// foundation (concept + approved bible + approved decisions); later stages add
// their own snapshots. Approving never changes the working copy.
router.post('/:id/approve', async (req, res) => {
  try {
    const story = await load(req, res); if (!story) return;
    const stage = STAGES.includes(req.body?.stage) ? req.body.stage : 'development';
    if (stage !== 'development') return res.status(400).json({ error: 'Only the development stage can be approved in this version of the workshop' });
    const snapshot = {
      concept: story.concept,
      bible: story.bible.filter(e => e.status === 'approved'),
      decisions: story.decisions.filter(d => d.status === 'approved')
    };
    const version = { id: nid('ver'), stage, note: str(req.body?.note, 500), snapshot, createdAt: new Date() };
    story.versions.push(version);
    story.approvals = { ...(story.approvals || {}), [stage]: version.createdAt };
    story.markModified('approvals');
    await story.save();
    res.json(story);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

// AI collaborator for the story workshop (stage 1: story development).
//
// Principles baked into the prompts:
//   - the author decides; the AI proposes. Nothing is applied until accepted.
//   - approved bible entries and decisions are fixed: the AI may propose an
//     update to one, never contradict it silently.
//   - the AI is asked to challenge weak storytelling, not to flatter.
// Every reply is structured output validated with AJV before it is stored, so
// a malformed reply never reaches the bible. A failed call keeps the author's
// message and records the error on the thread.

const OpenAI = require('openai');
const Ajv = require('ajv');
const { BIBLE_CATEGORIES } = require('../models/Story');

const WRITER_MODEL = process.env.STORY_WRITER_MODEL || 'gpt-5.5';
// The critic is wired in stage 4 (editorial review); the setting lives here so
// the whole workshop reads models from one place.
const CRITIC_MODEL = process.env.STORY_CRITIC_MODEL || 'gemini-3.1-pro-preview';
const HISTORY_TURNS = 30;            // most recent messages sent verbatim
const MAX_OUTPUT_TOKENS = 6000;

const ajv = new Ajv({ allErrors: true });

// Structured-output schema for a development reply. OpenAI strict mode needs
// every property listed in `required` and additionalProperties:false; optional
// values are expressed as nullable.
const replySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reply: { type: 'string', description: 'The conversational answer to the author, in markdown. Concise; no restating of the whole story.' },
    challenges: {
      type: 'array',
      description: 'Pushback on weak storytelling in what the author has so far or just said. Empty when there is nothing worth challenging.',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          about: { type: 'string' },
          problem: { type: 'string' },
          suggestion: { type: 'string' }
        },
        required: ['about', 'problem', 'suggestion']
      }
    },
    questions: {
      type: 'array', items: { type: 'string' },
      description: 'Questions the author should answer next, in priority order. At most three.'
    },
    proposals: {
      type: 'array',
      description: 'Concrete additions or changes to the Story Bible or the decisions list, each self-contained. Only what this turn actually proposes.',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['bible', 'decision'] },
          action: { type: 'string', enum: ['add', 'update', 'remove'] },
          category: { type: ['string', 'null'], enum: [...BIBLE_CATEGORIES, null] },
          targetId: { type: ['string', 'null'], description: 'For update/remove: the id of the existing entry or decision.' },
          name: { type: ['string', 'null'], description: 'Short label for a bible entry. Null for decisions.' },
          text: { type: 'string', description: 'The entry text or the decision in one or two sentences.' },
          rationale: { type: ['string', 'null'] }
        },
        required: ['kind', 'action', 'category', 'targetId', 'name', 'text', 'rationale']
      }
    }
  },
  required: ['reply', 'challenges', 'questions', 'proposals']
};
const validateReply = ajv.compile(replySchema);

function formatConcept(c = {}) {
  const lines = [];
  if (c.genre) lines.push(`Genre: ${c.genre}`);
  if (c.setting || c.period) lines.push(`Setting: ${[c.setting, c.period].filter(Boolean).join(', ')}`);
  if (c.premise) lines.push(`Premise: ${c.premise}`);
  if (c.tone) lines.push(`Tone: ${c.tone}`);
  if (c.comicCount) lines.push(`Collection: ${c.comicCount} comic${c.comicCount === 1 ? '' : 's'}${c.pagesPerComic ? `, about ${c.pagesPerComic} story pages each` : ''}`);
  else if (c.pagesPerComic) lines.push(`About ${c.pagesPerComic} story pages`);
  if (c.cefr) lines.push(`Target Spanish level (for the later adaptation only): ${c.cefr}`);
  const chars = (c.characters || []).filter(ch => ch.name || ch.personality || ch.notes);
  if (chars.length) {
    lines.push('Characters given by the author:');
    for (const ch of chars) {
      const bits = [ch.age && `age ${ch.age}`, ch.personality, ch.relationships && `relationships: ${ch.relationships}`, ch.notes].filter(Boolean);
      lines.push(`- ${ch.name || '(unnamed)'}${bits.length ? ' — ' + bits.join('; ') : ''}`);
    }
  }
  if (c.notes) lines.push(`Author's notes: ${c.notes}`);
  return lines.length ? lines.join('\n') : '(no concept details yet)';
}

function formatBible(bible = [], status) {
  const items = bible.filter(e => e.status === status);
  if (!items.length) return '(none)';
  const byCat = {};
  for (const e of items) (byCat[e.category] ||= []).push(e);
  return Object.entries(byCat).map(([cat, list]) =>
    `${cat}:\n` + list.map(e => `  [${e.id}] ${e.name ? e.name + ': ' : ''}${e.text}`).join('\n')
  ).join('\n');
}

function formatDecisions(decisions = [], status) {
  const items = decisions.filter(d => d.status === status);
  return items.length ? items.map(d => `  [${d.id}] ${d.text}`).join('\n') : '(none)';
}

function pendingProposals(thread) {
  const out = [];
  for (const m of thread.messages || []) {
    for (const p of m.proposals || []) if (p.status === 'pending') out.push(p);
  }
  return out;
}

function buildSystemPrompt(story, thread) {
  const c = story.concept || {};
  const pending = pendingProposals(thread);
  return `You are the story editor and co-writer for Comigo, a series of Spanish-learning comics. You are working with the author on the STORY DEVELOPMENT stage: premise, characters, motivations, conflict, stakes, mystery, turning points, climax, resolution, and the hooks between the comics of a collection. Dialogue and page-by-page scripting come later; the Spanish adaptation comes later still, so write and think in English and do not simplify ideas for language level now.

How this collaboration works
- The author is the creative director. You propose; nothing is approved until the author accepts it in the workshop. Do not describe your proposals as decided.
- APPROVED bible entries and decisions below are fixed. Build on them. If you believe one should change, say so and propose an "update" to that exact id with your reasoning; never contradict an approved item silently or restate it differently.
- Do not re-propose items that are listed as pending (awaiting the author's verdict) or rejected. If the author asks for alternatives, offer genuinely different ones.
- Be a demanding editor. When the premise is predictable, a motivation is thin, the protagonist is passive, the stakes are abstract, the conflict is unconvincing, or a scene would exist only to explain the plot, say so plainly in "challenges" with one concrete fix each. Do not praise for the sake of it. When something is genuinely strong, say briefly why it works.
- Offer alternatives where a choice matters (two or three, clearly different), and recommend one.
- Comics are a visual medium: favour conflict shown through action and images over explanation.
- The reader's free preview of each comic is the cover plus its first three story pages. The opening pages must give a reader a real reason to keep going, through character and situation, never a tacked-on cliffhanger. The story must work as entertainment on its own: if an English reader who was not learning Spanish would not want to know what happens next, it is not good enough yet.
- Keep "reply" conversational and focused on the current question; put durable material in "proposals" as self-contained bible entries or one-sentence decisions, so the bible stays a clean reference. A proposal's text must stand alone without the chat.
- Bible categories: ${BIBLE_CATEGORIES.join(', ')}. Use "decision" for plot-level choices (what happens, in which comic), "bible" for facts about the world and people.

THE CONCEPT (from the author)
${formatConcept(c)}

APPROVED BIBLE
${formatBible(story.bible, 'approved')}

APPROVED DECISIONS
${formatDecisions(story.decisions, 'approved')}

PROPOSED BY YOU EARLIER, STILL AWAITING THE AUTHOR'S VERDICT (do not repeat)
${pending.length ? pending.map(p => `  (${p.kind}${p.category ? '/' + p.category : ''}) ${p.name ? p.name + ': ' : ''}${p.text}`).join('\n') : '(none)'}

REJECTED BY THE AUTHOR (do not propose again)
${[...(story.bible || []).filter(e => e.status === 'rejected').map(e => `  ${e.name ? e.name + ': ' : ''}${e.text}`),
   ...(story.decisions || []).filter(d => d.status === 'rejected').map(d => `  ${d.text}`)].join('\n') || '(none)'}
${thread.summary ? `\nSUMMARY OF EARLIER CONVERSATION\n${thread.summary}` : ''}`;
}

// The conversation history as the model sees it. Assistant turns carry their
// reply plus a one-line record of what each proposal was and what the author
// did with it, so the model knows the outcome without the bible repeating it.
function buildHistory(thread) {
  const msgs = (thread.messages || []).slice(-HISTORY_TURNS);
  return msgs.filter(m => !m.error).map(m => {
    if (m.role === 'user') return { role: 'user', content: m.content };
    const outcomes = (m.proposals || []).map(p => `- (${p.status}) ${p.kind} ${p.action}${p.name ? ' ' + p.name : ''}: ${p.text}`);
    const extra = [
      (m.challenges || []).length ? 'Challenges raised:\n' + m.challenges.map(ch => `- ${ch.about}: ${ch.problem}`).join('\n') : '',
      outcomes.length ? 'Proposals and the author\'s verdicts:\n' + outcomes.join('\n') : ''
    ].filter(Boolean).join('\n');
    return { role: 'assistant', content: extra ? `${m.content}\n\n${extra}` : m.content };
  });
}

function writerModel(story) {
  return (story.models && story.models.writer) || WRITER_MODEL;
}

/**
 * Ask the writer model for the next development turn. `thread.messages` must
 * already end with the author's message. Returns { content, challenges,
 * questions, proposals, model, usage }. Throws on API failure or when the
 * reply fails validation twice.
 */
async function developmentTurn(story, thread) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OpenAI API key not configured.');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = writerModel(story);
  const input = [
    { role: 'system', content: buildSystemPrompt(story, thread) },
    ...buildHistory(thread)
  ];

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await openai.responses.create({
      model,
      input: attempt === 0 ? input : [...input, { role: 'user', content: `Your previous reply was not valid structured output (${lastError}). Reply again following the schema exactly.` }],
      max_output_tokens: MAX_OUTPUT_TOKENS,
      text: { format: { type: 'json_schema', name: 'story_development_reply', schema: replySchema, strict: true } }
    });
    const raw = response.output_text || '';
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { lastError = 'not JSON'; continue; }
    if (!validateReply(parsed)) { lastError = ajv.errorsText(validateReply.errors); continue; }
    return {
      content: parsed.reply,
      challenges: parsed.challenges,
      questions: parsed.questions.slice(0, 3),
      proposals: parsed.proposals,
      model,
      usage: { input: response.usage?.input_tokens, output: response.usage?.output_tokens }
    };
  }
  throw new Error(`The writer model returned an unusable reply (${lastError}).`);
}

// The instruction that opens a development thread when the author presses
// "Start development": an honest assessment of the concept plus the first
// proposals and the questions that matter most.
const KICKOFF_MESSAGE = `Let's begin. Assess my concept as it stands: what is strong, what is weak or predictable, and what is missing before this can become a gripping story. Then propose the first Story Bible entries you can already stand behind (characters, setting, the central mystery or conflict) and ask me the questions that matter most.`;

module.exports = { developmentTurn, buildSystemPrompt, replySchema, validateReply, KICKOFF_MESSAGE, WRITER_MODEL, CRITIC_MODEL };

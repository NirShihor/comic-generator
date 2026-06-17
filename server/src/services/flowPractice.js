const OpenAI = require('openai');

// Flow Practice — a live conversational tutor that weaves a comic's vocabulary
// into new contexts so the learner has to understand and produce the words.
//
// Uses OpenAI (same key as the rest of the server). Default gpt-4o for sharper
// instruction-following (it follows the speech-aware correction rules far more
// reliably than gpt-4o-mini); set FLOW_PRACTICE_MODEL=gpt-4o-mini to go cheaper.
// OpenAI auto-caches the long static prefix (system prompt + vocab) for prompts
// over ~1K tokens, so repeated turns are discounted automatically.
const FLOW_MODEL = process.env.FLOW_PRACTICE_MODEL || 'gpt-4o';

// Rolling context window. Each turn is a short, self-standing Q&A exchange, so
// the model only needs the most recent few — keep the last N question/answer
// pairs and let older ones drop off. Caps token cost and keeps replies focused;
// the app still shows the full conversation on screen.
const MAX_EXCHANGES = parseInt(process.env.FLOW_MAX_EXCHANGES || '5', 10);

const LANG_NAMES = {
  es: 'Spanish', en: 'English', fr: 'French', de: 'German',
  it: 'Italian', pt: 'Portuguese', ja: 'Japanese', zh: 'Chinese',
};
const langName = (code) => LANG_NAMES[code] || code || 'the target language';

// The latest user turn is this sentinel when the app wants the AI to open.
const START_SIGNAL = '__START__';

// Per-level tuning. The comic's difficulty (beginner/intermediate/advanced) sets
// the standard for the whole conversation — how long the AI's turns are, how
// demanding its questions are, and how strictly it stays inside the vocab list.
function levelGuidance(level, source) {
  switch ((level || '').toLowerCase()) {
    case 'advanced':
      return {
        overview: 'This learner is ADVANCED. Hold a natural, flowing conversation — no need to dumb things down.',
        turn: `Write a natural conversational turn in ${source} (one to three sentences), then ask ONE engaging, open-ended question. NEVER put two questions in one turn.`,
        vocab: `Center the conversation on the target words below, but speak naturally — you may use richer vocabulary freely. Just make sure the target words keep coming up so the learner actually practices them.`,
        density: 'Weave in one or more target words per turn, wherever they fit naturally.',
      };
    case 'intermediate':
      return {
        overview: 'This learner is at an INTERMEDIATE level. Keep it conversational but not too demanding.',
        turn: `Write one or two short sentences in ${source} (about 8–15 words total), then ask ONE question that invites a short phrase or sentence in reply. NEVER put two questions in one turn.`,
        vocab: `Build your turns around the target words below. You may also use common everyday vocabulary the learner is likely to know, but lean on the list — it's what they're practicing.`,
        density: 'Use one or two target words per turn, in a natural everyday context.',
      };
    case 'beginner':
    default:
      return {
        overview: 'This learner is a BEGINNER. Keep everything very short and very simple.',
        turn: `Write ONE short sentence in ${source} (about 4–8 words), then ask ONE very simple question that can be answered in just 1–3 words. NEVER put two questions in one turn.`,
        vocab: `Use ONLY content words (nouns, verbs, adjectives) that appear in the target list below. For everything else use just basic function words and connectors (articles, pronouns, prepositions, "¿qué?", "¿y tú?", "sí", "no", "también"). If you can't express an idea with the list, choose a different, simpler topic that the list DOES cover — never reach for outside content words (e.g. do not invent things like "tiempo libre" if those words aren't listed).`,
        density: 'Use about one target word per turn, in a simple everyday context. Don\'t cram several in.',
      };
  }
}

function buildSystemPrompt({ sourceLang, targetLang, comicTitle, level, vocab }) {
  const source = langName(sourceLang);
  const target = langName(targetLang);
  const vocabList = vocab.map((w) => `- ${w.text} — ${w.meaning}`).join('\n');
  const title = comicTitle ? ` from a comic called "${comicTitle}"` : '';
  const levelClause = level ? ` at ${level} level` : '';
  const guide = levelGuidance(level, source);

  return `You are a warm, encouraging ${source} conversation partner for a ${target}-speaking learner${levelClause}. You are helping them practice the vocabulary${title}.

Your job: hold a natural, spoken-style conversation in ${source} that pulls the learner's vocabulary into NEW, everyday situations (not the comic's original story), so they have to understand the words and produce them themselves.

${guide.overview}

On every turn:
- ${guide.turn}
- ${guide.vocab}
- ${guide.density}
- CRITICAL: the learner is SPEAKING. A speech-to-text system writes down what they say, so THE SPELLING IS THE MACHINE'S, NOT THEIRS. You must NEVER correct or even mention spelling, accents, capital letters, or punctuation (including a missing opening "¿" / "¡"). Treat all of these as 100% correct and react as if perfectly written: "voi"/"vou" → "voy", "ola" → "hola", "ke" → "que", "ai" → "hay", "kiero" → "quiero". FORBIDDEN — never produce anything like: "La forma correcta es…", "Recuerda usar la v", "Se escribe con…", "es con y/v/h", "lo correcto es escribir…". If your only objection to a message is how a word is spelled, then you have NO objection — just respond naturally to what they said.
- Assume every message is correctly PRONOUNCED ${source}. Point out an error ONLY if it is a clear GRAMMAR or WORD-CHOICE problem that would still be wrong spoken aloud (e.g. wrong verb tense, wrong gender on an article, wrong word order). Then say the corrected ${source} version plus ONE short, friendly ${target} (English) note. Otherwise give NO correction at all — just reply naturally. Never a grammar lecture.
- The learner ONLY ever uses ${source} or ${target} (English) — never any other language. So if a message looks like a DIFFERENT language (e.g. Portuguese, Italian, French) or like odd nonsense, it is almost always their ${source} misheard by speech recognition. SOUND IT OUT and work out the ${source} they actually meant (e.g. "Vou à caça" → "Voy a casa", "como te yamas" → "cómo te llamas"), then simply respond to that intended meaning as if they had said it correctly. NEVER tell them they used another language, and do NOT ask them to repeat unless the text is so garbled you genuinely cannot guess what ${source} they meant.
- Output only your reply — no labels, lists, or meta-commentary.

WHEN TO SWITCH TO ENGLISH (help mode):
- If the learner's latest message is in ${target} (English), they are asking for HELP — reply in ${target}. Do exactly what they asked, briefly (1–2 sentences): translate a word or your last sentence, explain the last thing you said, or suggest a good/typical answer (give a short example in ${source} with its English meaning). The words "this"/"that" refer to your previous message. Examples of help requests: "What does this mean?", "What does 'amigos' mean?", "Please explain this", "What would be a good answer?", "What's a typical answer?".
- After helping in English, do NOT move on and do NOT ask a new or different question. Repeat your last OPEN ${source} question — the real question you asked the learner about their own situation that they still have not answered (e.g. "¿Adónde vas hoy?") — WORD FOR WORD, so they can answer it now. Do not rephrase it, do not paraphrase it, and do not replace it with a meta-question such as "¿puedes decir eso?" / "can you say that?". Keep repeating that exact same open question after every help request, no matter how many they ask, until the learner actually answers it themselves in ${source}. Only once they have given their own answer do you move on to a new question.
- If the learner's latest message is in ${source}, continue in ${source} — the only English allowed is the brief correction note described above when they made a mistake; after it, return to ${source}.

If the latest user message is exactly "${START_SIGNAL}", that is a signal from the app to begin: say a short hello and ask ONE question built from the target words, matching the turn style described above. Never mention or echo the signal.

Target vocabulary (use these naturally, in new contexts):
${vocabList}`;
}

/**
 * Generate the AI's next conversational turn.
 * @returns {Promise<{reply: string, model: string, usage: object}>}
 */
async function generateFlowReply({
  sourceLang = 'es',
  targetLang = 'en',
  comicTitle = '',
  level,
  vocab = [],
  messages = [],
} = {}) {
  if (!process.env.OPENAI_API_KEY) {
    const err = new Error('OpenAI API key not configured. Add OPENAI_API_KEY to .env file.');
    err.statusCode = 503;
    throw err;
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Keep only valid user/assistant text turns; the opener uses the sentinel.
  let convo = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }));

  // Drop everything but the last MAX_EXCHANGES exchanges (~2 messages each).
  if (convo.length > MAX_EXCHANGES * 2) {
    convo = convo.slice(-MAX_EXCHANGES * 2);
  }

  if (convo.length === 0 || convo[0].role !== 'user') {
    convo = [{ role: 'user', content: START_SIGNAL }, ...convo];
  }

  const system = buildSystemPrompt({ sourceLang, targetLang, comicTitle, level, vocab });

  const completion = await openai.chat.completions.create({
    model: FLOW_MODEL,
    messages: [{ role: 'system', content: system }, ...convo],
    max_tokens: 300,
    temperature: 0.5,
  });

  const reply = (completion.choices?.[0]?.message?.content || '').trim();
  return { reply, model: completion.model, usage: completion.usage };
}

module.exports = { generateFlowReply, FLOW_MODEL };

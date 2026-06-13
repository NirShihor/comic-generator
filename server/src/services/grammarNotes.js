const OpenAI = require('openai');

const languageNames = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German',
  it: 'Italian', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese'
};

// Collect sentences needing explanations (skip sound effects: no audio)
function collectPendingSentences(comicObj, forceRegenerate = false) {
  const pending = new Map(); // sentenceId -> { text, translation }
  const allBubbles = [
    ...(comicObj.cover?.bubbles || []),
    ...(comicObj.pages || []).flatMap(p => [
      ...(p.bubbles || []),
      ...(p.panels || []).flatMap(panel => panel.bubbles || [])
    ])
  ];

  for (const bubble of allBubbles) {
    for (const sentence of bubble.sentences || []) {
      if (!sentence.id || !sentence.text || !sentence.text.trim()) continue;
      if (!sentence.audioUrl) continue;
      if (!forceRegenerate && sentence.grammarNote) continue;
      pending.set(sentence.id, { text: sentence.text, translation: sentence.translation || '' });
    }
  }
  return pending;
}

/**
 * Generate grammar explanations for all sentences in a comic that lack them,
 * and save them to the comic's sentences in MongoDB.
 *
 * @param {object} comic Mongoose Comic document
 * @param {object} opts { forceRegenerate, onProgress(chunk, totalChunks, processed, total) }
 * @returns {{ generated: number, updated: number, total: number }}
 */
async function generateGrammarNotes(comic, { forceRegenerate = false, onProgress } = {}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const Comic = require('../models/Comic');
  const comicObj = comic.toObject();

  const sourceLang = languageNames[comicObj.language || 'es'] || comicObj.language;
  const targetLang = languageNames[comicObj.targetLanguage || 'en'] || comicObj.targetLanguage;

  const pending = collectPendingSentences(comicObj, forceRegenerate);
  if (pending.size === 0) {
    return { generated: 0, updated: 0, total: 0 };
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const entries = [...pending.entries()];
  const chunkSize = 10;
  const totalChunks = Math.ceil(entries.length / chunkSize);
  const allNotes = new Map();

  for (let i = 0; i < entries.length; i += chunkSize) {
    const chunkIndex = Math.floor(i / chunkSize) + 1;
    const chunk = entries.slice(i, i + chunkSize);
    const sentenceList = chunk
      .map(([sid, s]) => `${sid}: "${s.text}"${s.translation ? ` (${s.translation})` : ''}`)
      .join('\n');

    const prompt = `You are helping a beginner ${sourceLang} learner reading a comic. For each ${sourceLang} sentence below (its ${targetLang} translation is in parentheses), write a short grammar explanation in ${targetLang}.

Guidelines:
- 1 to 3 short sentences, plain language, no jargon without a gloss
- Focus on what a learner would actually wonder about: verb tense and why it's used, word order, contractions, idioms, pronouns, interjections
- Name tenses explicitly when relevant (e.g. "tuve is the preterite of tener — a completed past event")
- Don't translate the sentence again; explain how it works

Sentences:
${sentenceList}

Return a JSON object mapping each sentence id to its explanation string.
Example: { "sent-abc123": "Tuve is the preterite (completed past) of tener...", "sent-def456": "..." }

Return ONLY the JSON object, no other text.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a precise, friendly language teacher. Always respond with valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      max_completion_tokens: 4000
    });

    const responseText = completion.choices[0].message.content.trim();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      for (const [sid, note] of Object.entries(parsed)) {
        if (typeof note === 'string' && note.trim()) {
          allNotes.set(sid, note.trim());
        }
      }
    }

    if (onProgress) {
      onProgress(chunkIndex, totalChunks, Math.min(i + chunkSize, entries.length), entries.length);
    }

    if (i + chunkSize < entries.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Write notes back to all matching sentences
  let updated = 0;

  function applyNotes(bubbles) {
    for (const bubble of bubbles || []) {
      for (const sentence of bubble.sentences || []) {
        const note = allNotes.get(sentence.id);
        if (note && (forceRegenerate || !sentence.grammarNote)) {
          sentence.grammarNote = note;
          updated++;
        }
      }
    }
  }

  applyNotes(comicObj.cover?.bubbles);
  for (const page of comicObj.pages || []) {
    applyNotes(page.bubbles);
    for (const panel of page.panels || []) {
      applyNotes(panel.bubbles);
    }
  }

  await Comic.updateOne(
    { id: comicObj.id },
    { $set: { pages: comicObj.pages, ...(comicObj.cover && { cover: comicObj.cover }) } }
  );

  console.log(`Grammar notes: generated ${allNotes.size}, updated ${updated} sentences`);
  return { generated: allNotes.size, updated, total: pending.size };
}

module.exports = { generateGrammarNotes };

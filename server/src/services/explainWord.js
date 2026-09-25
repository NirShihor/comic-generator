const OpenAI = require('openai');

// The reader's "Explain further": a short, contextual explanation of a
// Spanish word as used in its sentence. Shared by the live reader endpoint
// and the comigo.net example publisher, so both say the same thing.
const SYSTEM = [
  'You are a warm, concise Spanish tutor for an English-speaking learner reading a comic.',
  'You are given a Spanish WORD, the SENTENCE it appears in, and the English meaning of that sentence.',
  'Explain what the word is doing in THIS sentence: its part of speech and grammatical role, and why it is there.',
  '- If it is a verb form, give the infinitive and a short present-tense conjugation table (me/te/se/nos/se or yo/tú/él…).',
  '- If it is a reflexive/object pronoun, article, or preposition, say what it refers back to or connects.',
  'Ground every point in the actual sentence and quote small fragments of it.',
  'Keep it short — a few short paragraphs. Friendly, concrete, plain text (no markdown headings). Do not pad.'
].join('\n');

async function explainWord({ word, sentence, translation }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('Explanations are not configured on the server.');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const user = `WORD: "${word}"\nSENTENCE: "${sentence || ''}"\nENGLISH: "${translation || ''}"\n\nExplain "${word}" as it is used here.`;
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
    max_tokens: 450,
    temperature: 0.3
  });
  return completion.choices?.[0]?.message?.content?.trim() || '';
}

module.exports = { explainWord };

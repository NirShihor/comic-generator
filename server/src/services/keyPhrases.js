// Shared helpers for key phrases + practice pages: tokenising comic text and
// collecting the comic's vocabulary so generated text can be validated
// against it (the rule: never a word the comic doesn't contain).

// Lowercase, strip punctuation/quotes, keep accents and ñ. Shared with the
// client-side validator in the Key Phrases tab (keep both in sync).
const normalizePhraseToken = t => String(t || '').toLowerCase()
  .replace(/[¿¡!?.,;:"“”«»()\[\]…]/g, ' ').replace(/['’]/g, "'").trim();
const phraseTokens = text => normalizePhraseToken(text).split(/\s+/).filter(Boolean);

// Every sentence in the comic (cover, page bubbles, panel bubbles, hotspot
// slides) with its page number, plus the set of distinct word forms.
function collectComicVocabulary(comicObj) {
  const sentences = [];
  const vocab = new Set();
  const take = (text, page) => {
    const t = String(text || '').trim();
    if (!t) return;
    sentences.push({ page, text: t });
    for (const tok of phraseTokens(t)) vocab.add(tok);
  };
  const visit = (bubbles, page) => {
    for (const b of bubbles || []) for (const s of b.sentences || []) {
      take(s.text, page);
      for (const w of s.words || []) for (const tok of phraseTokens(w.text)) vocab.add(tok);
    }
  };
  visit(comicObj.cover?.bubbles, 0);
  for (const page of comicObj.pages || []) {
    const n = page.pageNumber;
    visit(page.bubbles, n);
    for (const panel of page.panels || []) visit(panel.bubbles, n);
    for (const h of page.hotspots || []) for (const sl of h.slides || []) take(sl.text, n);
  }
  return { sentences, vocab };
}


// Every token of `text` must be a word form from the comic. Returns the
// missing tokens (empty array = valid).
function missingTokens(text, vocab) {
  return phraseTokens(text).filter(t => !vocab.has(t));
}

module.exports = { normalizePhraseToken, phraseTokens, collectComicVocabulary, missingTokens };

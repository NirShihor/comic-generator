// Partial colouring of a sentence's text: `sentence.colorSpans` is a list of
// { start, end, color } character ranges into `sentence.text` (end exclusive,
// colour "#rrggbb"). The text itself stays plain, so TTS, word timing, speech
// grading and every other reader of `text` are untouched; only the lettering
// (PageEditor) and the reader's word chips (via the export) paint the runs.
// The client has the same helpers in client/src/utils/textColor.js.

const HEX = /^#[0-9a-f]{6}$/i;

// Valid, sorted, clipped to the text, non-overlapping, non-empty spans.
function cleanColorSpans(text, spans) {
  const len = (text || '').length;
  const out = [];
  for (const s of Array.isArray(spans) ? spans : []) {
    if (!s || !HEX.test(String(s.color || ''))) continue;
    const start = Math.max(0, Math.min(len, Math.floor(Number(s.start))));
    const end = Math.max(0, Math.min(len, Math.floor(Number(s.end))));
    if (!(end > start)) continue;
    out.push({ start, end, color: String(s.color).toUpperCase() });
  }
  out.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (last && s.start < last.end) { if (s.end > last.end) merged.push({ start: last.end, end: s.end, color: s.color }); continue; }
    merged.push(s);
  }
  return merged;
}

// The runs of the spans that fall inside [start, end), as offsets relative to
// `start`: [{ from, to, color }].
function colorRunsFor(spans, start, end) {
  const runs = [];
  for (const s of spans || []) {
    const from = Math.max(s.start, start), to = Math.min(s.end, end);
    if (to > from) runs.push({ from: from - start, to: to - start, color: s.color });
  }
  return runs;
}

// Every whitespace-separated token with its range in the text.
function tokenRanges(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/\S+/gu)) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

// The colour runs of an exported word: the word's range is its token's when
// its display text is that token, else the next occurrence of the display
// text after the previous word.
function wordColorRuns(spans, tokens, wIdx, displayText, text, cursor) {
  if (!spans.length || !displayText) return { runs: [], cursor };
  const tok = tokens[wIdx];
  let start;
  if (tok && tok.text === displayText) start = tok.start;
  else { const i = String(text).indexOf(displayText, cursor); if (i < 0) return { runs: [], cursor }; start = i; }
  const end = start + displayText.length;
  return { runs: colorRunsFor(spans, start, end), cursor: end };
}

module.exports = { cleanColorSpans, colorRunsFor, tokenRanges, wordColorRuns };

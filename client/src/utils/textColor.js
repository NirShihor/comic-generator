// Partial colouring of a sentence's text — `sentence.colorSpans`: a list of
// { start, end, color } character ranges into `sentence.text` (end exclusive,
// "#rrggbb"). The text stays plain; the lettering paints the runs, and the
// server export turns them into per-word runs for the reader's popup.
// Mirror of server/src/services/textColor.js.

const HEX = /^#[0-9a-f]{6}$/i;

// Valid, sorted, clipped to the text, non-overlapping, non-empty spans.
export function cleanColorSpans(text, spans) {
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

// The text as runs: [{ text, color }] with color null for plain stretches.
export function textRuns(text, spans) {
  const t = text || '';
  const runs = [];
  let at = 0;
  for (const s of cleanColorSpans(t, spans)) {
    if (s.start > at) runs.push({ text: t.slice(at, s.start), color: null });
    runs.push({ text: t.slice(s.start, s.end), color: s.color });
    at = s.end;
  }
  if (at < t.length) runs.push({ text: t.slice(at), color: null });
  return runs;
}

// Cut [start, end) out of the spans (what's left either side stays).
function cutRange(spans, start, end) {
  const out = [];
  for (const s of spans) {
    if (s.end <= start || s.start >= end) { out.push(s); continue; }
    if (s.start < start) out.push({ start: s.start, end: start, color: s.color });
    if (s.end > end) out.push({ start: end, end: s.end, color: s.color });
  }
  return out;
}

// Colour [start, end) — replacing whatever colour was there.
export function setColorRange(text, spans, start, end, color) {
  return cleanColorSpans(text, [...cutRange(cleanColorSpans(text, spans), start, end), { start, end, color }]);
}

// Remove any colour from [start, end).
export function clearColorRange(text, spans, start, end) {
  return cleanColorSpans(text, cutRange(cleanColorSpans(text, spans), start, end));
}

// Keep the spans in step with an edit of the text: the changed stretch is
// found as what lies between the common prefix and suffix of old and new;
// spans before it stay, spans after it shift, spans across it are trimmed.
export function shiftColorSpans(oldText, newText, spans) {
  const a = oldText || '', b = newText || '';
  if (a === b) return cleanColorSpans(b, spans);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let sfx = 0;
  while (sfx < a.length - p && sfx < b.length - p && a[a.length - 1 - sfx] === b[b.length - 1 - sfx]) sfx++;
  const oldEnd = a.length - sfx, delta = b.length - a.length;
  const out = [];
  for (const s of cleanColorSpans(a, spans)) {
    if (s.end <= p) out.push(s);
    else if (s.start >= oldEnd) out.push({ ...s, start: s.start + delta, end: s.end + delta });
    else {
      // straddles the edit: keep the untouched head and/or tail
      if (s.start < p) out.push({ start: s.start, end: p, color: s.color });
      if (s.end > oldEnd) out.push({ start: oldEnd + delta, end: s.end + delta, color: s.color });
    }
  }
  return cleanColorSpans(b, out);
}

// The palette offered in the editor (any other colour via the picker).
export const TEXT_COLOR_PALETTE = ['#E53935', '#1E88E5', '#43A047', '#FB8C00', '#6E40F0', '#D81B60'];

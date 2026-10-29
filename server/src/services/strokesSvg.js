// Lines and arrows drawn over a page in the editor ("strokes"): the geometry
// shared by the editor's canvas, its bake target and the server's no-text
// export. Coordinates are page-relative (0..1); `W`/`H` give the pixel size
// they are drawn at, and widths are in px of the 400x600 editing canvas, so
// they scale with the drawing (a 3px line is ~8px in the 1024-wide bake).
//
// One stroke: { id, kind: 'line' | 'curve', x1, y1, x2, y2, c1x, c1y, c2x, c2y
// (cubic control points, used when kind === 'curve'), color, width,
// dash: 'solid' | 'dashed' | 'dotted', headStart, headEnd (arrow heads),
// headSize (multiplier, 1 = normal), opacity, locked }.
//
// This file exists twice — client/src/utils/strokes.js and
// server/src/services/strokesSvg.js — with the same body; a server test
// checks they match. Change both.

const STROKE_DEFAULTS = {
  kind: 'line', color: '#000000', width: 3, dash: 'solid',
  headStart: false, headEnd: false, headSize: 1, opacity: 1, locked: false,
};

const CANVAS = { W: 400, H: 600 };   // the editing canvas the widths refer to

function withDefaults(s) { return { ...STROKE_DEFAULTS, ...s }; }

// A curve's control points when it has none yet (or is reset): a gentle arc
// bowing to one side of the straight line.
function defaultControls(s) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const len = Math.hypot(dx, dy) || 0.0001;
  const nx = -dy / len, ny = dx / len;     // unit normal (page-relative units)
  const bow = len * 0.25;
  return {
    c1x: s.x1 + dx / 3 + nx * bow, c1y: s.y1 + dy / 3 + ny * bow,
    c2x: s.x1 + 2 * dx / 3 + nx * bow, c2y: s.y1 + 2 * dy / 3 + ny * bow,
  };
}

function controls(s) {
  return (s.c1x == null || s.c1y == null || s.c2x == null || s.c2y == null) ? defaultControls(s) : { c1x: s.c1x, c1y: s.c1y, c2x: s.c2x, c2y: s.c2y };
}

// Pixel geometry of a stroke at W x H: the end points, the control points
// (curves) and the unit direction the line arrives at each end with.
function geometry(stroke, W, H) {
  const s = withDefaults(stroke);
  const p1 = { x: s.x1 * W, y: s.y1 * H }, p2 = { x: s.x2 * W, y: s.y2 * H };
  const unit = (a, b) => { const d = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / d, y: (b.y - a.y) / d }; };
  if (s.kind !== 'curve') {
    const u = unit(p1, p2);
    return { s, p1, p2, c1: null, c2: null, dirIn: u, dirOut: { x: -u.x, y: -u.y } };
  }
  const c = controls(s);
  const c1 = { x: c.c1x * W, y: c.c1y * H }, c2 = { x: c.c2x * W, y: c.c2y * H };
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 0.5;
  // Tangent at p2 comes from c2 (or c1, or p1 when they coincide); at p1 from c1.
  const dirIn = unit(near(c2, p2) ? (near(c1, p2) ? p1 : c1) : c2, p2);
  const dirOut = unit(near(c1, p1) ? (near(c2, p1) ? p2 : c2) : c1, p1);
  return { s, p1, p2, c1, c2, dirIn, dirOut };
}

// Stroke width in px at W x H (widths are given for the 400x600 canvas).
function widthAt(s, W) { return (Number(s.width) || STROKE_DEFAULTS.width) * (W / CANVAS.W); }

// Length of an arrow head along the line, px.
function headLength(s, W) { return Math.max(10 * (W / CANVAS.W), widthAt(s, W) * 4) * (Number(s.headSize) || 1); }

// The three corners of the head whose tip is at `tip`, pointing along `dir`.
function headPoints(tip, dir, len) {
  const bx = tip.x - dir.x * len, by = tip.y - dir.y * len;
  const nx = -dir.y, ny = dir.x, w = len * 0.45;
  return [[tip.x, tip.y], [bx + nx * w, by + ny * w], [bx - nx * w, by - ny * w]];
}

// The SVG path `d` of the line itself at W x H — pulled back a little at an
// end with a head so the line doesn't poke out past the head's tip — plus
// the heads as polygon point lists.
function shapes(stroke, W, H) {
  const g = geometry(stroke, W, H);
  const { s } = g;
  const len = headLength(s, W);
  const pull = len * 0.7;
  const start = s.headStart ? { x: g.p1.x - g.dirOut.x * pull, y: g.p1.y - g.dirOut.y * pull } : g.p1;
  const end = s.headEnd ? { x: g.p2.x - g.dirIn.x * pull, y: g.p2.y - g.dirIn.y * pull } : g.p2;
  const f = n => Math.round(n * 100) / 100;
  const d = s.kind === 'curve'
    ? `M ${f(start.x)} ${f(start.y)} C ${f(g.c1.x)} ${f(g.c1.y)}, ${f(g.c2.x)} ${f(g.c2.y)}, ${f(end.x)} ${f(end.y)}`
    : `M ${f(start.x)} ${f(start.y)} L ${f(end.x)} ${f(end.y)}`;
  const heads = [];
  if (s.headEnd) heads.push(headPoints(g.p2, g.dirIn, len));
  if (s.headStart) heads.push(headPoints(g.p1, g.dirOut, len));
  return { d, heads, width: widthAt(s, W), geometry: g };
}

// stroke-dasharray for the dash style at this width (round caps make the
// dotted style real dots).
function dashArray(s, width) {
  if (s.dash === 'dashed') return `${width * 3} ${width * 2}`;
  if (s.dash === 'dotted') return `0.1 ${width * 2}`;
  return null;
}

// A complete SVG document drawing every stroke at W x H (for the server's
// sharp composite, and anywhere else an image is wanted).
function strokesSvg(strokes, W, H) {
  const body = (strokes || []).map(st => {
    const s = withDefaults(st);
    const { d, heads, width } = shapes(s, W, H);
    const dash = dashArray(s, width);
    const op = s.opacity == null ? 1 : Number(s.opacity);
    const esc = v => String(v).replace(/[^#\w.,()% -]/g, '');
    const line = `<path d="${d}" fill="none" stroke="${esc(s.color)}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
    const polys = heads.map(h => `<polygon points="${h.map(p => `${Math.round(p[0] * 100) / 100},${Math.round(p[1] * 100) / 100}`).join(' ')}" fill="${esc(s.color)}" stroke="${esc(s.color)}" stroke-width="${width * 0.3}" stroke-linejoin="round"/>`).join('');
    return `<g opacity="${op}">${line}${polys}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
}

module.exports = { STROKE_DEFAULTS, withDefaults, defaultControls, controls, geometry, shapes, dashArray, headLength, strokesSvg };

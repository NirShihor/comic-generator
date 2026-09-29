// Which panel a bubble belongs to on a published example page — the same owner
// rule as the reader export: floating panels win when the bubble's centre is
// inside more than one (a full-page base panel holds them all), otherwise the
// panel whose tap zone contains the centre, else the nearest panel centre.
// Used for the site's reading order and for placing its bubble popup away
// from the bubble's panel (as the app does).

function panelOwner(page) {
  const eligible = (page.panels || []).filter(p => !p.skipInReader);
  const priority = [...eligible].sort((a, b) => (b.floating ? 1 : 0) - (a.floating ? 1 : 0));
  const zone = p => p.tapZone || { x: 0, y: 0, width: 1, height: 1 };
  return (b) => {
    const cx = (b.x || 0) + (b.width || 0) / 2, cy = (b.y || 0) + (b.height || 0) / 2;
    const inside = p => { const t = zone(p); return cx >= t.x && cx < t.x + t.width && cy >= t.y && cy < t.y + t.height; };
    let owner = priority.find(inside);
    if (!owner) {
      let bestD = Infinity;
      for (const p of eligible) {
        const t = zone(p);
        const d = (cx - (t.x + t.width / 2)) ** 2 + (cy - (t.y + t.height / 2)) ** 2;
        if (d < bestD) { bestD = d; owner = p; }
      }
    }
    return owner || null;
  };
}

/** The owning panel's tap zone as [x, y, w, h] (page fractions), or null. */
function panelBox(panel) {
  if (!panel) return null;
  const t = panel.tapZone || { x: 0, y: 0, width: 1, height: 1 };
  const r = v => Math.round((v || 0) * 10000) / 10000;
  return [r(t.x), r(t.y), r(t.width), r(t.height)];
}

module.exports = { panelOwner, panelBox };

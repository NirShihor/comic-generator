// The reader's covers mosaic (end of the free preview) tiles a whole page
// with comic covers: every published comic first, in catalogue order, then
// the unpublished ones to fill the page out — covers only, nothing a reader
// could open. Example comics never appear.
function coverListing(comics) {
  const withCover = (comics || []).filter(c => !c.isExample && (c.cover?.bakedImage || c.cover?.image));
  const byOrder = (a, b) =>
    ((a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)) ||
    (new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  const entry = c => ({
    id: c.id,
    published: !!c.published,
    coverThumbnailUrl: `/api/reader/cover-thumbnail/${c.id}`,
  });
  return [
    ...withCover.filter(c => c.published).sort(byOrder).map(entry),
    ...withCover.filter(c => !c.published).sort(byOrder).map(entry),
  ];
}

module.exports = { coverListing };

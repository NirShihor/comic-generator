// The covers listing behind the reader's end-of-preview mosaic: published
// comics first in catalogue order, then the unpublished ones that fill the
// page; only comics with a cover; never an example comic.
const { test } = require('node:test');
const assert = require('node:assert');
const { coverListing } = require('../src/services/coverListing');

const comic = (id, extra = {}) => ({ id, cover: { image: `/uploads/${id}.png` }, ...extra });

test('published covers come first, in catalogue order, then the unpublished', () => {
  const list = coverListing([
    comic('u2', { published: false, order: 2 }),
    comic('p3', { published: true, order: 3 }),
    comic('u1', { published: false, order: 1 }),
    comic('p1', { published: true, order: 1 }),
    comic('p2', { published: true, order: 2 }),
  ]);
  assert.deepStrictEqual(list.map(c => c.id), ['p1', 'p2', 'p3', 'u1', 'u2']);
  assert.deepStrictEqual(list.map(c => c.published), [true, true, true, false, false]);
  assert.strictEqual(list[0].coverThumbnailUrl, '/api/reader/cover-thumbnail/p1');
});

test('a comic without a cover, or an example comic, is left out', () => {
  const list = coverListing([
    { id: 'bare', published: true },
    comic('example', { published: true, isExample: true }),
    comic('baked', { published: true, cover: { bakedImage: '/uploads/baked.png' } }),
  ]);
  assert.deepStrictEqual(list.map(c => c.id), ['baked']);
});

test('without an order, creation date decides; nothing to list is an empty list', () => {
  const list = coverListing([
    comic('later', { published: true, createdAt: '2026-02-01' }),
    comic('earlier', { published: true, createdAt: '2026-01-01' }),
  ]);
  assert.deepStrictEqual(list.map(c => c.id), ['earlier', 'later']);
  assert.deepStrictEqual(coverListing([]), []);
  assert.deepStrictEqual(coverListing(undefined), []);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EXPORT_VERSION,
  validateImportDoc,
  diaryKey,
  watchEntryKey,
  listKey,
  reviewKey
} = require('../../src/data/importExport');

test('validateImportDoc accepts a well-formed document and defaults missing sections', () => {
  const sections = validateImportDoc({ version: EXPORT_VERSION });
  assert.deepEqual(sections, { watchEntries: [], diary: [], reviews: [], lists: [] });
});

test('validateImportDoc passes through provided arrays', () => {
  const sections = validateImportDoc({
    version: EXPORT_VERSION,
    watchEntries: [{ movieId: 1, status: 'Completed' }],
    diary: [{ movieId: 1, watchedAt: '2024-01-01' }],
    reviews: [{ movieId: 1, content: 'ok' }],
    lists: [{ title: 'Faves' }]
  });
  assert.equal(sections.watchEntries.length, 1);
  assert.equal(sections.diary.length, 1);
  assert.equal(sections.reviews.length, 1);
  assert.equal(sections.lists.length, 1);
});

test('validateImportDoc rejects non-objects', () => {
  for (const bad of [null, undefined, 42, 'x', []]) {
    assert.throws(() => validateImportDoc(bad), err => err.status === 400);
  }
});

test('validateImportDoc rejects an unsupported version', () => {
  assert.throws(() => validateImportDoc({ version: 999 }), err => err.status === 400 && err.code === 'unsupported_version');
});

test('validateImportDoc rejects a section that is not an array', () => {
  assert.throws(() => validateImportDoc({ version: EXPORT_VERSION, diary: {} }), err => err.status === 400);
});

test('dedup keys are stable natural keys', () => {
  assert.equal(diaryKey({ movieId: 5, watchedAt: '2024-01-02T00:00:00.000Z' }), '5 2024-01-02T00:00:00.000Z');
  assert.equal(watchEntryKey({ movieId: 7 }), '7');
  assert.equal(listKey({ title: 'Best of 2024' }), 'Best of 2024');
  assert.equal(reviewKey({ movieId: 3, content: 'great' }), '3 great');
});

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateListCreate,
  validateListUpdate,
  validateListItem,
  validateReorder
} = require('../../src/validation');

test('list creation normalizes title/description and defaults isPublic to false', () => {
  const result = validateListCreate({ title: '  Top Sci-Fi  ', description: '  Best of  ' });
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, { title: 'Top Sci-Fi', description: 'Best of', isPublic: false });
});

test('list creation rejects a missing title and a non-boolean isPublic', () => {
  const result = validateListCreate({ title: '   ', isPublic: 'yes' });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ['title is required', 'isPublic must be a boolean']);
});

test('list creation rejects an over-long title', () => {
  const result = validateListCreate({ title: 'x'.repeat(101) });
  assert.equal(result.valid, false);
  assert.ok(result.errors[0].includes('at most'));
});

test('list update requires at least one editable field', () => {
  assert.equal(validateListUpdate({}).valid, false);
  const ok = validateListUpdate({ isPublic: true });
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.value, { isPublic: true });
});

test('list item validation parses movieId and trims the note', () => {
  const result = validateListItem({ movieId: '603', note: '  a classic  ' });
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, { movieId: 603, note: 'a classic' });
});

test('list item validation rejects a non-positive movieId', () => {
  const result = validateListItem({ movieId: 'nope' });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ['movieId must be a positive integer']);
});

test('reorder validation parses ids and rejects duplicates', () => {
  const ok = validateReorder({ order: ['3', 1, '2'] });
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.value.order, [3, 1, 2]);

  const dup = validateReorder({ order: [1, 1, 2] });
  assert.equal(dup.valid, false);
  assert.ok(dup.errors.some(message => message.includes('duplicate')));

  const empty = validateReorder({ order: [] });
  assert.equal(empty.valid, false);
});

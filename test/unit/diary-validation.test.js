const test = require('node:test');
const assert = require('node:assert/strict');

const { validateDiaryEntry, validateDiaryUpdate } = require('../../src/validation');

const NOW = Date.parse('2026-09-01T12:00:00.000Z');

test('diary entry validation normalizes a valid log', () => {
  const result = validateDiaryEntry({
    movieId: '603',
    watchedAt: '2026-08-15',
    rating: '4',
    notes: '  Loved it  ',
    rewatch: true
  }, NOW);

  assert.equal(result.valid, true);
  assert.equal(result.value.movieId, 603);
  assert.equal(result.value.watchedAt, '2026-08-15T00:00:00.000Z');
  assert.equal(result.value.rating, 4);
  assert.equal(result.value.notes, 'Loved it');
  assert.equal(result.value.rewatch, true);
});

test('diary entry defaults rewatch to false and allows omitting optionals', () => {
  const result = validateDiaryEntry({ movieId: 5, watchedAt: '2026-01-01' }, NOW);
  assert.equal(result.valid, true);
  assert.equal(result.value.rewatch, false);
  assert.equal('rating' in result.value, false);
  assert.equal('notes' in result.value, false);
});

test('diary entry rejects a future watch date', () => {
  const result = validateDiaryEntry({ movieId: 5, watchedAt: '2026-12-31' }, NOW);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('watchedAt cannot be in the future'));
});

test('diary entry rejects an invalid date, bad movieId, and out-of-range rating', () => {
  const result = validateDiaryEntry({ movieId: 'nope', watchedAt: 'not-a-date', rating: 9 }, NOW);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('movieId must be a positive integer'));
  assert.ok(result.errors.includes('watchedAt must be a valid date'));
  assert.ok(result.errors.includes('rating must be an integer from 1 to 5'));
});

test('diary update requires at least one editable field', () => {
  assert.equal(validateDiaryUpdate({}, NOW).valid, false);
});

test('diary update allows clearing rating and notes', () => {
  const result = validateDiaryUpdate({ rating: null, notes: '' }, NOW);
  assert.equal(result.valid, true);
  assert.equal(result.value.rating, null);
  assert.equal(result.value.notes, '');
});

test('diary update rejects a future watchedAt', () => {
  const result = validateDiaryUpdate({ watchedAt: '2027-01-01' }, NOW);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('watchedAt cannot be in the future'));
});

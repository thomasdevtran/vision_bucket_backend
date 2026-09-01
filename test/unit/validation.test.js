const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isValidWatchStatus,
  validateReview,
  validateReviewUpdate
} = require('../../src/validation');

test('review validation normalizes valid numeric fields', () => {
  const result = validateReview({
    movieId: '950387',
    Author: '  Ada  ',
    content: '  Worth watching  ',
    rating: '5'
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.value, {
    movieId: 950387,
    Author: 'Ada',
    content: 'Worth watching',
    rating: 5,
    isSpoiler: false
  });
});

test('review validation defaults isSpoiler to false and accepts an explicit flag', () => {
  assert.equal(validateReview({ movieId: 1, Author: 'Ada', content: 'ok', rating: 3 }).value.isSpoiler, false);

  const flagged = validateReview({ movieId: 1, Author: 'Ada', content: 'twist', rating: 3, isSpoiler: true });
  assert.equal(flagged.valid, true);
  assert.equal(flagged.value.isSpoiler, true);

  const bad = validateReview({ movieId: 1, Author: 'Ada', content: 'ok', rating: 3, isSpoiler: 'yes' });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.includes('isSpoiler must be a boolean'));
});

test('review validation rejects missing text and out-of-range ratings', () => {
  const result = validateReview({ movieId: 'not-a-number', Author: ' ', content: '', rating: 6 });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    'movieId must be a positive integer',
    'Author is required',
    'content is required',
    'rating must be an integer from 1 to 5'
  ]);
});

test('review updates require at least one valid editable field', () => {
  assert.equal(validateReviewUpdate({}).valid, false);
  assert.equal(validateReviewUpdate({ content: ' ' }).valid, false);
  assert.equal(validateReviewUpdate({ rating: 2.5 }).valid, false);
  assert.deepEqual(validateReviewUpdate({ content: ' updated ', rating: '4' }).value, {
    content: 'updated',
    rating: 4
  });
});

test('review updates accept isSpoiler on its own and reject non-booleans', () => {
  const spoilerOnly = validateReviewUpdate({ isSpoiler: true });
  assert.equal(spoilerOnly.valid, true);
  assert.deepEqual(spoilerOnly.value, { isSpoiler: true });

  const bad = validateReviewUpdate({ isSpoiler: 'nope' });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.includes('isSpoiler must be a boolean'));
});

test('watch status validation accepts only persisted status fields', () => {
  assert.equal(isValidWatchStatus('Completed'), true);
  assert.equal(isValidWatchStatus('Plan_to_watch'), true);
  assert.equal(isValidWatchStatus('__proto__'), false);
});

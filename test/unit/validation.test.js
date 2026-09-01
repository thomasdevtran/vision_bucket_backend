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
    rating: 5
  });
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

test('watch status validation accepts only persisted status fields', () => {
  assert.equal(isValidWatchStatus('Completed'), true);
  assert.equal(isValidWatchStatus('Plan_to_watch'), true);
  assert.equal(isValidWatchStatus('__proto__'), false);
});

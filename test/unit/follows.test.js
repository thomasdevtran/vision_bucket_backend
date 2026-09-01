const test = require('node:test');
const assert = require('node:assert/strict');

const { validateFollow } = require('../../src/validation');
const { followDocumentId } = require('../../src/data/follows');

test('follow validation requires a non-empty followeeId', () => {
  assert.equal(validateFollow({}).valid, false);
  assert.equal(validateFollow({ followeeId: '   ' }).valid, false);
  assert.deepEqual(validateFollow({}).errors, ['followeeId is required']);
});

test('follow validation trims and accepts a valid followeeId', () => {
  const result = validateFollow({ followeeId: '  user-123  ' });
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, { followeeId: 'user-123' });
});

test('follow document id is deterministic for idempotent follow/unfollow', () => {
  assert.equal(followDocumentId('alice', 'bob'), 'alice_bob');
  assert.notEqual(followDocumentId('alice', 'bob'), followDocumentId('bob', 'alice'));
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateReportInput, TARGET_TYPES, RESOLUTION_STATUSES } = require('../../src/data/moderation');

test('validateReportInput accepts a well-formed report and trims strings', () => {
  const result = validateReportInput({ targetType: 'review', targetId: '  abc123  ', reason: '  spam  ' });
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, { targetType: 'review', targetId: 'abc123', reason: 'spam' });
});

test('validateReportInput rejects an unknown target type', () => {
  const result = validateReportInput({ targetType: 'user', targetId: 'x', reason: 'bad' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(message => message.includes('targetType')));
});

test('validateReportInput requires a non-empty targetId and reason', () => {
  const missingId = validateReportInput({ targetType: 'thread', targetId: '   ', reason: 'bad' });
  assert.equal(missingId.valid, false);
  assert.ok(missingId.errors.some(message => message.includes('targetId')));

  const missingReason = validateReportInput({ targetType: 'thread', targetId: 'x', reason: '' });
  assert.equal(missingReason.valid, false);
  assert.ok(missingReason.errors.some(message => message.includes('reason')));
});

test('validateReportInput rejects an over-long reason', () => {
  const result = validateReportInput({ targetType: 'comment', targetId: 'x', reason: 'a'.repeat(1001) });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(message => message.includes('1000')));
});

test('the exported target types and resolution statuses match the data model', () => {
  assert.deepEqual([...TARGET_TYPES], ['review', 'thread', 'comment']);
  assert.deepEqual([...RESOLUTION_STATUSES], ['resolved', 'dismissed']);
});

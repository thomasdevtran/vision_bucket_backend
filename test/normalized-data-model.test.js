const test = require('node:test');
const assert = require('node:assert/strict');

const { mergeWithLegacyComments } = require('../src/data/comments');
const { legacyCommentDocumentId, watchEntryDocumentId } = require('../src/data/recordIds');
const { mergeProfileWithWatchEntries } = require('../src/data/watchEntries');
const { collectUserMovies } = require('../scripts/migrate-normalized-records');

test('record identifiers are stable and scoped to their owning records', () => {
  assert.equal(watchEntryDocumentId('user-1', '42'), watchEntryDocumentId('user-1', '42'));
  assert.notEqual(watchEntryDocumentId('user-1', '42'), watchEntryDocumentId('user-2', '42'));
  assert.notEqual(
    legacyCommentDocumentId('discussion_post', 'post-1', '7', 0),
    legacyCommentDocumentId('discussion_post', 'post-2', '7', 0)
  );
});

test('normalized watch entries override legacy status arrays', () => {
  const profile = {
    displayName: 'Ada',
    Completed: [10, 20],
    Dropped: [],
    On_hold: [],
    Plan_to_watch: [30],
    Rewatched: []
  };
  const entries = [
    { movieId: '20', status: 'Rewatched' },
    { movieId: '30', status: 'Completed' }
  ];

  const merged = mergeProfileWithWatchEntries(profile, entries);

  assert.deepEqual(merged.Completed, [10, '30']);
  assert.deepEqual(merged.Plan_to_watch, []);
  assert.deepEqual(merged.Rewatched, ['20']);
  assert.equal(merged.displayName, 'Ada');
});

test('migrated comments replace, rather than duplicate, their legacy array values', () => {
  const legacy = [
    { commentId: 'old-1', author: 'A', content: 'first', date: '1' },
    { commentId: 'old-2', author: 'B', content: 'second', date: '2' }
  ];
  const records = [{
    id: 'new-document-id',
    legacyCommentId: 'old-1',
    author: 'A',
    authorId: 'user-a',
    content: 'first',
    date: '1'
  }];

  const merged = mergeWithLegacyComments(records, legacy);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].commentId, 'old-2');
  assert.equal(merged[1].commentId, 'new-document-id');
});

test('migration detects a movie present in multiple legacy status arrays', () => {
  const movies = collectUserMovies({ Completed: [10, 20], Rewatched: [20] });

  assert.deepEqual([...movies.get('10')], ['Completed']);
  assert.deepEqual([...movies.get('20')], ['Completed', 'Rewatched']);
});

const { db, collection, doc, getDoc, getDocs, setDoc } = require('../src/firebase');
const { parentKey } = require('../src/data/comments');
const { legacyCommentDocumentId, watchEntryDocumentId } = require('../src/data/recordIds');
const { VALID_STATUSES, normalizeMovieId } = require('../src/data/watchEntries');

const applyChanges = process.argv.includes('--apply');
const summary = {
  mode: applyChanges ? 'apply' : 'dry-run',
  comments: { discovered: 0, copied: 0, invalid: 0, existing: 0, failed: 0 },
  watchEntries: { discovered: 0, copied: 0, conflicts: 0, existing: 0, failed: 0 },
  conflictDetails: [],
  failures: []
};

const writeIfMissing = async (collectionName, id, data, category) => {
  if (!applyChanges) return;
  try {
    const target = doc(db, collectionName, id);
    const snapshot = await getDoc(target);
    if (snapshot.exists) {
      summary[category].existing += 1;
      return;
    }
    await setDoc(target, data);
    summary[category].copied += 1;
  } catch (error) {
    summary[category].failed += 1;
    summary.failures.push({ category, id, message: error.message });
  }
};

const migrateComments = async (sourceCollection, parentType) => {
  const snapshot = await getDocs(collection(db, sourceCollection));
  for (const postSnapshot of snapshot.docs) {
    const comments = postSnapshot.data().Comments;
    if (!Array.isArray(comments)) continue;

    for (const [index, comment] of comments.entries()) {
      if (!comment || !comment.author || !comment.content || !comment.date) {
        summary.comments.invalid += 1;
        continue;
      }

      summary.comments.discovered += 1;
      const id = legacyCommentDocumentId(parentType, postSnapshot.id, comment.commentId, index);
      await writeIfMissing('comments', id, {
        parentType,
        parentId: postSnapshot.id,
        parentKey: parentKey(parentType, postSnapshot.id),
        authorId: comment.uid || null,
        author: comment.author,
        content: comment.content,
        date: comment.date,
        createdAt: comment.date,
        legacyCommentId: comment.commentId || null,
        migrationSource: `${sourceCollection}/${postSnapshot.id}`
      }, 'comments');
    }
  }
};

const collectUserMovies = user => {
  const movies = new Map();
  for (const status of VALID_STATUSES) {
    const movieIds = Array.isArray(user[status]) ? user[status] : [];
    for (const movieId of movieIds) {
      const normalizedMovieId = normalizeMovieId(movieId);
      const statuses = movies.get(normalizedMovieId) || new Set();
      statuses.add(status);
      movies.set(normalizedMovieId, statuses);
    }
  }
  return movies;
};

const migrateWatchEntries = async () => {
  const snapshot = await getDocs(collection(db, 'Users'));
  for (const userSnapshot of snapshot.docs) {
    const movies = collectUserMovies(userSnapshot.data());
    for (const [movieId, statuses] of movies) {
      summary.watchEntries.discovered += 1;
      if (statuses.size !== 1) {
        summary.watchEntries.conflicts += 1;
        summary.conflictDetails.push({ userId: userSnapshot.id, movieId, statuses: [...statuses] });
        continue;
      }

      const status = [...statuses][0];
      const migratedAt = new Date().toISOString();
      const id = watchEntryDocumentId(userSnapshot.id, movieId);
      await writeIfMissing('watch_entries', id, {
        userId: userSnapshot.id,
        movieId,
        status,
        createdAt: migratedAt,
        updatedAt: migratedAt,
        migrationSource: `Users/${userSnapshot.id}.${status}`
      }, 'watchEntries');
    }
  }
};

const main = async () => {
  await migrateComments('Disc_Posts', 'discussion_post');
  await migrateComments('News_Posts', 'news_post');
  await migrateWatchEntries();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.failures.length || summary.conflictDetails.length) process.exitCode = 2;
};

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { collectUserMovies };

const {
  db,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where
} = require('../firebase');
const { watchEntryDocumentId } = require('./recordIds');

const WATCH_ENTRIES_COLLECTION = 'watch_entries';
const VALID_STATUSES = ['Completed', 'Dropped', 'On_hold', 'Plan_to_watch', 'Rewatched'];

const normalizeMovieId = movieId => String(movieId);

const listWatchEntries = async userId => {
  const snapshot = await getDocs(query(
    collection(db, WATCH_ENTRIES_COLLECTION),
    where('userId', '==', userId)
  ));

  return snapshot.docs.map(snapshotDoc => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
};

const upsertWatchEntry = async ({ userId, movieId, status, watchedAt, rating, progress, notes }) => {
  const normalizedMovieId = normalizeMovieId(movieId);
  const entryRef = doc(db, WATCH_ENTRIES_COLLECTION, watchEntryDocumentId(userId, normalizedMovieId));
  const now = new Date().toISOString();
  const existing = await getDoc(entryRef);
  const entry = {
    userId,
    movieId: normalizedMovieId,
    status,
    updatedAt: now
  };

  if (!existing.exists()) entry.createdAt = now;
  if (watchedAt !== undefined) entry.watchedAt = watchedAt;
  if (rating !== undefined) entry.rating = rating;
  if (progress !== undefined) entry.progress = progress;
  if (notes !== undefined) entry.notes = notes;

  await setDoc(entryRef, entry, { merge: true });
  return { id: entryRef.id, ...(existing.exists() ? existing.data() : {}), ...entry };
};

const removeWatchEntry = async ({ userId, movieId, status }) => {
  const entryRef = doc(db, WATCH_ENTRIES_COLLECTION, watchEntryDocumentId(userId, normalizeMovieId(movieId)));
  const snapshot = await getDoc(entryRef);

  if (!snapshot.exists()) return false;
  if (status && snapshot.data().status !== status) return false;

  await deleteDoc(entryRef);
  return true;
};

const mergeProfileWithWatchEntries = (profile, entries) => {
  const result = { ...profile };
  const normalizedMovieIds = new Set(entries.map(entry => normalizeMovieId(entry.movieId)));

  for (const status of VALID_STATUSES) {
    const legacyMovies = Array.isArray(profile[status]) ? profile[status] : [];
    result[status] = legacyMovies.filter(movieId => !normalizedMovieIds.has(normalizeMovieId(movieId)));
  }

  for (const entry of entries) {
    if (!VALID_STATUSES.includes(entry.status)) continue;
    if (!result[entry.status].some(movieId => normalizeMovieId(movieId) === normalizeMovieId(entry.movieId))) {
      result[entry.status].push(entry.movieId);
    }
  }

  return result;
};

module.exports = {
  VALID_STATUSES,
  WATCH_ENTRIES_COLLECTION,
  listWatchEntries,
  mergeProfileWithWatchEntries,
  normalizeMovieId,
  removeWatchEntry,
  upsertWatchEntry
};

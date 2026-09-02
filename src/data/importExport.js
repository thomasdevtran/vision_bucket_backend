// data/importExport.js - portability for a user's own data. Builds a single
// JSON document of everything the caller owns (GET /profile/export) and
// recreates those entries from such a document (POST /profile/import).
//
// Identity ALWAYS comes from the caller's token: on import every uid/ownerId in
// the file is ignored and rewritten to the caller. Import is idempotent -
// re-importing the same document adds nothing, because each entry type is
// deduplicated by a stable natural key (documented per section below).
//
// NOTE: this runs synchronously inside the request. It is fine for a personal
// account's data, but a very large import (tens of thousands of entries) would
// be better handled as an async/queued job so the request does not block; the
// app's JSON body limit (config.bodyLimit) already caps the payload size.
const {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  addDoc
} = require('../firebase');
const { AppError } = require('../errors');
const {
  validateDiaryEntry,
  validateReview,
  validateListCreate,
  validateListItem
} = require('../validation');
const {
  listWatchEntries,
  upsertWatchEntry,
  WATCH_ENTRIES_COLLECTION,
  VALID_STATUSES
} = require('./watchEntries');
const { DIARY_ENTRIES_COLLECTION, createDiaryEntry } = require('./diaryEntries');

const EXPORT_VERSION = 1;
const REVIEWS_COLLECTION = 'Reviews';
const LISTS_COLLECTION = 'lists';

// --- Dedup keys (natural keys used to make import idempotent) --------------
// diary:         movieId + watchedAt
// watch_entries: movieId (deterministic: one doc per user/movie)
// lists:         title
// reviews:       movieId + content
const diaryKey = entry => `${entry.movieId} ${entry.watchedAt}`;
const watchEntryKey = entry => String(entry.movieId);
const listKey = list => String(list.title);
const reviewKey = review => `${review.movieId} ${review.content}`;

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const listAllForUser = async (collectionName, field, uid) => {
  const snapshot = await getDocs(query(collection(db, collectionName), where(field, '==', uid)));
  return snapshot.docs.map(snapshotDoc => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
};

// Build the full export document for one uid. Only the caller's own data.
const buildExport = async uid => {
  const [profileSnap, watchEntries, diary, reviews, lists] = await Promise.all([
    getDoc(doc(db, 'Users', uid)),
    listWatchEntries(uid),
    listAllForUser(DIARY_ENTRIES_COLLECTION, 'userId', uid),
    listAllForUser(REVIEWS_COLLECTION, 'uid', uid),
    listAllForUser(LISTS_COLLECTION, 'ownerId', uid)
  ]);

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    profile: profileSnap.exists() ? profileSnap.data() : null,
    watchEntries,
    diary,
    reviews,
    lists
  };
};

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

// Pure shape/version check. Throws AppError(400) on a malformed document so the
// route maps it straight to a 400. Missing sections default to empty arrays.
const validateImportDoc = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'invalid_import', 'Import must be a JSON object');
  }
  if (value.version !== EXPORT_VERSION) {
    throw new AppError(400, 'unsupported_version', `Unsupported export version (expected ${EXPORT_VERSION})`);
  }
  const asArray = (section, name) => {
    if (section === undefined || section === null) return [];
    if (!Array.isArray(section)) {
      throw new AppError(400, 'invalid_import', `${name} must be an array`);
    }
    return section;
  };

  return {
    watchEntries: asArray(value.watchEntries, 'watchEntries'),
    diary: asArray(value.diary, 'diary'),
    reviews: asArray(value.reviews, 'reviews'),
    lists: asArray(value.lists, 'lists')
  };
};

const emptySummary = () => ({
  imported: { watchEntries: 0, diary: 0, reviews: 0, lists: 0 },
  skipped: { watchEntries: 0, diary: 0, reviews: 0, lists: 0 }
});

const importWatchEntries = async (uid, rows, summary) => {
  const seen = new Set((await listWatchEntries(uid)).map(watchEntryKey));
  for (const row of rows) {
    const movieId = row && row.movieId;
    const status = row && row.status;
    if (movieId === undefined || movieId === null || !VALID_STATUSES.includes(status)) {
      summary.skipped.watchEntries += 1;
      continue;
    }
    const key = watchEntryKey({ movieId });
    if (seen.has(key)) {
      summary.skipped.watchEntries += 1;
      continue;
    }
    seen.add(key);
    await upsertWatchEntry({
      userId: uid,
      movieId,
      status,
      ...(row.watchedAt !== undefined ? { watchedAt: row.watchedAt } : {}),
      ...(row.rating !== undefined ? { rating: row.rating } : {}),
      ...(row.progress !== undefined ? { progress: row.progress } : {}),
      ...(row.notes !== undefined ? { notes: row.notes } : {})
    });
    summary.imported.watchEntries += 1;
  }
};

const importDiary = async (uid, rows, summary) => {
  const existing = await listAllForUser(DIARY_ENTRIES_COLLECTION, 'userId', uid);
  const seen = new Set(existing.map(diaryKey));
  for (const row of rows) {
    const validation = validateDiaryEntry(row || {});
    if (!validation.valid) {
      summary.skipped.diary += 1;
      continue;
    }
    const key = diaryKey(validation.value);
    if (seen.has(key)) {
      summary.skipped.diary += 1;
      continue;
    }
    seen.add(key);
    await createDiaryEntry({ userId: uid, ...validation.value });
    summary.imported.diary += 1;
  }
};

const importReviews = async (uid, rows, summary) => {
  const existing = await listAllForUser(REVIEWS_COLLECTION, 'uid', uid);
  const seen = new Set(existing.map(reviewKey));
  for (const row of rows) {
    const validation = validateReview(row || {});
    if (!validation.valid) {
      summary.skipped.reviews += 1;
      continue;
    }
    const key = reviewKey(validation.value);
    if (seen.has(key)) {
      summary.skipped.reviews += 1;
      continue;
    }
    seen.add(key);
    await addDoc(collection(db, REVIEWS_COLLECTION), {
      movieId: validation.value.movieId,
      date: (row && row.date) || new Date().toISOString(),
      Author: validation.value.Author,
      content: validation.value.content,
      rating: validation.value.rating,
      isSpoiler: validation.value.isSpoiler,
      reactionCount: 0,
      uid
    });
    summary.imported.reviews += 1;
  }
};

// Sanitize imported list items through the same validator the API uses, keeping
// order and re-deriving contiguous 1-based positions.
const sanitizeItems = rawItems => {
  if (!Array.isArray(rawItems)) return [];
  const items = [];
  const seenMovies = new Set();
  for (const rawItem of rawItems) {
    const validation = validateListItem(rawItem || {});
    if (!validation.valid) continue;
    const movieId = validation.value.movieId;
    if (seenMovies.has(String(movieId))) continue;
    seenMovies.add(String(movieId));
    items.push({
      movieId,
      position: items.length + 1,
      ...(validation.value.note !== undefined ? { note: validation.value.note } : {})
    });
  }
  return items;
};

const importLists = async (uid, rows, summary) => {
  const existing = await listAllForUser(LISTS_COLLECTION, 'ownerId', uid);
  const seen = new Set(existing.map(listKey));
  for (const row of rows) {
    const validation = validateListCreate(row || {});
    if (!validation.valid) {
      summary.skipped.lists += 1;
      continue;
    }
    const key = listKey(validation.value);
    if (seen.has(key)) {
      summary.skipped.lists += 1;
      continue;
    }
    seen.add(key);
    const now = new Date().toISOString();
    await addDoc(collection(db, LISTS_COLLECTION), {
      ownerId: uid,
      title: validation.value.title,
      description: validation.value.description,
      isPublic: validation.value.isPublic,
      collaboratorIds: [],
      items: sanitizeItems(row && row.items),
      createdAt: now,
      updatedAt: now
    });
    summary.imported.lists += 1;
  }
};

// Recreate the caller's entries from an export document. Everything is written
// under `uid` regardless of any ids in the file. Returns { imported, skipped }.
const importData = async (uid, rawDoc) => {
  const sections = validateImportDoc(rawDoc);
  const summary = emptySummary();

  // watch_entries first so diary's best-effort sync has a base to merge onto.
  await importWatchEntries(uid, sections.watchEntries, summary);
  await importDiary(uid, sections.diary, summary);
  await importReviews(uid, sections.reviews, summary);
  await importLists(uid, sections.lists, summary);

  return summary;
};

module.exports = {
  EXPORT_VERSION,
  WATCH_ENTRIES_COLLECTION,
  REVIEWS_COLLECTION,
  LISTS_COLLECTION,
  diaryKey,
  watchEntryKey,
  listKey,
  reviewKey,
  buildExport,
  validateImportDoc,
  importData
};

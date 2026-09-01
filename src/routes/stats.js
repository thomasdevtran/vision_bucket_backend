// routes/stats.js
//
// GET /profile/stats/:uid -- a public statistics dashboard for a user, built
// from their watch_entries, diary, and reviews. Genre breakdowns need movie
// metadata, so we look up each watched movie's genres through the shared movie
// provider; if the provider is not configured (or a lookup fails) the endpoint
// still returns the non-genre stats and flags `genresAvailable: false` rather
// than 500ing. The pure aggregation lives in src/data/statsAggregate.js.
//
// Data access + provider are injected so this is unit/emulator-testable with a
// mocked provider and no live TMDB.

const express = require('express');
const { db, collection, getDocs, query, where } = require('../firebase');
const { listWatchEntries } = require('../data/watchEntries');
const { aggregateStats } = require('../data/statsAggregate');
const { getDefaultProvider } = require('./movies');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Cap genre lookups so a huge history stays cheap (provider caches upstream).
const MAX_GENRE_LOOKUPS = 100;

const listAllDiary = async userId => {
  const snapshot = await getDocs(query(collection(db, 'diary_entries'), where('userId', '==', userId)));
  return snapshot.docs.map(snapshotDoc => snapshotDoc.data());
};

const listUserReviews = async userId => {
  const snapshot = await getDocs(query(collection(db, 'Reviews'), where('uid', '==', userId)));
  return snapshot.docs.map(snapshotDoc => snapshotDoc.data());
};

// Look up genres for each movie, tracking how many lookups actually succeeded.
// A provider instance can exist yet still fail every call (e.g. unreachable /
// unconfigured upstream), so `succeeded` — not merely "did we get a provider" —
// is what tells the caller whether a genre breakdown is real.
const buildGenresByMovieId = async (provider, movieIds) => {
  const map = {};
  let succeeded = 0;
  await Promise.all(movieIds.slice(0, MAX_GENRE_LOOKUPS).map(async movieId => {
    try {
      const names = await provider.getMovieGenres(movieId);
      map[String(movieId)] = Array.isArray(names) ? names : [];
      succeeded += 1;
    } catch {
      map[String(movieId)] = [];
    }
  }));
  return { map, succeeded };
};

const createStatsRouter = ({
  provider = getDefaultProvider,
  getWatchEntries = listWatchEntries,
  getDiary = listAllDiary,
  getReviews = listUserReviews
} = {}) => {
  const router = express.Router();

  // GET /profile/stats/:uid
  router.get('/:uid', asyncHandler(async (req, res) => {
    const { uid } = req.params;
    const [watchEntries, diary, reviews] = await Promise.all([
      getWatchEntries(uid),
      getDiary(uid),
      getReviews(uid)
    ]);

    const distinctMovieIds = [...new Set(watchEntries.map(entry => String(entry.movieId)))];

    // Genres are best-effort: an unconfigured/failing provider degrades to
    // stats without a genre breakdown instead of failing the whole request.
    let genresByMovieId = {};
    let genresAvailable;
    try {
      const result = await buildGenresByMovieId(provider(), distinctMovieIds);
      genresByMovieId = result.map;
      genresAvailable = result.succeeded > 0;
    } catch {
      genresAvailable = false;
    }

    const stats = aggregateStats({ watchEntries, diary, reviews, genresByMovieId });
    res.status(200).json({ ...stats, genresAvailable });
  }));

  return router;
};

// Default router reuses the shared lazily-built provider (and its cache).
const router = createStatsRouter();

module.exports = router;
module.exports.createStatsRouter = createStatsRouter;

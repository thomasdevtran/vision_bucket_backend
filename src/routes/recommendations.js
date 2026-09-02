// routes/recommendations.js
//
// GET /recommendations — a personalized "For You" feed for the authenticated
// user. The handler stays thin: it resolves the caller, loads their watch
// history, and delegates the affinity/candidate assembly + ranking to
// src/data/recommendationInputs.js (which wraps the pure src/recommendations.js
// core). Provider/auth/data access are injected so this is unit-testable with
// everything mocked — no live TMDB, no network.
const express = require('express');
const { AppError } = require('../errors');
const { authenticate: defaultAuthenticate } = require('../middleware/authenticate');
const { listWatchEntries } = require('../data/watchEntries');
const { buildRecommendations } = require('../data/recommendationInputs');
const { getDefaultProvider } = require('./movies');

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 30;

// Parse the optional ?limit=<n>: a positive integer, clamped to MAX_LIMIT.
const parseLimit = raw => {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LIMIT;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new AppError(400, 'invalid_request', 'limit must be a positive integer');
  }
  return Math.min(parsed, MAX_LIMIT);
};

const createRecommendationsRouter = ({
  provider = getDefaultProvider,
  getWatchEntries = listWatchEntries,
  authenticate = defaultAuthenticate
} = {}) => {
  const router = express.Router();

  // GET /recommendations?limit=<n>
  router.get('/', authenticate, async (req, res) => {
    const limit = parseLimit(req.query.limit);
    const entries = await getWatchEntries(req.user.uid);
    const result = await buildRecommendations({ provider: provider(), watchEntries: entries, limit });
    res.json(result);
  });

  return router;
};

// Default router: reuses the shared lazily-built provider (and its cache).
const router = createRecommendationsRouter();

module.exports = router;
module.exports.createRecommendationsRouter = createRecommendationsRouter;
module.exports.DEFAULT_LIMIT = DEFAULT_LIMIT;
module.exports.MAX_LIMIT = MAX_LIMIT;

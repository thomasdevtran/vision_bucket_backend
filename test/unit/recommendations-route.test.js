const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const { createRecommendationsRouter } = require('../../src/routes/recommendations');
const { buildRecommendations } = require('../../src/data/recommendationInputs');
const { errorHandler, notFoundHandler } = require('../../src/errors');

// --- helpers ------------------------------------------------------------

// A provider stub. `genresByMovie` maps a watched movie id -> genre names;
// `popular` / `byGenre` are the candidate pools keyed by genre id.
const fakeProvider = ({ popular = [], genres = [], byGenre = {}, genresByMovie = {}, notConfigured = false } = {}) => {
  const guard = () => {
    if (notConfigured) {
      const err = new Error('not configured');
      err.status = 503;
      err.code = 'movie_provider_not_configured';
      throw err;
    }
  };
  return {
    getPopularMovies: async () => { guard(); return { page: 1, results: popular, total_pages: 1, total_results: popular.length }; },
    getGenres: async () => { guard(); return { genres }; },
    getMovieGenres: async id => { guard(); return genresByMovie[String(id)] || []; },
    getMoviesByGenre: async genreId => { guard(); return { page: 1, results: byGenre[String(genreId)] || [], total_pages: 1, total_results: 0 }; }
  };
};

// Mount the router with auth + watch-history + provider all mocked.
const buildApp = ({ provider, watchEntries = [] }) => {
  const app = express();
  app.use((req, res, next) => {
    req.id = 'test-req';
    req.log = { error() {}, warn() {} };
    next();
  });
  app.use('/recommendations', createRecommendationsRouter({
    provider: () => provider,
    getWatchEntries: async () => watchEntries,
    authenticate: (req, _res, next) => { req.user = { uid: 'user-1' }; next(); }
  }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

// --- data-assembly layer ------------------------------------------------

test('buildRecommendations excludes watched movies and orders affinity then popularity', async () => {
  // History: two Sci-Fi + one Drama watched -> Sci-Fi is the top affinity genre.
  const provider = fakeProvider({
    genres: [{ id: 878, name: 'Sci-Fi' }, { id: 18, name: 'Drama' }],
    genresByMovie: { 10: ['Sci-Fi'], 11: ['Sci-Fi'], 12: ['Drama'] },
    // Popular pool includes a watched movie (10) that must be filtered out.
    popular: [
      { id: 10, title: 'Watched SciFi', vote_average: 9 },
      { id: 20, title: 'Popular Only', vote_average: 8 }
    ],
    byGenre: {
      878: [
        { id: 30, title: 'SciFi A', vote_average: 5 },
        { id: 31, title: 'SciFi B', vote_average: 7 }
      ]
    }
  });

  const result = await buildRecommendations({
    provider,
    watchEntries: [
      { movieId: '10', status: 'Completed' },
      { movieId: '11', status: 'Completed' },
      { movieId: '12', status: 'Dropped' }
    ],
    limit: 10
  });

  assert.equal(result.fallback, false);
  const ids = result.results.map(m => m.id);
  // Watched (10, 11, 12) excluded.
  assert.ok(!ids.includes(10) && !ids.includes(11) && !ids.includes(12));
  // Genre-affinity titles (30, 31) rank above the untagged popular title (20);
  // within the affinity tier, higher popularity (vote_average) wins -> 31 > 30.
  assert.deepEqual(ids, [31, 30, 20]);
  // Output matches the Movie shape (no leaked genres/popularity tags).
  assert.deepEqual(Object.keys(result.results[0]).sort(),
    ['id', 'overview', 'poster_path', 'release_date', 'title', 'vote_average']);
});

test('buildRecommendations falls back to popular movies when there is no history', async () => {
  const provider = fakeProvider({
    popular: [
      { id: 1, title: 'A', vote_average: 4 },
      { id: 2, title: 'B', vote_average: 9 }
    ]
  });
  const result = await buildRecommendations({ provider, watchEntries: [], limit: 10 });
  assert.equal(result.fallback, true);
  assert.equal(result.reason, 'no_history');
  assert.deepEqual(result.results.map(m => m.id), [2, 1]); // popularity desc
});

// --- route --------------------------------------------------------------

test('GET /recommendations returns a ranked list for a signed-in user', async () => {
  const provider = fakeProvider({
    genres: [{ id: 878, name: 'Sci-Fi' }],
    genresByMovie: { 10: ['Sci-Fi'] },
    popular: [{ id: 20, title: 'Pop', vote_average: 8 }],
    byGenre: { 878: [{ id: 30, title: 'SciFi A', vote_average: 6 }] }
  });
  const app = buildApp({ provider, watchEntries: [{ movieId: '10', status: 'Completed' }] });

  const res = await request(app).get('/recommendations');
  assert.equal(res.status, 200);
  assert.equal(res.body.fallback, false);
  assert.equal(res.body.results[0].id, 30); // affinity title first
  assert.ok(!res.body.results.some(m => m.id === 10)); // watched excluded
});

test('GET /recommendations honors the limit query param', async () => {
  const provider = fakeProvider({
    popular: [{ id: 1, vote_average: 5 }, { id: 2, vote_average: 4 }, { id: 3, vote_average: 3 }]
  });
  const app = buildApp({ provider, watchEntries: [] });

  const res = await request(app).get('/recommendations?limit=2');
  assert.equal(res.status, 200);
  assert.equal(res.body.results.length, 2);
});

test('GET /recommendations rejects an invalid limit', async () => {
  const app = buildApp({ provider: fakeProvider(), watchEntries: [] });
  const res = await request(app).get('/recommendations?limit=abc');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'invalid_request');
});

test('GET /recommendations surfaces movie_provider_not_configured as 503', async () => {
  const app = buildApp({
    provider: fakeProvider({ notConfigured: true }),
    watchEntries: [{ movieId: '10', status: 'Completed' }]
  });
  const res = await request(app).get('/recommendations');
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, 'movie_provider_not_configured');
});

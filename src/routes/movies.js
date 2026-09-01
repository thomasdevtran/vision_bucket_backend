// routes/movies.js
//
// Backend movie proxy consumed by the frontend's api_service. All handlers are
// thin: validation, caching, retries and normalization live in the provider.
// Express 5 forwards rejected promises to the central error handler, so the
// handlers simply await and return.
const express = require('express');
const { loadMovieConfig } = require('../config');
const { createTmdbClient } = require('../movies/tmdbClient');
const { createTtlCache } = require('../movies/cache');
const { createMovieProvider } = require('../movies/provider');

// Factory so tests can mount the routes with a mocked provider.
const createMoviesRouter = provider => {
  const router = express.Router();

  // GET /api/movies/search?q=<query>&page=<n>
  router.get('/search', async (req, res) => {
    res.json(await provider.searchMovies(req.query.q, req.query.page));
  });

  // GET /api/movies/popular?page=<n>
  router.get('/popular', async (req, res) => {
    res.json(await provider.getPopularMovies(req.query.page));
  });

  // GET /api/movies/genres
  router.get('/genres', async (req, res) => {
    res.json(await provider.getGenres());
  });

  // GET /api/movies/genre/:genreId?page=<n>
  router.get('/genre/:genreId', async (req, res) => {
    res.json(await provider.getMoviesByGenre(req.params.genreId, req.query.page));
  });

  // GET /api/movies/:id  (keep last: it is the catch-all numeric route)
  router.get('/:id', async (req, res) => {
    res.json(await provider.getMovieDetails(req.params.id));
  });

  return router;
};

// Default provider, wired lazily so requiring this module never touches env or
// the network at import time. A single provider instance (and its cache) is
// reused across requests.
let defaultProvider;
const getDefaultProvider = () => {
  if (!defaultProvider) {
    const config = loadMovieConfig();
    defaultProvider = createMovieProvider({
      client: createTmdbClient({ config }),
      cache: createTtlCache()
    });
  }
  return defaultProvider;
};

// The router the app mounts. Handlers read through a proxy that resolves the
// default provider on first use, keeping route registration free of env/network
// access at import time.
const providerProxy = {
  searchMovies: (...args) => getDefaultProvider().searchMovies(...args),
  getMovieDetails: (...args) => getDefaultProvider().getMovieDetails(...args),
  getPopularMovies: (...args) => getDefaultProvider().getPopularMovies(...args),
  getGenres: (...args) => getDefaultProvider().getGenres(...args),
  getMoviesByGenre: (...args) => getDefaultProvider().getMoviesByGenre(...args)
};

const router = createMoviesRouter(providerProxy);

module.exports = router;
module.exports.createMoviesRouter = createMoviesRouter;
// Exposed so sibling routes (e.g. recommendations) reuse the same lazily-built
// provider instance — and therefore its upstream TTL cache — rather than
// standing up a second one.
module.exports.getDefaultProvider = getDefaultProvider;

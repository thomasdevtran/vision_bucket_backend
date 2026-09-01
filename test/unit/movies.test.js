const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const { createTtlCache } = require('../../src/movies/cache');
const { createTmdbClient } = require('../../src/movies/tmdbClient');
const { createMovieProvider } = require('../../src/movies/provider');
const {
  normalizeMovie,
  normalizeSearchResponse,
  normalizeGenreList
} = require('../../src/movies/normalize');
const { createMoviesRouter } = require('../../src/routes/movies');
const { errorHandler, notFoundHandler } = require('../../src/errors');

// --- helpers ------------------------------------------------------------

const jsonResponse = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  headers: { get: name => headers[name.toLowerCase()] }
});

const clientConfig = { baseUrl: 'https://tmdb.test/3', accessToken: 'v4-token', maxRetries: 3, baseDelayMs: 0 };

// --- cache --------------------------------------------------------------

test('cache returns undefined on miss and the value on hit', () => {
  const cache = createTtlCache();
  assert.equal(cache.get('k'), undefined);
  cache.set('k', { a: 1 }, 1000);
  assert.deepEqual(cache.get('k'), { a: 1 });
  assert.equal(cache.size, 1);
});

test('cache expires entries after the TTL elapses', () => {
  let clock = 1000;
  const cache = createTtlCache({ now: () => clock });
  cache.set('k', 'v', 500);
  clock = 1400;
  assert.equal(cache.get('k'), 'v'); // still fresh
  clock = 1600;
  assert.equal(cache.get('k'), undefined); // expired and evicted
  assert.equal(cache.size, 0);
});

// --- client: retries & error mapping ------------------------------------

test('client retries on 5xx then 429 and finally succeeds', async () => {
  const responses = [
    jsonResponse(500, { error: 'boom' }),
    jsonResponse(429, { error: 'slow down' }, { 'retry-after': '0' }),
    jsonResponse(200, { results: [{ id: 1 }] })
  ];
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return responses.shift();
  };
  const slept = [];
  const client = createTmdbClient({ config: clientConfig, fetchImpl, sleep: async ms => slept.push(ms) });

  const data = await client.get('/search/movie', { query: 'matrix' });
  assert.deepEqual(data, { results: [{ id: 1 }] });
  assert.equal(calls.length, 3); // two failures + one success
  assert.equal(slept.length, 2); // one backoff per retry
  assert.match(calls[0], /query=matrix/);
});

test('client sends the bearer token and returns parsed JSON on first success', async () => {
  let seenHeaders;
  const fetchImpl = async (_url, options) => {
    seenHeaders = options.headers;
    return jsonResponse(200, { id: 7 });
  };
  const client = createTmdbClient({ config: clientConfig, fetchImpl, sleep: async () => {} });
  const data = await client.get('/movie/7');
  assert.deepEqual(data, { id: 7 });
  assert.equal(seenHeaders.authorization, 'Bearer v4-token');
});

test('client puts api_key in the query string when only a v3 key is set', async () => {
  let seenUrl;
  const fetchImpl = async (url) => { seenUrl = String(url); return jsonResponse(200, {}); };
  const client = createTmdbClient({
    config: { baseUrl: 'https://tmdb.test/3', apiKey: 'v3key', maxRetries: 0 },
    fetchImpl,
    sleep: async () => {}
  });
  await client.get('/movie/popular');
  assert.match(seenUrl, /api_key=v3key/);
});

test('client maps a 404 to a 404 AppError', async () => {
  const client = createTmdbClient({
    config: clientConfig,
    fetchImpl: async () => jsonResponse(404, { status_message: 'Not found' }),
    sleep: async () => {}
  });
  await assert.rejects(client.get('/movie/0'), err => {
    assert.equal(err.status, 404);
    assert.equal(err.code, 'movie_not_found');
    return true;
  });
});

test('client gives up after maxRetries and raises a 502 AppError', async () => {
  let calls = 0;
  const client = createTmdbClient({
    config: { ...clientConfig, maxRetries: 2 },
    fetchImpl: async () => { calls += 1; return jsonResponse(503, {}); },
    sleep: async () => {}
  });
  await assert.rejects(client.get('/movie/popular'), err => {
    assert.equal(err.status, 502);
    assert.equal(err.code, 'movie_provider_unavailable');
    return true;
  });
  assert.equal(calls, 3); // initial + 2 retries
});

test('client fails with a 503 not_configured error when no credentials are set', async () => {
  const client = createTmdbClient({
    config: { baseUrl: 'https://tmdb.test/3' },
    fetchImpl: async () => jsonResponse(200, {}),
    sleep: async () => {}
  });
  await assert.rejects(client.get('/movie/popular'), err => {
    assert.equal(err.status, 503);
    assert.equal(err.code, 'movie_provider_not_configured');
    return true;
  });
});

// --- normalization ------------------------------------------------------

test('normalizeMovie maps a TMDB payload to the frontend Movie shape', () => {
  const movie = normalizeMovie({
    id: '603',
    title: 'The Matrix',
    overview: 'A hacker learns the truth.',
    poster_path: '/matrix.jpg',
    release_date: '1999-03-31',
    vote_average: 8.7,
    extra_field: 'dropped'
  });
  assert.deepEqual(movie, {
    id: 603,
    title: 'The Matrix',
    overview: 'A hacker learns the truth.',
    poster_path: '/matrix.jpg',
    release_date: '1999-03-31',
    vote_average: 8.7
  });
});

test('normalizeMovie fills safe defaults for missing/null fields', () => {
  const movie = normalizeMovie({ id: 1, title: 'X', poster_path: null });
  assert.equal(movie.poster_path, '');
  assert.equal(movie.overview, '');
  assert.equal(movie.release_date, '');
  assert.equal(movie.vote_average, 0);
});

test('normalizeSearchResponse and normalizeGenreList produce the expected envelopes', () => {
  const search = normalizeSearchResponse({
    page: 2,
    results: [{ id: 1, title: 'A' }, { id: 2, title: 'B' }],
    total_pages: 10,
    total_results: 200
  });
  assert.equal(search.page, 2);
  assert.equal(search.results.length, 2);
  assert.deepEqual(Object.keys(search), ['page', 'results', 'total_pages', 'total_results']);

  const genres = normalizeGenreList({ genres: [{ id: 28, name: 'Action' }] });
  assert.deepEqual(genres, { genres: [{ id: 28, name: 'Action' }] });
});

// --- provider: caching + validation -------------------------------------

const fakeClient = (impl) => ({ get: impl });

test('provider serves the second identical call from cache (one upstream hit)', async () => {
  let hits = 0;
  const provider = createMovieProvider({
    client: fakeClient(async () => { hits += 1; return { page: 1, results: [{ id: 1, title: 'A' }] }; }),
    cache: createTtlCache()
  });
  const first = await provider.searchMovies('matrix', 1);
  const second = await provider.searchMovies('matrix', 1);
  assert.deepEqual(first, second);
  assert.equal(hits, 1); // cached the second time
});

test('provider validation rejects an empty query and non-numeric ids', async () => {
  const provider = createMovieProvider({
    client: fakeClient(async () => ({})),
    cache: createTtlCache()
  });
  await assert.rejects(provider.searchMovies('', 1), err => {
    assert.equal(err.status, 400);
    assert.equal(err.code, 'invalid_request');
    return true;
  });
  await assert.rejects(provider.getMovieDetails('abc'), err => {
    assert.equal(err.status, 400);
    return true;
  });
  await assert.rejects(provider.getMoviesByGenre('x', 1), err => {
    assert.equal(err.status, 400);
    return true;
  });
});

test('provider defaults the page to 1 and passes discover params for genre', async () => {
  const seen = [];
  const provider = createMovieProvider({
    client: fakeClient(async (path, params) => { seen.push({ path, params }); return { page: 1, results: [] }; }),
    cache: createTtlCache()
  });
  await provider.getMoviesByGenre('28');
  assert.equal(seen[0].path, '/discover/movie');
  assert.equal(seen[0].params.with_genres, 28);
  assert.equal(seen[0].params.page, 1);
});

// --- routes (mocked provider) -------------------------------------------

const buildApp = provider => {
  const app = express();
  app.use((req, res, next) => {
    req.id = 'test-req';
    req.log = { error() {}, warn() {} };
    next();
  });
  app.use('/api/movies', createMoviesRouter(provider));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

test('routes return normalized shapes and correct status codes', async () => {
  const provider = {
    searchMovies: async (q, page) => ({ page: Number(page) || 1, results: [{ id: 1, title: q }], total_pages: 1, total_results: 1 }),
    getMovieDetails: async id => ({ id: Number(id), title: 'Detail', overview: '', poster_path: '', release_date: '', vote_average: 0 }),
    getPopularMovies: async () => ({ page: 1, results: [], total_pages: 0, total_results: 0 }),
    getGenres: async () => ({ genres: [{ id: 28, name: 'Action' }] }),
    getMoviesByGenre: async () => ({ page: 1, results: [], total_pages: 0, total_results: 0 })
  };
  const app = buildApp(provider);

  const search = await request(app).get('/api/movies/search?q=matrix&page=2');
  assert.equal(search.status, 200);
  assert.equal(search.body.results[0].title, 'matrix');

  const details = await request(app).get('/api/movies/603');
  assert.equal(details.status, 200);
  assert.equal(details.body.id, 603);

  const genres = await request(app).get('/api/movies/genres');
  assert.equal(genres.status, 200);
  assert.equal(genres.body.genres[0].name, 'Action');
});

test('routes surface provider AppErrors through the central error handler', async () => {
  const { AppError } = require('../../src/errors');
  const provider = {
    searchMovies: async () => { throw new AppError(400, 'invalid_request', 'q is required'); },
    getMovieDetails: async () => { throw new AppError(404, 'movie_not_found', 'nope'); },
    getPopularMovies: async () => ({}),
    getGenres: async () => ({}),
    getMoviesByGenre: async () => ({})
  };
  const app = buildApp(provider);

  const badSearch = await request(app).get('/api/movies/search');
  assert.equal(badSearch.status, 400);
  assert.equal(badSearch.body.error.code, 'invalid_request');

  const missing = await request(app).get('/api/movies/999999');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'movie_not_found');
});

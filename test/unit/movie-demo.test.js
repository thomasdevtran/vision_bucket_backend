const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createMovieDemoApp } = require('../../src/movie-demo-app');
const { createMoviesRouter } = require('../../src/routes/movies');
const { createLogger } = require('../../src/logger');
const { AppError } = require('../../src/errors');

const app = createMovieDemoApp({
  logger: createLogger({ logLevel: 'silent', nodeEnv: 'test' }),
  router: createMoviesRouter({
    getPopularMovies: async () => ({ results: [{ id: 27205, title: 'Inception' }] }),
    searchMovies: async () => { throw new AppError(400, 'invalid_request', 'Query is required'); }
  })
});

test('demo serves public movies with CORS and caching without Firebase login', async () => {
  const res = await request(app).get('/api/movies/popular').set('Origin', 'https://thomasdevtran.github.io');
  assert.equal(res.status, 200);
  assert.equal(res.body.results[0].title, 'Inception');
  assert.equal(res.headers['access-control-allow-origin'], '*');
  assert.match(res.headers['cache-control'], /s-maxage=300/);
});

test('demo does not expose profile, reviews, or write routes', async () => {
  for (const path of ['/profile/data/someone', '/reviews/posting', '/api/movies/popular']) {
    const res = await request(app).post(path).send({ content: 'no writes' });
    assert.equal(res.status, 404);
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  assert.equal((await request(app).get('/profile/data/someone')).status, 404);
});

test('movie validation errors are not cached', async () => {
  const res = await request(app).get('/api/movies/search');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'invalid_request');
  assert.equal(res.headers['cache-control'], 'no-store');
});

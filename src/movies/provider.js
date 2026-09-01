// Movie provider: the domain layer the routes call. It validates input,
// serves GET responses from a TTL cache, delegates cache misses to the TMDB
// client, and normalizes upstream payloads into the frontend's shapes.
//
// Built via a factory so tests can inject a fake client / cache.

const { AppError } = require('../errors');
const {
  validateSearchQuery,
  parsePage,
  parsePositiveId
} = require('../validation');
const {
  normalizeMovie,
  normalizeSearchResponse,
  normalizeGenreList
} = require('./normalize');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Reasonable TTLs: details/genres change rarely, listings a little more often.
const TTL = Object.freeze({
  search: 5 * MINUTE,
  popular: 5 * MINUTE,
  genre: 5 * MINUTE,
  details: 24 * HOUR,
  genres: 24 * HOUR
});

const badRequest = message => new AppError(400, 'invalid_request', message);

const createMovieProvider = ({ client, cache, ttl = TTL } = {}) => {
  if (!client) throw new Error('createMovieProvider requires a client');
  if (!cache) throw new Error('createMovieProvider requires a cache');

  // Fetch-through-cache: return the cached value or populate it from `loader`.
  const cached = async (key, ttlMs, loader) => {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const value = await loader();
    cache.set(key, value, ttlMs);
    return value;
  };

  const searchMovies = async (query, page) => {
    const q = validateSearchQuery(query);
    if (!q.valid) throw badRequest(q.error);
    const pageResult = parsePage(page);
    if (!pageResult.valid) throw badRequest(pageResult.error);

    const key = `search:${q.value.toLowerCase()}:${pageResult.value}`;
    return cached(key, ttl.search, async () => {
      const raw = await client.get('/search/movie', { query: q.value, page: pageResult.value });
      return normalizeSearchResponse(raw);
    });
  };

  const getMovieDetails = async id => {
    const parsed = parsePositiveId(id, 'movie id');
    if (!parsed.valid) throw badRequest(parsed.error);

    const key = `details:${parsed.value}`;
    return cached(key, ttl.details, async () => {
      const raw = await client.get(`/movie/${parsed.value}`);
      return normalizeMovie(raw);
    });
  };

  const getPopularMovies = async page => {
    const pageResult = parsePage(page);
    if (!pageResult.valid) throw badRequest(pageResult.error);

    const key = `popular:${pageResult.value}`;
    return cached(key, ttl.popular, async () => {
      const raw = await client.get('/movie/popular', { page: pageResult.value });
      return normalizeSearchResponse(raw);
    });
  };

  const getGenres = async () =>
    cached('genres', ttl.genres, async () => {
      const raw = await client.get('/genre/movie/list');
      return normalizeGenreList(raw);
    });

  const getMoviesByGenre = async (genreId, page) => {
    const parsed = parsePositiveId(genreId, 'genre id');
    if (!parsed.valid) throw badRequest(parsed.error);
    const pageResult = parsePage(page);
    if (!pageResult.valid) throw badRequest(pageResult.error);

    const key = `genre:${parsed.value}:${pageResult.value}`;
    return cached(key, ttl.genre, async () => {
      const raw = await client.get('/discover/movie', {
        with_genres: parsed.value,
        page: pageResult.value,
        sort_by: 'popularity.desc'
      });
      return normalizeSearchResponse(raw);
    });
  };

  return {
    searchMovies,
    getMovieDetails,
    getPopularMovies,
    getGenres,
    getMoviesByGenre
  };
};

module.exports = { createMovieProvider, TTL };

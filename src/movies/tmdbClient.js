// Resilient HTTP client for The Movie Database (TMDB).
//
// Responsibilities:
//   - attach credentials (v4 bearer token and/or v3 api_key)
//   - enforce a per-request timeout
//   - retry 429 / 5xx / network failures with exponential backoff + jitter
//   - translate final failures into AppError so the central error handler
//     produces a consistent response shape.
//
// `fetchImpl` and `sleep` are injectable so tests never touch the network.

const { AppError } = require('../errors');

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Exponential backoff with full jitter. Honours a numeric Retry-After (seconds)
// when the upstream provides one on a 429.
const backoffDelay = (attempt, baseDelayMs, retryAfterMs) => {
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return retryAfterMs;
  const capped = baseDelayMs * 2 ** attempt;
  return Math.round(Math.random() * capped);
};

const parseRetryAfter = response => {
  const header = response.headers && typeof response.headers.get === 'function'
    ? response.headers.get('retry-after')
    : undefined;
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
};

const createTmdbClient = ({
  config,
  fetchImpl = fetch,
  sleep = defaultSleep
} = {}) => {
  const {
    baseUrl = 'https://api.themoviedb.org/3',
    accessToken = null,
    apiKey = null,
    timeoutMs = 8000,
    maxRetries = 3,
    baseDelayMs = 200
  } = config || {};

  const isConfigured = Boolean(accessToken || apiKey);

  const buildUrl = (path, params = {}) => {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    // v3 api_key travels as a query param; the v4 token travels as a header.
    if (!accessToken && apiKey) url.searchParams.set('api_key', apiKey);
    return url;
  };

  const buildHeaders = () => {
    const headers = { accept: 'application/json' };
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    return headers;
  };

  const attempt = async (url, headers) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const get = async (path, params = {}) => {
    if (!isConfigured) {
      throw new AppError(
        503,
        'movie_provider_not_configured',
        'Movie provider is not configured. Set TMDB_ACCESS_TOKEN or TMDB_API_KEY.'
      );
    }

    const url = buildUrl(path, params);
    const headers = buildHeaders();
    let lastError;

    for (let tries = 0; tries <= maxRetries; tries += 1) {
      let response;
      try {
        response = await attempt(url, headers);
      } catch (error) {
        // Network error or timeout abort — retryable.
        lastError = error;
        if (tries < maxRetries) {
          await sleep(backoffDelay(tries, baseDelayMs));
          continue;
        }
        break;
      }

      if (response.ok) {
        return response.json();
      }

      if (response.status === 404) {
        throw new AppError(404, 'movie_not_found', 'The requested movie resource was not found.');
      }

      if (RETRYABLE_STATUSES.has(response.status) && tries < maxRetries) {
        const retryAfterMs = response.status === 429 ? parseRetryAfter(response) : undefined;
        await sleep(backoffDelay(tries, baseDelayMs, retryAfterMs));
        lastError = new Error(`TMDB responded with ${response.status}`);
        continue;
      }

      // Non-retryable upstream error, or retries exhausted on a retryable status.
      throw new AppError(
        502,
        'movie_provider_unavailable',
        `Movie provider request failed with status ${response.status}.`
      );
    }

    throw new AppError(
      502,
      'movie_provider_unavailable',
      `Movie provider is unavailable: ${lastError ? lastError.message : 'unknown error'}.`
    );
  };

  return { get, isConfigured };
};

module.exports = { createTmdbClient, backoffDelay, RETRYABLE_STATUSES };

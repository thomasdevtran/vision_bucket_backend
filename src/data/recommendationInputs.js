// Wiring/data-assembly layer for the "For You" feed.
//
// The pure ranking core lives in src/recommendations.js. This module gathers
// the two inputs that core needs and shapes them for it:
//   1. the watched-set + genre affinity, derived from the user's watch_entries
//      (each watched movie's genres fetched through the movie provider), and
//   2. a candidate pool pulled from the provider (popular titles + titles in
//      the user's top affinity genres).
//
// It returns normalized `Movie` objects (the same shape the frontend consumes)
// plus a `fallback` flag describing why. The provider is injected so the route
// and tests can supply a real or a mocked provider.

const { rankRecommendations } = require('../recommendations');
const { WATCH_STATUSES } = require('../validation');

// How many of the user's most-preferred genres we pull extra candidates for.
const MAX_AFFINITY_GENRES = 3;
// Cap the number of per-movie detail lookups so a huge history stays cheap
// (provider caches these upstream, so repeat requests are effectively free).
const MAX_HISTORY_LOOKUPS = 50;

// Project any movie-ish object down to the frontend's Movie shape.
const toMovie = movie => ({
  id: movie.id,
  title: movie.title,
  overview: movie.overview,
  poster_path: movie.poster_path,
  release_date: movie.release_date,
  vote_average: movie.vote_average
});

// The normalized Movie shape omits TMDB's `popularity`, so fall back to
// `vote_average` as the popularity signal the ranking core sorts on (a mock
// candidate may still pass an explicit `popularity`, which wins).
const popularityOf = movie => {
  const explicit = Number(movie && movie.popularity);
  if (Number.isFinite(explicit)) return explicit;
  const rating = Number(movie && movie.vote_average);
  return Number.isFinite(rating) ? rating : 0;
};

// Group watch_entries into the { <status>: [movieId...] } profile shape the
// ranking core reads its watched-set from.
const groupEntriesByStatus = entries => {
  const profile = {};
  for (const status of WATCH_STATUSES) profile[status] = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry && WATCH_STATUSES.includes(entry.status)) {
      profile[entry.status].push(entry.movieId);
    }
  }
  return profile;
};

// Count genre occurrences across the user's history and return the top names.
const derivePreferredGenres = async (provider, watchedIds) => {
  const counts = new Map();
  await Promise.all(watchedIds.slice(0, MAX_HISTORY_LOOKUPS).map(async id => {
    // A single unreadable title must not sink the whole feed.
    const names = await provider.getMovieGenres(id).catch(() => []);
    for (const name of Array.isArray(names) ? names : []) {
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }));

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_AFFINITY_GENRES)
    .map(([name]) => name);
};

// Merge candidates by id, unioning the genre tags we attach so a title that
// matches several preferred genres accrues a higher affinity score.
const collectCandidates = async (provider, preferredGenres) => {
  const byId = new Map();
  const add = (movie, genreNames) => {
    if (!movie || movie.id === undefined || movie.id === null) return;
    const key = String(movie.id);
    const existing = byId.get(key);
    const genres = new Set([...(existing ? existing.genres : []), ...(genreNames || [])]);
    byId.set(key, { ...toMovie(movie), popularity: popularityOf(movie), genres: [...genres] });
  };

  // Popular titles form the untagged baseline / tail of the pool.
  const popular = await provider.getPopularMovies();
  for (const movie of (popular && popular.results) || []) add(movie, []);

  if (preferredGenres.length > 0) {
    const genreList = await provider.getGenres().catch(() => ({ genres: [] }));
    const nameToId = new Map(
      ((genreList && genreList.genres) || []).map(genre => [String(genre.name).toLowerCase(), genre.id])
    );

    await Promise.all(preferredGenres.map(async name => {
      const genreId = nameToId.get(String(name).toLowerCase());
      if (!genreId) return;
      try {
        const byGenre = await provider.getMoviesByGenre(genreId);
        for (const movie of (byGenre && byGenre.results) || []) add(movie, [name]);
      } catch {
        // Skip a genre whose discovery call fails; the rest still contribute.
      }
    }));
  }

  return [...byId.values()];
};

// Build the ranked "For You" list for a user.
//   provider     - movie provider (real or mocked)
//   watchEntries - the user's watch_entries documents
//   limit        - max results to return
// Returns { results: Movie[], fallback: boolean, reason?: string }.
const buildRecommendations = async ({ provider, watchEntries, limit = 10 } = {}) => {
  const profile = groupEntriesByStatus(watchEntries);
  const watchedIds = WATCH_STATUSES.flatMap(status => profile[status]).map(String);

  // No history yet: recommend popular titles so the shelf is never empty.
  if (watchedIds.length === 0) {
    const popular = await provider.getPopularMovies();
    const candidates = ((popular && popular.results) || [])
      .map(movie => ({ ...toMovie(movie), popularity: popularityOf(movie), genres: [] }));
    const ranked = rankRecommendations(candidates, {}, limit);
    return { results: ranked.map(toMovie), fallback: true, reason: 'no_history' };
  }

  const preferredGenres = await derivePreferredGenres(provider, watchedIds);
  const candidates = await collectCandidates(provider, preferredGenres);
  const ranked = rankRecommendations(candidates, { ...profile, preferredGenres }, limit);

  return { results: ranked.map(toMovie), fallback: false, preferredGenres };
};

module.exports = {
  buildRecommendations,
  groupEntriesByStatus,
  derivePreferredGenres,
  collectCandidates,
  MAX_AFFINITY_GENRES,
  MAX_HISTORY_LOOKUPS
};

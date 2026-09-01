const { WATCH_STATUSES } = require('./validation');

const normalizeId = id => String(id);

const watchedMovieIds = profile => new Set(
  WATCH_STATUSES.flatMap(status => Array.isArray(profile[status]) ? profile[status] : [])
    .map(normalizeId)
);

const rankRecommendations = (candidates, profile = {}, limit = 10) => {
  if (!Array.isArray(candidates) || !Number.isSafeInteger(limit) || limit < 0) return [];

  const watched = watchedMovieIds(profile);
  const preferredGenres = new Set(
    (Array.isArray(profile.preferredGenres) ? profile.preferredGenres : [])
      .map(genre => String(genre).toLowerCase())
  );

  return candidates
    .map((movie, index) => ({
      movie,
      index,
      genreMatches: (Array.isArray(movie && movie.genres) ? movie.genres : [])
        .filter(genre => preferredGenres.has(String(genre).toLowerCase())).length,
      popularity: Number.isFinite(Number(movie && movie.popularity)) ? Number(movie.popularity) : 0
    }))
    .filter(({ movie }) => movie && movie.id !== undefined && !watched.has(normalizeId(movie.id)))
    .sort((left, right) => (
      right.genreMatches - left.genreMatches
      || right.popularity - left.popularity
      || left.index - right.index
    ))
    .slice(0, limit)
    .map(({ movie }) => movie);
};

module.exports = { rankRecommendations, watchedMovieIds };

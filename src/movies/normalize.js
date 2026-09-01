// Transform raw TMDB payloads into the exact shapes the frontend consumes
// (see the frontend's src/types/index.ts: Movie, MovieSearchResponse,
// Genre, GenreListResponse). Missing fields are coerced to safe defaults so
// the UI never has to guard against nulls.

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toText = (value, fallback = '') => (typeof value === 'string' ? value : fallback);

const normalizeMovie = (movie = {}) => ({
  id: toNumber(movie.id),
  title: toText(movie.title ?? movie.name),
  overview: toText(movie.overview),
  // poster_path is null on TMDB when a movie has no artwork; keep it a string
  // because the frontend interpolates it directly into an <img> src.
  poster_path: toText(movie.poster_path),
  release_date: toText(movie.release_date ?? movie.first_air_date),
  vote_average: toNumber(movie.vote_average)
});

const normalizeSearchResponse = (payload = {}) => ({
  page: toNumber(payload.page, 1),
  results: Array.isArray(payload.results) ? payload.results.map(normalizeMovie) : [],
  total_pages: toNumber(payload.total_pages),
  total_results: toNumber(payload.total_results)
});

const normalizeGenre = (genre = {}) => ({
  id: toNumber(genre.id),
  name: toText(genre.name)
});

const normalizeGenreList = (payload = {}) => ({
  genres: Array.isArray(payload.genres) ? payload.genres.map(normalizeGenre) : []
});

module.exports = {
  normalizeMovie,
  normalizeSearchResponse,
  normalizeGenre,
  normalizeGenreList
};

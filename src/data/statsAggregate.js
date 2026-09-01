// Pure aggregation of a user's activity into dashboard statistics.
//
// Takes already-fetched inputs (watch_entries, diary_entries, reviews, and a
// movieId -> genre-names map) and returns a plain stats object. No Firestore,
// no network -- so it is fully unit-testable. The route in src/routes/stats.js
// does the fetching (and the genre lookups via the movie provider) and hands
// the raw arrays here.

const RATINGS = [1, 2, 3, 4, 5];

// Extract a 4-digit year from an ISO date/string, or null if unparseable.
const yearOf = value => {
  if (!value && value !== 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getUTCFullYear();
};

const isValidRating = value => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5;
};

const aggregateStats = ({ watchEntries = [], diary = [], reviews = [], genresByMovieId = {} } = {}) => {
  // Distinct movies the user has tracked (one watch_entries doc per movie).
  const distinctMovieIds = [...new Set(watchEntries.map(entry => String(entry.movieId)))];

  // Ratings the user has given, counted across their reviews and diary entries.
  const ratingsDistribution = Object.fromEntries(RATINGS.map(rating => [rating, 0]));
  let ratingSum = 0;
  let ratingCount = 0;
  const countRating = value => {
    if (!isValidRating(value)) return;
    const n = Number(value);
    ratingsDistribution[n] += 1;
    ratingSum += n;
    ratingCount += 1;
  };
  reviews.forEach(review => countRating(review.rating));
  diary.forEach(entry => countRating(entry.rating));

  const averageRating = ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null;

  // Top genres across the user's watched movies (genre names supplied per movie).
  const genreCounts = new Map();
  for (const movieId of distinctMovieIds) {
    const names = genresByMovieId[movieId] || genresByMovieId[Number(movieId)] || [];
    for (const name of Array.isArray(names) ? names : []) {
      if (typeof name === 'string' && name.trim()) {
        genreCounts.set(name, (genreCounts.get(name) || 0) + 1);
      }
    }
  }
  const topGenres = [...genreCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([genre, count]) => ({ genre, count }));

  // Watches per calendar year, from the diary's watchedAt timestamps.
  const yearCounts = new Map();
  for (const entry of diary) {
    const year = yearOf(entry.watchedAt);
    if (year !== null) yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
  }
  const watchesPerYear = [...yearCounts.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([year, count]) => ({ year, count }));

  return {
    totals: {
      moviesWatched: distinctMovieIds.length,
      reviews: reviews.length,
      diaryEntries: diary.length,
      averageRating
    },
    ratingsDistribution: RATINGS.map(rating => ({ rating, count: ratingsDistribution[rating] })),
    topGenres,
    watchesPerYear
  };
};

module.exports = { aggregateStats, yearOf };

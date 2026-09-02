const test = require('node:test');
const assert = require('node:assert/strict');

const { aggregateStats, yearOf } = require('../../src/data/statsAggregate');

test('totals count distinct watched movies, reviews, and diary entries', () => {
  const stats = aggregateStats({
    watchEntries: [
      { movieId: '10', status: 'Completed' },
      { movieId: 10, status: 'Rewatched' }, // same movie, still distinct=1
      { movieId: '20', status: 'Completed' }
    ],
    reviews: [{ rating: 5 }, { rating: 3 }],
    diary: [{ watchedAt: '2026-01-01', rating: 4 }]
  });

  assert.equal(stats.totals.moviesWatched, 2);
  assert.equal(stats.totals.reviews, 2);
  assert.equal(stats.totals.diaryEntries, 1);
});

test('ratings distribution and average combine review and diary ratings', () => {
  const stats = aggregateStats({
    reviews: [{ rating: 5 }, { rating: 5 }, { rating: 1 }],
    diary: [{ watchedAt: '2026-01-01', rating: 3 }, { watchedAt: '2026-02-01', rating: null }]
  });

  const byRating = Object.fromEntries(stats.ratingsDistribution.map(r => [r.rating, r.count]));
  assert.equal(byRating[5], 2);
  assert.equal(byRating[3], 1);
  assert.equal(byRating[1], 1);
  assert.equal(byRating[2], 0);
  // (5 + 5 + 1 + 3) / 4 = 3.5; the null diary rating is ignored.
  assert.equal(stats.totals.averageRating, 3.5);
});

test('averageRating is null when no ratings exist', () => {
  const stats = aggregateStats({ watchEntries: [{ movieId: '1', status: 'Completed' }] });
  assert.equal(stats.totals.averageRating, null);
  assert.deepEqual(stats.topGenres, []);
  assert.deepEqual(stats.watchesPerYear, []);
});

test('top genres are counted across watched movies and sorted by frequency', () => {
  const stats = aggregateStats({
    watchEntries: [
      { movieId: '1', status: 'Completed' },
      { movieId: '2', status: 'Completed' },
      { movieId: '3', status: 'Completed' }
    ],
    genresByMovieId: {
      1: ['Action', 'Sci-Fi'],
      2: ['Action', 'Comedy'],
      3: ['Action']
    }
  });

  assert.deepEqual(stats.topGenres[0], { genre: 'Action', count: 3 });
  const names = stats.topGenres.map(g => g.genre);
  assert.ok(names.includes('Sci-Fi') && names.includes('Comedy'));
});

test('watches per year are counted from diary watchedAt and sorted ascending', () => {
  const stats = aggregateStats({
    diary: [
      { watchedAt: '2024-05-01' },
      { watchedAt: '2026-01-01' },
      { watchedAt: '2026-08-01' },
      { watchedAt: 'not-a-date' }
    ]
  });

  assert.deepEqual(stats.watchesPerYear, [
    { year: 2024, count: 1 },
    { year: 2026, count: 2 }
  ]);
});

test('yearOf parses ISO dates and rejects garbage', () => {
  assert.equal(yearOf('2026-03-15T00:00:00.000Z'), 2026);
  assert.equal(yearOf('nope'), null);
  assert.equal(yearOf(undefined), null);
});

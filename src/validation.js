const WATCH_STATUSES = Object.freeze([
  'Completed',
  'Dropped',
  'On_hold',
  'Plan_to_watch',
  'Rewatched'
]);

const isNonEmptyString = value => typeof value === 'string' && value.trim().length > 0;
const toInteger = value => {
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};
const isValidWatchStatus = status => WATCH_STATUSES.includes(status);

const validateReview = ({ movieId, Author, content, rating } = {}) => {
  const parsedMovieId = toInteger(movieId);
  const parsedRating = toInteger(rating);
  const errors = [];

  if (!parsedMovieId || parsedMovieId < 1) errors.push('movieId must be a positive integer');
  if (!isNonEmptyString(Author)) errors.push('Author is required');
  if (!isNonEmptyString(content)) errors.push('content is required');
  if (parsedRating === null || parsedRating < 1 || parsedRating > 5) {
    errors.push('rating must be an integer from 1 to 5');
  }

  return {
    valid: errors.length === 0,
    errors,
    value: {
      movieId: parsedMovieId,
      Author: isNonEmptyString(Author) ? Author.trim() : Author,
      content: isNonEmptyString(content) ? content.trim() : content,
      rating: parsedRating
    }
  };
};

const validateFollow = ({ followeeId } = {}) => {
  const errors = [];
  if (!isNonEmptyString(followeeId)) errors.push('followeeId is required');

  return {
    valid: errors.length === 0,
    errors,
    value: { followeeId: isNonEmptyString(followeeId) ? followeeId.trim() : followeeId }
  };
};

const validateReviewUpdate = ({ content, rating } = {}) => {
  const errors = [];
  const value = {};

  if (content === undefined && rating === undefined) {
    errors.push('content or rating is required');
  }
  if (content !== undefined) {
    if (!isNonEmptyString(content)) errors.push('content cannot be empty');
    else value.content = content.trim();
  }
  if (rating !== undefined) {
    const parsedRating = toInteger(rating);
    if (parsedRating === null || parsedRating < 1 || parsedRating > 5) {
      errors.push('rating must be an integer from 1 to 5');
    } else {
      value.rating = parsedRating;
    }
  }

  return { valid: errors.length === 0, errors, value };
};

// --- Movie provider query/param validation ------------------------------

const validateSearchQuery = q => {
  if (!isNonEmptyString(q)) return { valid: false, error: 'q is required' };
  return { valid: true, value: q.trim() };
};

const parsePage = page => {
  if (page === undefined || page === null || page === '') return { valid: true, value: 1 };
  const parsed = toInteger(page);
  if (parsed === null || parsed < 1) return { valid: false, error: 'page must be a positive integer' };
  return { valid: true, value: parsed };
};

const parsePositiveId = (value, label = 'id') => {
  const parsed = toInteger(value);
  if (parsed === null || parsed < 1) return { valid: false, error: `${label} must be a positive integer` };
  return { valid: true, value: parsed };
};

module.exports = {
  WATCH_STATUSES,
  isNonEmptyString,
  isValidWatchStatus,
  toInteger,
  validateFollow,
  validateReview,
  validateReviewUpdate,
  validateSearchQuery,
  parsePage,
  parsePositiveId
};

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

const LIST_TITLE_MAX = 100;
const LIST_DESCRIPTION_MAX = 500;
const LIST_NOTE_MAX = 300;

const validateDescription = (description, errors, value) => {
  if (description === undefined || description === null || description === '') {
    value.description = '';
    return;
  }
  if (typeof description !== 'string') {
    errors.push('description must be a string');
  } else if (description.trim().length > LIST_DESCRIPTION_MAX) {
    errors.push(`description must be at most ${LIST_DESCRIPTION_MAX} characters`);
  } else {
    value.description = description.trim();
  }
};

const validateListCreate = ({ title, description, isPublic } = {}) => {
  const errors = [];
  const value = {};

  if (!isNonEmptyString(title)) {
    errors.push('title is required');
  } else if (title.trim().length > LIST_TITLE_MAX) {
    errors.push(`title must be at most ${LIST_TITLE_MAX} characters`);
  } else {
    value.title = title.trim();
  }

  validateDescription(description, errors, value);

  if (isPublic === undefined) {
    value.isPublic = false;
  } else if (typeof isPublic !== 'boolean') {
    errors.push('isPublic must be a boolean');
  } else {
    value.isPublic = isPublic;
  }

  return { valid: errors.length === 0, errors, value };
};

const validateListUpdate = ({ title, description, isPublic } = {}) => {
  const errors = [];
  const value = {};

  if (title === undefined && description === undefined && isPublic === undefined) {
    errors.push('title, description, or isPublic is required');
  }
  if (title !== undefined) {
    if (!isNonEmptyString(title)) errors.push('title cannot be empty');
    else if (title.trim().length > LIST_TITLE_MAX) errors.push(`title must be at most ${LIST_TITLE_MAX} characters`);
    else value.title = title.trim();
  }
  if (description !== undefined) {
    if (typeof description !== 'string') errors.push('description must be a string');
    else if (description.trim().length > LIST_DESCRIPTION_MAX) {
      errors.push(`description must be at most ${LIST_DESCRIPTION_MAX} characters`);
    } else value.description = description.trim();
  }
  if (isPublic !== undefined) {
    if (typeof isPublic !== 'boolean') errors.push('isPublic must be a boolean');
    else value.isPublic = isPublic;
  }

  return { valid: errors.length === 0, errors, value };
};

const validateListItem = ({ movieId, note } = {}) => {
  const errors = [];
  const value = {};
  const parsedMovieId = toInteger(movieId);

  if (parsedMovieId === null || parsedMovieId < 1) errors.push('movieId must be a positive integer');
  else value.movieId = parsedMovieId;

  if (note !== undefined && note !== null && note !== '') {
    if (typeof note !== 'string') errors.push('note must be a string');
    else if (note.trim().length > LIST_NOTE_MAX) errors.push(`note must be at most ${LIST_NOTE_MAX} characters`);
    else value.note = note.trim();
  }

  return { valid: errors.length === 0, errors, value };
};

const validateReorder = ({ order } = {}) => {
  const errors = [];
  if (!Array.isArray(order) || order.length === 0) {
    return { valid: false, errors: ['order must be a non-empty array of movieIds'], value: { order: [] } };
  }
  const parsed = order.map(toInteger);
  if (parsed.some(id => id === null || id < 1)) {
    errors.push('order must contain only positive integer movieIds');
  }
  if (new Set(parsed.map(String)).size !== parsed.length) {
    errors.push('order must not contain duplicate movieIds');
  }
  return { valid: errors.length === 0, errors, value: { order: parsed } };
};

module.exports = {
  WATCH_STATUSES,
  LIST_TITLE_MAX,
  LIST_DESCRIPTION_MAX,
  LIST_NOTE_MAX,
  isNonEmptyString,
  isValidWatchStatus,
  toInteger,
  validateFollow,
  validateReview,
  validateReviewUpdate,
  validateSearchQuery,
  parsePage,
  parsePositiveId,
  validateListCreate,
  validateListUpdate,
  validateListItem,
  validateReorder
};

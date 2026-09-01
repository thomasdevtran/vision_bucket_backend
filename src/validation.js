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

const validateReview = ({ movieId, Author, content, rating, isSpoiler } = {}) => {
  const parsedMovieId = toInteger(movieId);
  const parsedRating = toInteger(rating);
  const errors = [];

  if (!parsedMovieId || parsedMovieId < 1) errors.push('movieId must be a positive integer');
  if (!isNonEmptyString(Author)) errors.push('Author is required');
  if (!isNonEmptyString(content)) errors.push('content is required');
  if (parsedRating === null || parsedRating < 1 || parsedRating > 5) {
    errors.push('rating must be an integer from 1 to 5');
  }
  if (isSpoiler !== undefined && typeof isSpoiler !== 'boolean') {
    errors.push('isSpoiler must be a boolean');
  }

  return {
    valid: errors.length === 0,
    errors,
    value: {
      movieId: parsedMovieId,
      Author: isNonEmptyString(Author) ? Author.trim() : Author,
      content: isNonEmptyString(content) ? content.trim() : content,
      rating: parsedRating,
      isSpoiler: isSpoiler === true
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

const validateReviewUpdate = ({ content, rating, isSpoiler } = {}) => {
  const errors = [];
  const value = {};

  if (content === undefined && rating === undefined && isSpoiler === undefined) {
    errors.push('content, rating, or isSpoiler is required');
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
  if (isSpoiler !== undefined) {
    if (typeof isSpoiler !== 'boolean') errors.push('isSpoiler must be a boolean');
    else value.isSpoiler = isSpoiler;
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
const DIARY_NOTES_MAX = 2000;

// Accepts a date string / number, returns a Date only when it parses cleanly.
const parseDate = value => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Diary watch log: an append-only record of a single viewing (rewatches allowed).
// watchedAt is required, a valid date, and may not be in the future.
const validateDiaryEntry = ({ movieId, watchedAt, rating, notes, rewatch } = {}, now = Date.now()) => {
  const errors = [];
  const value = {};

  const parsedMovieId = toInteger(movieId);
  if (parsedMovieId === null || parsedMovieId < 1) errors.push('movieId must be a positive integer');
  else value.movieId = parsedMovieId;

  const parsedDate = parseDate(watchedAt);
  if (!parsedDate) errors.push('watchedAt must be a valid date');
  else if (parsedDate.getTime() > now) errors.push('watchedAt cannot be in the future');
  else value.watchedAt = parsedDate.toISOString();

  if (rating !== undefined && rating !== null && rating !== '') {
    const parsedRating = toInteger(rating);
    if (parsedRating === null || parsedRating < 1 || parsedRating > 5) {
      errors.push('rating must be an integer from 1 to 5');
    } else {
      value.rating = parsedRating;
    }
  }

  if (notes !== undefined && notes !== null && notes !== '') {
    if (typeof notes !== 'string') errors.push('notes must be a string');
    else if (notes.trim().length > DIARY_NOTES_MAX) errors.push(`notes must be at most ${DIARY_NOTES_MAX} characters`);
    else value.notes = notes.trim();
  }

  if (rewatch !== undefined) {
    if (typeof rewatch !== 'boolean') errors.push('rewatch must be a boolean');
    else value.rewatch = rewatch;
  } else {
    value.rewatch = false;
  }

  return { valid: errors.length === 0, errors, value };
};

// Editable fields on an existing diary entry. At least one must be supplied.
const validateDiaryUpdate = ({ watchedAt, rating, notes } = {}, now = Date.now()) => {
  const errors = [];
  const value = {};

  if (watchedAt === undefined && rating === undefined && notes === undefined) {
    errors.push('watchedAt, rating, or notes is required');
  }

  if (watchedAt !== undefined) {
    const parsedDate = parseDate(watchedAt);
    if (!parsedDate) errors.push('watchedAt must be a valid date');
    else if (parsedDate.getTime() > now) errors.push('watchedAt cannot be in the future');
    else value.watchedAt = parsedDate.toISOString();
  }

  if (rating !== undefined) {
    if (rating === null || rating === '') {
      value.rating = null;
    } else {
      const parsedRating = toInteger(rating);
      if (parsedRating === null || parsedRating < 1 || parsedRating > 5) {
        errors.push('rating must be an integer from 1 to 5');
      } else {
        value.rating = parsedRating;
      }
    }
  }

  if (notes !== undefined) {
    if (notes === null || notes === '') {
      value.notes = '';
    } else if (typeof notes !== 'string') {
      errors.push('notes must be a string');
    } else if (notes.trim().length > DIARY_NOTES_MAX) {
      errors.push(`notes must be at most ${DIARY_NOTES_MAX} characters`);
    } else {
      value.notes = notes.trim();
    }
  }

  return { valid: errors.length === 0, errors, value };
};

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
  DIARY_NOTES_MAX,
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
  validateReorder,
  validateDiaryEntry,
  validateDiaryUpdate
};

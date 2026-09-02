// routes/notifications.js - a recipient's notification inbox. Mounted at
// /notifications. The recipient always comes from the verified token, never from
// the request, so a caller can only ever read or mutate their own notifications.
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { AppError } = require('../errors');
const {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead
} = require('../data/notifications');

const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// GET /notifications - newest-first, cursor-paginated inbox for the caller.
// Query: ?cursor=<opaque>&limit=<n>. unreadCount always covers the whole inbox.
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { cursor, limit } = req.query;
  const { notifications, unreadCount, nextCursor } = await listNotifications(
    req.user.uid,
    { cursor, limit }
  );
  res.status(200).json({ notifications, unreadCount, nextCursor });
}));

// POST /notifications/read-all - mark every unread notification as read.
// Declared before /:id/read so the literal path is matched first.
router.post('/read-all', authenticate, asyncHandler(async (req, res) => {
  const updated = await markAllNotificationsRead(req.user.uid);
  res.status(200).json({ message: 'All notifications marked as read', updated });
}));

// POST /notifications/:id/read - mark one notification as read (owner only).
// A missing or someone else's notification is a 404 - ownership is never leaked.
router.post('/:id/read', authenticate, asyncHandler(async (req, res) => {
  const notification = await markNotificationRead(req.params.id, req.user.uid);
  if (!notification) {
    throw new AppError(404, 'not_found', 'Notification not found');
  }
  res.status(200).json(notification);
}));

module.exports = router;

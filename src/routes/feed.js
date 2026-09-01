const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { buildFeed } = require('../data/feed');

// GET /feed - authenticated, cursor-paginated activity from followed users.
// Query: ?cursor=<ISO date>&limit=<n> (newest first).
router.get('/', authenticate, async (req, res) => {
    try {
        const { cursor, limit } = req.query;
        const feed = await buildFeed(req.user.uid, { cursor, limit });
        res.status(200).json(feed);
    } catch (error) {
        console.error("Error building feed:", error);
        res.status(500).json({ error: "Failed to build feed" });
    }
});

module.exports = router;

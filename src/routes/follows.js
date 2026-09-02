const express = require('express');
const router = express.Router();
const { db, doc, getDoc } = require('../firebase');
const { authenticate } = require('../middleware/authenticate');
const { validateFollow } = require('../validation');
const {
    createFollow,
    removeFollow,
    listFolloweeIds,
    listFollowerIds,
    isFollowing
} = require('../data/follows');
const { createNotification } = require('../data/notifications');

// POST /follows - authenticated user follows another user. Idempotent.
router.post('/', authenticate, async (req, res) => {
    try {
        const validation = validateFollow(req.body);
        if (!validation.valid) {
            return res.status(400).json({ error: "Invalid follow", details: validation.errors });
        }

        // followerId always comes from the verified token, never the request body.
        const followerId = req.user.uid;
        const { followeeId } = validation.value;

        if (followeeId === followerId) {
            return res.status(400).json({ error: "You cannot follow yourself" });
        }

        const followeeSnap = await getDoc(doc(db, "Users", followeeId));
        if (!followeeSnap.exists()) {
            return res.status(404).json({ error: "User not found" });
        }

        const follow = await createFollow(followerId, followeeId);

        // Notify the followee. Guarded so a notification failure never fails the follow.
        try {
            await createNotification({ userId: followeeId, type: 'follow', actorUid: followerId });
        } catch (notifyError) {
            console.error("Failed to create follow notification:", notifyError);
        }

        res.status(201).json({ message: "Followed successfully", follow });
    } catch (error) {
        console.error("Error creating follow:", error);
        res.status(500).json({ error: "Failed to follow user" });
    }
});

// DELETE /follows/:followeeId - authenticated user unfollows another user.
router.delete('/:followeeId', authenticate, async (req, res) => {
    const { followeeId } = req.params;
    try {
        await removeFollow(req.user.uid, followeeId);
        res.status(200).json({ message: "Unfollowed successfully" });
    } catch (error) {
        console.error("Error removing follow:", error);
        res.status(500).json({ error: "Failed to unfollow user" });
    }
});

// GET /follows/following/:uid - public list + count of who :uid follows.
router.get('/following/:uid', async (req, res) => {
    try {
        const followeeIds = await listFolloweeIds(req.params.uid);
        res.status(200).json({ uid: req.params.uid, count: followeeIds.length, following: followeeIds });
    } catch (error) {
        console.error("Error listing following:", error);
        res.status(500).json({ error: "Failed to list following" });
    }
});

// GET /follows/followers/:uid - public list + count of who follows :uid.
router.get('/followers/:uid', async (req, res) => {
    try {
        const followerIds = await listFollowerIds(req.params.uid);
        res.status(200).json({ uid: req.params.uid, count: followerIds.length, followers: followerIds });
    } catch (error) {
        console.error("Error listing followers:", error);
        res.status(500).json({ error: "Failed to list followers" });
    }
});

// GET /follows/status/:uid - whether the authenticated user follows :uid.
router.get('/status/:uid', authenticate, async (req, res) => {
    try {
        const following = await isFollowing(req.user.uid, req.params.uid);
        res.status(200).json({ following });
    } catch (error) {
        console.error("Error checking follow status:", error);
        res.status(500).json({ error: "Failed to check follow status" });
    }
});

module.exports = router;

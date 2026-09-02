const express = require('express');
const router = express.Router();
const { db, doc, updateDoc, arrayUnion, arrayRemove, setDoc, getDoc } = require('../firebase'); // Use db from firebase.js
const { authenticate } = require('../middleware/authenticate');
const {
    VALID_STATUSES,
    listWatchEntries,
    mergeProfileWithWatchEntries,
    removeWatchEntry,
    upsertWatchEntry
} = require('../data/watchEntries');
const { buildExport, importData } = require('../data/importExport');

// Middleware to handle errors
const asyncHandler = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// GET /profile/export - download a single JSON document of the caller's own
// data (profile, watch entries, diary, reviews, lists). Identity from the token.
router.get('/export', authenticate, asyncHandler(async (req, res) => {
    const data = await buildExport(req.user.uid);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="vision-bucket-export.json"');
    res.status(200).send(JSON.stringify(data, null, 2));
}));

// POST /profile/import - recreate the caller's entries from an export document.
// Idempotent/dedup-safe; everything is written under the caller's uid.
router.post('/import', authenticate, asyncHandler(async (req, res) => {
    const summary = await importData(req.user.uid, req.body);
    res.status(200).json(summary);
}));

// GET http://localhost:5000/profile/data/:uid (fetches user profile data by uid)
router.get('/data/:uid', async (req, res) => {
    try {
        const uid = req.params.uid;
        console.log("Fetching user data with UID:", uid);

        const userRef = doc(db, "Users", uid);
        const docSnap = await getDoc(userRef);

        if (!docSnap.exists()) {
            return res.status(404).json({ error: "User not found" });
        }

        const watchEntries = await listWatchEntries(uid);
        res.status(200).json(mergeProfileWithWatchEntries(docSnap.data(), watchEntries));

    } catch (error) {
        console.error("Error fetching document:", error);
        res.status(500).json({ error: "Failed to fetch user data" });
    }
});

// GET http://localhost:5000/profile/watch_entries/:uid
router.get('/watch_entries/:uid', asyncHandler(async (req, res) => {
    const entries = await listWatchEntries(req.params.uid);
    res.status(200).json(entries);
}));

// PUT http://localhost:5000/profile/update/last_online
router.put('/update/last_online', authenticate, asyncHandler(async (req, res) => {
    const uid = req.user.uid;
    const { last_online } = req.body;
    if (!last_online) {
        return res.status(400).json({ error: "Last_online is required" });
    }
    const userRef = doc(db, "Users", uid);
    await updateDoc(userRef, { Last_online: new Date(last_online) });
    res.status(200).json({ message: "Last online updated successfully" });
}));

// PUT http://localhost:5000/profile/update/:status/add_movie
router.put('/update/:status/add_movie', authenticate, asyncHandler(async (req, res) => {
    const uid = req.user.uid;
    const { status } = req.params;
    const { movieId, watchedAt, rating, progress, notes } = req.body;
    if (!movieId) {
        return res.status(400).json({ error: "MovieId is required" });
    }
    if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
    }
    const entry = await upsertWatchEntry({ userId: uid, movieId, status, watchedAt, rating, progress, notes });
    res.status(200).json({ message: "Movie added successfully", entry });
}));

// PUT http://localhost:5000/profile/update/:status/remove_movie
router.put('/update/:status/remove_movie', authenticate, asyncHandler(async (req, res) => {
    const uid = req.user.uid;
    const { status } = req.params;
    const { movieId } = req.body;
    if (!movieId) {
        return res.status(400).json({ error: "MovieId is required" });
    }
    if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
    }
    await removeWatchEntry({ userId: uid, movieId, status });

    // Shrink legacy data during the compatibility window without rewriting an array.
    const userRef = doc(db, "Users", uid);
    await updateDoc(userRef, { [status]: arrayRemove(movieId) });
    res.status(200).json({ message: "Movie removed successfully" });
}))


// PUT http://localhost:5000/profile/update/add_review
router.put('/update/add_review', authenticate, asyncHandler(async (req, res) => {
    const uid = req.user.uid;
    const { reviewId } = req.body;
    if (!reviewId) {
        return res.status(400).json({ error: "ReviewId is required" });
    }
    const userRef = doc(db, "Users", uid);
    await updateDoc(userRef, { reviews: arrayUnion(reviewId) });
    res.status(200).json({ message: "Review added successfully" });
}));

// PUT http://localhost:5000/profile/update/remove_review
router.put('/update/remove_review', authenticate, asyncHandler(async (req, res) => {
    const uid = req.user.uid;
    const { reviewId } = req.body;
    if (!reviewId) {
        return res.status(400).json({ error: "ReviewId is required" });
    }
    const userRef = doc(db, "Users", uid);
    await updateDoc(userRef, { reviews: arrayRemove(reviewId) });
    res.status(200).json({ message: "Review removed successfully" });
}));

// POST http://localhost:5000/profile/create
router.post('/create', authenticate, asyncHandler(async (req, res) => {
    const uid = req.user.uid;
    const userData = { ...req.body };
    delete userData.uid;

    const initialWatchEntries = [];
    for (const status of VALID_STATUSES) {
        const movieIds = Array.isArray(userData[status]) ? userData[status] : [];
        initialWatchEntries.push(...movieIds.map(movieId => ({ userId: uid, movieId, status })));
        delete userData[status];
    }

    const uniqueMovieIds = new Set(initialWatchEntries.map(entry => String(entry.movieId)));
    if (uniqueMovieIds.size !== initialWatchEntries.length) {
        return res.status(400).json({ error: "A movie can only have one watch status" });
    }

    try {
        await setDoc(doc(db, "Users", uid), userData);
        await Promise.all(initialWatchEntries.map(upsertWatchEntry));
        console.log("Document written with ID: ", uid);
        res.status(201).json({ message: "User created successfully", uid: uid });
    } catch (e) {
        console.error("Error adding document: ", e);
        res.status(500).json({ error: "Failed to create user" });
    }
}));

module.exports = router;

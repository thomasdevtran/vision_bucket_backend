const express = require('express');
const router = express.Router();
const {
    db,
    collection,
    getDoc,
    getDocs,
    doc,
    query,
    where,
    addDoc,
    updateDoc,
    deleteDoc,
    runTransaction
} = require('../firebase');
const { auth } = require('../firebaseAdmin');
const { authenticate } = require('../middleware/authenticate');
const { AppError } = require('../errors');
const { validateReview, validateReviewUpdate } = require('../validation');
const { createNotification } = require('../data/notifications');

const REACTIONS = 'review_reactions';
const DEFAULT_REACTION_TYPE = 'helpful';
const reactionId = (reviewId, uid) => `${reviewId}_${uid}`;

// Public reads stay public, but a supplied bearer token lets us compute
// reactedByMe without ever rejecting the request. Identity always comes from
// the verified token, never from the request body.
const resolveUid = async req => {
    const authorization = req.get('authorization');
    const match = authorization && authorization.match(/^Bearer\s+(\S+)$/i);
    if (!match) return null;
    try {
        const decoded = await auth.verifyIdToken(match[1]);
        return decoded.uid;
    } catch {
        return null;
    }
};

// Strip the owner uid and expose the community fields. reactedByMe is only
// included when the caller was identified via a token.
const serializeReview = (id, data, reactedByMe) => {
    const { uid: _uid, ...review } = data;
    const count = Number(data.reactionCount);
    return {
        id,
        ...review,
        isSpoiler: data.isSpoiler === true,
        reactionCount: Number.isFinite(count) && count > 0 ? count : 0,
        ...(reactedByMe === undefined ? {} : { reactedByMe })
    };
};

// Which of these reviews the caller has reacted to (empty when anonymous).
const reactedReviewIds = async (reviewIds, uid) => {
    if (!uid || reviewIds.length === 0) return new Set();
    const snaps = await Promise.all(
        reviewIds.map(id => getDoc(doc(db, REACTIONS, reactionId(id, uid))))
    );
    const reacted = new Set();
    snaps.forEach((snap, index) => {
        if (snap.exists()) reacted.add(reviewIds[index]);
    });
    return reacted;
};

// GET /reviews/movie/:movieId - Public list of reviews for a movie
router.get('/movie/:movieId', async (req, res) => {
    const movieId = Number(req.params.movieId);
    if (!Number.isInteger(movieId)) {
        return res.status(400).json({ error: "Invalid movie id" });
    }
    try {
        const callerUid = await resolveUid(req);
        const snapshot = await getDocs(query(collection(db, "Reviews"), where("movieId", "==", movieId)));
        const reacted = await reactedReviewIds(snapshot.docs.map(reviewDoc => reviewDoc.id), callerUid);
        const reviews = snapshot.docs
            .map((reviewDoc) => serializeReview(
                reviewDoc.id,
                reviewDoc.data(),
                callerUid ? reacted.has(reviewDoc.id) : undefined
            ))
            .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        res.status(200).json(reviews);
    } catch (error) {
        console.error("Error fetching reviews:", error);
        res.status(500).json({ error: "Failed to fetch reviews" });
    }
});

// GET /reviews/:docId - Public single review
router.get('/:docId', async (req, res) => {
    const { docId } = req.params;
    try {
        const reviewSnap = await getDoc(doc(db, "Reviews", docId));
        if (!reviewSnap.exists()) {
            return res.status(404).json({ error: "Review not found" });
        }
        const callerUid = await resolveUid(req);
        const reacted = await reactedReviewIds([docId], callerUid);
        res.status(200).json(serializeReview(
            reviewSnap.id,
            reviewSnap.data(),
            callerUid ? reacted.has(docId) : undefined
        ));
    } catch (error) {
        console.error("Error fetching review:", error);
        res.status(500).json({ error: "Failed to fetch review" });
    }
});

// POST http://localhost:5000/reviews/posting
router.post('/posting', authenticate, async (req, res) => {
    try {
        const validation = validateReview(req.body);
        if (!validation.valid) {
            return res.status(400).json({ error: "Invalid review", details: validation.errors });
        }

        // Create new review object
        const newReview = {
            movieId: validation.value.movieId,
            date: new Date().toISOString(), // Store the current date
            Author: validation.value.Author,
            content: validation.value.content,
            rating: validation.value.rating,
            isSpoiler: validation.value.isSpoiler,
            reactionCount: 0,
            uid: req.user.uid
        };

        // Add the new review to the "Reviews" collection
        const docRef = await addDoc(collection(db, "Reviews"), newReview);

        const { uid: _uid, ...review } = newReview;
        res.status(201).json({ message: "Review added successfully", id: docRef.id, review });

    } catch (error) {
        console.error("Error adding review:", error);
        res.status(500).json({ error: "Failed to add review" });
    }
});

// POST /reviews/:docId/reactions - add the caller's reaction (idempotent, one per user)
router.post('/:docId/reactions', authenticate, async (req, res) => {
    const { docId } = req.params;
    const rawType = req.body && req.body.type;
    const type = typeof rawType === 'string' && rawType.trim() ? rawType.trim() : DEFAULT_REACTION_TYPE;
    try {
        const reviewRef = doc(db, "Reviews", docId);
        const reactionRef = doc(db, REACTIONS, reactionId(docId, req.user.uid));

        const result = await runTransaction(async (transaction) => {
            const reviewSnap = await transaction.get(reviewRef);
            if (!reviewSnap.exists) throw new AppError(404, 'not_found', 'Review not found');
            const reactionSnap = await transaction.get(reactionRef);

            const current = Number(reviewSnap.data().reactionCount);
            const base = Number.isFinite(current) && current > 0 ? current : 0;
            const authorUid = reviewSnap.data().uid;

            if (reactionSnap.exists) {
                // Idempotent: reacting again is a no-op for the count; keep the type fresh.
                transaction.update(reactionRef, { type });
                return { reactionCount: base, created: false, authorUid };
            }
            transaction.set(reactionRef, {
                reviewId: docId,
                uid: req.user.uid,
                type,
                createdAt: new Date().toISOString()
            });
            transaction.update(reviewRef, { reactionCount: base + 1 });
            return { reactionCount: base + 1, created: true, authorUid };
        });

        // Notify the review author on a genuinely new reaction. Guarded so a
        // notification failure never fails the reaction.
        if (result.created && result.authorUid) {
            try {
                await createNotification({
                    userId: result.authorUid,
                    type: 'reaction',
                    actorUid: req.user.uid,
                    entityType: 'review',
                    entityId: docId
                });
            } catch (notifyError) {
                console.error("Failed to create reaction notification:", notifyError);
            }
        }

        res.status(200).json({ message: "Reaction saved", reactionCount: result.reactionCount, reactedByMe: true });
    } catch (error) {
        if (error instanceof AppError) {
            return res.status(error.status).json({ error: error.message });
        }
        console.error("Error adding reaction:", error);
        res.status(500).json({ error: "Failed to add reaction" });
    }
});

// DELETE /reviews/:docId/reactions - remove the caller's reaction (idempotent)
router.delete('/:docId/reactions', authenticate, async (req, res) => {
    const { docId } = req.params;
    try {
        const reviewRef = doc(db, "Reviews", docId);
        const reactionRef = doc(db, REACTIONS, reactionId(docId, req.user.uid));

        const reactionCount = await runTransaction(async (transaction) => {
            const reviewSnap = await transaction.get(reviewRef);
            if (!reviewSnap.exists) throw new AppError(404, 'not_found', 'Review not found');
            const reactionSnap = await transaction.get(reactionRef);

            const current = Number(reviewSnap.data().reactionCount);
            const base = Number.isFinite(current) && current > 0 ? current : 0;

            if (!reactionSnap.exists) return base; // Idempotent no-op.
            transaction.delete(reactionRef);
            const next = base > 0 ? base - 1 : 0;
            transaction.update(reviewRef, { reactionCount: next });
            return next;
        });

        res.status(200).json({ message: "Reaction removed", reactionCount, reactedByMe: false });
    } catch (error) {
        if (error instanceof AppError) {
            return res.status(error.status).json({ error: error.message });
        }
        console.error("Error removing reaction:", error);
        res.status(500).json({ error: "Failed to remove reaction" });
    }
});

// DELETE /reviews/:docId - Delete a review owned by the authenticated user
router.delete('/:docId', authenticate, async (req, res) => {
    const { docId } = req.params;
    try {
        const reviewRef = doc(db, "Reviews", docId);
        const reviewSnap = await getDoc(reviewRef);

        if (!reviewSnap.exists()) {
            return res.status(404).json({ error: "Review not found" });
        }

        const reviewData = reviewSnap.data();
        if (reviewData.uid !== req.user.uid) {
            return res.status(403).json({ error: "Unauthorized: You are not allowed to delete this review" });
        }

        await deleteDoc(reviewRef);
        res.status(200).json({ message: "Review deleted successfully" });
    } catch (error) {
        console.error("Error deleting review:", error);
        res.status(500).json({ error: "Failed to delete review" });
    }
});

// PATCH /reviews/:docId - Update a review owned by the authenticated user
router.patch('/:docId', authenticate, async (req, res) => {
    const { docId } = req.params;
    try {
        const reviewRef = doc(db, "Reviews", docId);
        const reviewSnap = await getDoc(reviewRef);

        if (!reviewSnap.exists()) {
            return res.status(404).json({ error: "Review not found" });
        }

        const reviewData = reviewSnap.data();
        if (reviewData.uid !== req.user.uid) {
            return res.status(403).json({ error: "Unauthorized: You are not allowed to update this review" });
        }

        const validation = validateReviewUpdate(req.body);
        if (!validation.valid) {
            return res.status(400).json({ error: "Invalid review update", details: validation.errors });
        }

        await updateDoc(reviewRef, validation.value);
        res.status(200).json({ message: "Review updated successfully" });
    } catch (error) {
        console.error("Error updating review:", error);
        res.status(500).json({ error: "Failed to update review" });
    }
});

module.exports = router;

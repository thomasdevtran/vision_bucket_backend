const express = require('express');
const router = express.Router();
const { db, collection, getDoc, doc, addDoc, updateDoc, deleteDoc } = require('../firebase');
const { authenticate } = require('../middleware/authenticate');

// POST http://localhost:5000/reviews/posting
router.post('/posting', authenticate, async (req, res) => {
    try {
        const { movieId, Author, content, rating } = req.body;

        // Validate input
        if (!movieId || !Author || !content || !rating) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        // Create new review object
        const newReview = {
            movieId: parseInt(movieId), // Ensure movieId is an integer
            date: new Date().toISOString(), // Store the current date
            Author,
            content,
            rating: parseInt(rating), // Ensure rating is an integer
            uid: req.user.uid
        };

        // Add the new review to the "Reviews" collection
        const docRef = await addDoc(collection(db, "Reviews"), newReview);

        const { uid, ...review } = newReview;
        res.status(201).json({ message: "Review added successfully", id: docRef.id, review });

    } catch (error) {
        console.error("Error adding review:", error);
        res.status(500).json({ error: "Failed to add review" });
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
    const { content, rating } = req.body;
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

        const updateData = {};
        if (content !== undefined) updateData.content = content;
        if (rating !== undefined) updateData.rating = parseInt(rating);

        await updateDoc(reviewRef, updateData);
        res.status(200).json({ message: "Review updated successfully" });
    } catch (error) {
        console.error("Error updating review:", error);
        res.status(500).json({ error: "Failed to update review" });
    }
});

module.exports = router;

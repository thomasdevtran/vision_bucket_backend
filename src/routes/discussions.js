// routes/discussions.js
const express = require('express');
const router = express.Router();
const { db, collection, getDocs, doc, getDoc, addDoc, updateDoc, arrayRemove, deleteDoc } = require('../firebase');
const { authenticate } = require('../middleware/authenticate');
const {
  createComment,
  deleteComment,
  deleteCommentsForParent,
  findComment,
  listCommentRecords,
  mergeWithLegacyComments
} = require('../data/comments');

const PARENT_TYPE = 'discussion_post';

const serializePost = (id, data) => {
  const { uid, Comments, ...post } = data;
  return {
    id,
    ...post,
    Comments: Array.isArray(Comments)
      ? Comments.map(({ uid, ...comment }) => comment)
      : []
  };
};

// GET http://localhost:5000/discussions/posts (fetches all ID, author, date, title, description)
router.get('/posts', async (req, res) => {
    try {
        const querySnapshot = await getDocs(collection(db, "Disc_Posts"));
        const posts = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                Author: data.Author,
                Date: data.Date,
                Title: data.Title,
                Description: data.Description
            };
        });
        
        res.status(200).json(posts);
    } catch (error) {
        console.error("Error fetching documents: ", error);
        res.status(500).json({ error: "Failed to fetch posts" });
    }
});

// GET http://localhost:5000/discussions/post/KuEuWrfkqHDDMpDY1KqH <- fetches a specific post by ID
router.get('/post/:docId', async (req, res) => {
  try {
    const docId = req.params.docId;
    console.log("Fetching document with ID:", docId);
    
    const docRef = doc(db, "Disc_Posts", docId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return res.status(404).json({ error: "Document not found" });
    }

    const post = docSnap.data();
    const comments = await listCommentRecords(PARENT_TYPE, docId);
    res.status(200).json(serializePost(docSnap.id, {
      ...post,
      Comments: mergeWithLegacyComments(comments, post.Comments)
    }));
    
  } catch (error) {
    console.error("Error fetching document:", error);
    res.status(500).json({ error: "Failed to fetch document" });
  }
});

// POST http://localhost:5000/discussions/posting
// Content-Type: application/json

// {
//   "Author": "John Doe",
//   "uid": "KuEuWrfkqHDDMpDY1KqH", // optional, can be added for user tracking
//   "Date": "20250603",
//   "Comments": [
//     {
//     }
//   ],
//   "Title": "New Discussion Topic",
//   "Description": "This is a description of the new discussion topic."
// }


router.post('/posting', authenticate, async (req, res) => {
  try {
    const { Author, Date, Title, Description } = req.body;

    // Validate required fields
    if (!Author || !Date || !Title || !Description) {
      return res.status(400).json({ error: "All fields (Author, Date, Title, Description) are required" });
    }

    // Add a new document to the collection
    const newPost = {
      Author,
      uid: req.user.uid,
      Date,
      Title,
      Description
    };

    const docRef = await addDoc(collection(db, "Disc_Posts"), newPost);

    res.status(201).json({ message: "Post created successfully", id: docRef.id });
  } catch (error) {
    console.error("Error creating post:", error);
    res.status(500).json({ error: "Failed to create post" });
  }
});

// POST http://localhost:5000/discussions/post/:docId/comment
router.post('/post/:docId/comment', authenticate, async (req, res) => {
  try {
    const docId = req.params.docId;
    const { author, content, date } = req.body;
    if (!author || !content || !date) {
      return res.status(400).json({ error: "Author, content, and date are required for comments" });
    }
    const docRef = doc(db, "Disc_Posts", docId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      return res.status(404).json({ error: "Discussion post not found" });
    }
    const newComment = await createComment({
      parentType: PARENT_TYPE,
      parentId: docId,
      authorId: req.user.uid,
      author,
      content,
      date
    });
    const { uid, ...comment } = newComment;
    res.status(201).json({ 
      message: "Comment added successfully",
      comment
    });
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ error: "Failed to add comment" });
  }
});

// DELETE http://localhost:5000/discussions/post/:docId
router.delete('/post/:docId', authenticate, async (req, res) => {
    try {
        const docId = req.params.docId;

        if (!docId) {
            return res.status(400).json({ error: "Document ID is required" });
        }

        const docRef = doc(db, "Disc_Posts", docId);
        const docSnap = await getDoc(docRef);

        // Check if the document exists
        if (!docSnap.exists()) {
            return res.status(404).json({ error: "Discussion post not found" });
        }

        // Check if the user ID matches the post's user ID
        if (docSnap.data().uid !== req.user.uid) {
            return res.status(403).json({ error: "Unauthorized: You are not allowed to delete this post" });
        }

        await deleteCommentsForParent(PARENT_TYPE, docId);
        await deleteDoc(docRef);

        res.status(200).json({ message: "Discussion post deleted successfully" });

    } catch (error) {
        console.error("Error deleting document:", error);
        res.status(500).json({ error: "Failed to delete discussion post" });
    }
});

// DELETE http://localhost:5000/discussions/comment/:docId/:commentId
router.delete('/comment/:docId/:commentId', authenticate, async (req, res) => {
    try {
        const docId = req.params.docId;
        const commentId = req.params.commentId;

        if (!docId || !commentId) {
            return res.status(400).json({ error: "Document ID and Comment ID are required" });
        }

        const docRef = doc(db, "Disc_Posts", docId);
        const docSnap = await getDoc(docRef);

        // Check if the document exists
        if (!docSnap.exists()) {
            return res.status(404).json({ error: "Discussion post not found" });
        }

        const comment = await findComment(PARENT_TYPE, docId, commentId);
        if (comment) {
            if (comment.authorId !== req.user.uid) {
                return res.status(403).json({ error: "Unauthorized: You are not allowed to delete this comment" });
            }
            await deleteComment(comment);
        } else {
            // Compatibility path until every legacy array has been migrated.
            const legacyComment = (docSnap.data().Comments || []).find(item => item.commentId === commentId);
            if (!legacyComment) {
                return res.status(404).json({ error: "Comment not found" });
            }
            if (legacyComment.uid !== req.user.uid) {
                return res.status(403).json({ error: "Unauthorized: You are not allowed to delete this comment" });
            }
            await updateDoc(docRef, { Comments: arrayRemove(legacyComment) });
        }

        res.status(200).json({ message: "Comment deleted successfully" });

    } catch (error) {
        console.error("Error deleting comment:", error);
        res.status(500).json({ error: "Failed to delete comment" });
    }
});

// delete a post by ID (auth)

module.exports = router;

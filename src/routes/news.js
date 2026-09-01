const express = require('express');
const router = express.Router();
const { db, collection, getDocs, doc, getDoc, addDoc } = require('../firebase');
const { authenticate, requireRole } = require('../middleware/authenticate');
const { createComment, listCommentRecords, mergeWithLegacyComments } = require('../data/comments');

const PARENT_TYPE = 'news_post';

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

// GET http://localhost:5000/news/posts (fetches all ID, author, date, title, description)
router.get('/posts', async (req, res) => {
    try {
        const querySnapshot = await getDocs(collection(db, "News_Posts"));
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

// GET http://localhost:5000/news/post/:docId
router.get('/post/:docId', async (req, res) => {
  try {
    const docId = req.params.docId;
    console.log("Fetching document with ID:", docId);
    
    const docRef = doc(db, "News_Posts", docId);
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

// POST http://localhost:5000/news/posting
// Content-Type: application/json
// 
// {
//   "Author": "John Doe",
//   "Date": "20250603",
//   "Comments": [
//     {
//     }
//   ],
//   "Title": "New Discussion Topic",
//   "Description": "This is a description of the new discussion topic."
// }
router.post('/posting', authenticate, requireRole('admin', 'editor'), async (req, res) => {
  try {
    const { Author, Date, Title, Description } = req.body;

    if (!Author || !Date || !Title || !Description) {
      return res.status(400).json({ error: "All fields (Author, Date, Title, Description) are required" });
    }

    const newPost = {
      Author,
      uid: req.user.uid,
      Date,
      Title,
      Description
    };

    const docRef = await addDoc(collection(db, "News_Posts"), newPost);

    res.status(201).json({ message: "Post created successfully", id: docRef.id });
  } catch (error) {
    console.error("Error creating post:", error);
    res.status(500).json({ error: "Failed to create post" });
  }
});

// POST http://localhost:5000/news/post/:docId/comment
router.post('/post/:docId/comment', authenticate, async (req, res) => {
  try {
    const docId = req.params.docId;
    const { author, content, date } = req.body;
    if (!author || !content || !date) {
      return res.status(400).json({ error: "Author, content, and date are required for comments" });
    }
    const docRef = doc(db, "News_Posts", docId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      return res.status(404).json({ error: "News post not found" });
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

module.exports = router;

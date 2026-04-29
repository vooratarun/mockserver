const express = require('express');

/**
 * Auth middleware: verifies Bearer JWT and attaches decoded user to req.user.
 * Rejects if token is revoked.
 */
function makeAuthMiddleware({ jwt, JWT_SECRET, revokedTokens }) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header with Bearer token is required.' });
    }

    const token = authHeader.slice(7);

    if (revokedTokens.has(token)) {
      return res.status(401).json({ error: 'Token has been revoked. Please log in again.' });
    }

    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Token is invalid or expired.' });
    }

    return next();
  };
}

function createCommentsRouter({ db, jwt, JWT_SECRET, revokedTokens }) {
  const router = express.Router();
  const authenticate = makeAuthMiddleware({ jwt, JWT_SECRET, revokedTokens });

  function parseId(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  /**
   * GET /videos/:videoId/comments
   * Get all comments for a video (no auth required)
   */
  router.get('/videos/:videoId/comments', async (req, res) => {
    const videoId = parseId(req.params.videoId);

    if (videoId === null) {
      return res.status(400).json({ error: 'Invalid video ID. ID must be a number.' });
    }

    await db.read();

    const video = (db.data.videos ?? []).find((v) => v.id === videoId);
    if (!video) {
      return res.status(404).json({ error: `Video with ID ${videoId} not found.` });
    }

    const comments = (db.data.comments ?? []).filter((c) => c.videoId === videoId);
    return res.json(comments);
  });

  /**
   * GET /comments/:commentId
   * Get a single comment (no auth required)
   */
  router.get('/comments/:commentId', async (req, res) => {
    const commentId = parseId(req.params.commentId);

    if (commentId === null) {
      return res.status(400).json({ error: 'Invalid comment ID. ID must be a number.' });
    }

    await db.read();
    const comment = (db.data.comments ?? []).find((c) => c.id === commentId);

    if (!comment) {
      return res.status(404).json({ error: `Comment with ID ${commentId} not found.` });
    }

    return res.json(comment);
  });

  /**
   * POST /videos/:videoId/comments
   * Create a comment on a video (auth required)
   */
  router.post('/videos/:videoId/comments', authenticate, async (req, res) => {
    const videoId = parseId(req.params.videoId);

    if (videoId === null) {
      return res.status(400).json({ error: 'Invalid video ID. ID must be a number.' });
    }

    const { text } = req.body ?? {};

    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required and must be a non-empty string.' });
    }

    await db.read();

    const video = (db.data.videos ?? []).find((v) => v.id === videoId);
    if (!video) {
      return res.status(404).json({ error: `Video with ID ${videoId} not found.` });
    }

    const user = (db.data.users ?? []).find((u) => u.id === req.user.sub);
    if (!user) {
      return res.status(401).json({ error: 'User not found.' });
    }

    const comments = db.data.comments ?? [];
    const nextId = comments.length > 0
      ? Math.max(...comments.map((c) => c.id || 0)) + 1
      : 1;

    const newComment = {
      id: nextId,
      videoId,
      userId: req.user.sub,
      username: user.username,
      text: text.trim(),
      createdAt: new Date().toISOString(),
    };

    comments.push(newComment);
    db.data.comments = comments;
    await db.write();

    return res.status(201).json(newComment);
  });

  /**
   * PUT /comments/:commentId
   * Update a comment (auth required, user must be comment owner)
   */
  router.put('/comments/:commentId', authenticate, async (req, res) => {
    const commentId = parseId(req.params.commentId);

    if (commentId === null) {
      return res.status(400).json({ error: 'Invalid comment ID. ID must be a number.' });
    }

    const { text } = req.body ?? {};

    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required and must be a non-empty string.' });
    }

    await db.read();

    const comments = db.data.comments ?? [];
    const commentIndex = comments.findIndex((c) => c.id === commentId);

    if (commentIndex === -1) {
      return res.status(404).json({ error: `Comment with ID ${commentId} not found.` });
    }

    const comment = comments[commentIndex];

    if (comment.userId !== req.user.sub) {
      return res.status(403).json({ error: 'You can only edit your own comments.' });
    }

    comments[commentIndex] = {
      ...comment,
      text: text.trim(),
      updatedAt: new Date().toISOString(),
    };

    db.data.comments = comments;
    await db.write();

    return res.json(comments[commentIndex]);
  });

  /**
   * DELETE /comments/:commentId
   * Delete a comment (auth required, user must be comment owner)
   */
  router.delete('/comments/:commentId', authenticate, async (req, res) => {
    const commentId = parseId(req.params.commentId);

    if (commentId === null) {
      return res.status(400).json({ error: 'Invalid comment ID. ID must be a number.' });
    }

    await db.read();

    const comments = db.data.comments ?? [];
    const commentIndex = comments.findIndex((c) => c.id === commentId);

    if (commentIndex === -1) {
      return res.status(404).json({ error: `Comment with ID ${commentId} not found.` });
    }

    const comment = comments[commentIndex];

    if (comment.userId !== req.user.sub) {
      return res.status(403).json({ error: 'You can only delete your own comments.' });
    }

    const [deletedComment] = comments.splice(commentIndex, 1);
    db.data.comments = comments;
    await db.write();

    return res.json({ message: 'Comment deleted successfully.', comment: deletedComment });
  });

  return router;
}

module.exports = { createCommentsRouter };


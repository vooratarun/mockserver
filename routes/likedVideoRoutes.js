const express = require('express');

/**
 * Creates an auth middleware that verifies the Bearer JWT and attaches
 * the decoded payload to req.user.  Rejects revoked tokens.
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

function createLikedVideoRouter({ db, jwt, JWT_SECRET, revokedTokens }) {
  const router = express.Router();
  const authenticate = makeAuthMiddleware({ jwt, JWT_SECRET, revokedTokens });

  /**
   * Resolve and validate :userId param; also enforce ownership so a user
   * cannot access another user's liked-videos list.
   */
  function resolveUser(req, res) {
    const userId = Number.parseInt(req.params.userId, 10);

    if (Number.isNaN(userId)) {
      res.status(400).json({ error: 'Invalid user ID. ID must be a number.' });
      return null;
    }

    // Only allow a user to touch their own liked-videos list
    if (req.user.sub !== userId) {
      res.status(403).json({ error: 'You are not allowed to access another user\'s liked videos.' });
      return null;
    }

    return userId;
  }

  // GET /users/:userId/liked-videos
  // Returns liked video objects (full video details) for the user.
  router.get('/users/:userId/liked-videos', authenticate, async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === null) return;

    await db.read();

    const likedEntries = (db.data.likedVideos ?? []).filter((lv) => lv.userId === userId);
    const likedVideoIds = new Set(likedEntries.map((lv) => lv.videoId));
    const videos = (db.data.videos ?? []).filter((v) => likedVideoIds.has(v.id));

    return res.json(videos);
  });

  // GET /users/:userId/liked-videos/:videoId
  // Returns { liked: true/false } indicating whether the video is liked by the user.
  router.get('/users/:userId/liked-videos/:videoId', authenticate, async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === null) return;

    const videoId = Number.parseInt(req.params.videoId, 10);
    if (Number.isNaN(videoId)) {
      return res.status(400).json({ error: 'Invalid video ID. ID must be a number.' });
    }

    await db.read();

    const liked = (db.data.likedVideos ?? []).some(
      (lv) => lv.userId === userId && lv.videoId === videoId,
    );

    return res.json({ liked });
  });

  // POST /users/:userId/liked-videos/:videoId
  // Likes a video for the user. Idempotent — re-liking is a no-op.
  router.post('/users/:userId/liked-videos/:videoId', authenticate, async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === null) return;

    const videoId = Number.parseInt(req.params.videoId, 10);
    if (Number.isNaN(videoId)) {
      return res.status(400).json({ error: 'Invalid video ID. ID must be a number.' });
    }

    await db.read();

    // Verify the video exists
    const video = (db.data.videos ?? []).find((v) => v.id === videoId);
    if (!video) {
      return res.status(404).json({ error: `Video with ID ${videoId} not found.` });
    }

    // Idempotency – already liked
    const alreadyLiked = (db.data.likedVideos ?? []).some(
      (lv) => lv.userId === userId && lv.videoId === videoId,
    );

    if (alreadyLiked) {
      return res.status(200).json({ message: 'Video already liked.', video });
    }

    if (!db.data.likedVideos) db.data.likedVideos = [];

    const nextId =
      db.data.likedVideos.length > 0
        ? Math.max(...db.data.likedVideos.map((lv) => lv.id || 0)) + 1
        : 1;

    db.data.likedVideos.push({ id: nextId, userId, videoId });
    await db.write();

    return res.status(201).json({ message: 'Video liked successfully.', video });
  });

  // DELETE /users/:userId/liked-videos/:videoId
  // Unlikes a video for the user.
  router.delete('/users/:userId/liked-videos/:videoId', authenticate, async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === null) return;

    const videoId = Number.parseInt(req.params.videoId, 10);
    if (Number.isNaN(videoId)) {
      return res.status(400).json({ error: 'Invalid video ID. ID must be a number.' });
    }

    await db.read();

    const index = (db.data.likedVideos ?? []).findIndex(
      (lv) => lv.userId === userId && lv.videoId === videoId,
    );

    if (index === -1) {
      return res.status(404).json({ error: 'Liked video entry not found.' });
    }

    db.data.likedVideos.splice(index, 1);
    await db.write();

    return res.json({ message: 'Video unliked successfully.' });
  });

  return router;
}

module.exports = { createLikedVideoRouter };


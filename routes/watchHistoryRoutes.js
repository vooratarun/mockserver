const express = require('express');

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

function createWatchHistoryRouter({ db, jwt, JWT_SECRET, revokedTokens }) {
  const router = express.Router();
  const authenticate = makeAuthMiddleware({ jwt, JWT_SECRET, revokedTokens });

  function resolveUser(req, res) {
    const userId = Number.parseInt(req.params.userId, 10);

    if (Number.isNaN(userId)) {
      res.status(400).json({ error: 'Invalid user ID. ID must be a number.' });
      return null;
    }

    if (req.user.sub !== userId) {
      res.status(403).json({ error: 'You are not allowed to access another user\'s watch history.' });
      return null;
    }

    return userId;
  }

  function parseVideoId(req, res) {
    const videoId = Number.parseInt(req.params.videoId, 10);

    if (Number.isNaN(videoId)) {
      res.status(400).json({ error: 'Invalid video ID. ID must be a number.' });
      return null;
    }

    return videoId;
  }

  // GET /users/:userId/watch-history
  // Returns watch history entries with full video details, newest first.
  router.get('/users/:userId/watch-history', authenticate, async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === null) return;

    await db.read();

    const entries = (db.data.watchHistory ?? [])
      .filter((entry) => entry.userId === userId)
      .sort((a, b) => new Date(b.watchedAt).getTime() - new Date(a.watchedAt).getTime());

    const videosById = new Map((db.data.videos ?? []).map((video) => [video.id, video]));

    const data = entries
      .map((entry) => ({
        id: entry.id,
        userId: entry.userId,
        videoId: entry.videoId,
        watchedAt: entry.watchedAt,
        video: videosById.get(entry.videoId) ?? null,
      }))
      .filter((entry) => entry.video !== null);

    return res.json(data);
  });

  // POST /users/:userId/watch-history/:videoId
  // Stores (or refreshes) watch history for a video.
  router.post('/users/:userId/watch-history/:videoId', authenticate, async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === null) return;

    const videoId = parseVideoId(req, res);
    if (videoId === null) return;

    await db.read();

    const video = (db.data.videos ?? []).find((item) => item.id === videoId);
    if (!video) {
      return res.status(404).json({ error: `Video with ID ${videoId} not found.` });
    }

    if (!db.data.watchHistory) db.data.watchHistory = [];

    const existingIndex = db.data.watchHistory.findIndex(
      (entry) => entry.userId === userId && entry.videoId === videoId,
    );

    const watchedAt = new Date().toISOString();

    if (existingIndex !== -1) {
      db.data.watchHistory[existingIndex].watchedAt = watchedAt;
      await db.write();

      return res.json({
        message: 'Watch history updated.',
        entry: db.data.watchHistory[existingIndex],
        video,
      });
    }

    const nextId = db.data.watchHistory.length > 0
      ? Math.max(...db.data.watchHistory.map((entry) => entry.id || 0)) + 1
      : 1;

    const entry = {
      id: nextId,
      userId,
      videoId,
      watchedAt,
    };

    db.data.watchHistory.push(entry);
    await db.write();

    return res.status(201).json({ message: 'Watch history saved.', entry, video });
  });

  // DELETE /users/:userId/watch-history/:videoId
  // Removes a specific video from user's watch history.
  router.delete('/users/:userId/watch-history/:videoId', authenticate, async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === null) return;

    const videoId = parseVideoId(req, res);
    if (videoId === null) return;

    await db.read();

    const index = (db.data.watchHistory ?? []).findIndex(
      (entry) => entry.userId === userId && entry.videoId === videoId,
    );

    if (index === -1) {
      return res.status(404).json({ error: 'Watch history entry not found.' });
    }

    const [deleted] = db.data.watchHistory.splice(index, 1);
    await db.write();

    return res.json({ message: 'Watch history entry removed.', entry: deleted });
  });

  return router;
}

module.exports = { createWatchHistoryRouter };


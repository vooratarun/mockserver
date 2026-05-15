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

function createPlaylistRouter({ db, jwt, JWT_SECRET, revokedTokens }) {
  const router = express.Router();
  const authenticate = makeAuthMiddleware({ jwt, JWT_SECRET, revokedTokens });

  function resolveUser(req, res) {
    const userId = Number.parseInt(req.params.userId, 10);

    if (Number.isNaN(userId)) {
      res.status(400).json({ error: 'Invalid user ID. ID must be a number.' });
      return null;
    }

    // User can manage their own playlists. Admin can manage any user's playlists.
    if (req.user.sub !== userId && req.user.role !== 'admin') {
      res.status(403).json({ error: 'You are not allowed to access this user\'s playlists.' });
      return null;
    }

    return userId;
  }

  function resolvePlaylistId(req, res) {
    const playlistId = Number.parseInt(req.params.playlistId, 10);

    if (Number.isNaN(playlistId)) {
      res.status(400).json({ error: 'Invalid playlist ID. ID must be a number.' });
      return null;
    }

    return playlistId;
  }

  router.get('/users/:userId/playlists', authenticate, async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === null) return;

    await db.read();
    const playlists = (db.data.playlists ?? []).filter((p) => p.userId === userId);
    return res.json(playlists);
  });

  router.post('/users/:userId/playlists', authenticate, async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === null) return;

    const { name, description } = req.body ?? {};

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required and must be a non-empty string.' });
    }

    if (description !== undefined && typeof description !== 'string') {
      return res.status(400).json({ error: 'description must be a string when provided.' });
    }

    await db.read();

    if (!db.data.playlists) db.data.playlists = [];

    const nextId = db.data.playlists.length > 0
      ? Math.max(...db.data.playlists.map((p) => p.id || 0)) + 1
      : 1;

    const timestamp = new Date().toISOString();
    const playlist = {
      id: nextId,
      userId,
      name: name.trim(),
      description: typeof description === 'string' ? description.trim() : '',
      videoIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    db.data.playlists.push(playlist);
    await db.write();

    return res.status(201).json(playlist);
  });

  router.get('/users/:userId/playlists/:playlistId', authenticate, async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === null) return;

    const playlistId = resolvePlaylistId(req, res);
    if (playlistId === null) return;

    await db.read();

    const playlist = (db.data.playlists ?? []).find(
      (p) => p.id === playlistId && p.userId === userId,
    );

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found.' });
    }

    return res.json(playlist);
  });

  router.delete('/users/:userId/playlists/:playlistId', authenticate, async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === null) return;

    const playlistId = resolvePlaylistId(req, res);
    if (playlistId === null) return;

    await db.read();

    const playlists = db.data.playlists ?? [];
    const playlistIndex = playlists.findIndex(
      (p) => p.id === playlistId && p.userId === userId,
    );

    if (playlistIndex === -1) {
      return res.status(404).json({ error: 'Playlist not found.' });
    }

    const [deletedPlaylist] = playlists.splice(playlistIndex, 1);
    db.data.playlists = playlists;
    await db.write();

    return res.json({ message: 'Playlist deleted successfully.', playlist: deletedPlaylist });
  });

  router.get('/users/:userId/playlists/:playlistId/videos', authenticate, async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === null) return;

    const playlistId = resolvePlaylistId(req, res);
    if (playlistId === null) return;

    await db.read();

    const playlist = (db.data.playlists ?? []).find(
      (p) => p.id === playlistId && p.userId === userId,
    );

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found.' });
    }

    const videoIdSet = new Set(playlist.videoIds ?? []);
    const videos = (db.data.videos ?? []).filter((v) => videoIdSet.has(v.id));

    return res.json({ playlist, videos });
  });

  router.post('/users/:userId/playlists/:playlistId/videos/:videoId', authenticate, async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === null) return;

    const playlistId = resolvePlaylistId(req, res);
    if (playlistId === null) return;

    const videoId = Number.parseInt(req.params.videoId, 10);
    if (Number.isNaN(videoId)) {
      return res.status(400).json({ error: 'Invalid video ID. ID must be a number.' });
    }

    await db.read();

    const playlistIndex = (db.data.playlists ?? []).findIndex(
      (p) => p.id === playlistId && p.userId === userId,
    );

    if (playlistIndex === -1) {
      return res.status(404).json({ error: 'Playlist not found.' });
    }

    const video = (db.data.videos ?? []).find((v) => v.id === videoId);
    if (!video) {
      return res.status(404).json({ error: `Video with ID ${videoId} not found.` });
    }

    const playlist = db.data.playlists[playlistIndex];
    if (!Array.isArray(playlist.videoIds)) playlist.videoIds = [];

    if (playlist.videoIds.includes(videoId)) {
      return res.status(200).json({ message: 'Video already in playlist.', playlist });
    }

    playlist.videoIds.push(videoId);
    playlist.updatedAt = new Date().toISOString();
    db.data.playlists[playlistIndex] = playlist;
    await db.write();

    return res.status(201).json({ message: 'Video added to playlist.', playlist, video });
  });

  router.delete('/users/:userId/playlists/:playlistId/videos/:videoId', authenticate, async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === null) return;

    const playlistId = resolvePlaylistId(req, res);
    if (playlistId === null) return;

    const videoId = Number.parseInt(req.params.videoId, 10);
    if (Number.isNaN(videoId)) {
      return res.status(400).json({ error: 'Invalid video ID. ID must be a number.' });
    }

    await db.read();

    const playlistIndex = (db.data.playlists ?? []).findIndex(
      (p) => p.id === playlistId && p.userId === userId,
    );

    if (playlistIndex === -1) {
      return res.status(404).json({ error: 'Playlist not found.' });
    }

    const playlist = db.data.playlists[playlistIndex];
    const videoIndex = (playlist.videoIds ?? []).indexOf(videoId);

    if (videoIndex === -1) {
      return res.status(404).json({ error: 'Video is not in this playlist.' });
    }

    playlist.videoIds.splice(videoIndex, 1);
    playlist.updatedAt = new Date().toISOString();
    db.data.playlists[playlistIndex] = playlist;
    await db.write();

    return res.json({ message: 'Video removed from playlist.', playlist });
  });

  return router;
}

module.exports = { createPlaylistRouter };


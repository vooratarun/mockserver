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

function createChannelSubscriptionRouter({ db, jwt, JWT_SECRET, revokedTokens }) {
  const router = express.Router();
  const authenticate = makeAuthMiddleware({ jwt, JWT_SECRET, revokedTokens });

  function resolveUser(req, res) {
    const userId = Number.parseInt(req.params.userId, 10);

    if (Number.isNaN(userId)) {
      res.status(400).json({ error: 'Invalid user ID. ID must be a number.' });
      return null;
    }

    if (req.user.sub !== userId) {
      res.status(403).json({ error: 'You are not allowed to access another user\'s subscriptions.' });
      return null;
    }

    return userId;
  }

  function parseChannelName(req, res) {
    const channelName = typeof req.params.channelName === 'string'
      ? req.params.channelName.trim()
      : '';

    if (!channelName) {
      res.status(400).json({ error: 'channelName is required in path.' });
      return null;
    }

    return channelName;
  }

  function normalizeChannelName(channelName) {
    return channelName.trim().toLowerCase();
  }

  function matchesChannel(entry, normalizedChannelName) {
    return normalizeChannelName(entry.channelName || '') === normalizedChannelName
      || entry.normalizedChannelName === normalizedChannelName;
  }

  // GET /users/:userId/subscribed-channels
  router.get('/users/:userId/subscribed-channels', authenticate, async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === null) return;

    await db.read();

    const subscriptions = (db.data.channelSubscriptions ?? [])
      .filter((entry) => entry.userId === userId)
      .sort((a, b) => new Date(b.subscribedAt).getTime() - new Date(a.subscribedAt).getTime())
      .map((entry) => ({
        id: entry.id,
        userId: entry.userId,
        channelName: entry.channelName,
        subscribedAt: entry.subscribedAt,
      }));

    return res.json(subscriptions);
  });

  // GET /users/:userId/subscribed-channels/:channelName
  router.get('/users/:userId/subscribed-channels/:channelName', authenticate, async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === null) return;

    const channelName = parseChannelName(req, res);
    if (channelName === null) return;

    await db.read();

    const normalizedChannelName = normalizeChannelName(channelName);
    const subscribed = (db.data.channelSubscriptions ?? []).some(
      (entry) => entry.userId === userId && matchesChannel(entry, normalizedChannelName),
    );

    return res.json({ userId, channelName, subscribed });
  });

  // GET /users/:userId/subscribed-channels/:channelName/videos
  router.get('/users/:userId/subscribed-channels/:channelName/videos', authenticate, async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === null) return;

    const channelName = parseChannelName(req, res);
    if (channelName === null) return;

    await db.read();

    const normalizedChannelName = normalizeChannelName(channelName);
    const channelVideos = (db.data.videos ?? []).filter(
      (video) => normalizeChannelName(video.channelName || '') === normalizedChannelName,
    );

    if (channelVideos.length === 0) {
      return res.status(404).json({ error: `Channel "${channelName}" not found.` });
    }

    const subscription = (db.data.channelSubscriptions ?? []).find(
      (entry) => entry.userId === userId && matchesChannel(entry, normalizedChannelName),
    );

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found for this channel.' });
    }

    return res.json({
      userId,
      channelName: subscription.channelName,
      total: channelVideos.length,
      videos: channelVideos,
    });
  });

  // POST /users/:userId/subscribed-channels/:channelName
  router.post('/users/:userId/subscribed-channels/:channelName', authenticate, async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === null) return;

    const channelName = parseChannelName(req, res);
    if (channelName === null) return;

    await db.read();

    const normalizedChannelName = normalizeChannelName(channelName);
    const channelVideo = (db.data.videos ?? []).find(
      (video) => normalizeChannelName(video.channelName || '') === normalizedChannelName,
    );

    if (!channelVideo) {
      return res.status(404).json({ error: `Channel "${channelName}" not found.` });
    }

    if (!db.data.channelSubscriptions) db.data.channelSubscriptions = [];

    const existingEntry = db.data.channelSubscriptions.find(
      (entry) => entry.userId === userId && matchesChannel(entry, normalizedChannelName),
    );

    if (existingEntry) {
      return res.status(200).json({
        message: 'Already subscribed to channel.',
        subscription: {
          id: existingEntry.id,
          userId: existingEntry.userId,
          channelName: existingEntry.channelName,
          subscribedAt: existingEntry.subscribedAt,
        },
      });
    }

    const nextId = db.data.channelSubscriptions.length > 0
      ? Math.max(...db.data.channelSubscriptions.map((entry) => entry.id || 0)) + 1
      : 1;

    const entry = {
      id: nextId,
      userId,
      channelName: channelVideo.channelName,
      normalizedChannelName,
      subscribedAt: new Date().toISOString(),
    };

    db.data.channelSubscriptions.push(entry);
    await db.write();

    return res.status(201).json({
      message: 'Channel subscribed successfully.',
      subscription: {
        id: entry.id,
        userId: entry.userId,
        channelName: entry.channelName,
        subscribedAt: entry.subscribedAt,
      },
    });
  });

  // DELETE /users/:userId/subscribed-channels/:channelName
  router.delete('/users/:userId/subscribed-channels/:channelName', authenticate, async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === null) return;

    const channelName = parseChannelName(req, res);
    if (channelName === null) return;

    await db.read();

    const normalizedChannelName = normalizeChannelName(channelName);
    const index = (db.data.channelSubscriptions ?? []).findIndex(
      (entry) => entry.userId === userId && matchesChannel(entry, normalizedChannelName),
    );

    if (index === -1) {
      return res.status(404).json({ error: 'Subscription not found.' });
    }

    const [removed] = db.data.channelSubscriptions.splice(index, 1);
    await db.write();

    return res.json({
      message: 'Channel unsubscribed successfully.',
      subscription: {
        id: removed.id,
        userId: removed.userId,
        channelName: removed.channelName,
        subscribedAt: removed.subscribedAt,
      },
    });
  });

  return router;
}

module.exports = { createChannelSubscriptionRouter };


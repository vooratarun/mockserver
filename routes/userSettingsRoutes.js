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

function createUserSettingsRouter({ db, jwt, JWT_SECRET, revokedTokens }) {
  const router = express.Router();
  const authenticate = makeAuthMiddleware({ jwt, JWT_SECRET, revokedTokens });

  function parseUserId(req, res) {
    const userId = Number.parseInt(req.params.userId, 10);

    if (Number.isNaN(userId)) {
      res.status(400).json({ error: 'Invalid user ID. ID must be a number.' });
      return null;
    }

    // User can access own settings, admin can access any user's settings.
    if (req.user.sub !== userId && req.user.role !== 'admin') {
      res.status(403).json({ error: 'You are not allowed to access this user\'s settings.' });
      return null;
    }

    return userId;
  }

  function defaultSettings(userId, now) {
    return {
      userId,
      theme: 'system',
      language: 'en',
      autoplay: true,
      emailNotifications: true,
      pushNotifications: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  function validateSettingsPatch(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { error: 'Request body must be a JSON object.' };
    }

    const allowedFields = new Set([
      'theme',
      'language',
      'autoplay',
      'emailNotifications',
      'pushNotifications',
    ]);

    const keys = Object.keys(payload);

    if (keys.length === 0) {
      return { error: 'At least one settings field is required.' };
    }

    const invalidFields = keys.filter((key) => !allowedFields.has(key));

    if (invalidFields.length > 0) {
      return {
        error: 'Unsupported settings fields provided.',
        invalidFields,
      };
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'theme')) {
      const theme = String(payload.theme || '').trim().toLowerCase();

      if (!['light', 'dark', 'system'].includes(theme)) {
        return { error: 'theme must be one of: light, dark, system.' };
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'language')) {
      if (typeof payload.language !== 'string' || !payload.language.trim()) {
        return { error: 'language must be a non-empty string.' };
      }
    }

    for (const flag of ['autoplay', 'emailNotifications', 'pushNotifications']) {
      if (Object.prototype.hasOwnProperty.call(payload, flag) && typeof payload[flag] !== 'boolean') {
        return { error: `${flag} must be a boolean.` };
      }
    }

    const sanitized = {};

    if (Object.prototype.hasOwnProperty.call(payload, 'theme')) {
      sanitized.theme = payload.theme.trim().toLowerCase();
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'language')) {
      sanitized.language = payload.language.trim();
    }

    for (const flag of ['autoplay', 'emailNotifications', 'pushNotifications']) {
      if (Object.prototype.hasOwnProperty.call(payload, flag)) {
        sanitized[flag] = payload[flag];
      }
    }

    return { patch: sanitized };
  }

  function ensureUserSettings(userId) {
    if (!db.data.userSettings) {
      db.data.userSettings = [];
    }

    const settingsIndex = db.data.userSettings.findIndex((settings) => settings.userId === userId);

    if (settingsIndex !== -1) {
      return { settingsIndex, created: false };
    }

    const now = new Date().toISOString();
    const settings = defaultSettings(userId, now);

    db.data.userSettings.push(settings);

    return { settingsIndex: db.data.userSettings.length - 1, created: true };
  }

  // GET /users/:userId/settings
  // Returns settings for the user. Creates defaults on first access.
  router.get('/users/:userId/settings', authenticate, async (req, res) => {
    const userId = parseUserId(req, res);
    if (userId === null) return;

    await db.read();

    const user = (db.data.users ?? []).find((item) => item.id === userId);

    if (!user) {
      return res.status(404).json({ error: `User with ID ${userId} not found.` });
    }

    const { settingsIndex, created } = ensureUserSettings(userId);

    if (created) {
      await db.write();
    }

    return res.json(db.data.userSettings[settingsIndex]);
  });

  // PUT /users/:userId/settings
  // Partial update of user settings.
  router.put('/users/:userId/settings', authenticate, async (req, res) => {
    const userId = parseUserId(req, res);
    if (userId === null) return;

    const validation = validateSettingsPatch(req.body ?? {});

    if (validation.error) {
      return res.status(400).json({
        error: validation.error,
        ...(validation.invalidFields ? { invalidFields: validation.invalidFields } : {}),
      });
    }

    await db.read();

    const user = (db.data.users ?? []).find((item) => item.id === userId);

    if (!user) {
      return res.status(404).json({ error: `User with ID ${userId} not found.` });
    }

    const { settingsIndex } = ensureUserSettings(userId);

    db.data.userSettings[settingsIndex] = {
      ...db.data.userSettings[settingsIndex],
      ...validation.patch,
      updatedAt: new Date().toISOString(),
    };

    await db.write();

    return res.json({
      message: 'User settings updated successfully.',
      settings: db.data.userSettings[settingsIndex],
    });
  });

  return router;
}

module.exports = { createUserSettingsRouter };


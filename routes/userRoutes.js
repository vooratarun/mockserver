const express = require('express');

function createUserRouter({ db, jwt, JWT_SECRET, JWT_EXPIRES_IN, revokedTokens }) {
  const router = express.Router();
  const allowedRoles = new Set(['user', 'admin']);

  function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Authorization header with Bearer token is required.',
      });
    }

    const token = authHeader.slice(7);

    if (revokedTokens.has(token)) {
      return res.status(401).json({
        error: 'Token has been revoked. Please log in again.',
      });
    }

    try {
      req.user = jwt.verify(token, JWT_SECRET);
      req.authToken = token;
    } catch {
      return res.status(401).json({
        error: 'Token is invalid or expired.',
      });
    }

    return next();
  }

  router.post('/register', async (req, res) => {
    const { username, password, name, role } = req.body ?? {};

    if (!username || !password || !name) {
      return res.status(400).json({
        error: 'username, password and name are required.',
      });
    }

    if (
      typeof username !== 'string'
      || typeof password !== 'string'
      || typeof name !== 'string'
    ) {
      return res.status(400).json({
        error: 'username, password and name must be strings.',
      });
    }

    if (role !== undefined && typeof role !== 'string') {
      return res.status(400).json({
        error: 'role must be a string with value "user" or "admin".',
      });
    }

    const normalizedUsername = username.trim();
    const normalizedPassword = password.trim();
    const normalizedName = name.trim();
    const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : 'user';

    if (!normalizedUsername || !normalizedPassword || !normalizedName) {
      return res.status(400).json({
        error: 'username, password and name cannot be empty.',
      });
    }

    if (!allowedRoles.has(normalizedRole)) {
      return res.status(400).json({
        error: 'role must be either "user" or "admin".',
      });
    }

    await db.read();

    const usernameExists = (db.data.users ?? []).some(
      (u) => u.username.toLowerCase() === normalizedUsername.toLowerCase(),
    );

    if (usernameExists) {
      return res.status(409).json({
        error: 'Username already exists.',
      });
    }

    const users = db.data.users ?? [];
    const nextId = users.length > 0
      ? Math.max(...users.map((u) => u.id || 0)) + 1
      : 1;

    const newUser = {
      id: nextId,
      username: normalizedUsername,
      password: normalizedPassword,
      name: normalizedName,
      role: normalizedRole,
    };

    users.push(newUser);
    db.data.users = users;
    await db.write();

    return res.status(201).json({
      message: 'Registration successful.',
      user: {
        id: newUser.id,
        username: newUser.username,
        name: newUser.name,
        role: newUser.role,
      },
    });
  });

  router.post('/login', async (req, res) => {
    const { username, password } = req.body ?? {};

    if (!username || !password) {
      return res.status(400).json({
        error: 'username and password are required.',
      });
    }

    await db.read();
    const user = (db.data.users ?? []).find(
      (u) => u.username === username && u.password === password,
    );

    if (!user) {
      return res.status(401).json({
        error: 'Invalid username or password.',
      });
    }

    const safeRole = user.role === 'admin' ? 'admin' : 'user';
    const payload = { sub: user.id, username: user.username, name: user.name, role: safeRole };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.json({
      message: 'Login successful.',
      token,
      user: { id: user.id, username: user.username, name: user.name, role: safeRole },
    });
  });

  router.post('/logout', (req, res) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(400).json({
        error: 'Authorization header with Bearer token is required.',
      });
    }

    const token = authHeader.slice(7);

    try {
      jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({
        error: 'Token is invalid or already expired.',
      });
    }

    revokedTokens.add(token);
    return res.json({ message: 'Logout successful.' });
  });

  router.post('/change-password', authenticate, async (req, res) => {
    const { oldPassword, newPassword } = req.body ?? {};

    if (typeof oldPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({
        error: 'oldPassword and newPassword are required and must be strings.',
      });
    }

    const normalizedOldPassword = oldPassword.trim();
    const normalizedNewPassword = newPassword.trim();

    if (!normalizedOldPassword || !normalizedNewPassword) {
      return res.status(400).json({
        error: 'oldPassword and newPassword cannot be empty.',
      });
    }

    if (normalizedOldPassword === normalizedNewPassword) {
      return res.status(400).json({
        error: 'newPassword must be different from oldPassword.',
      });
    }

    await db.read();
    const users = db.data.users ?? [];
    const userIndex = users.findIndex((u) => u.id === req.user.sub);

    if (userIndex === -1) {
      return res.status(401).json({
        error: 'User not found.',
      });
    }

    if (users[userIndex].password !== normalizedOldPassword) {
      return res.status(401).json({
        error: 'Old password is incorrect.',
      });
    }

    users[userIndex].password = normalizedNewPassword;
    db.data.users = users;
    await db.write();

    // Force re-login after password change by revoking current token.
    revokedTokens.add(req.authToken);

    return res.json({
      message: 'Password changed successfully. Please log in again.',
    });
  });

  return router;
}

module.exports = { createUserRouter };

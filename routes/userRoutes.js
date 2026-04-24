const express = require('express');

function createUserRouter({ db, jwt, JWT_SECRET, JWT_EXPIRES_IN, revokedTokens }) {
  const router = express.Router();

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

    const payload = { sub: user.id, username: user.username, name: user.name };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.json({
      message: 'Login successful.',
      token,
      user: { id: user.id, username: user.username, name: user.name },
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

  return router;
}

module.exports = { createUserRouter };
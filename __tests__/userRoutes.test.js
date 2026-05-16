const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createUserRouter } = require('../routes/userRoutes');

function createMockDb(initialUsers = []) {
  return {
    data: {
      users: [...initialUsers],
    },
    read: jest.fn(async () => {}),
    write: jest.fn(async () => {}),
  };
}

function createTestApp({ users = [], JWT_SECRET = 'test_secret', JWT_EXPIRES_IN = '1h' } = {}) {
  const app = express();
  app.use(express.json());

  const db = createMockDb(users);
  const revokedTokens = new Set();

  app.use(createUserRouter({
    db,
    jwt,
    JWT_SECRET,
    JWT_EXPIRES_IN,
    revokedTokens,
  }));

  return { app, db, revokedTokens, JWT_SECRET };
}

describe('userRoutes', () => {
  describe('POST /register', () => {
    test('registers user successfully with default role', async () => {
      const { app, db } = createTestApp();

      const response = await request(app)
        .post('/register')
        .send({
          username: '  alice  ',
          password: '  pass123  ',
          name: '  Alice  ',
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        message: 'Registration successful.',
        user: {
          id: 1,
          username: 'alice',
          name: 'Alice',
          role: 'user',
        },
      });

      expect(db.write).toHaveBeenCalledTimes(1);
      expect(db.data.users).toHaveLength(1);
      expect(db.data.users[0]).toMatchObject({
        id: 1,
        username: 'alice',
        password: 'pass123',
        name: 'Alice',
        role: 'user',
      });
    });

    test('rejects duplicate username (case-insensitive)', async () => {
      const { app } = createTestApp({
        users: [{ id: 1, username: 'Alice', password: 'pass123', name: 'Alice', role: 'user' }],
      });

      const response = await request(app)
        .post('/register')
        .send({ username: 'alice', password: 'newpass', name: 'Another Alice' });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Username already exists.');
    });

    test('rejects invalid role', async () => {
      const { app } = createTestApp();

      const response = await request(app)
        .post('/register')
        .send({ username: 'bob', password: 'pass123', name: 'Bob', role: 'manager' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('role must be either "user" or "admin".');
    });
  });

  describe('POST /login', () => {
    test('logs in successfully and returns token + safe role', async () => {
      const { app } = createTestApp({
        users: [{ id: 2, username: 'admin', password: 'admin123', name: 'Admin User', role: 'admin' }],
      });

      const response = await request(app)
        .post('/login')
        .send({ username: 'admin', password: 'admin123' });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Login successful.');
      expect(typeof response.body.token).toBe('string');
      expect(response.body.user).toEqual({
        id: 2,
        username: 'admin',
        name: 'Admin User',
        role: 'admin',
      });
    });

    test('rejects invalid credentials', async () => {
      const { app } = createTestApp({
        users: [{ id: 1, username: 'user1', password: 'correct', name: 'User One', role: 'user' }],
      });

      const response = await request(app)
        .post('/login')
        .send({ username: 'user1', password: 'wrong' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid username or password.');
    });
  });

  describe('POST /logout', () => {
    test('revokes valid token', async () => {
      const { app, revokedTokens, JWT_SECRET } = createTestApp();
      const token = jwt.sign({ sub: 1, username: 'alice' }, JWT_SECRET, { expiresIn: '1h' });

      const response = await request(app)
        .post('/logout')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Logout successful.');
      expect(revokedTokens.has(token)).toBe(true);
    });

    test('returns 400 when auth header is missing', async () => {
      const { app } = createTestApp();

      const response = await request(app).post('/logout');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Authorization header with Bearer token is required.');
    });
  });

  describe('POST /change-password', () => {
    test('changes password and revokes current token', async () => {
      const { app, db, revokedTokens, JWT_SECRET } = createTestApp({
        users: [{ id: 1, username: 'alice', password: 'oldpass', name: 'Alice', role: 'user' }],
      });

      const token = jwt.sign({ sub: 1, username: 'alice', name: 'Alice', role: 'user' }, JWT_SECRET, {
        expiresIn: '1h',
      });

      const response = await request(app)
        .post('/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ oldPassword: 'oldpass', newPassword: 'newpass' });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Password changed successfully. Please log in again.');
      expect(db.data.users[0].password).toBe('newpass');
      expect(db.write).toHaveBeenCalledTimes(1);
      expect(revokedTokens.has(token)).toBe(true);
    });

    test('rejects request with revoked token', async () => {
      const { app, revokedTokens, JWT_SECRET } = createTestApp({
        users: [{ id: 1, username: 'alice', password: 'oldpass', name: 'Alice', role: 'user' }],
      });

      const token = jwt.sign({ sub: 1, username: 'alice', name: 'Alice', role: 'user' }, JWT_SECRET, {
        expiresIn: '1h',
      });
      revokedTokens.add(token);

      const response = await request(app)
        .post('/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ oldPassword: 'oldpass', newPassword: 'newpass' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Token has been revoked. Please log in again.');
    });

    test('rejects when old password is incorrect', async () => {
      const { app, JWT_SECRET } = createTestApp({
        users: [{ id: 1, username: 'alice', password: 'oldpass', name: 'Alice', role: 'user' }],
      });

      const token = jwt.sign({ sub: 1, username: 'alice', name: 'Alice', role: 'user' }, JWT_SECRET, {
        expiresIn: '1h',
      });

      const response = await request(app)
        .post('/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ oldPassword: 'wrong-old', newPassword: 'newpass' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Old password is incorrect.');
    });
  });
});


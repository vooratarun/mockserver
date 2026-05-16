const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createChannelSubscriptionRouter } = require('../routes/channelSubscriptionRoutes');

function createMockDb({ users = [], videos = [], channelSubscriptions = [] } = {}) {
  return {
    data: {
      users: [...users],
      videos: [...videos],
      channelSubscriptions: [...channelSubscriptions],
    },
    read: jest.fn(async () => {}),
    write: jest.fn(async () => {}),
  };
}

function createTestApp({ users = [], videos = [], channelSubscriptions = [], JWT_SECRET = 'test_secret' } = {}) {
  const app = express();
  app.use(express.json());

  const db = createMockDb({ users, videos, channelSubscriptions });
  const revokedTokens = new Set();

  app.use(createChannelSubscriptionRouter({
    db,
    jwt,
    JWT_SECRET,
    revokedTokens,
  }));

  return { app, db, revokedTokens, JWT_SECRET };
}

describe('channelSubscriptionRoutes', () => {
  const users = [{ id: 1, username: 'alice', password: 'pass', name: 'Alice', role: 'user' }];
  const videos = [
    { id: 1, channelName: 'FutureCoders', title: 'A', thumbnailUrl: 'x', authorImageUrl: 'x', videoSourceUrl: 'x', meta: 'x' },
    { id: 2, channelName: 'Angular Hub', title: 'B', thumbnailUrl: 'x', authorImageUrl: 'x', videoSourceUrl: 'x', meta: 'x' },
    { id: 3, channelName: 'FutureCoders', title: 'C', thumbnailUrl: 'x', authorImageUrl: 'x', videoSourceUrl: 'x', meta: 'x' },
  ];

  function tokenFor(secret, sub = 1) {
    return jwt.sign({ sub, username: 'alice' }, secret, { expiresIn: '1h' });
  }

  test('subscribes successfully and returns 201', async () => {
    const { app, db, JWT_SECRET } = createTestApp({ users, videos });
    const token = tokenFor(JWT_SECRET);

    const response = await request(app)
      .post('/users/1/subscribed-channels/FutureCoders')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(201);
    expect(response.body.message).toBe('Channel subscribed successfully.');
    expect(response.body.subscription).toMatchObject({ userId: 1, channelName: 'FutureCoders' });
    expect(db.write).toHaveBeenCalledTimes(1);
    expect(db.data.channelSubscriptions).toHaveLength(1);
  });

  test('returns 200 when already subscribed', async () => {
    const { app, JWT_SECRET } = createTestApp({
      users,
      videos,
      channelSubscriptions: [{
        id: 1,
        userId: 1,
        channelName: 'FutureCoders',
        normalizedChannelName: 'futurecoders',
        subscribedAt: '2026-05-16T10:00:00.000Z',
      }],
    });
    const token = tokenFor(JWT_SECRET);

    const response = await request(app)
      .post('/users/1/subscribed-channels/futurecoders')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Already subscribed to channel.');
  });

  test('lists user subscriptions', async () => {
    const { app, JWT_SECRET } = createTestApp({
      users,
      videos,
      channelSubscriptions: [{
        id: 2,
        userId: 1,
        channelName: 'Angular Hub',
        normalizedChannelName: 'angular hub',
        subscribedAt: '2026-05-16T11:00:00.000Z',
      }],
    });
    const token = tokenFor(JWT_SECRET);

    const response = await request(app)
      .get('/users/1/subscribed-channels')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].channelName).toBe('Angular Hub');
    expect(response.body[0]).not.toHaveProperty('normalizedChannelName');
  });

  test('checks subscription status', async () => {
    const { app, JWT_SECRET } = createTestApp({
      users,
      videos,
      channelSubscriptions: [{
        id: 1,
        userId: 1,
        channelName: 'FutureCoders',
        normalizedChannelName: 'futurecoders',
        subscribedAt: '2026-05-16T10:00:00.000Z',
      }],
    });
    const token = tokenFor(JWT_SECRET);

    const response = await request(app)
      .get('/users/1/subscribed-channels/FutureCoders')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: 1, channelName: 'FutureCoders', subscribed: true });
  });

  test('returns videos for one subscribed channel', async () => {
    const { app, JWT_SECRET } = createTestApp({
      users,
      videos,
      channelSubscriptions: [{
        id: 1,
        userId: 1,
        channelName: 'FutureCoders',
        normalizedChannelName: 'futurecoders',
        subscribedAt: '2026-05-16T10:00:00.000Z',
      }],
    });
    const token = tokenFor(JWT_SECRET);

    const response = await request(app)
      .get('/users/1/subscribed-channels/FutureCoders/videos')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.userId).toBe(1);
    expect(response.body.channelName).toBe('FutureCoders');
    expect(response.body.total).toBe(2);
    expect(response.body.videos).toHaveLength(2);
    expect(response.body.videos.map((video) => video.id)).toEqual([1, 3]);
  });

  test('returns 404 when requesting videos for a non-subscribed channel', async () => {
    const { app, JWT_SECRET } = createTestApp({ users, videos });
    const token = tokenFor(JWT_SECRET);

    const response = await request(app)
      .get('/users/1/subscribed-channels/FutureCoders/videos')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Subscription not found for this channel.');
  });

  test('returns 404 when requesting videos for an unknown channel', async () => {
    const { app, JWT_SECRET } = createTestApp({ users, videos });
    const token = tokenFor(JWT_SECRET);

    const response = await request(app)
      .get('/users/1/subscribed-channels/UnknownChannel/videos')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Channel "UnknownChannel" not found.');
  });

  test('unsubscribes successfully', async () => {
    const { app, db, JWT_SECRET } = createTestApp({
      users,
      videos,
      channelSubscriptions: [{
        id: 1,
        userId: 1,
        channelName: 'FutureCoders',
        normalizedChannelName: 'futurecoders',
        subscribedAt: '2026-05-16T10:00:00.000Z',
      }],
    });
    const token = tokenFor(JWT_SECRET);

    const response = await request(app)
      .delete('/users/1/subscribed-channels/FutureCoders')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Channel unsubscribed successfully.');
    expect(db.data.channelSubscriptions).toHaveLength(0);
    expect(db.write).toHaveBeenCalledTimes(1);
  });

  test('returns 404 when channel does not exist while subscribing', async () => {
    const { app, JWT_SECRET } = createTestApp({ users, videos });
    const token = tokenFor(JWT_SECRET);

    const response = await request(app)
      .post('/users/1/subscribed-channels/UnknownChannel')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Channel "UnknownChannel" not found.');
  });

  test('returns 403 when user tries to modify another user subscriptions', async () => {
    const { app, JWT_SECRET } = createTestApp({ users, videos });
    const token = tokenFor(JWT_SECRET, 1);

    const response = await request(app)
      .post('/users/2/subscribed-channels/FutureCoders')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('You are not allowed to access another user\'s subscriptions.');
  });
});


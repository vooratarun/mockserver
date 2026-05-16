const express = require('express');
const request = require('supertest');
const { createVideoRouter } = require('../routes/videoRoutes');

function createMockDb({ videos = [], categories = [], likedVideos = [] } = {}) {
  return {
    data: {
      videos: [...videos],
      categories: [...categories],
      likedVideos: [...likedVideos],
    },
    read: jest.fn(async () => {}),
    write: jest.fn(async () => {}),
  };
}

function normalizeVideo(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'Request body must be a JSON object.' };
  }

  const requiredFields = [
    'thumbnailUrl',
    'authorImageUrl',
    'videoSourceUrl',
    'title',
    'channelName',
    'meta',
  ];

  const missingFields = requiredFields.filter(
    (field) => typeof payload[field] !== 'string' || payload[field].trim() === '',
  );

  if (missingFields.length > 0) {
    return { error: 'Missing or invalid video fields.', missingFields };
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'userId')) {
    if (!Number.isInteger(payload.userId) || payload.userId < 1) {
      return { error: 'userId must be a positive integer when provided.' };
    }
  }

  return {
    video: {
      thumbnailUrl: payload.thumbnailUrl.trim(),
      authorImageUrl: payload.authorImageUrl.trim(),
      videoSourceUrl: payload.videoSourceUrl.trim(),
      title: payload.title.trim(),
      channelName: payload.channelName.trim(),
      meta: payload.meta.trim(),
      ...(Object.prototype.hasOwnProperty.call(payload, 'userId') && { userId: payload.userId }),
    },
  };
}

function createTestApp({ videos = [], categories = [], likedVideos = [] } = {}) {
  const app = express();
  app.use(express.json());

  const db = createMockDb({ videos, categories, likedVideos });
  app.use(createVideoRouter({ db, normalizeVideo }));

  return { app, db };
}

describe('videoRoutes optional userId', () => {
  const basePayload = {
    thumbnailUrl: 'https://example.com/thumb.jpg',
    authorImageUrl: 'https://example.com/author.jpg',
    videoSourceUrl: 'https://example.com/video.mp4',
    title: 'Video title',
    channelName: 'Channel name',
    meta: '10K Views • 2 Days Ago',
  };

  test('creates a video with optional userId', async () => {
    const { app, db } = createTestApp();

    const response = await request(app)
      .post('/videos')
      .send({ ...basePayload, userId: 2 });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ id: 1, userId: 2, ...basePayload });
    expect(db.data.videos[0]).toMatchObject({ id: 1, userId: 2, ...basePayload });
  });

  test('creates a video without userId', async () => {
    const { app, db } = createTestApp();

    const response = await request(app)
      .post('/videos')
      .send(basePayload);

    expect(response.status).toBe(201);
    expect(response.body).not.toHaveProperty('userId');
    expect(db.data.videos[0]).not.toHaveProperty('userId');
  });

  test('rejects invalid userId on create', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/videos')
      .send({ ...basePayload, userId: '2' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('userId must be a positive integer when provided.');
  });

  test('updates a video and preserves existing userId when omitted', async () => {
    const { app, db } = createTestApp({
      videos: [{ id: 1, userId: 7, ...basePayload }],
    });

    const response = await request(app)
      .put('/update-video/1')
      .send({ ...basePayload, title: 'Updated title' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 1, userId: 7, title: 'Updated title' });
    expect(db.data.videos[0]).toMatchObject({ id: 1, userId: 7, title: 'Updated title' });
  });

  test('updates a video and overwrites userId when provided', async () => {
    const { app, db } = createTestApp({
      videos: [{ id: 1, userId: 7, ...basePayload }],
    });

    const response = await request(app)
      .put('/update-video/1')
      .send({ ...basePayload, userId: 3, title: 'Updated title' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 1, userId: 3, title: 'Updated title' });
    expect(db.data.videos[0]).toMatchObject({ id: 1, userId: 3, title: 'Updated title' });
  });

  test('rejects invalid userId on update', async () => {
    const { app } = createTestApp({
      videos: [{ id: 1, userId: 7, ...basePayload }],
    });

    const response = await request(app)
      .put('/update-video/1')
      .send({ ...basePayload, userId: 0 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('userId must be a positive integer when provided.');
  });

  test('fetches videos by userId', async () => {
    const { app } = createTestApp({
      videos: [
        { id: 1, userId: 2, ...basePayload },
        { id: 2, userId: 2, ...basePayload, title: 'Second' },
        { id: 3, userId: 3, ...basePayload, title: 'Third' },
      ],
    });

    const response = await request(app).get('/users/2/videos');

    expect(response.status).toBe(200);
    expect(response.body.userId).toBe(2);
    expect(response.body.total).toBe(2);
    expect(response.body.videos).toHaveLength(2);
    expect(response.body.videos.map((v) => v.id)).toEqual([1, 2]);
  });

  test('returns empty array when user has no videos', async () => {
    const { app } = createTestApp({
      videos: [{ id: 1, userId: 3, ...basePayload }],
    });

    const response = await request(app).get('/users/2/videos');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      userId: 2,
      total: 0,
      videos: [],
    });
  });

  test('returns 400 for invalid userId in path', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/users/abc/videos');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid user ID. ID must be a positive number.');
  });
});


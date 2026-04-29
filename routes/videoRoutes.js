const express = require('express');

function createVideoRouter({ db, normalizeVideo }) {
  // NOTE: a JWT-protected version of this check also lives at
  //   GET /users/:userId/liked-videos/:videoId  (likedVideoRoutes.js)
  const router = express.Router();

  function resolveCategoryAssignment(payload, categories) {
    const hasCategory = Object.prototype.hasOwnProperty.call(payload, 'category');
    const hasCategoryId = Object.prototype.hasOwnProperty.call(payload, 'categoryId');

    if (!hasCategory && !hasCategoryId) {
      return { mode: 'unchanged' };
    }

    const rawValue = hasCategory ? payload.category : payload.categoryId;

    if (rawValue === null || rawValue === '') {
      return { mode: 'clear' };
    }

    let resolvedId = null;

    if (typeof rawValue === 'number' && Number.isInteger(rawValue)) {
      resolvedId = rawValue;
    } else if (typeof rawValue === 'string') {
      const normalized = rawValue.trim();

      if (!normalized) {
        return { mode: 'clear' };
      }

      if (/^\d+$/.test(normalized)) {
        resolvedId = Number.parseInt(normalized, 10);
      } else {
        const matchedByName = categories.find(
          (c) => c.name.toLowerCase() === normalized.toLowerCase(),
        );

        if (!matchedByName) {
          return { error: `Category \"${normalized}\" not found.` };
        }

        resolvedId = matchedByName.id;
      }
    } else {
      return { error: 'category must be a category id (number) or category name (string).' };
    }

    const exists = categories.some((c) => c.id === resolvedId);

    if (!exists) {
      return { error: `Category with ID ${resolvedId} not found.` };
    }

    const resolvedCategory = categories.find((c) => c.id === resolvedId);

    return {
      mode: 'set',
      categoryId: resolvedId,
      categoryName: resolvedCategory?.name ?? null,
    };
  }

  router.get('/videos/:videoId/is-liked', async (req, res) => {
    const videoId = Number.parseInt(req.params.videoId, 10);

    if (Number.isNaN(videoId)) {
      return res.status(400).json({ error: 'Invalid video ID. ID must be a number.' });
    }

    const userId = Number.parseInt(req.query.userId, 10);

    if (Number.isNaN(userId)) {
      return res.status(400).json({ error: 'userId query param is required and must be a number.' });
    }

    await db.read();

    const liked = (db.data.likedVideos ?? []).some(
      (lv) => lv.userId === userId && lv.videoId === videoId,
    );

    return res.json({ userId, videoId, liked });
  });

  // POST /videos/liked-status
  // Body: { "userId": 1, "videoIds": [3, 4, 5] }
  // Returns liked and notLiked arrays with full video objects.
  router.post('/videos/liked-status', async (req, res) => {
    const { userId, videoIds } = req.body ?? {};

    if (!userId || typeof userId !== 'number') {
      return res.status(400).json({ error: 'userId is required and must be a number.' });
    }

    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      return res.status(400).json({ error: 'videoIds must be a non-empty array of numbers.' });
    }

    const invalidIds = videoIds.filter((id) => typeof id !== 'number' || !Number.isInteger(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({
        error: 'All entries in videoIds must be integers.',
        invalidIds,
      });
    }

    await db.read();

    const likedSet = new Set(
      (db.data.likedVideos ?? [])
        .filter((lv) => lv.userId === userId)
        .map((lv) => lv.videoId),
    );

    const videosMap = new Map(
      (db.data.videos ?? []).map((v) => [v.id, v]),
    );

    const liked = [];
    const notLiked = [];
    const notFound = [];

    for (const videoId of videoIds) {
      const video = videosMap.get(videoId);
      if (!video) {
        notFound.push(videoId);
        continue;
      }
      if (likedSet.has(videoId)) {
        liked.push(video);
      } else {
        notLiked.push(video);
      }
    }

    return res.json({
      userId,
      liked,
      notLiked,
      ...(notFound.length > 0 && { notFound }),
    });
  });

  router.get('/get-videos', async (_req, res) => {
    await db.read();
    res.json(db.data.videos ?? []);
  });

  router.get('/get-video/:id', async (req, res) => {
    const videoId = Number.parseInt(req.params.id, 10);

    if (Number.isNaN(videoId)) {
      return res.status(400).json({
        error: 'Invalid video ID. ID must be a number.',
      });
    }

    await db.read();
    const video = (db.data.videos ?? []).find((item) => item.id === videoId);

    if (!video) {
      return res.status(404).json({
        error: `Video with ID ${videoId} not found.`,
      });
    }

    return res.json(video);
  });

  router.get('/get-videos-paginated', async (req, res) => {
    const page = Number.parseInt(req.query.page, 10) || 1;
    const limit = Number.parseInt(req.query.limit, 10) || 10;
    const hasCategoryId = Object.prototype.hasOwnProperty.call(req.query, 'categoryId');

    let categoryId = null;

    if (hasCategoryId) {
      categoryId = Number.parseInt(req.query.categoryId, 10);

      if (Number.isNaN(categoryId) || categoryId < 1) {
        return res.status(400).json({
          error: 'categoryId must be a positive integer when provided.',
        });
      }
    }

    if (page < 1 || limit < 1) {
      return res.status(400).json({
        error: 'page and limit must be positive integers.',
      });
    }

    const safeLimit = Math.min(limit, 100);
    const offset = (page - 1) * safeLimit;

    await db.read();
    const videos = db.data.videos ?? [];
    const categories = db.data.categories ?? [];

    if (hasCategoryId) {
      const categoryExists = categories.some((category) => category.id === categoryId);

      if (!categoryExists) {
        return res.status(404).json({
          error: `Category with ID ${categoryId} not found.`,
        });
      }
    }

    const filteredVideos = hasCategoryId
      ? videos.filter((video) => video.categoryId === categoryId)
      : videos;
    const total = filteredVideos.length;
    const totalPages = Math.max(1, Math.ceil(total / safeLimit));
    const data = filteredVideos.slice(offset, offset + safeLimit);

    return res.json({
      page,
      limit: safeLimit,
      ...(hasCategoryId && { categoryId }),
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      data,
    });
  });

  router.get('/search', async (req, res) => {
    const query = (req.query.q || '').trim().toLowerCase();

    if (!query) {
      return res.status(400).json({
        error: 'Search query is required. Use ?q=your_search_term',
      });
    }

    await db.read();
    const results = (db.data.videos ?? []).filter((video) => {
      const titleMatch = video.title.toLowerCase().includes(query);
      const metaMatch = video.meta.toLowerCase().includes(query);
      const channelMatch = video.channelName.toLowerCase().includes(query);
      return titleMatch || metaMatch || channelMatch;
    });

    return res.json(results);
  });

  const createVideo = async (req, res) => {
    const result = normalizeVideo(req.body);

    if (result.error) {
      return res.status(400).json({
        error: result.error,
        missingFields: result.missingFields ?? [],
      });
    }

    await db.read();
    const categoryResolution = resolveCategoryAssignment(req.body ?? {}, db.data.categories ?? []);

    if (categoryResolution.error) {
      return res.status(400).json({ error: categoryResolution.error });
    }

    const nextId = db.data.videos.length > 0
      ? Math.max(...db.data.videos.map((v) => v.id || 0)) + 1
      : 1;
    const videoWithId = {
      id: nextId,
      ...result.video,
      ...(categoryResolution.mode === 'set' && {
        categoryId: categoryResolution.categoryId,
        categoryName: categoryResolution.categoryName,
      }),
    };
    db.data.videos.push(videoWithId);
    await db.write();

    return res.status(201).json(videoWithId);
  };

  router.post('/videos', createVideo);
  router.post('/add-video', createVideo);

  router.put('/update-video/:id', async (req, res) => {
    const videoId = Number.parseInt(req.params.id, 10);

    if (Number.isNaN(videoId)) {
      return res.status(400).json({
        error: 'Invalid video ID. ID must be a number.',
      });
    }

    const result = normalizeVideo(req.body);

    if (result.error) {
      return res.status(400).json({
        error: result.error,
        missingFields: result.missingFields ?? [],
      });
    }

    await db.read();
    const categoryResolution = resolveCategoryAssignment(req.body ?? {}, db.data.categories ?? []);

    if (categoryResolution.error) {
      return res.status(400).json({ error: categoryResolution.error });
    }

    const videoIndex = db.data.videos.findIndex((v) => v.id === videoId);

    if (videoIndex === -1) {
      return res.status(404).json({
        error: `Video with ID ${videoId} not found.`,
      });
    }

    const updatedVideo = { id: videoId, ...result.video };

    if (categoryResolution.mode === 'set') {
      updatedVideo.categoryId = categoryResolution.categoryId;
      updatedVideo.categoryName = categoryResolution.categoryName;
    }

    db.data.videos[videoIndex] = updatedVideo;
    await db.write();

    return res.json(db.data.videos[videoIndex]);
  });

  router.delete('/delete-video/:id', async (req, res) => {
    const videoId = Number.parseInt(req.params.id, 10);

    if (Number.isNaN(videoId)) {
      return res.status(400).json({
        error: 'Invalid video ID. ID must be a number.',
      });
    }

    await db.read();
    const videoIndex = db.data.videos.findIndex((video) => video.id === videoId);

    if (videoIndex === -1) {
      return res.status(404).json({
        error: `Video with ID ${videoId} not found.`,
      });
    }

    const [deletedVideo] = db.data.videos.splice(videoIndex, 1);
    await db.write();

    return res.json({
      message: 'Video deleted successfully.',
      video: deletedVideo,
    });
  });

  return router;
}

module.exports = { createVideoRouter };

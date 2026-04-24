const express = require('express');

function createVideoRouter({ db, normalizeVideo }) {
  const router = express.Router();

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

    if (page < 1 || limit < 1) {
      return res.status(400).json({
        error: 'page and limit must be positive integers.',
      });
    }

    const safeLimit = Math.min(limit, 100);
    const offset = (page - 1) * safeLimit;

    await db.read();
    const videos = db.data.videos ?? [];
    const total = videos.length;
    const totalPages = Math.max(1, Math.ceil(total / safeLimit));
    const data = videos.slice(offset, offset + safeLimit);

    return res.json({
      page,
      limit: safeLimit,
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
    const nextId = db.data.videos.length > 0
      ? Math.max(...db.data.videos.map((v) => v.id || 0)) + 1
      : 1;
    const videoWithId = { id: nextId, ...result.video };
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
    const videoIndex = db.data.videos.findIndex((v) => v.id === videoId);

    if (videoIndex === -1) {
      return res.status(404).json({
        error: `Video with ID ${videoId} not found.`,
      });
    }

    db.data.videos[videoIndex] = { id: videoId, ...result.video };
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
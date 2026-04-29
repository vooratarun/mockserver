const express = require('express');

function createCategoryRouter({ db }) {
  const router = express.Router();

  function parseId(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  function validateCategoryBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { error: 'Request body must be a JSON object.' };
    }

    const { name, description } = body;

    if (typeof name !== 'string' || !name.trim()) {
      return { error: 'name is required and must be a non-empty string.' };
    }

    if (description !== undefined && typeof description !== 'string') {
      return { error: 'description must be a string when provided.' };
    }

    return {
      category: {
        name: name.trim(),
        ...(description !== undefined && { description: description.trim() }),
      },
    };
  }

  router.get('/categories', async (_req, res) => {
    await db.read();
    return res.json(db.data.categories ?? []);
  });

  router.get('/categories/:id', async (req, res) => {
    const categoryId = parseId(req.params.id);
    if (categoryId === null) {
      return res.status(400).json({ error: 'Invalid category ID. ID must be a number.' });
    }

    await db.read();
    const category = (db.data.categories ?? []).find((c) => c.id === categoryId);
    if (!category) {
      return res.status(404).json({ error: `Category with ID ${categoryId} not found.` });
    }

    return res.json(category);
  });

  router.post('/categories', async (req, res) => {
    const result = validateCategoryBody(req.body);
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    await db.read();
    const categories = db.data.categories ?? [];

    const duplicate = categories.some(
      (c) => c.name.toLowerCase() === result.category.name.toLowerCase(),
    );

    if (duplicate) {
      return res.status(409).json({ error: 'Category name already exists.' });
    }

    const nextId = categories.length > 0
      ? Math.max(...categories.map((c) => c.id || 0)) + 1
      : 1;

    const newCategory = { id: nextId, ...result.category };
    categories.push(newCategory);
    db.data.categories = categories;
    await db.write();

    return res.status(201).json(newCategory);
  });

  router.put('/categories/:id', async (req, res) => {
    const categoryId = parseId(req.params.id);
    if (categoryId === null) {
      return res.status(400).json({ error: 'Invalid category ID. ID must be a number.' });
    }

    const result = validateCategoryBody(req.body);
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    await db.read();
    const categories = db.data.categories ?? [];
    const categoryIndex = categories.findIndex((c) => c.id === categoryId);

    if (categoryIndex === -1) {
      return res.status(404).json({ error: `Category with ID ${categoryId} not found.` });
    }

    const duplicate = categories.some(
      (c) => c.id !== categoryId && c.name.toLowerCase() === result.category.name.toLowerCase(),
    );

    if (duplicate) {
      return res.status(409).json({ error: 'Category name already exists.' });
    }

    categories[categoryIndex] = { id: categoryId, ...result.category };
    db.data.categories = categories;
    await db.write();

    return res.json(categories[categoryIndex]);
  });

  router.delete('/categories/:id', async (req, res) => {
    const categoryId = parseId(req.params.id);
    if (categoryId === null) {
      return res.status(400).json({ error: 'Invalid category ID. ID must be a number.' });
    }

    await db.read();
    const categories = db.data.categories ?? [];
    const categoryIndex = categories.findIndex((c) => c.id === categoryId);

    if (categoryIndex === -1) {
      return res.status(404).json({ error: `Category with ID ${categoryId} not found.` });
    }

    const [deletedCategory] = categories.splice(categoryIndex, 1);
    const videos = db.data.videos ?? [];
    let detachedVideos = 0;

    for (const video of videos) {
      if (video.categoryId === categoryId) {
        delete video.categoryId;
        detachedVideos += 1;
      }
    }

    db.data.categories = categories;
    db.data.videos = videos;
    await db.write();

    return res.json({
      message: 'Category deleted successfully.',
      category: deletedCategory,
      detachedVideos,
    });
  });

  router.put('/videos/:videoId/category/:categoryId', async (req, res) => {
    const videoId = parseId(req.params.videoId);
    const categoryId = parseId(req.params.categoryId);

    if (videoId === null || categoryId === null) {
      return res.status(400).json({ error: 'videoId and categoryId must be numbers.' });
    }

    await db.read();

    const video = (db.data.videos ?? []).find((v) => v.id === videoId);
    if (!video) {
      return res.status(404).json({ error: `Video with ID ${videoId} not found.` });
    }

    const category = (db.data.categories ?? []).find((c) => c.id === categoryId);
    if (!category) {
      return res.status(404).json({ error: `Category with ID ${categoryId} not found.` });
    }

    video.categoryId = categoryId;
    await db.write();

    return res.json({
      message: 'Category assigned to video successfully.',
      video,
      category,
    });
  });

  router.delete('/videos/:videoId/category', async (req, res) => {
    const videoId = parseId(req.params.videoId);

    if (videoId === null) {
      return res.status(400).json({ error: 'videoId must be a number.' });
    }

    await db.read();
    const video = (db.data.videos ?? []).find((v) => v.id === videoId);

    if (!video) {
      return res.status(404).json({ error: `Video with ID ${videoId} not found.` });
    }

    if (video.categoryId === undefined) {
      return res.status(404).json({ error: 'Video is not associated with any category.' });
    }

    delete video.categoryId;
    await db.write();

    return res.json({ message: 'Category removed from video successfully.', video });
  });

  router.get('/videos/:videoId/category', async (req, res) => {
    const videoId = parseId(req.params.videoId);

    if (videoId === null) {
      return res.status(400).json({ error: 'videoId must be a number.' });
    }

    await db.read();
    const video = (db.data.videos ?? []).find((v) => v.id === videoId);

    if (!video) {
      return res.status(404).json({ error: `Video with ID ${videoId} not found.` });
    }

    if (video.categoryId === undefined) {
      return res.json({ videoId, category: null });
    }

    const category = (db.data.categories ?? []).find((c) => c.id === video.categoryId) ?? null;
    return res.json({ videoId, category });
  });

  router.get('/categories/:categoryId/videos', async (req, res) => {
    const categoryId = parseId(req.params.categoryId);

    if (categoryId === null) {
      return res.status(400).json({ error: 'Invalid category ID. ID must be a number.' });
    }

    await db.read();
    const category = (db.data.categories ?? []).find((c) => c.id === categoryId);

    if (!category) {
      return res.status(404).json({ error: `Category with ID ${categoryId} not found.` });
    }

    const videos = (db.data.videos ?? []).filter((v) => v.categoryId === categoryId);
    return res.json({ category, videos });
  });

  return router;
}

module.exports = { createCategoryRouter };


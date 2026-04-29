const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const { createUserRouter } = require('./routes/userRoutes');
const { createVideoRouter } = require('./routes/videoRoutes');
const { createLikedVideoRouter } = require('./routes/likedVideoRoutes');

const JWT_SECRET = process.env.JWT_SECRET || 'mockserver_dev_secret';
const JWT_EXPIRES_IN = '24h';
// In-memory token blocklist for logged-out tokens (resets on restart — sufficient for a mock server)
const revokedTokens = new Set();

const port = process.env.PORT || 3000;
const dbFile = process.env.DB_FILE || path.join(__dirname, 'db.json');
const defaultData = { users: [], videos: [], likedVideos: [] };
const requiredVideoFields = [
  'thumbnailUrl',
  'authorImageUrl',
  'title',
  'channelName',
  'meta',
];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function normalizeVideo(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      error: 'Request body must be a JSON object.',
    };
  }

  const missingFields = requiredVideoFields.filter(
    (field) => !isNonEmptyString(payload[field]),
  );

  if (missingFields.length > 0) {
    return {
      error: 'Missing or invalid video fields.',
      missingFields,
    };
  }

  return {
    video: {
      thumbnailUrl: payload.thumbnailUrl.trim(),
      authorImageUrl: payload.authorImageUrl.trim(),
      title: payload.title.trim(),
      channelName: payload.channelName.trim(),
      meta: payload.meta.trim(),
    },
  };
}

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Mock Server API',
      version: '1.0.0',
      description: 'REST API for the Angular mock server — videos CRUD, search, pagination and auth.',
    },
    servers: [{ url: `http://localhost:${process.env.PORT || 3000}` }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Video: {
          type: 'object',
          properties: {
            id:             { type: 'integer', example: 1 },
            thumbnailUrl:   { type: 'string',  example: 'https://img.youtube.com/vi/abc/maxresdefault.jpg' },
            authorImageUrl: { type: 'string',  example: '/profile.png' },
            title:          { type: 'string',  example: 'JavaScript Fundamentals' },
            channelName:    { type: 'string',  example: 'FutureCoders' },
            meta:           { type: 'string',  example: '10M Views • 3 Months Ago' },
          },
        },
        VideoInput: {
          type: 'object',
          required: ['thumbnailUrl', 'authorImageUrl', 'title', 'channelName', 'meta'],
          properties: {
            thumbnailUrl:   { type: 'string' },
            authorImageUrl: { type: 'string' },
            title:          { type: 'string' },
            channelName:    { type: 'string' },
            meta:           { type: 'string' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
    paths: {
      '/login': {
        post: {
          tags: ['Auth'],
          summary: 'Login with username and password',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['username', 'password'],
                  properties: {
                    username: { type: 'string', example: 'admin' },
                    password: { type: 'string', example: 'admin123' },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Login successful',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                      token:   { type: 'string' },
                      user: {
                        type: 'object',
                        properties: {
                          id:       { type: 'integer' },
                          username: { type: 'string' },
                          name:     { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
            400: { description: 'Missing credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            401: { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/logout': {
        post: {
          tags: ['Auth'],
          summary: 'Logout and revoke the current JWT token',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'Logout successful' },
            400: { description: 'Missing Authorization header', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            401: { description: 'Token invalid or expired',   content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/videos/liked-status': {
        post: {
          tags: ['Videos'],
          summary: 'Batch check liked/not-liked status of videos for a user',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['userId', 'videoIds'],
                  properties: {
                    userId:   { type: 'integer', example: 1 },
                    videoIds: { type: 'array', items: { type: 'integer' }, example: [3, 4, 5] },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Videos split into liked and notLiked arrays',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      userId:   { type: 'integer' },
                      liked:    { type: 'array', items: { $ref: '#/components/schemas/Video' } },
                      notLiked: { type: 'array', items: { $ref: '#/components/schemas/Video' } },
                      notFound: { type: 'array', items: { type: 'integer' }, description: 'videoIds that do not exist in the DB' },
                    },
                  },
                },
              },
            },
            400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/videos/{videoId}/is-liked': {
        get: {
          tags: ['Videos'],
          summary: 'Check whether a video is liked by a specific user (no auth required)',
          parameters: [
            { name: 'videoId', in: 'path',  required: true, schema: { type: 'integer' }, description: 'Video ID' },
            { name: 'userId',  in: 'query', required: true, schema: { type: 'integer' }, description: 'User ID'  },
          ],
          responses: {
            200: {
              description: 'Liked status',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      userId:  { type: 'integer' },
                      videoId: { type: 'integer' },
                      liked:   { type: 'boolean' },
                    },
                  },
                },
              },
            },
            400: { description: 'Invalid params', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/get-videos': {
        get: {
          tags: ['Videos'],
          summary: 'Get all videos',
          responses: {
            200: {
              description: 'Array of all videos',
              content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Video' } } } },
            },
          },
        },
      },
      '/get-video/{id}': {
        get: {
          tags: ['Videos'],
          summary: 'Get a single video by ID',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Video ID' }],
          responses: {
            200: { description: 'Video object', content: { 'application/json': { schema: { $ref: '#/components/schemas/Video' } } } },
            400: { description: 'Invalid ID',    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            404: { description: 'Not found',     content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/get-videos-paginated': {
        get: {
          tags: ['Videos'],
          summary: 'Get videos with pagination',
          parameters: [
            { name: 'page',  in: 'query', schema: { type: 'integer', default: 1  }, description: 'Page number (1-based)' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 }, description: 'Items per page (max 100)' },
          ],
          responses: {
            200: {
              description: 'Paginated response',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      page:        { type: 'integer' },
                      limit:       { type: 'integer' },
                      total:       { type: 'integer' },
                      totalPages:  { type: 'integer' },
                      hasNextPage: { type: 'boolean' },
                      hasPrevPage: { type: 'boolean' },
                      data:        { type: 'array', items: { $ref: '#/components/schemas/Video' } },
                    },
                  },
                },
              },
            },
            400: { description: 'Invalid pagination params', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/search': {
        get: {
          tags: ['Videos'],
          summary: 'Search videos by title, channelName or meta',
          parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' }, description: 'Search term' }],
          responses: {
            200: { description: 'Matching videos', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Video' } } } } },
            400: { description: 'Missing query',   content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/videos': {
        post: {
          tags: ['Videos'],
          summary: 'Add a new video',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/VideoInput' } } } },
          responses: {
            201: { description: 'Created video', content: { 'application/json': { schema: { $ref: '#/components/schemas/Video' } } } },
            400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/add-video': {
        post: {
          tags: ['Videos'],
          summary: 'Add a new video (alias for /videos)',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/VideoInput' } } } },
          responses: {
            201: { description: 'Created video', content: { 'application/json': { schema: { $ref: '#/components/schemas/Video' } } } },
            400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/update-video/{id}': {
        put: {
          tags: ['Videos'],
          summary: 'Update a video by ID',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Video ID' }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/VideoInput' } } } },
          responses: {
            200: { description: 'Updated video', content: { 'application/json': { schema: { $ref: '#/components/schemas/Video' } } } },
            400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            404: { description: 'Not found',       content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/delete-video/{id}': {
        delete: {
          tags: ['Videos'],
          summary: 'Delete a video by ID',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Video ID' }],
          responses: {
            200: {
              description: 'Deleted successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                      video:   { $ref: '#/components/schemas/Video' },
                    },
                  },
                },
              },
            },
            400: { description: 'Invalid ID', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            404: { description: 'Not found',  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/users/{userId}/liked-videos': {
        get: {
          tags: ['Liked Videos'],
          summary: 'Get all liked videos for a user',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'integer' }, description: 'User ID' }],
          responses: {
            200: { description: 'Array of liked videos', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Video' } } } } },
            401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            403: { description: 'Forbidden',    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/users/{userId}/liked-videos/{videoId}': {
        get: {
          tags: ['Liked Videos'],
          summary: 'Check if a video is liked by a user',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'userId',  in: 'path', required: true, schema: { type: 'integer' }, description: 'User ID'  },
            { name: 'videoId', in: 'path', required: true, schema: { type: 'integer' }, description: 'Video ID' },
          ],
          responses: {
            200: {
              description: 'Liked status',
              content: { 'application/json': { schema: { type: 'object', properties: { liked: { type: 'boolean' } } } } },
            },
            401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            403: { description: 'Forbidden',    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
        post: {
          tags: ['Liked Videos'],
          summary: 'Like a video for a user',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'userId',  in: 'path', required: true, schema: { type: 'integer' }, description: 'User ID'  },
            { name: 'videoId', in: 'path', required: true, schema: { type: 'integer' }, description: 'Video ID' },
          ],
          responses: {
            201: { description: 'Video liked',          content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, video: { $ref: '#/components/schemas/Video' } } } } } },
            200: { description: 'Already liked',        content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, video: { $ref: '#/components/schemas/Video' } } } } } },
            401: { description: 'Unauthorized',         content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            403: { description: 'Forbidden',            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            404: { description: 'Video not found',      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
        delete: {
          tags: ['Liked Videos'],
          summary: 'Unlike a video for a user',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'userId',  in: 'path', required: true, schema: { type: 'integer' }, description: 'User ID'  },
            { name: 'videoId', in: 'path', required: true, schema: { type: 'integer' }, description: 'Video ID' },
          ],
          responses: {
            200: { description: 'Video unliked',        content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } } } },
            401: { description: 'Unauthorized',         content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            403: { description: 'Forbidden',            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            404: { description: 'Entry not found',      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
    },
  },
  apis: [],
});

async function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/api-docs.json', (_req, res) => res.json(swaggerSpec));

  // lowdb is ESM-only, so load it dynamically while keeping this server in CommonJS.
  const { JSONFilePreset } = await import('lowdb/node');
  const db = await JSONFilePreset(dbFile, defaultData);

  app.get('/', (_req, res) => {
    res.json({
      message: 'Express app is running',
    });
  });

  app.use(createUserRouter({
    db,
    jwt,
    JWT_SECRET,
    JWT_EXPIRES_IN,
    revokedTokens,
  }));

  app.use(createVideoRouter({
    db,
    normalizeVideo,
  }));

  app.use(createLikedVideoRouter({
    db,
    jwt,
    JWT_SECRET,
    revokedTokens,
  }));

  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});

# Mock Server API

Base URL: `http://localhost:3000`

## Routes

### Root

- `GET /`
  - Description: Health/root endpoint
  - Response: `{ "message": "Express app is running" }`

### API Documentation

- `GET /api-docs`
  - Description: Swagger UI documentation page

- `GET /api-docs.json`
  - Description: Raw OpenAPI JSON spec

### Auth Routes

- `POST /login`
  - Description: Login with username and password
  - Request body:
    ```json
    {
      "username": "admin",
      "password": "admin123"
    }
    ```
  - Success response: token + user object

- `POST /logout`
  - Description: Logout current user token
  - Headers: `Authorization: Bearer <token>`

### Video Routes

- `GET /get-videos`
  - Description: Get all videos

- `GET /get-video/:id`
  - Description: Get one video by id
  - Path params:
    - `id` (number)

- `GET /get-videos-paginated?page=1&limit=10`
  - Description: Get videos with pagination
  - Query params:
    - `page` (number, default: 1)
    - `limit` (number, default: 10, max: 100)

- `GET /search?q=keyword`
  - Description: Search videos by `title`, `meta`, or `channelName`
  - Query params:
    - `q` (string, required)

- `POST /videos`
  - Description: Create new video
  - Request body:
    ```json
    {
      "thumbnailUrl": "https://example.com/thumb.jpg",
      "authorImageUrl": "https://example.com/author.jpg",
      "title": "Video title",
      "channelName": "Channel name",
      "meta": "10K Views • 2 Days Ago"
    }
    ```

- `POST /add-video`
  - Description: Alias of `POST /videos` (same behavior and body)

- `PUT /update-video/:id`
  - Description: Update a video by id
  - Path params:
    - `id` (number)
  - Request body: same as `POST /videos`

- `DELETE /delete-video/:id`
  - Description: Delete a video by id
  - Path params:
    - `id` (number)

## Run

```bash
npm install
npm start
```

Open docs in browser: `http://localhost:3000/api-docs`

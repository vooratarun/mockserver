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

- `POST /change-password`
  - Description: Change password for logged-in user
  - Headers: `Authorization: Bearer <token>`
  - Request body:
    ```json
    {
      "oldPassword": "admin123",
      "newPassword": "admin1234"
    }
    ```

### Video Routes

- `GET /get-videos`
  - Description: Get all videos

- `GET /users/:userId/videos`
  - Description: Get all videos created by a specific user
  - Path params:
    - `userId` (number)

- `GET /get-video/:id`
  - Description: Get one video by id
  - Path params:
    - `id` (number)

- `GET /get-videos-paginated?page=1&limit=10`
  - Description: Get videos with pagination
  - Query params:
    - `page` (number, default: 1)
    - `limit` (number, default: 10, max: 100)
    - `categoryId` (number, optional; filter videos by category)

- `GET /get-videos-paginated?page=1&limit=10&categoryId=1`
  - Description: Get paginated videos for a specific category

- `GET /search?q=keyword`
  - Description: Search videos by `title`, `meta`, or `channelName`
  - Query params:
    - `q` (string, required)

- `POST /videos/by-ids`
  - Description: Get video details for multiple video IDs
  - Request body:
    ```json
    {
      "videoIds": [1, 2, 99]
    }
    ```
  - Success response: `{ "videos": [...], "missingIds": [99] }`

- `POST /videos`
  - Description: Create new video
  - Request body:
    ```json
    {
      "userId": 2,
      "thumbnailUrl": "https://example.com/thumb.jpg",
      "authorImageUrl": "https://example.com/author.jpg",
      "videoSourceUrl": "https://cdn.example.com/videos/sample.mp4",
      "title": "Video title",
      "channelName": "Channel name",
      "meta": "10K Views • 2 Days Ago"
    }
    ```
  - `userId` is optional. When provided, it must be a positive integer.

- `POST /add-video`
  - Description: Alias of `POST /videos` (same behavior and body)

- `PUT /update-video/:id`
  - Description: Update a video by id
  - Path params:
    - `id` (number)
  - Request body: same as `POST /videos`
  - If `userId` is omitted during update, the existing stored `userId` is preserved.

- `DELETE /delete-video/:id`
  - Description: Delete a video by id
  - Path params:
    - `id` (number)

### Playlist Routes

- `GET /users/:userId/playlists`
  - Description: Get all playlists for a user
  - Headers: `Authorization: Bearer <token>`

- `POST /users/:userId/playlists`
  - Description: Create playlist for a user
  - Headers: `Authorization: Bearer <token>`
  - Request body:
    ```json
    {
      "name": "My Favorites",
      "description": "Videos to watch later"
    }
    ```

- `POST /users/:userId/playlists/:playlistId/videos/:videoId`
  - Description: Add a video to a playlist
  - Headers: `Authorization: Bearer <token>`

- `DELETE /users/:userId/playlists/:playlistId`
  - Description: Delete a playlist of a user
  - Headers: `Authorization: Bearer <token>`

- `GET /users/:userId/playlists/:playlistId/videos`
  - Description: Get all videos in a playlist
  - Headers: `Authorization: Bearer <token>`

- `DELETE /users/:userId/playlists/:playlistId/videos/:videoId`
  - Description: Remove a video from a playlist
  - Headers: `Authorization: Bearer <token>`

### Watch History Routes

- `GET /users/:userId/watch-history`
  - Description: Get user watch history (newest first)
  - Headers: `Authorization: Bearer <token>`

- `POST /users/:userId/watch-history/:videoId`
  - Description: Save or refresh a watched video in user watch history
  - Headers: `Authorization: Bearer <token>`

- `DELETE /users/:userId/watch-history/:videoId`
  - Description: Remove a watched video from user watch history
  - Headers: `Authorization: Bearer <token>`

### User Settings Routes

- `GET /users/:userId/settings`
  - Description: Get user settings (creates defaults on first access)
  - Headers: `Authorization: Bearer <token>`

- `PUT /users/:userId/settings`
  - Description: Update user settings
  - Headers: `Authorization: Bearer <token>`
  - Request body (partial update):
    ```json
    {
      "theme": "dark",
      "language": "en",
      "autoplay": false,
      "emailNotifications": true,
      "pushNotifications": false
    }
    ```

### Channel Subscription Routes

- `GET /users/:userId/subscribed-channels`
  - Description: Get all channels subscribed by the user
  - Headers: `Authorization: Bearer <token>`

- `GET /users/:userId/subscribed-channels/:channelName`
  - Description: Check whether user is subscribed to a channel
  - Headers: `Authorization: Bearer <token>`

- `GET /users/:userId/subscribed-channels/:channelName/videos`
  - Description: Get all videos for one subscribed channel of the user
  - Headers: `Authorization: Bearer <token>`

- `POST /users/:userId/subscribed-channels/:channelName`
  - Description: Subscribe user to a channel (idempotent)
  - Headers: `Authorization: Bearer <token>`

- `DELETE /users/:userId/subscribed-channels/:channelName`
  - Description: Unsubscribe user from a channel
  - Headers: `Authorization: Bearer <token>`

## Run

```bash
npm install
npm start
```

Open docs in browser: `http://localhost:3000/api-docs`

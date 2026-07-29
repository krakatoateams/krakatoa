## ADDED Requirements

### Requirement: Users can connect an Instagram account
The system SHALL let a signed-in user authorize their Instagram Business/Creator account via Instagram Business Login, independent of their login session, and SHALL persist the resulting long-lived `access_token` and expiry in `platform_tokens` under `platform: "instagram"`.

#### Scenario: Successful connect
- **WHEN** a signed-in user completes the Instagram OAuth consent flow
- **THEN** a `platform_tokens` row exists for that user with `platform = "instagram"`, a non-empty `access_token`, and an `expires_at` roughly 60 days out

#### Scenario: CSRF state mismatch is rejected
- **WHEN** the callback's `state` query param does not match the `instagram_oauth_state` cookie
- **THEN** no token exchange occurs and the user is redirected to the settings Connections tab with `error=invalid_state`

#### Scenario: Missing authorization code
- **WHEN** the callback is reached without a `code` query param
- **THEN** the user is redirected to the settings Connections tab with `error=instagram_connect_failed` and no `platform_tokens` row is written

### Requirement: Users can disconnect Instagram
The system SHALL let a signed-in user delete their stored Instagram `platform_tokens` row.

#### Scenario: Disconnect removes the token row
- **WHEN** a signed-in user disconnects Instagram
- **THEN** the `platform_tokens` row for `(user_id, "instagram")` no longer exists

### Requirement: Connection status is queryable
`GET /api/connections/status` SHALL report whether the current user has an Instagram connection alongside the existing YouTube and TikTok fields.

#### Scenario: Status reflects a live connection
- **WHEN** a user has a `platform_tokens` row for `platform "instagram"`
- **THEN** `GET /api/connections/status` returns `instagram: true`

### Requirement: Long-lived tokens are proactively refreshed
The system SHALL periodically refresh a connected user's long-lived Instagram access token before it expires, without waiting for a publish attempt to trigger it.

#### Scenario: Token refreshed ahead of expiry
- **WHEN** a stored Instagram `platform_tokens` row's token is at least 24 hours old and approaching its 60-day expiry
- **THEN** the periodic refresh job calls Instagram's refresh endpoint and updates the stored `access_token` and `expires_at`

### Requirement: Scheduled photo and video/reel posts publish to Instagram
The system SHALL publish a due `posts` row with `platform = "instagram"` by creating a media container, verifying it reaches a `FINISHED` status, and then publishing it — never marking a post "published" before the container is confirmed `FINISHED`.

#### Scenario: Photo post publishes successfully
- **WHEN** a scheduled post has `platform = "instagram"` and a single `photo_urls` entry, and its scheduled time has passed
- **THEN** the cron creates an `IMAGE` container, confirms `status_code = FINISHED`, calls `media_publish`, and marks the post `published` with `instagram_media_id` set

#### Scenario: Video/reel post publishes successfully
- **WHEN** a scheduled post has `platform = "instagram"` and a `video_url`, and its scheduled time has passed
- **THEN** the cron creates a `REELS` container, confirms `status_code = FINISHED` (potentially across multiple cron ticks), calls `media_publish`, and marks the post `published` with `instagram_media_id` set

#### Scenario: Container still processing is not treated as failure or success
- **WHEN** a container's `status_code` is `IN_PROGRESS` on a given cron tick
- **THEN** the post remains `status: "scheduled"` with `instagram_container_id` preserved, and no `media_publish` call is made that tick

#### Scenario: Container error or expiry clears the container ID
- **WHEN** a container's `status_code` is `ERROR` or `EXPIRED`
- **THEN** the post's `instagram_container_id` is cleared and the failure is handled through the existing retry/give-up contract (transient retry, or `failed` once exhausted)

#### Scenario: Already-published posts are never re-published
- **WHEN** a post already has a non-null `instagram_media_id`
- **THEN** the cron marks it `published` without creating a new container or calling `media_publish` again

### Requirement: Instagram is only offered as a schedulable platform once connected
The scheduler SHALL only allow selecting Instagram as a target platform for a post when the current user has a live Instagram connection.

#### Scenario: Instagram unavailable without a connection
- **WHEN** a user has no `platform_tokens` row for `platform = "instagram"`
- **THEN** the scheduler does not offer Instagram as a selectable platform for any post

## ADDED Requirements

### Requirement: Due TikTok posts are automatically published
When a scheduled `posts` row targets `platform: "tiktok"` and its `scheduled_time` has passed, the cron SHALL publish it to TikTok via the Content Posting API, following the same claim-lock and retry contract already used for YouTube.

#### Scenario: Due TikTok post publishes
- **WHEN** a `posts` row has `platform = "tiktok"`, `status = "scheduled"`, and a past `scheduled_time`
- **THEN** the cron refreshes the stored TikTok token, initiates a Direct Post upload, and on success marks the row `status = "published"` with `tiktok_publish_id` set

#### Scenario: Already-published post is never re-published
- **WHEN** a claimed post already has `tiktok_publish_id` set
- **THEN** the cron marks it published without calling the TikTok API again

### Requirement: Rotated refresh token is persisted before publish is attempted
The system SHALL persist a newly-rotated TikTok `refresh_token` to `platform_tokens` immediately after a refresh call succeeds, before attempting to publish with the resulting access token.

#### Scenario: Publish fails after a successful refresh
- **WHEN** `refreshAccessToken` succeeds but the subsequent publish call fails
- **THEN** the rotated `refresh_token` is already stored in `platform_tokens`, so a later retry does not fail due to an invalidated refresh token

### Requirement: Privacy level is chosen by the user at schedule time
The system SHALL NOT silently default a TikTok post's `privacy_level`. When a user schedules a post targeting TikTok, the scheduler SHALL require a privacy-level selection sourced from the connected account's own Creator Info options, and store it on the post.

#### Scenario: TikTok post requires a privacy level
- **WHEN** a user selects TikTok as the platform while scheduling
- **THEN** the scheduler shows the connected account's available privacy levels and requires one to be chosen before the post can be scheduled

### Requirement: TikTok is only selectable when connected
The scheduler SHALL only offer TikTok as a platform choice when the current user has a live TikTok connection.

#### Scenario: No TikTok connection
- **WHEN** a user without a `platform_tokens` row for `platform = "tiktok"` opens the scheduler
- **THEN** TikTok does not appear as a selectable platform option

### Requirement: Publish completion is optimistic
The system SHALL consider a TikTok post published once Init Direct Post returns a `publish_id`, without polling TikTok for final processing confirmation.

#### Scenario: Init succeeds
- **WHEN** Init Direct Post returns a `publish_id`
- **THEN** the post is marked `status = "published"` immediately, regardless of TikTok's later, asynchronous processing outcome

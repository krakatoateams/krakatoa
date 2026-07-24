## ADDED Requirements

### Requirement: Verified-domain photo proxy for TikTok's PULL_FROM_URL

The system SHALL serve TikTok-bound photo URLs through a Kelolako-controlled route under a domain verified in the TikTok Developer Portal, rather than handing TikTok a third-party storage domain URL directly. The route SHALL stream the image bytes directly and SHALL NOT redirect.

#### Scenario: Proxy serves a valid photo without redirecting
- **WHEN** the proxy route is requested for a path that resolves to an existing photo under the storage bucket's `photos/` prefix
- **THEN** the response is a direct `200` with the image bytes and correct `Content-Type`
- **AND** the response is not a redirect (no `3xx` status)

#### Scenario: Proxy refuses paths outside the photos prefix
- **WHEN** the proxy route is requested with a path that does not resolve under the storage bucket's `photos/` prefix
- **THEN** the request is rejected (the route never behaves as an open arbitrary-URL fetch proxy)

### Requirement: Scheduled TikTok photo posts publish via the Content Posting API's photo endpoint

The system SHALL publish a due `posts` row targeting TikTok with one or more photo URLs using `POST /v2/post/publish/content/init/` (`media_type: "PHOTO"`, `post_mode: "DIRECT_POST"`, `source_info.source: "PULL_FROM_URL"`), following the same claim-lock/retry/idempotency contract already used for TikTok video posts.

#### Scenario: A due photo post is published
- **WHEN** cron finds a due `posts` row with `platform: "tiktok"` and a non-empty `photo_urls`
- **THEN** it calls the photo publish path (not the video path) with the photo URLs mapped through the verified proxy
- **AND** on a successful Init response, the post is marked `published` and `tiktok_publish_id` is stored, mirroring the existing video/YouTube idempotency pattern

#### Scenario: A due video post is unaffected
- **WHEN** cron finds a due `posts` row with `platform: "tiktok"` and `video_url` set (no `photo_urls`)
- **THEN** it calls the existing, unchanged video publish path exactly as before this change

#### Scenario: Photo posts reuse privacy and disclosure validation unchanged
- **WHEN** a TikTok photo post has `tiktok_brand_content_toggle: true` and `tiktok_privacy_level: "SELF_ONLY"`
- **THEN** the publish call is rejected before reaching TikTok, identically to how this combination is already rejected for video posts

#### Scenario: Photo post completion is optimistic, matching video
- **WHEN** the photo Init call returns a `publish_id`
- **THEN** the post is immediately marked `published`
- **AND** no call is made to TikTok's publish-status endpoint to confirm final processing (same accepted trade-off as TikTok video posts)

### Requirement: Scheduler supports selecting multiple photos for a single TikTok post

The scheduler UI SHALL allow choosing "Photo" as the content type when TikTok is the selected platform, and selecting multiple photos (up to TikTok's documented limit of 35) for that single post.

#### Scenario: User selects multiple photos for a TikTok post
- **WHEN** a user selects TikTok as the platform and "Photo" as the content type
- **THEN** a multi-select picker over the user's generated photos is shown (checkboxes, not the single-select pattern used for video)
- **AND** the selected photos, in selection order, become `photo_urls` on the created post

#### Scenario: Existing privacy/disclosure UI applies unchanged to photo posts
- **WHEN** "Photo" content type is selected for a TikTok post
- **THEN** the same required privacy-level dropdown and content-disclosure toggle (with "Your Brand"/"Branded Content" sub-checkboxes and the `SELF_ONLY`-disables-Branded-Content rule) already built for video posts are shown and behave identically

#### Scenario: No Duet/Stitch controls shown for photo posts
- **WHEN** "Photo" content type is selected
- **THEN** no Duet/Stitch related controls are rendered (neither exists in TikTok's photo post fields, and neither is currently exposed for video either)

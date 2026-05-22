## ADDED Requirements

### Requirement: Persist YouTube video ID on publish

When the cron job successfully uploads a post to YouTube, the system SHALL store the returned YouTube video ID on the post record.

#### Scenario: Successful cron publish

- **WHEN** cron uploads a scheduled post to YouTube successfully
- **THEN** the post `status` is set to `published`
- **AND** `youtube_video_id` is set to the returned video ID

### Requirement: View on YouTube in calendar

The scheduler calendar post detail modal SHALL show a link to watch the video on YouTube when a YouTube video ID exists.

#### Scenario: Published post with YouTube ID

- **WHEN** user opens a post with `status` published and non-null `youtube_video_id`
- **THEN** the modal displays a "View on YouTube" link to `https://www.youtube.com/watch?v={youtube_video_id}`

#### Scenario: Published post without YouTube ID

- **WHEN** user opens a published post with null `youtube_video_id` (legacy)
- **THEN** no "View on YouTube" link is shown
- **AND** "View source video" link to `video_url` remains available

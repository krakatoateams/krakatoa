## ADDED Requirements

### Requirement: Scheduled uploads publish as public

When the system uploads a scheduled video to YouTube, it SHALL set the video's privacy status to `public`.

#### Scenario: Due post publishes publicly
- **WHEN** the cron uploads a due scheduled post to YouTube
- **THEN** the created YouTube video's privacy status is `public`

### Requirement: Post format is persisted

The `posts` record SHALL be able to store a `format` value of `short` or `video`. When the scheduler creates a post, it SHALL send the card's chosen format, and the API SHALL store it. An absent or invalid format SHALL be stored as null without failing the request.

#### Scenario: Short is recorded
- **WHEN** a post is scheduled from a card whose format is "Short"
- **THEN** the created post row has `format = 'short'`

#### Scenario: Video is recorded
- **WHEN** a post is scheduled from a card whose format is "Video"
- **THEN** the created post row has `format = 'video'`

#### Scenario: Missing/invalid format is tolerated
- **WHEN** a post is created without a valid format value
- **THEN** the post is still created and its `format` is null

#### Scenario: Legacy posts remain valid
- **WHEN** the migration adds the `format` column to an existing table
- **THEN** pre-existing rows remain valid with `format` null

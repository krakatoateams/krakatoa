## ADDED Requirements

### Requirement: Recent posts list on scheduler dashboard
The scheduler dashboard SHALL display the user's most recent posts below the create form, showing status and available actions.

#### Scenario: Posts are loaded on mount
- **WHEN** the scheduler dashboard page loads
- **THEN** the system SHALL fetch posts from `/api/posts` and display up to 5 sorted by `scheduled_time` descending

#### Scenario: Post shows correct status badge
- **WHEN** a post has `status = "scheduled"`
- **THEN** a blue "Scheduled" badge SHALL be displayed

#### Scenario: Published post shows YouTube link
- **WHEN** a post has `status = "published"` and a non-null `youtube_video_id`
- **THEN** a "View on YouTube" link SHALL be displayed linking to `https://www.youtube.com/watch?v={id}`

#### Scenario: Failed post shows retry action
- **WHEN** a post has `status = "failed"`
- **THEN** a "Retry" button SHALL be displayed that resets the post status to `scheduled` via `PATCH /api/posts/:id`

#### Scenario: Auto-refresh
- **WHEN** 30 seconds have elapsed since the last fetch
- **THEN** the posts list SHALL re-fetch automatically without user interaction

#### Scenario: More than 5 posts exist
- **WHEN** the user has more than 5 posts
- **THEN** only the 5 most recent SHALL be shown
- **AND** a "View all in Calendar →" link SHALL be displayed linking to `/tools/scheduler/calendar`

#### Scenario: No posts yet
- **WHEN** the user has no posts
- **THEN** an empty state message SHALL be shown (e.g. "No posts yet. Schedule your first video above.")

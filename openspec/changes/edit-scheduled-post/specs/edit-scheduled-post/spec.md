## ADDED Requirements

### Requirement: Edit a not-yet-published post

The system SHALL allow editing a post's title, description, tags, scheduled date/time, and format while the post's status is `scheduled` or `failed`. Edits SHALL be rejected when the post is `published`. Ownership SHALL be enforced.

#### Scenario: Edit a scheduled post
- **WHEN** the owner edits the title/caption/tags/time/format of a `scheduled` post
- **THEN** the post is updated and the changes are reflected in the scheduler and calendar

#### Scenario: Edit a failed post re-arms it
- **WHEN** the owner saves an edit to a `failed` post
- **THEN** the changes are saved AND the post is re-armed to `scheduled` with `publish_attempts` reset to 0 and `last_error` cleared, so the publisher retries cleanly

#### Scenario: Published posts are locked
- **WHEN** an edit is attempted on a `published` post
- **THEN** the request is rejected and the post is unchanged

#### Scenario: A post being published is locked
- **WHEN** an edit or cancel is attempted on a post the publisher has claimed (`publish_started_at` set and still within the staleness window)
- **THEN** the request is rejected and the post is unchanged

#### Scenario: Format is validated on edit
- **WHEN** an edit includes a format value
- **THEN** only `short` or `video` is accepted; any other value is ignored

### Requirement: Re-arming a post resets the retry counter

When a post's status is set back to `scheduled` (via Retry or via saving an edited `failed` post), the system SHALL reset `publish_attempts` to 0 and clear `last_error`, so the bounded-retry publisher gives the post a fresh set of attempts.

#### Scenario: Retry after exhausting attempts
- **WHEN** a post that failed after reaching the max attempts is re-armed to `scheduled`
- **THEN** `publish_attempts` is 0 and `last_error` is null, and the publisher attempts it again rather than immediately giving up

### Requirement: Cancel a scheduled post

The system SHALL allow the owner to cancel a `scheduled` or `failed` post so it will no longer be published, and the cron SHALL no longer pick it up.

#### Scenario: Cancel removes it from the publish queue
- **WHEN** the owner cancels a `scheduled` post
- **THEN** the post is no longer in the set the publisher processes, and the UI reflects it as canceled/removed

#### Scenario: Cannot cancel a published post
- **WHEN** cancel is attempted on a `published` post
- **THEN** the request is rejected

#### Scenario: Canceled posts are shown, not hidden
- **WHEN** a post has been canceled
- **THEN** it appears with a muted "Canceled" status in the scheduler list and calendar (so the action is visible), and the publisher's `scheduled` due-query excludes it

## ADDED Requirements

### Requirement: Edit a not-yet-published post

The system SHALL allow editing a post's title, description, tags, scheduled date/time, and format while the post's status is `scheduled` or `failed`. Edits SHALL be rejected when the post is `published`. Ownership SHALL be enforced.

#### Scenario: Edit a scheduled post
- **WHEN** the owner edits the title/caption/tags/time/format of a `scheduled` post
- **THEN** the post is updated and the changes are reflected in the scheduler and calendar

#### Scenario: Edit a failed post
- **WHEN** the owner edits a `failed` post
- **THEN** the changes are saved (enabling a corrected retry)

#### Scenario: Published posts are locked
- **WHEN** an edit is attempted on a `published` post
- **THEN** the request is rejected and the post is unchanged

#### Scenario: Format is validated on edit
- **WHEN** an edit includes a format value
- **THEN** only `short` or `video` is accepted; any other value is ignored

### Requirement: Cancel a scheduled post

The system SHALL allow the owner to cancel a `scheduled` or `failed` post so it will no longer be published, and the cron SHALL no longer pick it up.

#### Scenario: Cancel removes it from the publish queue
- **WHEN** the owner cancels a `scheduled` post
- **THEN** the post is no longer in the set the publisher processes, and the UI reflects it as canceled/removed

#### Scenario: Cannot cancel a published post
- **WHEN** cancel is attempted on a `published` post
- **THEN** the request is rejected

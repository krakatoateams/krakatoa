## ADDED Requirements

### Requirement: Due posts publish automatically

The system SHALL trigger the publisher on a recurring cadence of at most a few minutes so that posts whose scheduled time has passed are uploaded without manual intervention.

#### Scenario: A due post is published without manual action
- **WHEN** a post's `scheduled_time` has passed and its status is `scheduled`
- **THEN** within the trigger cadence the publisher uploads it and sets status to `published` (or `failed` if the upload is rejected)

#### Scenario: Trigger is authenticated
- **WHEN** the publisher endpoint is invoked by the external trigger
- **THEN** it requires the `CRON_SECRET` bearer token and rejects unauthenticated calls

### Requirement: Publisher stays within platform runtime limits

Each publisher invocation SHALL process a bounded number of due posts and SHALL declare a runtime within the hosting plan's cap, so that a single run cannot time out the whole batch.

#### Scenario: Backlog drains across runs
- **WHEN** more due posts exist than the per-run limit
- **THEN** each invocation processes up to the limit and the remainder are handled by subsequent invocations

### Requirement: Overdue posts are visually distinct from failed

The UI SHALL present a post as "overdue/processing" when its status is `scheduled` and its `scheduled_time` is in the past, distinct from `failed`. This SHALL be a derived display state and SHALL NOT change the stored status.

#### Scenario: Past-due, not-yet-processed post
- **WHEN** a post is `scheduled` and its `scheduled_time` is in the past
- **THEN** the UI labels it overdue/processing (not "failed" and not a plain "scheduled" that looks stuck)

#### Scenario: Genuinely failed post
- **WHEN** the publisher attempted an upload and it was rejected
- **THEN** the post shows as `failed`

### Requirement: A post is never published twice

The publisher SHALL claim a post before uploading and SHALL NOT upload a post that another run has already claimed or already uploaded, so that overlapping or retried invocations cannot create duplicate YouTube uploads.

#### Scenario: Overlapping runs do not double-upload
- **WHEN** two publisher invocations see the same due post
- **THEN** only one claims it and uploads; the other skips it

#### Scenario: Already-uploaded post is not re-uploaded
- **WHEN** a claimed post already has a `youtube_video_id`
- **THEN** the publisher marks it `published` without uploading again

#### Scenario: A claim that never completed becomes retryable
- **WHEN** a claimed post's upload did not finish and its claim is older than the stale window
- **THEN** a later invocation may re-claim and retry it

### Requirement: Failure reason is stored and shown

When an upload fails the system SHALL store the failure reason on the post and the UI SHALL surface it, so users understand why a post did not publish.

#### Scenario: Failed post explains itself
- **WHEN** a post lands `failed`
- **THEN** the stored failure reason is visible in the scheduler list and the calendar detail view

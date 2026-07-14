## ADDED Requirements

### Requirement: Existence check at schedule time

The system SHALL verify, before inserting a new `posts` row, that a `videos/`-bucket video URL still resolves to an existing Supabase Storage object. Verification SHALL query the Storage API directly (not fetch the public CDN URL), consistent with the reference-checking approach already used by the storage sweep.

#### Scenario: Scheduling a video that no longer exists is rejected
- **WHEN** a schedule request resolves to a `video_url` (manual or asset-derived) pointing at the app's own storage bucket, and the Storage API confirms no object exists at that path
- **THEN** the request is rejected with `422` and a message telling the user to re-upload or regenerate the video
- **AND** no `posts` row is created

#### Scenario: Scheduling a video that exists succeeds unchanged
- **WHEN** a schedule request resolves to a `video_url` whose object is confirmed present
- **THEN** scheduling proceeds exactly as before this change

#### Scenario: Ambiguous or unparseable URL does not block scheduling
- **WHEN** the existence check cannot determine the result (Storage API error, or the URL does not parse to a path in the app's bucket)
- **THEN** scheduling proceeds unchanged — the check fails open

### Requirement: Existence check immediately before each publish attempt

The system SHALL re-verify, immediately before calling the platform publish API (YouTube or TikTok) for a due post, that the post's video object still exists in storage.

#### Scenario: Video deleted after scheduling is caught before the platform call
- **WHEN** a due post's video object is confirmed absent at publish time
- **THEN** the platform publish API (YouTube/TikTok) is never called for that attempt
- **AND** the failure is recorded via the normal failure path with a message stating the video no longer exists in storage

### Requirement: A confirmed-missing video is a permanent publish failure

A publish failure caused by a confirmed-missing storage object SHALL be classified as permanent, so it does not consume the transient-failure retry budget.

#### Scenario: Missing video fails on the first attempt, not after exhausting retries
- **WHEN** the pre-publish existence check (or, as a fallback, the platform-upload code's own storage-download step) reports the video is missing
- **THEN** the post is marked `failed` on that attempt
- **AND** `publish_attempts` reflects a single attempt, not the full `MAX_PUBLISH_ATTEMPTS` retry budget

#### Scenario: Fallback classification catches a missing video even if the pre-check is bypassed
- **WHEN** the publish flow reaches the platform-upload code's own storage-download step (bypassing or racing the pre-check) and that step fails with its existing "could not fetch video from storage" error
- **THEN** the failure is still classified as permanent and does not retry

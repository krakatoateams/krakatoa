## ADDED Requirements

### Requirement: Automated storage sweep endpoint

The system SHALL provide a server endpoint `GET /api/cron/storage-sweep` that removes transient and orphaned objects from the `videos/` folder of the storage bucket. The endpoint SHALL be safe to invoke unattended on a schedule.

#### Scenario: Orphan video older than the age threshold is removed
- **WHEN** the sweep runs and a `videos/` object is not referenced by any `posts`, `user_creations`, or `storyboards` row AND its storage age exceeds the minimum age threshold
- **THEN** the object is deleted from the bucket
- **AND** the response reports it under the deleted count

#### Scenario: Transient temp file is removed
- **WHEN** the sweep runs and an object exists under `videos/temp/` older than the age threshold
- **THEN** the object is deleted regardless of references

#### Scenario: Referenced video is preserved
- **WHEN** a `videos/` object's path or filename appears in any referenced URL/path from the known tables
- **THEN** the object is NOT deleted, even if old

### Requirement: Age guard protects in-progress uploads

The sweep SHALL NOT delete an unreferenced object whose storage age is at or below the minimum age threshold (default 24 hours), so that a freshly uploaded file being captioned/scheduled in the same session is never removed.

#### Scenario: Freshly uploaded, not-yet-scheduled file is kept
- **WHEN** a video was uploaded minutes ago and has not yet been scheduled (so it is unreferenced)
- **THEN** the sweep does NOT delete it because it is younger than the threshold

#### Scenario: Missing timestamp is treated as too-new
- **WHEN** an object has neither a `created_at` nor `updated_at` timestamp available
- **THEN** the sweep skips it (does not delete)

### Requirement: Conservative reference matching

The sweep SHALL treat an object as referenced if any reference string contains the object's full storage path OR its basename, including URL-decoded variants. When in doubt, the object SHALL be kept.

#### Scenario: Public URL reference is detected
- **WHEN** a post's `video_url` is a public URL that contains the object's storage path
- **THEN** the object is considered referenced and kept

#### Scenario: Basename fallback keeps ambiguous matches
- **WHEN** an object's basename appears in any reference string but its full path does not
- **THEN** the object is considered referenced and kept

### Requirement: Dry-run mode

The endpoint SHALL accept a `?dryRun=1` query parameter that returns the planned deletions (paths, counts, reclaimable bytes) WITHOUT deleting anything.

#### Scenario: Dry run reports without deleting
- **WHEN** the endpoint is called with `?dryRun=1`
- **THEN** the response lists what would be deleted and reclaimable size
- **AND** no objects are removed from the bucket

### Requirement: Protected trigger

When `CRON_SECRET` is set, the endpoint SHALL require an `Authorization: Bearer <CRON_SECRET>` header and SHALL reject mismatches with HTTP 401. When `CRON_SECRET` is unset (local dev), the endpoint SHALL allow the request.

#### Scenario: Unauthorized request is rejected
- **WHEN** `CRON_SECRET` is set and a request arrives without the matching Bearer token
- **THEN** the endpoint responds with HTTP 401 and performs no deletion

#### Scenario: Authorized request proceeds
- **WHEN** `CRON_SECRET` is set and the request carries the matching Bearer token
- **THEN** the sweep runs

## ADDED Requirements

### Requirement: Retrying a partially-failed multi-platform schedule never resubmits an already-succeeded platform
When a video is scheduled to more than one platform and only some of those `POST /api/posts` requests succeed, the system SHALL track success per platform and SHALL only resubmit the platform(s) that failed on any subsequent retry (re-clicking "Schedule Post" or "Schedule All").

#### Scenario: Bulk retry after partial failure
- **WHEN** a bulk-mode card targeting YouTube and TikTok has its YouTube post created successfully but its TikTok post fails
- **AND** the user clicks "Schedule All" again
- **THEN** no new YouTube post is created, and only a TikTok post is attempted

#### Scenario: Single-mode retry after partial failure
- **WHEN** a single-mode schedule targeting YouTube and TikTok has its YouTube post created successfully but its TikTok post fails
- **AND** the user clicks "Schedule Post" again without changing the form
- **THEN** no new YouTube post is created, and only a TikTok post is attempted

#### Scenario: Full success after retry marks the item scheduled
- **WHEN** a previously partially-failed item's remaining platform(s) succeed on retry
- **THEN** the item's aggregate status becomes "scheduled" and it is no longer a retry target

### Requirement: Bulk mode shows per-platform status when more than one platform is selected
The scheduler SHALL display an aggregate single-platform status badge when a card targets exactly one platform (unchanged from prior behavior), and SHALL display a per-platform status breakdown when a card targets more than one platform.

#### Scenario: Single-platform card is unchanged
- **WHEN** a bulk-mode card targets only one platform
- **THEN** it shows the existing single "Scheduling…"/"Scheduled ✅"/"Failed ❌" badge, with no per-platform breakdown

#### Scenario: Multi-platform card shows a breakdown
- **WHEN** a bulk-mode card targets two platforms and one has succeeded while the other has failed
- **THEN** the card shows the status of each platform individually (e.g. which succeeded and which failed, with that platform's error)

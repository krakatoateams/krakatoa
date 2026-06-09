## ADDED Requirements

### Requirement: Asset source toggle in the Upload section

The scheduler's Upload section SHALL offer two sources via a tab toggle — "Upload from device" and "My Assets" — and this toggle SHALL be available in both single mode and bulk mode. The "Upload from device" tab SHALL preserve the existing drag/drop + file-picker behavior unchanged.

#### Scenario: Tabs visible in single mode
- **WHEN** the scheduler is in single mode (one item)
- **THEN** the Upload section shows both "Upload from device" and "My Assets" tabs
- **AND** "Upload from device" is the default tab with the existing drop zone

#### Scenario: Tabs visible in bulk mode
- **WHEN** the scheduler is in bulk mode (2–5 items)
- **THEN** the Upload section shows both tabs
- **AND** selecting an asset adds to the existing set of cards

### Requirement: Video-only asset gallery

The "My Assets" tab SHALL embed the existing creations gallery filtered to video creations only (`reels_seedance`, `reels_veo`, `storyboard_video`) and SHALL NOT show image creations.

#### Scenario: Only video creations are listed
- **WHEN** the user opens the "My Assets" tab
- **THEN** the gallery requests `mediaType=video` for the three video tools
- **AND** image creations (product_photo, storyboard) do not appear

### Requirement: Single-pick appends one schedulable item

Selecting one asset SHALL produce exactly one schedulable video item without a device upload. The item SHALL set `videoUrl` to the asset's `mediaUrl`, mark upload status as done, and carry no `File`. Multi-select SHALL NOT be supported in this version.

#### Scenario: Pick an asset in single mode
- **WHEN** the user selects an asset while in single mode
- **THEN** the single item's `videoUrl` is set to the asset's `mediaUrl`
- **AND** its upload status is "done" with no `/api/upload` request made

#### Scenario: Pick an asset in bulk mode
- **WHEN** the user selects an asset while in bulk mode and fewer than 5 videos exist
- **THEN** a new video card is appended with `videoUrl` set to the asset's `mediaUrl` and status "done"

#### Scenario: Respect the 5-video limit
- **WHEN** the user selects an asset while 5 videos already exist
- **THEN** no new card is added and the user is informed the limit is reached

### Requirement: Duration capture and Shorts guard for assets

The system SHALL capture the asset video's duration from its URL metadata and SHALL apply the existing "under 60s" Shorts guard, surfacing the amber warning when the duration exceeds 60 seconds.

#### Scenario: Asset under 60s
- **WHEN** a picked asset's measured duration is 60 seconds or less
- **THEN** no duration warning is shown and the item is eligible to schedule

#### Scenario: Asset over 60s
- **WHEN** a picked asset's measured duration exceeds 60 seconds
- **THEN** the amber ">60s / Shorts must be under 60 seconds" warning is shown for that card

#### Scenario: Duration unavailable
- **WHEN** the asset's duration cannot be read from metadata
- **THEN** duration remains unknown and the item is still schedulable (no false warning)

### Requirement: Asset preview without a File

An asset-backed item SHALL display a video preview sourced from its `videoUrl` even though it has no `File`, while file-backed items SHALL continue to preview from their local object URL.

#### Scenario: Asset preview renders
- **WHEN** an item has a `videoUrl` from an asset and no `File`
- **THEN** the card renders a `<video>` preview using that `videoUrl`

#### Scenario: Device upload preview unchanged
- **WHEN** an item was created from a device upload (has a `File`)
- **THEN** its preview continues to use the local object URL exactly as before

### Requirement: Preserve existing scheduler behavior

This change SHALL NOT alter caption generation/polish, the `DescriptionCard`, the `/api/upload` device-upload pipeline and its validation, `ScheduleCard` scheduling, or Schedule All.

#### Scenario: Caption and scheduling untouched
- **WHEN** the asset feature is used
- **THEN** caption Generate/Polish, single-mode scheduling, and bulk Schedule All behave exactly as they did before

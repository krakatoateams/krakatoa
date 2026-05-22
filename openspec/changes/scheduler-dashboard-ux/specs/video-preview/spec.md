## ADDED Requirements

### Requirement: Instant video preview on file select
The scheduler dashboard SHALL display a video preview immediately when a file is selected, before the upload completes.

#### Scenario: File selected
- **WHEN** the user selects or drops a valid video file
- **THEN** an HTML5 `<video>` player SHALL render using `URL.createObjectURL(file)` with `controls` and a max height of 200px

#### Scenario: Duration displayed
- **WHEN** the video metadata loads (onLoadedMetadata)
- **THEN** the video duration SHALL be displayed in human-readable form (e.g. "0:42")

#### Scenario: Duration exceeds 60 seconds
- **WHEN** the loaded video duration is greater than 60 seconds
- **THEN** a warning SHALL be shown: "⚠️ Video is Xs — YouTube Shorts requires under 60s"
- **AND** the Schedule Post button SHALL be disabled

#### Scenario: Duration within limit
- **WHEN** the loaded video duration is 60 seconds or less
- **THEN** no warning SHALL be shown and the Schedule Post button SHALL not be disabled by duration

#### Scenario: File removed or reset
- **WHEN** the user removes the selected file or a new file is selected
- **THEN** the previous object URL SHALL be revoked to prevent memory leaks
- **AND** the preview SHALL be cleared

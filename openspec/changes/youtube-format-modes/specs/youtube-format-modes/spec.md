## ADDED Requirements

### Requirement: Per-card format selection

Each schedulable video card SHALL offer a format toggle with two options — "Short" and "Video" — available in both single and bulk mode. The selected format SHALL be stored per item.

#### Scenario: Toggle available in single mode
- **WHEN** the scheduler is in single mode
- **THEN** the card shows a Short / Video toggle reflecting the item's current format

#### Scenario: Toggle available per card in bulk mode
- **WHEN** the scheduler is in bulk mode with multiple cards
- **THEN** each card shows its own Short / Video toggle and they can differ between cards

### Requirement: Metadata-based auto-suggest with override

The system SHALL capture the video's aspect ratio and duration and SHALL suggest a format: portrait (height > width) AND duration ≤ 3 minutes suggests "Short"; landscape OR duration > 3 minutes suggests "Video". The suggestion SHALL apply only until the user manually overrides the format for that card, after which the manual choice SHALL persist.

#### Scenario: Vertical short clip suggests Short
- **WHEN** a loaded video is portrait and 3 minutes or shorter and the user has not overridden the format
- **THEN** the card's format is set to "Short"

#### Scenario: Landscape or long clip suggests Video
- **WHEN** a loaded video is landscape OR longer than 3 minutes and the user has not overridden the format
- **THEN** the card's format is set to "Video"

#### Scenario: Manual override wins
- **WHEN** the user toggles a card's format manually
- **THEN** later metadata-based suggestions do NOT change that card's format

### Requirement: Duration does not block scheduling

Scheduling SHALL be permitted based on a hosted video, a title, a date, and a time only. Video duration SHALL NOT disable the schedule action in either single or bulk mode.

#### Scenario: Long video can be scheduled
- **WHEN** a card has a valid video URL, title, date, and time but a duration over 60 seconds
- **THEN** the schedule action is enabled

### Requirement: Mode-aware advisory warnings

The system SHALL show advisory (non-blocking) warnings based on format and metadata. A "Short" longer than 3 minutes SHALL warn that it will publish as a regular video. A "Short" that is known to be non-vertical SHALL warn that Shorts should be 9:16. A "Video" SHALL NOT show duration or aspect warnings. Unknown duration or aspect SHALL NOT produce a warning.

#### Scenario: Short over 3 minutes warns
- **WHEN** a card's format is "Short" and its duration exceeds 3 minutes
- **THEN** an advisory warning is shown and scheduling remains enabled

#### Scenario: Non-vertical Short warns only
- **WHEN** a card's format is "Short" and its measured aspect is not portrait
- **THEN** an advisory warning is shown and scheduling remains enabled

#### Scenario: Video shows no format warning
- **WHEN** a card's format is "Video"
- **THEN** no duration or aspect warning is shown

### Requirement: Adaptive preview frame

The card preview SHALL use a 9:16 frame when the format is "Short" and a 16:9 frame when the format is "Video".

#### Scenario: Short preview is vertical
- **WHEN** a card's format is "Short"
- **THEN** its preview is rendered in a 9:16 frame

#### Scenario: Video preview is widescreen
- **WHEN** a card's format is "Video"
- **THEN** its preview is rendered in a 16:9 frame

### Requirement: Mode-aware caption generation

Caption generation SHALL accept the card's format. For "Short" it SHALL produce a punchy hook + hashtags including `#Shorts`. For "Video" it SHALL produce a longer-form description without a forced `#Shorts`.

#### Scenario: Short caption style
- **WHEN** caption generation is requested for a "Short"
- **THEN** the prompt produces short-form copy with `#Shorts`-style hashtags

#### Scenario: Video caption style
- **WHEN** caption generation is requested for a "Video"
- **THEN** the prompt produces a longer description and does not force `#Shorts`

### Requirement: Automatic #Shorts tagging on schedule

When a card with format "Short" is scheduled, the system SHALL ensure its description contains `#Shorts`, appending it if absent, before creating the post. A "Video" SHALL NOT have `#Shorts` appended.

#### Scenario: Short gets #Shorts appended
- **WHEN** a "Short" is scheduled and its description does not already contain `#Shorts`
- **THEN** `#Shorts` is appended to the description sent to the posts API

#### Scenario: Video is untouched
- **WHEN** a "Video" is scheduled
- **THEN** no `#Shorts` is appended

### Requirement: ReelsGen can schedule 16:9 output

The ReelsGen result view SHALL show the "Schedule to YouTube" action for storyboard (16:9) output, not only vertical reels.

#### Scenario: Storyboard result shows schedule action
- **WHEN** a storyboard (16:9) video result is shown in ReelsGen
- **THEN** the "Schedule to YouTube" action is available and links to the scheduler

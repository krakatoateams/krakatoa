## ADDED Requirements

### Requirement: Schedule-to-YouTube button on reel results

ReelsGen SHALL show a "Schedule to YouTube" action on the generated-video result, and that action SHALL be present ONLY when a video result exists AND the result is a vertical 9:16 reel (not a 16:9 storyboard clip).

#### Scenario: Button shown for a reel result
- **WHEN** a Seedance or Veo generation completes and the result is a vertical reel
- **THEN** the "Final Result" card shows a "Schedule to YouTube" action alongside the existing download/save controls

#### Scenario: Button hidden for storyboard results
- **WHEN** the current result is a 16:9 storyboard video
- **THEN** the "Schedule to YouTube" action is NOT shown

#### Scenario: Button hidden when no result exists
- **WHEN** no video has been generated yet (no result URL)
- **THEN** the "Schedule to YouTube" action is NOT shown

### Requirement: Deep link to the scheduler with asset and title

Activating "Schedule to YouTube" SHALL navigate to the scheduler route with the hosted video URL passed as `assetUrl` and the generation theme passed as `title`, both URL-encoded.

#### Scenario: Navigate with asset and title
- **WHEN** the user activates "Schedule to YouTube" for a reel whose hosted URL is U and theme is T
- **THEN** the app navigates to `/tools/scheduler?assetUrl=<encoded U>&title=<encoded T>`

#### Scenario: Empty theme omits or empties the title
- **WHEN** the generation theme is empty
- **THEN** the navigation still passes `assetUrl` and the title param is empty or omitted

### Requirement: Scheduler consumes the deep-link asset once

The scheduler SHALL read `assetUrl` from the URL on load and load it as a schedulable item via the existing asset-selection entry point, exactly once per navigation, without issuing a device upload.

#### Scenario: Asset pre-loaded on arrival
- **WHEN** the scheduler is opened with a valid `assetUrl` query param
- **THEN** the decoded URL is loaded as a schedulable video item (upload status "done", no `/api/upload` request)
- **AND** the asset appears as a card ready to schedule

#### Scenario: Applied exactly once
- **WHEN** the scheduler component re-renders or effects are re-invoked (including React StrictMode double-invocation)
- **THEN** the `assetUrl` is applied only once and the asset is not added more than once

#### Scenario: No param, no change
- **WHEN** the scheduler is opened without an `assetUrl` query param
- **THEN** no asset is auto-loaded and the page behaves exactly as before

### Requirement: Title pre-fill from the deep link

When a `title` query param is present, the scheduler SHALL pre-fill the title field of the card created from the deep-linked asset.

#### Scenario: Title pre-filled
- **WHEN** the scheduler is opened with both `assetUrl` and a non-empty `title`
- **THEN** the resulting asset card's title field is pre-filled with the decoded title

#### Scenario: Missing title leaves the field blank
- **WHEN** the scheduler is opened with `assetUrl` but no `title` (or an empty one)
- **THEN** the resulting card's title is left blank

### Requirement: Search-param reader under a Suspense boundary

The component that reads the scheduler's URL query params SHALL be rendered within a Suspense boundary, satisfying the framework requirement and isolating dynamic rendering to that subtree.

#### Scenario: Param reader is suspense-wrapped
- **WHEN** the scheduler page renders the query-param intake logic
- **THEN** that logic is contained in a child component wrapped in a Suspense boundary
- **AND** the rest of the scheduler renders unaffected when no params are present

### Requirement: Preserve existing reel and scheduler behavior

This change SHALL NOT alter video generation, the scheduler's existing upload/asset selection, caption generation, or scheduling logic beyond adding the button and the deep-link intake.

#### Scenario: Existing flows unchanged
- **WHEN** the deep-link feature is not used
- **THEN** ReelsGen generation, the scheduler's device-upload and "My Assets" selection, caption Generate/Polish, and Schedule/Schedule All behave exactly as before

## ADDED Requirements

### Requirement: Storyboard image API

The system SHALL expose `POST /api/generate-storyboard` that accepts JSON `{ "theme": string }` and returns JSON `{ "storyboardUrl": string }` on success.

The handler SHALL require a non-empty trimmed `theme`, call Replicate model `openai/gpt-image-2` with a prompt that instructs a single image containing **six** storyboard panels for a **15-second** video about the theme. Each panel SHALL be described as including scene number, timestamp range, visual description, and character dialogue, in a **cinematic storyboard sketch with annotations** style.

The handler SHALL persist the resulting image to Supabase Storage bucket `krakatoa` (or `SUPABASE_STORAGE_BUCKET` override) at path `videos/storyboard/storyboard_<timestamp>.png` and SHALL return a stable public HTTPS URL for that object as `storyboardUrl`.

#### Scenario: Successful storyboard generation

- **WHEN** the client sends `POST /api/generate-storyboard` with a valid non-empty `theme` and server credentials are configured
- **THEN** the response status is 200 and the body includes `storyboardUrl` pointing to the uploaded PNG

#### Scenario: Missing theme rejected

- **WHEN** the client sends `POST /api/generate-storyboard` with missing or whitespace-only `theme`
- **THEN** the response status is 400 and the body explains the validation error

### Requirement: Storyboard video API

The system SHALL expose `POST /api/generate-storyboard-video` that accepts JSON `{ "theme": string, "storyboardUrl": string }` and returns JSON `{ "videoUrl": string }` on success.

The handler SHALL call Replicate `openai/gpt-5` using the theme (and system instructions as needed) so the model outputs **only** a plain string: a detailed Seedance video prompt covering overall cinematic style, atmosphere, lighting, audio instructions (dialogue in **Indonesian**, ambient sound, music), and a per-scene breakdown with timestamps and character dialogue.

The handler SHALL then call Replicate `bytedance/seedance-2.0-fast` with:

- `prompt`: the generated string
- `reference_images`: `[storyboardUrl]` (exactly the client-supplied URL as the reference)
- `duration`: 15
- `generate_audio`: true
- `resolution`: `"720p"`
- `aspect_ratio`: `"16:9"`

The handler SHALL resolve the model output to a downloadable video URL using the same normalization approach as the main generate pipeline (string / object with `url` / arrays, etc.).

The handler SHALL upload the resulting video to `videos/storyboard/video_<timestamp>.mp4` in the same bucket and SHALL return its public URL as `videoUrl`.

#### Scenario: Successful video generation

- **WHEN** the client sends valid `theme` and `storyboardUrl` (HTTPS URL reachable for inference) and Replicate succeeds
- **THEN** the response status is 200 and the body includes `videoUrl` for the uploaded MP4

#### Scenario: Invalid input rejected

- **WHEN** `theme` is missing or empty or `storyboardUrl` is missing or not an `https` URL
- **THEN** the response status is 400 with a clear error message

### Requirement: ReelsGen Storyboard tab UI

The ReelsGen page SHALL present three tabs: Seedance, Veo, and Storyboard.

The Storyboard tab SHALL provide a theme text input, a **Generate Storyboard** control that invokes `/api/generate-storyboard`, and while that request is in flight SHALL show loading copy **Creating your storyboard...** via dedicated `storyboardLoading` state (separate from any video-generation loading).

After a successful storyboard response, the UI SHALL display the storyboard image and SHALL show **Generate Again** (re-run `/api/generate-storyboard` with the same theme) and **Create Video** (invoke `/api/generate-storyboard-video` with theme and current `storyboardUrl`).

While video generation is in flight, the UI SHALL use dedicated `videoLoading` state and loading copy **Generating video with audio, this may take up to 2 minutes...**

On success, the UI SHALL show a video preview with controls and a download affordance consistent with existing result presentation, and SHALL append entries to the existing process **logs** panel for major steps.

#### Scenario: User regenerates storyboard

- **WHEN** a storyboard image is visible and the user clicks **Generate Again**
- **THEN** the client re-requests `/api/generate-storyboard` with the same theme and updates `storyboardUrl` on success

#### Scenario: User creates video after review

- **WHEN** a storyboard image is visible and the user clicks **Create Video**
- **THEN** the client calls `/api/generate-storyboard-video` with the theme and current `storyboardUrl` and sets `videoUrl` from the response on success

### Requirement: Storage path conventions for storyboard assets

The system SHALL store storyboard PNGs under `videos/storyboard/storyboard_<timestamp>.png` and final MP4s under `videos/storyboard/video_<timestamp>.mp4`, using helpers or constants colocated with existing `videosStoragePath` patterns in `lib/storage-buckets.ts` so paths stay consistent with the rest of ReelsGen `videos/` usage.

#### Scenario: Paths stay under videos tree

- **WHEN** a storyboard image or video is uploaded
- **THEN** the object key starts with `videos/storyboard/` and does not use the `photos/` tree

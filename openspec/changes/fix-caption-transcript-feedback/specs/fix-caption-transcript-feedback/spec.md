## ADDED Requirements

### Requirement: Distinguish transcription outcomes

The caption generator SHALL report whether a transcript was produced, the audio was genuinely empty, or the transcription step failed — as distinct outcomes — rather than collapsing failure and silence into one signal.

#### Scenario: Transcript produced
- **WHEN** audio is extracted and Whisper returns non-empty text
- **THEN** the response indicates an "ok" transcript status and the caption is generated using the transcript

#### Scenario: No audio present
- **WHEN** the transcription pipeline runs but yields an empty transcript (no speech / silent)
- **THEN** the response indicates a "no_audio" status

#### Scenario: Transcription failed
- **WHEN** audio extraction or transcription throws (e.g. provider/config/timeout error)
- **THEN** the response indicates a "failed" status
- **AND** a caption is still returned from the remaining context (title/tags/description)

#### Scenario: Backward-compatible field retained
- **WHEN** the response is returned
- **THEN** the existing boolean transcript indicator is still present so older callers keep working

### Requirement: Accurate caption transcription message

The caption UI SHALL present a message that matches the actual transcription outcome and SHALL NOT claim "no audio detected" when the transcription step failed.

#### Scenario: Failure shows a retryable message
- **WHEN** the transcription outcome is "failed"
- **THEN** the UI tells the user the audio could not be read this time and the caption used title/tags, and invites a retry
- **AND** it does NOT state that the video has no audio

#### Scenario: Genuine silence shows the no-audio message
- **WHEN** the transcription outcome is "no_audio"
- **THEN** the UI shows the existing "no audio detected" guidance

#### Scenario: Successful transcript shows no warning
- **WHEN** the transcription outcome is "ok"
- **THEN** no transcription warning is shown

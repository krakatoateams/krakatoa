## ADDED Requirements

### Requirement: Direct-to-storage video upload

The scheduler SHALL upload device videos directly to object storage using a short-lived signed upload URL minted by the server, so the file bytes do not transit the application's serverless function and are not subject to its request-body size limit.

#### Scenario: Large file uploads in production
- **WHEN** a user selects a video larger than the serverless request-body limit but within the allowed maximum (e.g. 8 MB, ≤ 50 MB)
- **THEN** the file uploads successfully and the item receives a hosted public URL
- **AND** no "Request Entity Too Large" / JSON-parse error occurs

#### Scenario: Signed URL is minted server-side
- **WHEN** the client begins an upload
- **THEN** it first requests a signed upload URL from the server with the filename, content type, and declared size
- **AND** the server validates content type and maximum size before issuing the signed URL

#### Scenario: Oversized file rejected before upload
- **WHEN** the declared size exceeds the server maximum
- **THEN** the server refuses to issue a signed URL and the client shows a clear "file too large" message

### Requirement: Clear upload error messages

Upload failures SHALL surface a human-readable message on the affected video card and SHALL NOT display a raw JSON-parse error.

#### Scenario: Server error during signing
- **WHEN** the signed-URL request fails or returns a non-JSON body
- **THEN** the card shows a readable error (e.g. "Couldn't start the upload") and enters the error state

#### Scenario: Storage upload failure
- **WHEN** the direct storage upload fails
- **THEN** the card shows a readable error and enters the error state

### Requirement: Recover from a failed upload by picking an asset

When a video card is in the upload error state with no hosted URL, selecting an asset SHALL reuse that card in place rather than appending a new one.

#### Scenario: Asset pick replaces a failed upload
- **WHEN** a card is in the upload error state (no hosted URL) and the user selects an asset
- **THEN** that card is reused — its hosted URL is set, its file/error are cleared, and its status becomes done
- **AND** no additional card is appended and the layout does not switch to bulk solely because of the failed card

#### Scenario: Empty draft still preferred
- **WHEN** an empty draft card exists alongside an errored card and the user selects an asset
- **THEN** a reusable card is filled in place (no new card appended)

### Requirement: Preserve small-file upload behavior

Device uploads of files within the limit SHALL continue to preview and capture duration as before, and existing scheduling behavior SHALL be unchanged.

#### Scenario: Small file still works
- **WHEN** a user uploads a small video within all limits
- **THEN** it uploads, previews, captures duration, and is schedulable exactly as before

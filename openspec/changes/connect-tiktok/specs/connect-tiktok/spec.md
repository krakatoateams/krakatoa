## ADDED Requirements

### Requirement: Users can connect a TikTok account
The system SHALL let a signed-in user authorize their TikTok account via OAuth, independent of their login session, and SHALL persist the resulting `access_token`, `refresh_token`, and expiry in `platform_tokens` under `platform: "tiktok"`.

#### Scenario: Successful connect
- **WHEN** a signed-in user completes the TikTok OAuth consent flow
- **THEN** a `platform_tokens` row exists for that user with `platform = "tiktok"`, a non-empty `access_token`, and an `expires_at` timestamp

#### Scenario: CSRF state mismatch is rejected
- **WHEN** the callback's `state` query param does not match the `tiktok_oauth_state` cookie
- **THEN** no token exchange occurs and the user is redirected to the settings Connections tab with `error=invalid_state`

#### Scenario: Missing authorization code
- **WHEN** the callback is reached without a `code` query param
- **THEN** the user is redirected to the settings Connections tab with `error=tiktok_connect_failed` and no `platform_tokens` row is written

### Requirement: Users can disconnect TikTok
The system SHALL let a signed-in user delete their stored TikTok `platform_tokens` row.

#### Scenario: Disconnect removes the token row
- **WHEN** a signed-in user disconnects TikTok
- **THEN** the `platform_tokens` row for `(user_id, "tiktok")` no longer exists

### Requirement: Connection status is queryable
`GET /api/connections/status` SHALL report whether the current user has a TikTok connection alongside the existing YouTube field.

#### Scenario: Status reflects a live connection
- **WHEN** a user has a `platform_tokens` row for `platform "tiktok"`
- **THEN** `GET /api/connections/status` returns `tiktok: true`

### Requirement: Connect-time validation never blocks the connect flow
After successfully storing TikTok tokens, the system SHALL attempt a best-effort Creator Info query and SHALL NOT fail or block the connect flow if that query fails.

#### Scenario: Creator info fetch fails but connect still succeeds
- **WHEN** the post-connect Creator Info query errors or times out
- **THEN** the `platform_tokens` row remains stored and the user is redirected to the settings Connections tab without an error

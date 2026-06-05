## ADDED Requirements

### Requirement: Profile Settings route

The system SHALL provide an authenticated Profile Settings page at `/dashboard/settings`, rendered inside the `(app)` shell so it inherits the sidebar, session, and credit-balance context, and is protected by the existing `middleware.ts` auth matcher.

The page SHALL present five sections selectable via in-page tab navigation: **Account**, **Credits**, **Connections**, **Assets**, and **Basic Settings**. The active tab SHALL be reflected in a `tab` query parameter (values `account`, `credits`, `connections`, `assets`, `settings`) so tabs are deep-linkable, and the page SHALL default to the Account tab when no valid `tab` is present.

#### Scenario: Authenticated user opens settings

- **WHEN** an authenticated user navigates to `/dashboard/settings`
- **THEN** the page renders within the app shell showing the five tabs with the Account tab active by default

#### Scenario: Deep-link to a specific tab

- **WHEN** a user navigates to `/dashboard/settings?tab=credits`
- **THEN** the Credits tab is the active section on load

#### Scenario: Unauthenticated access redirected

- **WHEN** an unauthenticated visitor requests `/dashboard/settings`
- **THEN** the existing auth middleware redirects them to sign in

### Requirement: Sidebar entry points to settings

The sidebar user card SHALL act as a link to `/dashboard/settings`: clicking the identity area (avatar, name, email, credit badge) SHALL navigate to the Profile Settings page. The existing sign-out control SHALL remain a separate, isolated button whose activation signs the user out and does NOT navigate to settings. The sidebar navigation SHALL also include an explicit **Settings** item linking to `/dashboard/settings`.

#### Scenario: Clicking the user card opens settings

- **WHEN** a signed-in user clicks the name/email/avatar area of the sidebar user card
- **THEN** the app navigates to `/dashboard/settings`

#### Scenario: Sign-out button does not open settings

- **WHEN** the user clicks the sign-out icon button in the user card
- **THEN** the user is signed out and is NOT navigated to `/dashboard/settings`

### Requirement: Account tab

The Account tab SHALL display the signed-in user's Google identity from the NextAuth session (avatar or initial fallback, name, email), indicate the user is **Signed in with Google**, and provide a sign-out action that calls `signOut({ callbackUrl: "/" })`.

#### Scenario: Account identity shown

- **WHEN** the Account tab is active for an authenticated user
- **THEN** the user's name, email, and avatar (or initial fallback) from the session are displayed along with a "Signed in with Google" indicator

#### Scenario: Sign out from Account tab

- **WHEN** the user activates the sign-out action on the Account tab
- **THEN** the session is terminated and the user is returned to `/`

### Requirement: Credits tab

The Credits tab SHALL display the signed-in profile's wallet balance and lifetime stats obtained from `GET /api/credits/balance`, and SHALL display a transaction-history list (newest first) obtained from `GET /api/credits/transactions`. Each history entry SHALL show at least the transaction type, signed amount/direction, and creation time. The tab SHALL render a **Buy credits** panel as a visibly disabled "Coming soon" stub that performs no purchase action.

#### Scenario: Balance and history shown

- **WHEN** the Credits tab is active for an authenticated profile
- **THEN** the current balance plus lifetime purchased/spent are shown, and the recent credit transactions are listed newest-first

#### Scenario: Buy credits is a non-functional stub

- **WHEN** the user views the Buy credits panel
- **THEN** it is shown as disabled with "Coming soon" messaging and triggers no payment flow

### Requirement: Credit transactions API

The system SHALL expose `GET /api/credits/transactions` that resolves the current profile via `requireCurrentProfile()` and returns JSON `{ "items": CreditTransaction[] }` ordered newest-first via `listCreditTransactions(profile.id, { limit })`. The endpoint SHALL be read-only (no balance mutation) and SHALL return HTTP 401 when there is no authenticated session, mirroring `GET /api/credits/balance`.

#### Scenario: Authenticated ledger read

- **WHEN** an authenticated user requests `GET /api/credits/transactions`
- **THEN** the response status is 200 and the body contains an `items` array of that profile's credit transactions, newest first

#### Scenario: Unauthenticated request rejected

- **WHEN** a request to `GET /api/credits/transactions` has no authenticated session
- **THEN** the response status is 401 and no ledger data is returned

### Requirement: Connections tab (Model A, honest)

The Connections tab SHALL present an accurate, read-only view of social-publishing connectivity given that login and the YouTube grant are a single fused OAuth grant. For an authenticated user it SHALL show a connected state labeled to convey "Signed in with Google — YouTube publishing enabled", derived from session status consistent with the scheduler's existing YouTube status presentation. The tab SHALL NOT offer a disconnect action for YouTube. Instagram and TikTok SHALL be shown as visibly disabled **Coming soon** connection cards that perform no OAuth action.

#### Scenario: YouTube shown as enabled for signed-in user

- **WHEN** an authenticated user views the Connections tab
- **THEN** YouTube/Google is shown as connected/enabled with no disconnect control

#### Scenario: Instagram and TikTok are stubs

- **WHEN** the user views the Instagram and TikTok cards
- **THEN** they are shown as disabled "Coming soon" and trigger no connection flow

### Requirement: Assets tab

The Assets tab SHALL list the signed-in user's generated assets by reusing the existing creations history source (`GET /api/creations/history`), presenting the user's images/videos consistent with the dashboard's existing creations presentation.

#### Scenario: Assets listed

- **WHEN** the Assets tab is active for a user who has generated content
- **THEN** their generated assets are listed using the existing creations history data

#### Scenario: Empty assets state

- **WHEN** the Assets tab is active for a user with no generated content
- **THEN** an empty state is shown rather than an error

### Requirement: Basic Settings tab (stub)

The Basic Settings tab SHALL display the user's display name and avatar as read-only / disabled fields with a clear **Coming soon** note, and SHALL NOT persist any changes in this pass.

#### Scenario: Fields are non-editable

- **WHEN** the user views the Basic Settings tab
- **THEN** the display name and avatar fields are shown disabled with "Coming soon" messaging and cannot be saved

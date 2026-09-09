## ADDED Requirements

### Requirement: Split-layout auth modal with mode-specific promo content

The system SHALL render the in-app auth modal as a two-panel layout: a promotional panel and the existing auth form, with the promo panel positioned on the left and the auth form on the right. The promo panel's content SHALL differ based on whether the modal is in sign-up or sign-in mode.

#### Scenario: Sign-up modal shows the free-credit nudge
- **WHEN** the modal is opened via `openSignUpModal()`
- **THEN** the left panel shows "register now and generate for free"-style copy

#### Scenario: Sign-in modal shows the model showcase
- **WHEN** the modal is opened via `openSignInModal()`
- **THEN** the left panel shows the model showcase (reused from `LANDING_SHOWREEL`), not the sign-up free-credit copy

#### Scenario: Auth form behavior is unchanged
- **WHEN** a user interacts with Google/Apple/email sign-in or sign-up inside the redesigned modal
- **THEN** authentication behaves identically to before this change — only the surrounding layout/content changed

### Requirement: Sign-up's "generate for free" claim is backed by a real credit grant

The system SHALL only make a "generate for free" promise in the sign-up promo panel while a real credit grant mechanism is active and sized to cover at least one generation. This is satisfied by enabling the existing `welcome_bonus_settings` grant (`enabled = true`, `credit_amount` set to the cost of the cheapest available video generation) rather than inventing a new grant mechanism.

#### Scenario: A new regular user actually receives credits
- **WHEN** a brand-new (non-admin) user completes sign-up while the welcome bonus is enabled
- **THEN** their account is credited with `credit_amount` credits, tagged `source = 'new_user_bonus'`, sufficient to complete at least one generation

#### Scenario: An existing user resubmitting sign-up never receives a duplicate grant
- **WHEN** a user who already has an account submits the sign-up form again (e.g. by mistake)
- **THEN** no new `profiles` row is inserted and no additional welcome-bonus credit transaction is created, regardless of what promo copy they saw

### Requirement: Sign-in promo content does not claim recency it can't back

The system SHALL NOT present the sign-in panel's model showcase as "new" or "recently added" content, since no data source in the system tracks when a model or capability was actually shipped.

#### Scenario: Sign-in panel copy avoids unverifiable "new" claims
- **WHEN** the sign-in promo panel is rendered
- **THEN** its copy frames the content as a general showcase ("see what Kelolako can do") rather than asserting recency

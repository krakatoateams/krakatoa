## MODIFIED Requirements

### Requirement: Publisher stays within platform runtime limits

Each publisher invocation SHALL process at most one due post and SHALL declare a runtime within the hosting plan's cap, so that a single run finishes quickly and cannot time out mid-upload. The remaining due posts SHALL be handled by subsequent invocations.

#### Scenario: One post per run
- **WHEN** multiple posts are due
- **THEN** a single invocation processes exactly one (the earliest) and the rest drain on later invocations

#### Scenario: Frequent cadence drains backlog
- **WHEN** the trigger fires roughly every minute
- **THEN** a backlog of due posts is published over successive minutes

## ADDED Requirements

### Requirement: Transient failures retry automatically with a bounded limit

When an upload fails for a transient reason, the system SHALL retry it on subsequent runs up to a maximum number of attempts before marking it `failed`, so brief errors self-heal without manual intervention.

#### Scenario: Transient error retries then succeeds
- **WHEN** an upload fails for a transient reason and the attempt count is below the limit
- **THEN** the post returns to `scheduled`, its attempt count increases, and a later run retries it

#### Scenario: Transient error exhausts retries
- **WHEN** a transient failure reaches the maximum attempt count
- **THEN** the post is marked `failed` with the stored reason

### Requirement: Permanent failures do not retry

When an upload fails for a permanent reason — authorization/token problems or quota exhaustion — the system SHALL mark the post `failed` immediately without retrying, so it does not waste YouTube quota on errors that cannot self-heal.

#### Scenario: Auth error fails fast
- **WHEN** an upload fails because the account token is missing/invalid or re-authorization is required
- **THEN** the post is marked `failed` immediately with the reason, and no retry is attempted

#### Scenario: Quota error fails fast
- **WHEN** an upload is rejected because the YouTube API quota is exhausted
- **THEN** the post is marked `failed` immediately with the reason, and no retry is attempted

### Requirement: A successful publish resets retry state

When a post publishes successfully, the system SHALL clear its failure reason and reset its attempt count, so prior transient failures do not affect future operations.

#### Scenario: Success clears prior failure state
- **WHEN** a post that previously failed transiently is published successfully
- **THEN** its stored failure reason is cleared and its attempt count is reset to zero

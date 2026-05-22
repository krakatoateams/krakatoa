## ADDED Requirements

### Requirement: Day-aware and time-aware best time suggestion
The "Use Best Time" button SHALL suggest a scheduling time based on the current day of the week and the current time of day.

#### Scenario: Weekday and slot not yet passed
- **WHEN** the user clicks "Use Best Time" on a weekday (Mon–Fri) before 6:00 PM local time
- **THEN** the date SHALL be set to today and the time to "18:00"
- **AND** the button label SHALL read "⚡ Best Time · 6:00 PM · Weekday evening · highest engagement"

#### Scenario: Weekday and slot has passed
- **WHEN** the user clicks "Use Best Time" on a weekday (Mon–Fri) at or after 6:00 PM local time
- **THEN** the date SHALL be set to tomorrow and the time to "18:00"
- **AND** the button label SHALL reflect "tomorrow" context

#### Scenario: Weekend and slot not yet passed
- **WHEN** the user clicks "Use Best Time" on a weekend (Sat–Sun) before 10:00 AM local time
- **THEN** the date SHALL be set to today and the time to "10:00"
- **AND** the button label SHALL read "⚡ Best Time · 10:00 AM · Weekend morning · peak scroll time"

#### Scenario: Weekend and slot has passed
- **WHEN** the user clicks "Use Best Time" on a weekend (Sat–Sun) at or after 10:00 AM local time
- **THEN** the date SHALL be set to tomorrow and the time to "10:00"

#### Scenario: Logic computed at click time
- **WHEN** the user clicks the button
- **THEN** the current day and time SHALL be evaluated at that moment, not at page load

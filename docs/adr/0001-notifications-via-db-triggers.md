# Notifications are written by database triggers, not app code

Generations reach their outcome in many places: `finishJob`/`failJob`, the workflow finalize RPC, the reconcile crons, and route-specific paths such as motion control. Posts reach theirs across several branches of the publish cron. So Notifications are inserted by `AFTER` triggers on `jobs`, `posts`, `canvas_collaborators` and `profiles` (migration `110_notifications.sql`) instead of hooks sprinkled through those paths, and a new outcome path can't silently skip notifying. Each trigger swallows its own errors as a `WARNING`, so notifying can never roll back or mask the write that fired it. Rows hold only a small snapshot, and all user-facing copy is derived at read time in `lib/notifications-pure.ts`.

## Consequences

- To add a Notification kind, extend the `kind` check constraint and add a trigger (or extend one), not an app-code call.
- Trigger logic isn't covered by the TypeScript self-checks; verify it against a real database after applying the migration.

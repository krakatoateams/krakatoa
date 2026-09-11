-- 088_posts_status_check_canceled.sql
-- Widen posts.posts_status_check to allow status = 'canceled'.
--
-- Background: `posts` is a legacy table that predates this repo's migration
-- history (see 003_platform_foundation_nextauth_single_user.sql's comment),
-- so its original CHECK constraint was never captured in a migration file.
-- Confirmed live via pg_get_constraintdef:
--   CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'published'::text, 'failed'::text])))
--
-- The scheduler-edit change (openspec/changes/edit-scheduled-post) added a
-- soft-cancel action — CalendarPageClient's handleCancelPost PATCHes
-- status: "canceled" via app/api/posts/[id]/route.ts — but never shipped the
-- matching constraint migration, so every cancel attempt has been failing
-- live with: 'new row for relation "posts" violates check constraint
-- "posts_status_check"'. lib/post-status.ts's PostDisplayStatus type and
-- STATUS_CFG in both scheduler pages already handle "canceled" on the
-- display side; only the DB was out of sync.

alter table posts drop constraint if exists posts_status_check;
alter table posts add constraint posts_status_check
  check (status = any (array['draft'::text, 'scheduled'::text, 'published'::text, 'failed'::text, 'canceled'::text]));

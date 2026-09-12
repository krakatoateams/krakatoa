-- SUPERSEDED — do not run.
--
-- Production already cut over to auth.users. The idempotent record is
-- supabase/migrations/091_auth_users_fk_cutover.sql:
--   * never rematch user_id by email
--   * posts ON DELETE CASCADE (not SET NULL)
--   * storyboards included
--   * product_photo_generations optional
--   * users_deprecated kept
--
-- Verify with scripts/migrations/002-verify-migration.sql.

do $$
begin
  raise exception
    'SUPERSEDED: use supabase/migrations/091_auth_users_fk_cutover.sql';
end $$;

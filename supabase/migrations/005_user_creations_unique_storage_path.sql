-- 005_user_creations_unique_storage_path.sql
-- Prevent duplicate creation rows for the same stored file per user.
--
-- The Product Photo "Your generations" feed self-heals by backfilling
-- user_creations rows from Storage (see reconcileProductPhotosFromStorage).
-- Dedupe is enforced in application code, but under rare concurrent reads two
-- requests could both insert the same (user_id, storage_path). This partial
-- unique index makes that impossible at the database level.
--
-- Partial: storage_path defaults to '' for tools that don't persist a path, so
-- empty paths are excluded to avoid collapsing unrelated rows.
-- Idempotent and additive (safe to re-run via `npm run db:setup`).

create unique index if not exists user_creations_user_storage_path_uniq
  on user_creations (user_id, storage_path)
  where storage_path <> '';

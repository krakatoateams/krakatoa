-- ============================================================
-- PR 1 CLEANUP: Remap user_id FKs from users -> auth.users
-- 
-- ⚠️ DO NOT RUN YET.
-- Prerequisites before running this:
--   1. PR 2 (server auth layer) and PR 3 (client auth layer) must be 
--      deployed to production
--   2. All 3 users must have logged in at least once via Supabase Auth 
--      (Google login through the new flow, not NextAuth)
--   3. Run the pre-check query below FIRST and confirm 3 rows returned
--   4. Run the constraint-name check for platform_tokens (see note below)
--      before executing — if the name differs, update that line first
-- ============================================================

-- ── PRE-CHECK: confirm all 3 users exist in auth.users ──
-- Run this BEFORE the migration below. Must return exactly 3 rows.
SELECT id, email, created_at
FROM auth.users
WHERE email IN (
  'christyvivien@gmail.com',
  'ryansetiawan.works@gmail.com',
  'krakatoa.teams@gmail.com'
)
ORDER BY email;

-- ── OPTIONAL: check the real constraint name for platform_tokens ──
-- platform_tokens FK constraint name isn't in any migration file.
-- Run this and compare against 'platform_tokens_user_id_fkey' below.
-- If different, update the DROP CONSTRAINT line for platform_tokens.
SELECT conname, conrelid::regclass
FROM pg_constraint
WHERE conrelid = 'platform_tokens'::regclass AND contype = 'f'
  AND pg_get_constraintdef(oid) LIKE '%user_id%';


-- ============================================================
-- MIGRATION — run only after prerequisites above are satisfied
-- ============================================================

BEGIN;

-- ── platform_tokens ──
WITH user_mapping AS (
  SELECT u.id AS old_id, a.id AS new_id
  FROM users u
  JOIN auth.users a ON lower(a.email) = lower(u.email)
)
UPDATE platform_tokens pt
SET user_id = m.new_id
FROM user_mapping m
WHERE pt.user_id = m.old_id;

-- ── posts (only non-null rows) ──
WITH user_mapping AS (
  SELECT u.id AS old_id, a.id AS new_id
  FROM users u
  JOIN auth.users a ON lower(a.email) = lower(u.email)
)
UPDATE posts p
SET user_id = m.new_id
FROM user_mapping m
WHERE p.user_id = m.old_id;

-- ── user_creations ──
WITH user_mapping AS (
  SELECT u.id AS old_id, a.id AS new_id
  FROM users u
  JOIN auth.users a ON lower(a.email) = lower(u.email)
)
UPDATE user_creations uc
SET user_id = m.new_id
FROM user_mapping m
WHERE uc.user_id = m.old_id;

-- ── product_photo_generations ──
WITH user_mapping AS (
  SELECT u.id AS old_id, a.id AS new_id
  FROM users u
  JOIN auth.users a ON lower(a.email) = lower(u.email)
)
UPDATE product_photo_generations ppg
SET user_id = m.new_id
FROM user_mapping m
WHERE ppg.user_id = m.old_id;

-- ── profiles ──
-- Belt-and-suspenders: profiles.user_id should already be patched by
-- PR 2/3 app code on first login (lazy patch). This catches any leftovers.
WITH user_mapping AS (
  SELECT u.id AS old_id, a.id AS new_id
  FROM users u
  JOIN auth.users a ON lower(a.email) = lower(u.email)
)
UPDATE profiles pr
SET user_id = m.new_id
FROM user_mapping m
WHERE pr.user_id = m.old_id;

-- ── Rename old users table (DO NOT DROP — keep as safety net) ──
ALTER TABLE users RENAME TO users_deprecated;

-- ── Drop old FK constraints ──
ALTER TABLE profiles              DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;
ALTER TABLE platform_tokens       DROP CONSTRAINT IF EXISTS platform_tokens_user_id_fkey;
ALTER TABLE user_creations        DROP CONSTRAINT IF EXISTS user_creations_user_id_fkey;
ALTER TABLE product_photo_generations DROP CONSTRAINT IF EXISTS product_photo_generations_user_id_fkey;
ALTER TABLE posts                  DROP CONSTRAINT IF EXISTS posts_user_id_fkey;

-- ── Add new FK constraints pointing to auth.users ──
ALTER TABLE profiles
  ADD CONSTRAINT profiles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE platform_tokens
  ADD CONSTRAINT platform_tokens_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE user_creations
  ADD CONSTRAINT user_creations_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE product_photo_generations
  ADD CONSTRAINT product_photo_generations_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE posts
  ADD CONSTRAINT posts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMIT;
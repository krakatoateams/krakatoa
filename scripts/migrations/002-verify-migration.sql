-- ============================================================
-- Auth FK cutover verification — after 091_auth_users_fk_cutover.sql
-- Every query below must return 0 orphan rows.
-- ============================================================

-- 1. FKs must reference auth.users (posts CASCADE, storyboards SET NULL)
SELECT c.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS def
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE con.contype = 'f'
  AND n.nspname = 'public'
  AND pg_get_constraintdef(con.oid) ~* 'foreign key \(user_id\)'
ORDER BY c.relname;

-- 2. Confirm public.users is gone (renamed, not dropped)
SELECT to_regclass('public.users') AS users, to_regclass('public.users_deprecated') AS users_deprecated;

-- 3. Orphan user_id values — must return 0 rows
SELECT 'profiles' AS tbl, user_id
FROM profiles
WHERE user_id NOT IN (SELECT id FROM auth.users)
UNION ALL
SELECT 'user_creations', user_id
FROM user_creations
WHERE user_id NOT IN (SELECT id FROM auth.users)
UNION ALL
SELECT 'platform_tokens', user_id
FROM platform_tokens
WHERE user_id NOT IN (SELECT id FROM auth.users)
UNION ALL
SELECT 'posts', user_id
FROM posts
WHERE user_id IS NOT NULL
  AND user_id NOT IN (SELECT id FROM auth.users)
UNION ALL
SELECT 'storyboards', user_id
FROM storyboards
WHERE user_id IS NOT NULL
  AND user_id NOT IN (SELECT id FROM auth.users);

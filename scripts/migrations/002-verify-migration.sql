-- ============================================================
-- PR 1 VERIFICATION — run AFTER 001-remap-users-to-supabase-auth.sql
-- ============================================================

-- 1. Check profiles now point to auth.users UUIDs
--    auth_email should match profile email for all rows
SELECT p.id, p.email, p.user_id, a.email as auth_email
FROM profiles p
LEFT JOIN auth.users a ON a.id = p.user_id
ORDER BY p.email;

-- 2. Check platform_tokens consistency
--    Should show 1-3 rows with non-null email
SELECT pt.user_id, a.email
FROM platform_tokens pt
LEFT JOIN auth.users a ON a.id = pt.user_id
WHERE pt.platform = 'youtube';

-- 3. Confirm old users table was renamed (not dropped)
--    Should return 3
SELECT count(*) FROM users_deprecated;

-- 4. Confirm no orphaned user_ids remain
--    Must return 0 rows
SELECT 'profiles' as tbl, user_id FROM profiles
WHERE user_id NOT IN (SELECT id FROM auth.users)
UNION ALL
SELECT 'platform_tokens', user_id FROM platform_tokens
WHERE user_id NOT IN (SELECT id FROM auth.users)
UNION ALL
SELECT 'posts', user_id FROM posts
WHERE user_id IS NOT NULL
  AND user_id NOT IN (SELECT id FROM auth.users);
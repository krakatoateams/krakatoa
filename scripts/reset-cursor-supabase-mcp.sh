#!/usr/bin/env bash
# Reset Supabase MCP OAuth state in Cursor.
# IMPORTANT: Quit Cursor completely (Cmd+Q) before running this script.
set -euo pipefail

DB="$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb"

if [[ ! -f "$DB" ]]; then
  echo "Cursor global storage not found: $DB"
  exit 1
fi

if pgrep -x "Cursor" >/dev/null 2>&1; then
  echo "Cursor is still running. Quit Cursor (Cmd+Q), then run this script again."
  exit 1
fi

backup="$DB.backup-$(date +%Y%m%d-%H%M%S)"
cp "$DB" "$backup"
echo "Backup saved to: $backup"

sqlite3 "$DB" <<'SQL'
DELETE FROM ItemTable
WHERE key LIKE 'mcpOAuth.global.%supabase%'
   OR key LIKE 'mcpOAuth.global.%Supabase%'
   OR key LIKE 'mcpOAuth.global.%kelolako-supabase%'
   OR key LIKE 'mcpOAuth.global.%Krakatoa-supabase%'
   OR key LIKE 'mcpOAuth.secret.%supabase%'
   OR key LIKE 'mcpOAuth.secret.%Supabase%'
   OR key LIKE 'mcpOAuth.secret.%kelolako-supabase%'
   OR key LIKE 'mcpOAuth.secret.%Krakatoa-supabase%'
   OR key LIKE 'secret://%plugin-supabase-supabase%'
   OR key LIKE 'secret://%url:aHR0cHM6Ly9tY3Auc3VwYWJhc2UuY29tL21jcA%';

UPDATE ItemTable
SET value = json_remove(
  value,
  '$."[plugin-supabase-supabase] mcp_server_url"',
  '$."[plugin-supabase-supabase] mcp_code_verifier"',
  '$."[url:aHR0cHM6Ly9tY3Auc3VwYWJhc2UuY29tL21jcA] mcp_oauth_updated_at_ms"'
)
WHERE key = 'anysphere.cursor-mcp';
SQL

echo "Supabase MCP OAuth entries cleared."
echo "Reopen Cursor → Settings → MCP → enable supabase → Connect/Login."

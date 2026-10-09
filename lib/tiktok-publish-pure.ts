/**
 * Pure TikTok publish-client decisions. Split from lib/tiktok.ts so error
 * redaction and disclosure rules can be tested without network I/O.
 *
 * Cron persists thrown messages on `posts.last_error` and logs them. Signed
 * publish URLs must never appear in those strings.
 */

export function redactPublishMediaRef(urlOrPath: string): string {
  try {
    const parsed = new URL(urlOrPath);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    const query = urlOrPath.indexOf("?");
    return query === -1 ? urlOrPath : urlOrPath.slice(0, query);
  }
}

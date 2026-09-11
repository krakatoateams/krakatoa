/**
 * Only ever allow a same-origin relative path as a redirect target coming
 * from user input (a `next`/`redirectTo`-style query param).
 *
 * Requiring a single leading "/" is what actually makes this safe, not just
 * prepending our own origin before it — e.g. `origin + "@evil.com"` parses
 * as `http://ourorigin@evil.com` (a valid URL where "ourorigin" is treated
 * as userinfo and "evil.com" is the real host), and `origin + "//evil.com"`
 * without this check would be the classic protocol-relative bypass. A
 * leading "/" forces any later "@" into path position instead of authority
 * position. Reject backslashes too: the WHATWG URL parser treats them as
 * slashes for HTTP(S), so `/\evil.com` also becomes protocol-relative.
 */
export function sanitizeNextPath(next: string | null | undefined): string {
  if (
    next &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !/[\\\u0000-\u001f\u007f]/.test(next)
  ) {
    return next;
  }
  return "/dashboard";
}

/**
 * Password sign-in happens in a Route Handler, so the root client auth
 * context does not receive an onAuthStateChange event. A full navigation
 * makes every browser/server consumer re-read the new cookie session.
 */
export function navigateAfterPasswordSignIn(
  next: string | null | undefined,
  assign: (path: string) => void = (path) => window.location.assign(path),
): void {
  assign(sanitizeNextPath(next));
}

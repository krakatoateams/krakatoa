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
function hasRelativePathSegment(next: string): boolean {
  let pathname = next.split(/[?#]/, 1)[0];
  try {
    // Two passes also catch a once-double-encoded traversal without touching
    // query values, where dots are ordinary user input.
    for (let i = 0; i < 2; i++) {
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) break;
      pathname = decoded;
    }
  } catch {
    return true;
  }
  const normalizedSeparators = pathname.replaceAll("\\", "/");
  return (
    normalizedSeparators.startsWith("//") ||
    normalizedSeparators
      .split("/")
      .some((segment) => segment === "." || segment === "..")
  );
}

export function sanitizeNextPath(next: string | null | undefined): string {
  if (
    next &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !/[\\\u0000-\u001f\u007f]/.test(next) &&
    !hasRelativePathSegment(next)
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

export function authCallbackFailureUrl(
  origin: string,
  next: string | null | undefined,
): string {
  const url = new URL("/login", origin);
  url.searchParams.set("error", "auth_callback_failed");
  url.searchParams.set("next", sanitizeNextPath(next));
  return url.toString();
}

export function passwordResetDestination(
  next: string | null | undefined,
): string {
  return sanitizeNextPath(next);
}

export function passwordResetLandingPath(
  next: string | null | undefined,
): string {
  const url = new URL("/dashboard", "https://internal.invalid");
  url.searchParams.set("resetPassword", "1");
  url.searchParams.set("next", passwordResetDestination(next));
  return `${url.pathname}${url.search}`;
}

export function passwordResetCallbackUrl(
  origin: string,
  next: string | null | undefined,
): string {
  const url = new URL("/auth/callback", origin);
  url.searchParams.set("flow", "recovery");
  url.searchParams.set("next", passwordResetLandingPath(next));
  return url.toString();
}

export function passwordResetRetryUrl(
  origin: string,
  resetLanding: string | null | undefined,
): string {
  let next = "/dashboard";
  const safeLanding = sanitizeNextPath(resetLanding);

  try {
    const landing = new URL(safeLanding, origin);
    if (
      landing.pathname === "/dashboard" &&
      landing.searchParams.get("resetPassword") === "1"
    ) {
      next = passwordResetDestination(landing.searchParams.get("next"));
    }
  } catch {
    // Keep the safe dashboard fallback.
  }

  const retry = new URL("/forgot-password", origin);
  retry.searchParams.set("error", "expired");
  retry.searchParams.set("next", next);
  return retry.toString();
}

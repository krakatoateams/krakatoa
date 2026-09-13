import {
  authCallbackFailureUrl,
  navigateAfterPasswordSignIn,
} from "./safe-redirect";
import {
  SUPABASE_AUTH_CACHE_HEADERS,
  forwardSupabaseAuthUpdates,
} from "./supabase-auth-response";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`auth-session self-check: ${message}`);
}

export function authSessionSelfCheck(): void {
  const navigations: string[] = [];
  navigateAfterPasswordSignIn(
    "//attacker.example/steal",
    (path) => navigations.push(path),
  );
  navigateAfterPasswordSignIn(
    "/\\attacker.example/steal",
    (path) => navigations.push(path),
  );
  navigateAfterPasswordSignIn(
    "/tools/video?type=image2video",
    (path) => navigations.push(path),
  );
  navigateAfterPasswordSignIn(
    "/tools/video/../admin",
    (path) => navigations.push(path),
  );
  navigateAfterPasswordSignIn(
    "/tools/video/%2e%2e/admin",
    (path) => navigations.push(path),
  );
  navigateAfterPasswordSignIn(
    "/%2f%2fattacker.example",
    (path) => navigations.push(path),
  );
  navigateAfterPasswordSignIn(
    "/%5c%5cattacker.example",
    (path) => navigations.push(path),
  );

  assert(
    navigations[0] === "/dashboard",
    "password sign-in must reject an untrusted next destination",
  );
  assert(
    navigations[1] === "/dashboard",
    "password sign-in must reject a backslash-normalized external destination",
  );
  assert(
    navigations[2] === "/tools/video?type=image2video",
    "password sign-in must preserve a safe internal destination",
  );
  assert(
    navigations[3] === "/dashboard" && navigations[4] === "/dashboard",
    "password sign-in must reject literal and encoded path traversal",
  );
  assert(
    navigations[5] === "/dashboard" && navigations[6] === "/dashboard",
    "password sign-in must reject encoded protocol-relative separators",
  );

  const failedCallback = new URL(
    authCallbackFailureUrl(
      "https://www.kelolako.com",
      "/tools/video?type=image2video",
    ),
  );
  assert(
    failedCallback.origin === "https://www.kelolako.com" &&
      failedCallback.searchParams.get("error") === "auth_callback_failed" &&
      failedCallback.searchParams.get("next") ===
        "/tools/video?type=image2video",
    "an OAuth retry must retain its safe internal destination",
  );

  const forwardedCookies: Array<{
    name: string;
    value: string;
    options: { secure: boolean };
  }> = [];
  const forwardedHeaders: Array<[string, string]> = [];

  forwardSupabaseAuthUpdates(
    [
      {
        name: "sb-project-auth-token",
        value: "rotated-token",
        options: { secure: true },
      },
    ],
    {
      "Cache-Control": "private, no-store",
      Expires: "0",
    },
    (cookie) => forwardedCookies.push(cookie),
    (name, value) => forwardedHeaders.push([name, value]),
  );

  assert(
    forwardedCookies.length === 1 &&
      forwardedCookies[0].name === "sb-project-auth-token" &&
      forwardedCookies[0].options.secure,
    "auth cookies and their options must be forwarded",
  );
  assert(
    forwardedHeaders.some(
      ([name, value]) =>
        name.toLowerCase() === "cache-control" &&
        value === "private, no-store",
    ),
    "Supabase cache headers must be forwarded",
  );
  assert(
    SUPABASE_AUTH_CACHE_HEADERS["Cache-Control"] === "private, no-store" &&
      SUPABASE_AUTH_CACHE_HEADERS.Pragma === "no-cache",
    "auth route responses must opt out of shared caching",
  );
}

authSessionSelfCheck();
console.log("auth-session self-check passed");

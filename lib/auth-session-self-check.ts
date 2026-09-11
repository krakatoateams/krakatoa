import { navigateAfterPasswordSignIn } from "./safe-redirect";
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

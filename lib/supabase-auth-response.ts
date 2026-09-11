export type SupabaseAuthCookie<TOptions> = {
  name: string;
  value: string;
  options: TOptions;
};

export const SUPABASE_AUTH_CACHE_HEADERS = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
  Expires: "0",
} as const;

/**
 * Forward every cookie and cache header emitted by @supabase/ssr to the
 * framework response. This remains framework-agnostic so redirect and
 * passthrough responses cannot accidentally diverge.
 */
export function forwardSupabaseAuthUpdates<TOptions>(
  cookies: ReadonlyArray<SupabaseAuthCookie<TOptions>>,
  headers: Readonly<Record<string, string>>,
  setCookie: (cookie: SupabaseAuthCookie<TOptions>) => void,
  setHeader: (name: string, value: string) => void,
): void {
  cookies.forEach(setCookie);
  Object.entries(headers).forEach(([name, value]) => setHeader(name, value));
}

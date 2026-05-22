import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { supabaseServer } from "./supabase-server";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          // access_type=offline ensures Google returns a refresh_token
          // prompt=consent forces the consent screen every time so the
          // refresh_token is always included (not just on first login)
          access_type: "offline",
          prompt: "consent",
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/youtube.upload",
          ].join(" "),
        },
      },
    }),
  ],

  secret: process.env.NEXTAUTH_SECRET,

  callbacks: {
    // Smart redirect: send users to /dashboard after a fresh sign-in,
    // but honour any explicit callbackUrl from elsewhere in the app
    // (e.g. "Connect YouTube" deep-links inside the Scheduler).
    async redirect({ url, baseUrl }) {
      // Same-origin absolute URL
      if (url.startsWith(baseUrl)) {
        if (url === baseUrl || url === `${baseUrl}/`) {
          return `${baseUrl}/dashboard`;
        }
        return url;
      }
      // Relative path
      if (url.startsWith("/")) {
        if (url === "/") return `${baseUrl}/dashboard`;
        return `${baseUrl}${url}`;
      }
      return `${baseUrl}/dashboard`;
    },

    async signIn({ user, account }) {
      if (!user.email) return false;

      // ── 1. Upsert the user row ───────────────────────────────────────────
      const { error: upsertErr } = await supabaseServer
        .from("users")
        .upsert({ email: user.email }, { onConflict: "email", ignoreDuplicates: true });

      if (upsertErr) {
        console.error("[auth] upsert user failed:", upsertErr.message);
      }

      // ── 2. Store / refresh the Google OAuth tokens ───────────────────────
      if (account?.provider === "google" && account.access_token) {
        const { data: userRow } = await supabaseServer
          .from("users")
          .select("id")
          .eq("email", user.email)
          .single();

        if (userRow) {
          const expiresAt = account.expires_at
            ? new Date(account.expires_at * 1000).toISOString()
            : new Date(Date.now() + 3_600_000).toISOString();

          if (account.refresh_token) {
            // Full upsert — we have both tokens (first login or prompt=consent)
            const { error: tokenErr } = await supabaseServer
              .from("platform_tokens")
              .upsert(
                {
                  user_id: userRow.id,
                  platform: "youtube",
                  access_token: account.access_token,
                  refresh_token: account.refresh_token,
                  expires_at: expiresAt,
                },
                { onConflict: "user_id,platform" },
              );
            if (tokenErr) console.error("[auth] token upsert failed:", tokenErr.message);
          } else {
            // Subsequent login without a new refresh_token — only update the
            // access token and expiry so we don't lose the stored refresh_token
            const { data: existing } = await supabaseServer
              .from("platform_tokens")
              .select("id")
              .eq("user_id", userRow.id)
              .eq("platform", "youtube")
              .single();

            if (existing) {
              await supabaseServer
                .from("platform_tokens")
                .update({ access_token: account.access_token, expires_at: expiresAt })
                .eq("id", existing.id);
            }
          }
        }
      }

      return true;
    },
  },

  debug: true,
  logger: {
    error(code, metadata) { console.error("NEXTAUTH ERROR:", code, metadata); },
    warn(code)            { console.warn("NEXTAUTH WARN:", code); },
    debug(code, metadata) { console.log("NEXTAUTH DEBUG:", code, metadata); },
  },
};

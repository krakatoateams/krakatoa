"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseAuthBrowser } from "@/lib/supabase-browser-auth";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  status: AuthStatus;
  /** session.user.user_metadata.full_name or .name */
  name: string | null;
  email: string | null;
  /** session.user.user_metadata.avatar_url */
  image: string | null;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  status: "loading",
  name: null,
  email: null,
  image: null,
});

/**
 * Place once at the root layout. Subscribes to Supabase Auth state changes
 * and exposes the current session to all descendants via useCurrentUser().
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  // undefined = initial loading state (not yet resolved)
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    const supabase = getSupabaseAuthBrowser();

    // Seed initial session synchronously from storage (avoids a flash).
    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));

    return () => subscription.unsubscribe();
  }, []);

  const status: AuthStatus =
    session === undefined
      ? "loading"
      : session
        ? "authenticated"
        : "unauthenticated";

  const user = session?.user ?? null;

  const value: AuthContextValue = {
    session: session ?? null,
    user,
    status,
    name:
      user?.user_metadata?.full_name ??
      user?.user_metadata?.name ??
      null,
    email: user?.email ?? null,
    image: user?.user_metadata?.avatar_url ?? null,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Drop-in replacement for next-auth's useSession().
 * Returns { session, user, status, name, email, image }.
 * status mirrors next-auth: "loading" | "authenticated" | "unauthenticated"
 */
export function useCurrentUser(): AuthContextValue {
  return useContext(AuthContext);
}

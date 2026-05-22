import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";

export async function resolveUserIdByEmail(email: string): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("users")
    .select("id")
    .eq("email", email)
    .single();

  if (error) {
    console.error("[auth] resolve user:", error.message);
    return null;
  }
  return data?.id ?? null;
}

/** Returns the signed-in user's UUID from `users`, or null if unauthenticated / missing. */
export async function getSessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  return resolveUserIdByEmail(email);
}

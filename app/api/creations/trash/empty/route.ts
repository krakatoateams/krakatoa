import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/resolve-user";
import { emptyUserTrash } from "@/lib/creations-db";

export const dynamic = "force-dynamic";

/** Permanently delete every trashed creation for the current user. */
export async function POST() {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const removed = await emptyUserTrash(userId);
    return NextResponse.json({ removed });
  } catch (error: unknown) {
    console.error("[Creations Trash Empty]", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

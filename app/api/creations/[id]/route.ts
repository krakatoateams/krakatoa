import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/resolve-user";
import { updateUserCreation } from "@/lib/creations-db";

export const dynamic = "force-dynamic";

/**
 * Rename a creation (e.g. name a Character creation). Owner-scoped: a user can only
 * edit their own creations. Sets the display title and stores the name under
 * metadata.characterName so the library can show/group it.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const id = params.id?.trim();
    if (!id) {
      return NextResponse.json({ error: "Missing creation id." }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
    if (typeof body?.name !== "string") {
      return NextResponse.json({ error: "A name is required." }, { status: 400 });
    }
    const name = body.name.trim().slice(0, 80);

    const item = await updateUserCreation({
      userId,
      id,
      title: name || "Character",
      metadataPatch: { characterName: name },
    });

    return NextResponse.json({ item });
  } catch (error: unknown) {
    console.error("[Creations PATCH]", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

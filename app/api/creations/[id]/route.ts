import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/resolve-user";
import { classifyCreationMutationError } from "@/lib/creation-ownership-pure";
import {
  permanentlyDeleteUserCreation,
  restoreUserCreation,
  softDeleteUserCreation,
  updateUserCreation,
} from "@/lib/creations-db";

export const dynamic = "force-dynamic";

/**
 * Update a creation. Owner-scoped: a user can only edit their own creations.
 *   - { action: "restore" } → move out of Trash (clears metadata.deletedAt)
 *   - { name }              → rename (Character creation) + store metadata.characterName
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

    const body = (await req.json().catch(() => null)) as
      | { name?: unknown; action?: unknown }
      | null;

    if (body?.action === "restore") {
      const item = await restoreUserCreation(userId, id);
      return NextResponse.json({ item });
    }

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
    const mapped = classifyCreationMutationError(error);
    if (mapped.status === 500) {
      console.error("[Creations PATCH]", error);
    }
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}

/**
 * Delete a creation. Owner-scoped.
 *   - default        → soft delete (move to Trash)
 *   - ?permanent=1   → hard delete (removes the storage object + DB row)
 */
export async function DELETE(
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

    const permanent =
      new URL(req.url).searchParams.get("permanent") === "1";

    if (permanent) {
      const ok = await permanentlyDeleteUserCreation(userId, id);
      if (!ok) {
        return NextResponse.json({ error: "Creation not found." }, { status: 404 });
      }
      return NextResponse.json({ ok: true, permanent: true });
    }

    const item = await softDeleteUserCreation(userId, id);
    return NextResponse.json({ item });
  } catch (error: unknown) {
    const mapped = classifyCreationMutationError(error);
    if (mapped.status === 500) {
      console.error("[Creations DELETE]", error);
    }
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}

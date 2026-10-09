import { NextRequest, NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import {
  removeCanvasCollaborator,
  updateCanvasCollaboratorRole,
  type CanvasCollaboratorRole,
} from "@/lib/canvas-collaborators-db";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOf(value: string | undefined): string | null {
  const id = value?.trim() ?? "";
  return UUID_RE.test(id) ? id : null;
}

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; collaboratorId: string }> }
) {
  const params = await props.params;
  try {
    const profile = await requireCurrentProfile();
    const canvasId = uuidOf(params.id);
    const collaboratorId = uuidOf(params.collaboratorId);
    if (!canvasId || !collaboratorId) {
      return NextResponse.json({ error: "Collaborator not found." }, { status: 404 });
    }
    const body = (await req.json().catch(() => null)) as { role?: unknown } | null;
    const role: CanvasCollaboratorRole | null =
      body?.role === "viewer" || body?.role === "editor" ? body.role : null;
    if (!role) {
      return NextResponse.json({ error: "Choose Can edit or Can view." }, { status: 400 });
    }
    const collaborator = await updateCanvasCollaboratorRole({
      canvasId,
      ownerProfileId: profile.id,
      collaboratorId,
      role,
    });
    if (!collaborator) {
      return NextResponse.json({ error: "Collaborator not found." }, { status: 404 });
    }
    return NextResponse.json({ collaborator });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Not authenticated.") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    console.error("[api/canvas/collaborators] role update failed:", error);
    return NextResponse.json({ error: "Failed to update access." }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string; collaboratorId: string }> }
) {
  const params = await props.params;
  try {
    const profile = await requireCurrentProfile();
    const canvasId = uuidOf(params.id);
    const collaboratorId = uuidOf(params.collaboratorId);
    if (!canvasId || !collaboratorId) {
      return NextResponse.json({ error: "Collaborator not found." }, { status: 404 });
    }

    const ok = await removeCanvasCollaborator({
      canvasId,
      ownerProfileId: profile.id,
      collaboratorId,
    });
    if (!ok) return NextResponse.json({ error: "Collaborator not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Not authenticated.") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    console.error("[api/canvas/collaborators] remove failed:", error);
    return NextResponse.json({ error: "Failed to remove collaborator." }, { status: 500 });
  }
}

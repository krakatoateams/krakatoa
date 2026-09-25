import { NextRequest, NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import {
  inviteCanvasCollaborator,
  listCanvasCollaborators,
  type CanvasCollaboratorRole,
} from "@/lib/canvas-collaborators-db";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canvasIdOf(params: { id: string }): string | null {
  const id = params.id?.trim() ?? "";
  return UUID_RE.test(id) ? id : null;
}

function parseRole(value: unknown): CanvasCollaboratorRole | null {
  return value === "viewer" || value === "editor" ? value : null;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const profile = await requireCurrentProfile();
    const id = canvasIdOf(params);
    if (!id) return NextResponse.json({ error: "Canvas not found." }, { status: 404 });

    const collaborators = await listCanvasCollaborators(id, profile.id);
    return NextResponse.json({ collaborators });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Not authenticated.") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    console.error("[api/canvas/collaborators] list failed:", error);
    return NextResponse.json({ error: "Failed to list collaborators." }, { status: 500 });
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const profile = await requireCurrentProfile();
    const id = canvasIdOf(params);
    if (!id) return NextResponse.json({ error: "Canvas not found." }, { status: 404 });

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.email !== "string") {
      return NextResponse.json({ error: "An email address is required." }, { status: 400 });
    }

    const role = parseRole(body.role) ?? "editor";
    const collaborator = await inviteCanvasCollaborator({
      canvasId: id,
      ownerProfileId: profile.id,
      ownerEmail: profile.email,
      email: body.email,
      role,
    });

    return NextResponse.json({ collaborator });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Not authenticated.") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    if (message === "Canvas not found.") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message === "Enter a valid email address." || message === "You can't invite yourself.") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("[api/canvas/collaborators] invite failed:", error);
    return NextResponse.json({ error: "Failed to invite collaborator." }, { status: 500 });
  }
}

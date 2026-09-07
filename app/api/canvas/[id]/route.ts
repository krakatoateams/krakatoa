import { NextRequest, NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import {
  canvasGraphJsonTooLarge,
  parseCanvasGraph,
} from "@/lib/canvas-document";
import { deleteCanvas, getCanvas, updateCanvas, updateCanvasTitle } from "@/lib/canvases-db";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canvasIdOf(params: { id: string }): string | null {
  const id = params.id?.trim() ?? "";
  return UUID_RE.test(id) ? id : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const profile = await requireCurrentProfile();
    const id = canvasIdOf(params);
    if (!id) return NextResponse.json({ error: "Canvas not found." }, { status: 404 });
    const canvas = await getCanvas(profile.id, id);
    if (!canvas) return NextResponse.json({ error: "Canvas not found." }, { status: 404 });
    return NextResponse.json({ canvas });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Not authenticated.") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    console.error("[api/canvas] get failed:", error);
    return NextResponse.json({ error: "Failed to load canvas." }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const profile = await requireCurrentProfile();
    const id = canvasIdOf(params);
    if (!id) return NextResponse.json({ error: "Canvas not found." }, { status: 404 });
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    const graph = parseCanvasGraph(body.graph);
    if (!graph) {
      return NextResponse.json({ error: "That canvas graph could not be saved." }, { status: 400 });
    }
    if (canvasGraphJsonTooLarge(graph)) {
      return NextResponse.json({ error: "This canvas is too large to save." }, { status: 400 });
    }
    const canvas = await updateCanvas({
      profileId: profile.id,
      canvasId: id,
      title: typeof body.title === "string" ? body.title : "",
      graph,
    });
    if (!canvas) return NextResponse.json({ error: "Canvas not found." }, { status: 404 });
    return NextResponse.json({ canvas });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Not authenticated.") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    console.error("[api/canvas] update failed:", error);
    return NextResponse.json({ error: "Failed to save canvas." }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const profile = await requireCurrentProfile();
    const id = canvasIdOf(params);
    if (!id) return NextResponse.json({ error: "Canvas not found." }, { status: 404 });
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.title !== "string") {
      return NextResponse.json({ error: "A title is required." }, { status: 400 });
    }
    const canvas = await updateCanvasTitle({
      profileId: profile.id,
      canvasId: id,
      title: body.title,
    });
    if (!canvas) return NextResponse.json({ error: "Canvas not found." }, { status: 404 });
    return NextResponse.json({ canvas });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Not authenticated.") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    console.error("[api/canvas] rename failed:", error);
    return NextResponse.json({ error: "Failed to rename canvas." }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const profile = await requireCurrentProfile();
    const id = canvasIdOf(params);
    if (!id) return NextResponse.json({ error: "Canvas not found." }, { status: 404 });
    const ok = await deleteCanvas(profile.id, id);
    if (!ok) return NextResponse.json({ error: "Canvas not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Not authenticated.") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    console.error("[api/canvas] delete failed:", error);
    return NextResponse.json({ error: "Failed to delete canvas." }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import {
  canvasGraphJsonTooLarge,
  parseCanvasGraph,
} from "@/lib/canvas-document";
import { createCanvas, listCanvases } from "@/lib/canvases-db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const profile = await requireCurrentProfile();
    const canvases = await listCanvases(profile.id);
    return NextResponse.json({ canvases });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Not authenticated.") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    console.error("[api/canvas] list failed:", error);
    return NextResponse.json({ error: "Failed to list canvases." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const profile = await requireCurrentProfile();
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
    const canvas = await createCanvas({
      profileId: profile.id,
      title: typeof body.title === "string" ? body.title : "",
      graph,
    });
    return NextResponse.json({ canvas });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Not authenticated.") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    console.error("[api/canvas] create failed:", error);
    return NextResponse.json({ error: "Failed to save canvas." }, { status: 500 });
  }
}

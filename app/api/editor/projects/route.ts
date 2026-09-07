import { NextRequest, NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import {
  editorDocumentJsonTooLarge,
  parseEditorDocument,
} from "@/lib/editor-document";
import { createEditorProject, listEditorProjects } from "@/lib/editor-projects-db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const profile = await requireCurrentProfile();
    const projects = await listEditorProjects(profile.id);
    return NextResponse.json({ projects });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Not authenticated.") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    console.error("[api/editor/projects] list failed:", error);
    return NextResponse.json({ error: "Failed to list editor projects." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const profile = await requireCurrentProfile();
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    const document = parseEditorDocument(body.document);
    if (!document) {
      return NextResponse.json({ error: "That edit could not be saved." }, { status: 400 });
    }
    if (editorDocumentJsonTooLarge(document)) {
      return NextResponse.json({ error: "This edit is too large to save." }, { status: 400 });
    }
    const project = await createEditorProject({
      profileId: profile.id,
      title: typeof body.title === "string" ? body.title : "",
      document,
    });
    return NextResponse.json({ project });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Not authenticated.") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    console.error("[api/editor/projects] create failed:", error);
    return NextResponse.json({ error: "Failed to save editor project." }, { status: 500 });
  }
}

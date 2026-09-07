import { NextRequest, NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import {
  editorDocumentJsonTooLarge,
  parseEditorDocument,
} from "@/lib/editor-document";
import {
  deleteEditorProject,
  getEditorProject,
  updateEditorProject,
  updateEditorProjectTitle,
} from "@/lib/editor-projects-db";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function projectIdOf(params: { projectId: string }): string | null {
  const id = params.projectId?.trim() ?? "";
  return UUID_RE.test(id) ? id : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const profile = await requireCurrentProfile();
    const id = projectIdOf(params);
    if (!id) return NextResponse.json({ error: "Edit not found." }, { status: 404 });
    const project = await getEditorProject(profile.id, id);
    if (!project) return NextResponse.json({ error: "Edit not found." }, { status: 404 });
    return NextResponse.json({ project });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Not authenticated.") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    console.error("[api/editor/projects] get failed:", error);
    return NextResponse.json({ error: "Failed to load editor project." }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const profile = await requireCurrentProfile();
    const id = projectIdOf(params);
    if (!id) return NextResponse.json({ error: "Edit not found." }, { status: 404 });
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
    const project = await updateEditorProject({
      profileId: profile.id,
      projectId: id,
      title: typeof body.title === "string" ? body.title : "",
      document,
    });
    if (!project) return NextResponse.json({ error: "Edit not found." }, { status: 404 });
    return NextResponse.json({ project });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Not authenticated.") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    console.error("[api/editor/projects] update failed:", error);
    return NextResponse.json({ error: "Failed to save editor project." }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const profile = await requireCurrentProfile();
    const id = projectIdOf(params);
    if (!id) return NextResponse.json({ error: "Edit not found." }, { status: 404 });
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.title !== "string") {
      return NextResponse.json({ error: "A title is required." }, { status: 400 });
    }
    const project = await updateEditorProjectTitle({
      profileId: profile.id,
      projectId: id,
      title: body.title,
    });
    if (!project) return NextResponse.json({ error: "Edit not found." }, { status: 404 });
    return NextResponse.json({ project });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Not authenticated.") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    console.error("[api/editor/projects] rename failed:", error);
    return NextResponse.json({ error: "Failed to rename editor project." }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const profile = await requireCurrentProfile();
    const id = projectIdOf(params);
    if (!id) return NextResponse.json({ error: "Edit not found." }, { status: 404 });
    const ok = await deleteEditorProject(profile.id, id);
    if (!ok) return NextResponse.json({ error: "Edit not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Not authenticated.") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    console.error("[api/editor/projects] delete failed:", error);
    return NextResponse.json({ error: "Failed to delete editor project." }, { status: 500 });
  }
}

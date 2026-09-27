import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import {
  listAdminDashboardTemplates,
  saveAllDashboardTemplates,
} from "@/lib/dashboard-templates-db";
import {
  DashboardTemplateValidationError,
  isDashboardTemplateKind,
  parseAdminDashboardTemplate,
  type AdminDashboardTemplate,
  type DashboardTemplateKind,
} from "@/lib/dashboard-templates-pure";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return withAdmin(async () => {
    const kindParam = new URL(req.url).searchParams.get("kind");
    if (!kindParam || !isDashboardTemplateKind(kindParam)) {
      return NextResponse.json(
        { error: "Query param kind must be viral or motion_control." },
        { status: 400 }
      );
    }

    const templates = await listAdminDashboardTemplates(kindParam);
    return NextResponse.json({ templates });
  });
}

export async function PUT(req: Request) {
  return withAdmin(async () => {
    const body = (await req.json().catch(() => null)) as {
      kind?: string;
      templates?: unknown;
    } | null;

    if (!body || !isDashboardTemplateKind(body.kind ?? "")) {
      return NextResponse.json(
        { error: "Body must include kind: viral or motion_control." },
        { status: 400 }
      );
    }

    if (!Array.isArray(body.templates)) {
      return NextResponse.json({ error: "Body must include templates: [...]." }, { status: 400 });
    }

    const kind = body.kind as DashboardTemplateKind;
    let parsed: AdminDashboardTemplate[];
    try {
      parsed = body.templates.map((row, index) =>
        parseAdminDashboardTemplate(row, index, kind)
      );
    } catch (e) {
      if (e instanceof DashboardTemplateValidationError) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }

    const slugs = parsed.map((row) => row.slug);
    if (new Set(slugs).size !== slugs.length) {
      return NextResponse.json({ error: "Template slugs must be unique." }, { status: 400 });
    }

    const templates = await saveAllDashboardTemplates(kind, parsed);
    return NextResponse.json({ templates });
  });
}

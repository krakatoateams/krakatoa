import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { expireCreditLots } from "@/lib/credits-db";
import { runCreationExpiry } from "@/lib/creation-expiry";

export const dynamic = "force-dynamic";
// Manual admin trigger — same heavy work as the crons.
export const maxDuration = 120;

type RunTarget = "credits" | "photo" | "video";
const TARGETS: RunTarget[] = ["credits", "photo", "video"];

/**
 * POST /api/admin/expiry/run — admin "Run expiry now" for one target.
 * Body: { target: 'credits' | 'photo' | 'video', dryRun?: boolean }
 */
export async function POST(req: Request) {
  return withAdmin(async () => {
    const body = (await req.json().catch(() => null)) as
      | { target?: unknown; dryRun?: unknown }
      | null;
    const target = body?.target;
    if (typeof target !== "string" || !TARGETS.includes(target as RunTarget)) {
      return NextResponse.json(
        { error: "target must be one of: credits, photo, video." },
        { status: 400 }
      );
    }
    const dryRun = body?.dryRun === true;

    if (target === "credits") {
      const result = await expireCreditLots({ dryRun });
      return NextResponse.json({ target, result });
    }

    const result = await runCreationExpiry(target as "photo" | "video", { dryRun });
    return NextResponse.json({ target, result });
  });
}

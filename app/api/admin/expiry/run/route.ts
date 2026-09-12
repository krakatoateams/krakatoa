import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { expireCreditLots } from "@/lib/credits-db";
import { runCreationExpiry } from "@/lib/creation-expiry";
import { getExpirySettings } from "@/lib/expiry-settings-db";

export const dynamic = "force-dynamic";
// Manual admin trigger — same heavy work as the crons.
export const maxDuration = 120;

type RunTarget = "credits" | "photo" | "video";
const TARGETS: RunTarget[] = ["credits", "photo", "video"];

function parseCheckpoint(
  raw: unknown,
  label: string
): Date | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > Date.now() + 1_000) {
    throw new Error(`${label} must be a valid non-future ISO timestamp.`);
  }
  return parsed;
}

function parseExpectedDays(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!Number.isInteger(raw) || (raw as number) < 0) {
    throw new Error("expectedDays must be a non-negative integer or null.");
  }
  return raw as number;
}

/**
 * POST /api/admin/expiry/run — admin "Run expiry now" for one target.
 * A live run may pass the asOf/settings checkpoint returned by its preview.
 */
export async function POST(req: Request) {
  return withAdmin(async () => {
    const body = (await req.json().catch(() => null)) as
      | {
          target?: unknown;
          dryRun?: unknown;
          asOf?: unknown;
          expectedDays?: unknown;
        }
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
      let asOf: Date | undefined;
      try {
        asOf = parseCheckpoint(body?.asOf, "asOf");
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Invalid asOf." },
          { status: 400 }
        );
      }
      const effectiveAsOf = asOf ?? new Date();
      const result = await expireCreditLots({ dryRun, now: effectiveAsOf });
      return NextResponse.json({
        target,
        result: { ...result, asOf: effectiveAsOf.toISOString() },
      });
    }

    let asOf: Date | undefined;
    let expectedDays: number | null | undefined;
    try {
      asOf = parseCheckpoint(body?.asOf, "asOf");
      expectedDays = parseExpectedDays(body?.expectedDays);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Invalid expiry checkpoint." },
        { status: 400 }
      );
    }
    try {
      const settings = await getExpirySettings({ fresh: true });
      const result = await runCreationExpiry(target as "photo" | "video", {
        dryRun,
        settings,
        asOf,
        expectedDays,
      });
      return NextResponse.json({ target, result });
    } catch (e) {
      if (
        e instanceof Error &&
        e.message === "Expiry settings changed after preview. Preview again."
      ) {
        return NextResponse.json({ error: e.message }, { status: 409 });
      }
      throw e;
    }
  });
}

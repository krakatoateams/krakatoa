import "server-only";

import { NextResponse } from "next/server";
import { cronAuthDecision } from "./cron-auth-pure";

export function cronAuthorizationFailure(req: Request): NextResponse | null {
  const decision = cronAuthDecision({
    authorization: req.headers.get("authorization"),
    secret: process.env.CRON_SECRET,
    deployed:
      process.env.NODE_ENV === "production" ||
      process.env.VERCEL === "1" ||
      Boolean(process.env.VERCEL_ENV),
  });

  if (decision === "allow") return null;
  if (decision === "misconfigured") {
    console.error(
      "[cron auth] CRON_SECRET is required in deployed environments.",
    );
    return NextResponse.json(
      { error: "Cron is unavailable." },
      { status: 503 },
    );
  }
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

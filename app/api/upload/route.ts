import { NextResponse } from "next/server";

/**
 * Legacy multipart upload — removed. Scheduler and all clients must use
 * POST /api/upload/sign (signed direct-to-Storage upload) instead.
 * Multipart through Vercel hits the ~4.5 MB body limit anyway.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "This endpoint is deprecated. Use POST /api/upload/sign for device uploads.",
      redirect: "/api/upload/sign",
    },
    { status: 410 },
  );
}

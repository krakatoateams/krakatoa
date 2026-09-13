import { timingSafeEqual } from "node:crypto";

export type CronAuthDecision = "allow" | "unauthorized" | "misconfigured";

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function cronAuthDecision(input: {
  authorization: string | null;
  secret: string | undefined;
  deployed: boolean;
}): CronAuthDecision {
  const secret = input.secret?.trim();
  if (!secret) return input.deployed ? "misconfigured" : "allow";
  return constantTimeEqual(
    input.authorization ?? "",
    `Bearer ${secret}`,
  )
    ? "allow"
    : "unauthorized";
}

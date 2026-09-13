import { redirect } from "next/navigation";
import { authPageHref } from "@/lib/safe-redirect";

/**
 * Old reset emails used this path directly. A successful legacy callback is
 * now normalized into the proof-gated dashboard modal before it can reach
 * this page; direct visits have no trustworthy recovery proof.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = Array.isArray(params.next) ? params.next[0] : params.next;
  redirect(authPageHref("/forgot-password", next, { error: "expired" }));
}

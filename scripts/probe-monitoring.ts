/**
 * Smoke test for the admin monitoring query layer, without needing an admin
 * session or a running dev server.
 *
 *   npm run admin:probe-monitoring
 *   npm run admin:probe-monitoring -- --window=720 --limit=50
 *
 * Exists because lib/admin-monitoring-db.ts could not be exercised when it was
 * written (Supabase project was restricted: exceed_egress_quota). The three
 * things it proves are the ones a typecheck cannot:
 *   1. the .or(status.in.(...),created_at.gte.<iso>) filter parses server-side
 *   2. the jobs(tool) embed on job_steps resolves via the FK
 *   3. the real column shapes match (credit_transactions.type, nullable job_id)
 *
 * Read-only — it never writes. See docs/admin/admin-monitoring.md.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");

function loadEnv() {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    if (!process.env[key]) process.env[key] = v;
  }
}

function parseArgs(argv: string[]) {
  let windowHours = 720; // 30d — widest useful window for a first look
  let limit = 50;
  for (const arg of argv) {
    if (arg.startsWith("--window=")) {
      const n = Number(arg.slice("--window=".length));
      if (Number.isFinite(n) && n > 0) windowHours = n;
    } else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) limit = n;
    }
  }
  return { windowHours, limit };
}

async function main() {
  loadEnv();
  const { getAdminMonitoring, getAdminJobDetail, getAdminFailedStepAggregates } =
    await import("../lib/admin-monitoring-db");
  const { windowHours, limit } = parseArgs(process.argv.slice(2));

  console.log(`window=${windowHours}h limit=${limit}\n`);

  // 1. list query — exercises the .or() filter and all four batched side reads.
  const { rows, counts, capped } = await getAdminMonitoring({ windowHours, limit });
  console.log("counts:", JSON.stringify(counts));
  console.log(`rows: ${rows.length}${capped ? " (CAPPED — raise --limit)" : ""}\n`);

  for (const r of rows.slice(0, 10)) {
    const step = r.currentStep ? `${r.currentStep.step_key}(${r.currentStep.status})` : "-";
    console.log(
      `  ${r.status.padEnd(11)} ${r.tool}/${r.job_type} model=${r.model ?? "-"}\n` +
        `    step=${step} steps=${r.stepCount} spent=${r.spentCredits} refunded=${r.refundedCredits} ` +
        `cancelReq=${r.cancelRequested} cancelAllowed=${r.cancelAllowed} preds=${r.predictionCount} ` +
        `code=${r.errorCode ?? "-"} flags=[${r.flags.join(",")}]`
    );
  }

  // 2. failing-step aggregate — exercises the jobs(tool) embed on job_steps.
  const failed = await getAdminFailedStepAggregates({ windowHours });
  console.log(`\nfailing steps (${failed.length}):`);
  for (const s of failed.slice(0, 10)) {
    console.log(`  ${String(s.tool ?? "-").padEnd(14)} ${s.step_key.padEnd(24)} x${s.count}`);
  }

  // 3. detail query — prefer a job with a real timeline so the drill-down is proven.
  const target = rows.find((r) => r.stepCount > 2) ?? rows[0];
  if (!target) {
    console.log("\nno jobs in window — widen with --window=");
    return;
  }
  const d = await getAdminJobDetail(target.id);
  console.log(`\ndetail ${target.id} (${d?.job.tool} ${d?.job.status}) flags=[${d?.flags.join(",")}]`);
  console.log(`  steps:       ${d?.steps.map((s) => `${s.step_key}:${s.status}`).join(" → ") || "-"}`);
  console.log(`  ledger:      ${d?.transactions.map((t) => `${t.type}:${t.amount}`).join(", ") || "-"}`);
  console.log(
    `  request:     ${d?.request ? `${d.request.route_key} cancel_allowed=${d.request.cancel_allowed}` : "-"}`
  );
  console.log(`  predictions: ${d?.predictions.length ?? 0}   assets: ${d?.assets.length ?? 0}`);
  console.log(`  recovery:    ${d?.recovery ? `step=${d.recovery.step} resumeAttempts=${d.recovery.resumeAttempts ?? 0}` : "-"}`);

  // The point of the probe: an unhandled throw above is the failure signal.
  console.log("\nprobe-monitoring: ok");
}

main().catch((e) => {
  console.error("\nprobe-monitoring FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});

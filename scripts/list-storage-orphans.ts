/**
 * List orphan / transient objects in Supabase Storage (videos/ + photos/).
 *
 *   npm run storage:list-orphans
 *   npm run storage:list-orphans -- --min-age-hours=0
 *   npm run storage:list-orphans -- --json
 *   npm run storage:list-orphans -- --include-young
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
  let minAgeHours = 24;
  let json = false;
  let includeYoung = false;
  for (const arg of argv) {
    if (arg === "--json") json = true;
    else if (arg === "--include-young") includeYoung = true;
    else if (arg.startsWith("--min-age-hours=")) {
      const n = Number(arg.slice("--min-age-hours=".length));
      if (Number.isFinite(n) && n >= 0) minAgeHours = n;
    }
  }
  return { minAgeHours, json, includeYoung };
}

async function main() {
  loadEnv();
  const { planOrphanAudit, formatOrphanAuditReport } = await import(
    "../lib/storage-orphan-audit"
  );
  const { minAgeHours, json, includeYoung } = parseArgs(process.argv.slice(2));
  const plan = await planOrphanAudit(minAgeHours, { includeYoungOrphans: includeYoung });

  if (json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log(`\nOrphan audit (minAgeHours=${minAgeHours})\n`);
  console.log(formatOrphanAuditReport(plan));
  console.log(
    "\nDelete videos/ only: GET /api/cron/storage-sweep?dryRun=1 (Bearer CRON_SECRET)\n" +
      "Photos: no auto-sweep yet — remove manually from the list above.\n",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Guard: every module a `"use workflow"` file value-imports is inlined into the
 * workflow VM, which has no Node CommonJS globals. A top-level `require.main`
 * self-check there throws at load and the run never reaches step 1 (#335).
 * Step bodies load their code with `await import()` in Node, so dynamic imports are skipped.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const FORBIDDEN = /\brequire\.main\b|\bmodule\.exports\b|\b__dirname\b|\b__filename\b|\bprocess\.binding\b/;
const IMPORT = /^\s*(import|export)\s+([\s\S]*?)\s*from\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm;

type Fs = { read(file: string): string | null };

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`workflowBundleGuardSelfCheck: ${msg}`);
}

function isValueImport(clause: string): boolean {
  if (/^type\b/.test(clause)) return false;
  const named = clause.match(/^\{([\s\S]*)\}$/);
  if (!named) return true; // default, namespace, `export *`, or mixed default + named
  return named[1].split(",").some((s) => s.trim() && !/^type\b/.test(s.trim()));
}

function resolve(fs: Fs, from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(ROOT, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null; // package import
  for (const f of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) if (fs.read(f) !== null) return f;
  return null;
}

/** Violations as "chain -> file: match" strings for one workflow entry file. */
export function workflowBundleViolations(fs: Fs, entry: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.read(file) ?? "";
    const label = [...chain, path.relative(ROOT, file)].join(" -> ");
    const code = src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");
    const hit = chain.length > 0 && code.match(FORBIDDEN);
    if (hit) out.push(`${label}: ${hit[0]}`);
    for (const m of code.matchAll(IMPORT)) {
      const spec = m[3] ?? m[4];
      if (m[3] && !isValueImport(m[2].trim())) continue;
      const next = resolve(fs, file, spec);
      if (next) walk(next, [...chain, path.relative(ROOT, file)]);
    }
  };
  walk(entry, []);
  return out;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

function workflowBundleGuardSelfCheck(): void {
  const mem = (files: Record<string, string>): Fs => ({ read: (f) => files[path.relative(ROOT, f)] ?? null });
  const fixture = {
    "wf.ts": 'import { a } from "./pure";\nimport type { T } from "./typed";\nimport { type U } from "./typed";\nexport async function w() { "use workflow"; const c = await import("./typed"); }',
    "pure.ts": 'export * from "./deep";\nexport const a = 1;',
    "deep.ts": "export const b = 2;\nif (require.main === module) console.log(b);",
    "typed.ts": "export type T = 1; export type U = 2;\nmodule.exports = {};",
  };
  const bad = workflowBundleViolations(mem(fixture), path.join(ROOT, "wf.ts"));
  assert(bad.length === 1 && bad[0] === "wf.ts -> pure.ts -> deep.ts: require.main", `fixture flags only the value chain: ${bad.join("; ")}`);
  const clean = { ...fixture, "deep.ts": "export const b = 2; // require.main is only mentioned here" };
  assert(workflowBundleViolations(mem(clean), path.join(ROOT, "wf.ts")).length === 0, "comments and type imports pass");

  const disk: Fs = { read: (f) => (existsSync(f) && statSync(f).isFile() ? readFileSync(f, "utf8") : null) };
  const entries = ["lib", "app"].flatMap((d) => sourceFiles(path.join(ROOT, d))).filter((f) => f !== __filename && /["']use workflow["']/.test(readFileSync(f, "utf8")));
  assert(entries.length > 0, "found no workflow files");
  const violations = entries.flatMap((f) => workflowBundleViolations(disk, f));
  assert(violations.length === 0, `Node-only globals reachable from a workflow:\n  ${violations.join("\n  ")}`);
  console.log(`workflowBundleGuardSelfCheck: ok (${entries.length} workflow files)`);
}

workflowBundleGuardSelfCheck();

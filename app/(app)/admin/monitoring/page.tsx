"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";
import { AdminTableSkeleton } from "../admin-ui";

/**
 * Cross-user generation monitoring. Read-only: it renders what the pipeline
 * already wrote (jobs, job_steps, credit ledger, cancel flags, Replicate
 * prediction ids) and flags three anomalies — stuck, cancel not honored, and
 * refund missing. No action buttons by design; see the plan's "skipped" notes.
 */

type JobFlag = "stuck" | "cancel_not_honored" | "refund_missing";

type Step = {
  id: string;
  step_key: string;
  step_name: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  error: Record<string, unknown> | null;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  created_at: string;
};

type Row = {
  id: string;
  email: string | null;
  tool: string;
  job_type: string;
  status: string;
  featureLabel: string | null;
  provider: string | null;
  model: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
  errorCode: string | null;
  error: Record<string, unknown> | null;
  currentStep: Step | null;
  stepCount: number;
  failedStepKeys: string[];
  spentCredits: number;
  refundedCredits: number;
  cancelRequested: boolean;
  cancelAllowed: boolean;
  predictionCount: number;
  recoveryStep: string | null;
  resumeAttempts: number;
  flags: JobFlag[];
};

type Counts = {
  running: number;
  queued: number;
  recoverable: number;
  failed: number;
  cancelled: number;
  succeeded: number;
  anomalies: Record<JobFlag, number>;
};

type FailedStep = {
  step_key: string;
  tool: string | null;
  count: number;
  lastAt: string;
  lastMessage: string | null;
};

type Detail = {
  job: Row & { input: Record<string, unknown> | null; output: Record<string, unknown> | null };
  steps: Step[];
  transactions: {
    id: string;
    type: string;
    direction: string;
    status: string;
    amount: number;
    description: string | null;
    idempotency_key: string | null;
    created_at: string;
  }[];
  request: {
    idempotency_key: string;
    route_key: string;
    status: string;
    cancel_requested: boolean;
    cancel_allowed: boolean;
    error_json: Record<string, unknown> | null;
  } | null;
  predictions: { id: string; prediction_id: string; kind: string | null; status: string }[];
  assets: { id: string; asset_type: string; status: string; storage_path: string | null }[];
  recovery: Record<string, unknown> | null;
};

const TH =
  "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500";

const FLAG_LABEL: Record<JobFlag, string> = {
  stuck: "Stuck",
  cancel_not_honored: "Cancel not honored",
  refund_missing: "Refund missing",
};

const FLAG_HINT: Record<JobFlag, string> = {
  stuck: "Active for over 10 minutes with no update — routes are capped at 5 minutes, so this is dead.",
  cancel_not_honored:
    "User asked to cancel over 2 minutes ago, cancel is still allowed, and the job is still running.",
  refund_missing:
    "Terminal job kept credits it should have returned (post-commit cancel and user-abandon are already excluded).",
};

const POLL_MS = 5000;
const PAGE_SIZE = 25;

// Rolls up into d/w/mo so a month-old job reads "4w 1d", not "710h 31m". Step
// durations stay in s/m/h — routes are capped at 300s, so they never reach a day.
function fmtDur(msTotal: number): string {
  if (!Number.isFinite(msTotal) || msTotal < 0) return "—";
  const pair = (a: number, ua: string, b: number, ub: string) =>
    b > 0 ? `${a}${ua} ${b}${ub}` : `${a}${ua}`;
  const s = Math.floor(msTotal / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return pair(m, "m", s % 60, "s");
  const h = Math.floor(m / 60);
  if (h < 24) return pair(h, "h", m % 60, "m");
  const d = Math.floor(h / 24);
  if (d < 7) return pair(d, "d", h % 24, "h");
  if (d < 30) return pair(Math.floor(d / 7), "w", d % 7, "d");
  return pair(Math.floor(d / 30), "mo", d % 30, "d");
}

function since(iso: string | null | undefined): string {
  if (!iso) return "—";
  return fmtDur(Date.now() - Date.parse(iso));
}

/** Wall-clock stamp in the admin's own timezone. Year only when it isn't this one. */
function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === "succeeded" || status === "ready"
      ? "bg-emerald-500/15 text-emerald-300"
      : status === "failed"
        ? "bg-red-500/15 text-red-300"
        : status === "running"
          ? "bg-sky-500/15 text-sky-300"
          : status === "recoverable"
            ? "bg-amber-500/15 text-amber-300"
            : status === "cancelled"
              ? "bg-orange-500/15 text-orange-300"
              : "bg-gray-700 text-gray-300";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${color}`}>{status}</span>;
}

function FlagBadge({ flag }: { flag: JobFlag }) {
  return (
    <span
      title={FLAG_HINT[flag]}
      className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-300"
    >
      <AlertTriangle className="h-3 w-3" />
      {FLAG_LABEL[flag]}
    </span>
  );
}

function Chip({
  label,
  value,
  active,
  tone = "gray",
  onClick,
}: {
  label: string;
  value: number;
  active?: boolean;
  tone?: "gray" | "red";
  onClick?: () => void;
}) {
  const base =
    tone === "red"
      ? "border-red-900/60 bg-red-950/30 text-red-200"
      : "border-gray-800 bg-gray-900/50 text-gray-300";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-2 text-left transition-colors ${base} ${
        active ? "ring-1 ring-violet-500" : "hover:border-gray-700"
      } ${onClick ? "" : "cursor-default"}`}
    >
      <div className="text-[11px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </button>
  );
}

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-gray-600">—</span>;
  return (
    <pre className="max-h-56 overflow-auto rounded-lg bg-black/40 p-2 text-[11px] leading-relaxed text-gray-400">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500">
        {title}
      </h4>
      {children}
    </div>
  );
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/**
 * Prompt surface. Reads only what the pipeline already persists — nothing is
 * reconstructed here. Coverage is uneven by design and the UI says so out loud:
 * motion-control writes `input.prompt`, Reels/Veo/storyboard write `input.theme`
 * (the seed the LLM expands), and the Reels style anchor lands in the
 * `style_anchor` step output. Photo and text/image-to-video assemble their prompt
 * at call time and never store it, so those read "not recorded" rather than blank.
 */
function PromptSection({
  input,
  steps,
}: {
  input: Record<string, unknown> | null;
  steps: Step[];
}) {
  const i = input ?? {};
  const prompt = str(i.prompt);
  const theme = str(i.theme);
  const stepOut = (key: string) => steps.find((s) => s.step_key === key)?.output ?? null;
  const style = stepOut("style_anchor");
  const styleAnchor = str(style?.styleAnchor);
  const negativePrompt = str(style?.negativePrompt);
  const scenes = stepOut("scene_breakdown")?.scenes ?? null;
  // Routes that assemble a prompt (photo wraps pose/style scaffolding around the
  // user's text) record the final string on the generating step, not the job.
  const assembled = steps
    .map((s) => str(s.input?.prompt))
    .find((p) => p && p !== prompt);

  const empty =
    !prompt && !theme && !styleAnchor && !negativePrompt && !scenes && !assembled;

  return (
    <Section title="Prompt">
      {empty ? (
        <p className="text-sm text-gray-500">
          Not recorded — this route builds its prompt at call time and never persists it.
        </p>
      ) : (
        <div className="space-y-2">
          {prompt || theme ? (
            <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-600">
                {prompt ? "User prompt" : "Theme — the seed the LLM expands"}
              </div>
              <p className="whitespace-pre-wrap text-xs text-gray-300">{prompt ?? theme}</p>
            </div>
          ) : null}
          {assembled ? (
            <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-600">
                Assembled prompt — what the model actually received
              </div>
              <p className="whitespace-pre-wrap text-xs text-gray-300">{assembled}</p>
            </div>
          ) : null}
          {styleAnchor ? (
            <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-600">
                Style anchor — appended verbatim to every scene prompt
              </div>
              <p className="whitespace-pre-wrap text-xs text-gray-300">{styleAnchor}</p>
            </div>
          ) : null}
          {negativePrompt ? (
            <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-600">
                Negative prompt
              </div>
              <p className="whitespace-pre-wrap text-xs text-gray-300">{negativePrompt}</p>
            </div>
          ) : null}
          {scenes ? (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-600">
                Scene breakdown
              </div>
              <Json value={scenes} />
            </div>
          ) : null}
        </div>
      )}
    </Section>
  );
}

/** Step timeline + every side-table record for one job. */
function JobDetail({ jobId }: { jobId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    fetch(`/api/admin/monitoring/${jobId}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else setDetail(d as Detail);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load detail.");
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (error) return <p className="p-4 text-sm text-red-400">{error}</p>;
  if (!detail) return <p className="p-4 text-sm text-gray-500">Loading detail…</p>;

  const { job, steps, transactions, request, predictions, assets, recovery } = detail;

  return (
    <div className="grid gap-6 border-t border-gray-800 bg-black/20 p-4 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <PromptSection input={job.input} steps={steps} />
      </div>

      <Section title={`Step timeline (${steps.length})`}>
        {steps.length === 0 ? (
          <p className="text-sm text-gray-500">
            No steps recorded. Short pipelines write only one or two.
          </p>
        ) : (
          <ol className="space-y-2">
            {steps.map((s) => {
              const start = s.started_at ?? s.created_at;
              const end = s.finished_at ?? new Date().toISOString();
              return (
                <li
                  key={s.id}
                  className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-gray-200">{s.step_key}</span>
                    <StatusPill status={s.status} />
                    <span className="text-xs tabular-nums text-gray-500">
                      {fmtDur(Date.parse(end) - Date.parse(start))}
                      {!s.finished_at && s.status === "running" ? " (running)" : ""}
                    </span>
                  </div>
                  {s.error ? (
                    <div className="mt-2">
                      <Json value={s.error} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      <div className="space-y-6">
        <Section title="Credit ledger">
          {transactions.length === 0 ? (
            <p className="text-sm text-gray-500">No credit transactions for this job.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {transactions.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2"
                >
                  <span className="font-medium text-gray-200">{t.type}</span>
                  <span className="tabular-nums text-gray-300">
                    {t.direction === "debit" ? "−" : "+"}
                    {t.amount}
                  </span>
                  <StatusPill status={t.status} />
                  <span className="font-mono text-[10px] text-gray-600">
                    {t.idempotency_key ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Cancel / idempotency">
          {request ? (
            <div className="space-y-1 text-xs text-gray-300">
              <div>
                route <span className="font-mono text-gray-400">{request.route_key}</span> ·
                request status <StatusPill status={request.status} />
              </div>
              <div>
                cancel_requested{" "}
                <span className={request.cancel_requested ? "text-amber-300" : "text-gray-500"}>
                  {String(request.cancel_requested)}
                </span>{" "}
                · cancel_allowed{" "}
                <span className={request.cancel_allowed ? "text-gray-400" : "text-emerald-300"}>
                  {String(request.cancel_allowed)}
                </span>
                {!request.cancel_allowed ? (
                  <span className="text-gray-600"> (provider output committed)</span>
                ) : null}
              </div>
              <div className="font-mono text-[10px] text-gray-600">
                {request.idempotency_key}
              </div>
              {request.error_json ? <Json value={request.error_json} /> : null}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No generation_requests row.</p>
          )}
        </Section>

        <Section title={`Replicate predictions (${predictions.length})`}>
          {predictions.length === 0 ? (
            <p className="text-sm text-gray-500">None recorded.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {predictions.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <a
                    href={`https://replicate.com/p/${p.prediction_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-violet-300 hover:underline"
                  >
                    {p.prediction_id}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <span className="text-gray-500">{p.kind ?? "—"}</span>
                  <StatusPill status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        {recovery ? (
          <Section title="Recovery manifest">
            <Json value={recovery} />
          </Section>
        ) : null}

        <Section title={`Assets (${assets.length})`}>
          {assets.length === 0 ? (
            <p className="text-sm text-gray-500">None.</p>
          ) : (
            <ul className="space-y-1 text-xs text-gray-400">
              {assets.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <StatusPill status={a.status} />
                  <span>{a.asset_type}</span>
                  <span className="truncate font-mono text-[10px] text-gray-600">
                    {a.storage_path ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Job error">
          <Json value={job.error} />
        </Section>

        <Section title="Job input">
          <Json value={job.input} />
        </Section>
      </div>
    </div>
  );
}

export default function AdminMonitoringPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [failedSteps, setFailedSteps] = useState<FailedStep[]>([]);
  const [capped, setCapped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [flag, setFlag] = useState<JobFlag | null>(null);
  const [status, setStatus] = useState<string>("");
  const [windowHours, setWindowHours] = useState(24);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ window: String(windowHours) });
    if (flag) qs.set("flag", flag);
    if (status) qs.set("status", status);
    return fetch(`/api/admin/monitoring?${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setRows(d.rows ?? []);
        setCounts(d.counts ?? null);
        setFailedSteps(d.failedSteps ?? []);
        setCapped(Boolean(d.capped));
        setError(null);
        setRefreshedAt(Date.now());
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => setLoading(false));
  }, [flag, status, windowHours]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [live, load]);

  // Paging is client-side: the API already returns the whole capped window in one
  // payload, so slicing here costs no extra round trip and survives the 5s poll.
  useEffect(() => {
    setPage(0);
  }, [flag, status, windowHours]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pageRows = rows.slice(pageStart, pageStart + PAGE_SIZE);

  const anomalyRows = rows.filter((r) => r.flags.length > 0);
  const totalAnomalies = counts
    ? counts.anomalies.stuck +
      counts.anomalies.cancel_not_honored +
      counts.anomalies.refund_missing
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setLive((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/50 px-3 py-1.5 text-sm text-gray-300 hover:border-gray-700"
        >
          {live ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {live ? `Live · every ${POLL_MS / 1000}s` : "Paused"}
        </button>
        <button
          type="button"
          onClick={() => load()}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/50 px-3 py-1.5 text-sm text-gray-300 hover:border-gray-700"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
        <select
          value={windowHours}
          onChange={(e) => setWindowHours(Number(e.target.value))}
          className="rounded-lg border border-gray-800 bg-gray-900/50 px-3 py-1.5 text-sm text-gray-300"
        >
          <option value={1}>Last 1h</option>
          <option value={6}>Last 6h</option>
          <option value={24}>Last 24h</option>
          <option value={72}>Last 3d</option>
          <option value={168}>Last 7d</option>
          <option value={720}>Last 30d</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-gray-800 bg-gray-900/50 px-3 py-1.5 text-sm text-gray-300"
        >
          <option value="">All statuses</option>
          <option value="running">running</option>
          <option value="queued">queued</option>
          <option value="recoverable">recoverable</option>
          <option value="failed">failed</option>
          <option value="cancelled">cancelled</option>
          <option value="succeeded">succeeded</option>
        </select>
        {flag ? (
          <button
            type="button"
            onClick={() => setFlag(null)}
            className="rounded-lg border border-violet-800 bg-violet-950/40 px-3 py-1.5 text-sm text-violet-200"
          >
            {FLAG_LABEL[flag]} ✕
          </button>
        ) : null}
        <span className="ml-auto text-xs text-gray-600">
          {refreshedAt ? `updated ${since(new Date(refreshedAt).toISOString())} ago` : ""}
        </span>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {counts ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <Chip label="Running" value={counts.running} />
          <Chip label="Queued" value={counts.queued} />
          <Chip label="Recoverable" value={counts.recoverable} />
          <Chip label="Failed" value={counts.failed} />
          <Chip
            label="Stuck"
            tone="red"
            value={counts.anomalies.stuck}
            active={flag === "stuck"}
            onClick={() => setFlag(flag === "stuck" ? null : "stuck")}
          />
          <Chip
            label="Cancel stuck"
            tone="red"
            value={counts.anomalies.cancel_not_honored}
            active={flag === "cancel_not_honored"}
            onClick={() =>
              setFlag(flag === "cancel_not_honored" ? null : "cancel_not_honored")
            }
          />
          <Chip
            label="Refund missing"
            tone="red"
            value={counts.anomalies.refund_missing}
            active={flag === "refund_missing"}
            onClick={() => setFlag(flag === "refund_missing" ? null : "refund_missing")}
          />
        </div>
      ) : null}

      {loading ? (
        <AdminTableSkeleton />
      ) : (
        <>
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
              Anomalies
            </h2>
            {totalAnomalies === 0 ? (
              <p className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-300">
                All clear — nothing stuck, no unhonored cancels, no missing refunds in this
                window.
              </p>
            ) : anomalyRows.length === 0 ? (
              <p className="text-sm text-gray-500">
                {totalAnomalies} anomal{totalAnomalies === 1 ? "y" : "ies"} outside the current
                filter.
              </p>
            ) : (
              <ul className="space-y-2">
                {anomalyRows.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm"
                  >
                    <span className="text-gray-200">{r.email ?? "—"}</span>
                    <span className="text-gray-500" title={r.job_type}>
                      {r.tool} / {r.featureLabel ?? r.job_type}
                    </span>
                    <StatusPill status={r.status} />
                    {r.flags.map((f) => (
                      <FlagBadge key={f} flag={f} />
                    ))}
                    <span className="text-xs text-gray-500">
                      {r.spentCredits > 0
                        ? `${r.spentCredits} spent · ${r.refundedCredits} refunded`
                        : "no spend"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                      className="ml-auto text-xs text-violet-300 hover:underline"
                    >
                      Open
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
              Generations {capped ? "(capped — narrow the window)" : ""}
            </h2>
            {rows.length === 0 ? (
              <p className="text-sm text-gray-500">Nothing matches this filter.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-800">
                <table className="w-full">
                  <thead className="bg-gray-900/60">
                    <tr>
                      <th className={TH}></th>
                      <th className={TH}>User</th>
                      <th className={TH}>Tool / mode</th>
                      <th className={TH}>Model</th>
                      <th className={TH}>Status</th>
                      <th className={TH}>Current step</th>
                      <th className={TH}>Credits</th>
                      <th className={TH}>Flags</th>
                      <th className={TH}>Started</th>
                      <th className={TH}>Age</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {pageRows.map((r) => {
                      const open = expanded === r.id;
                      const step = r.currentStep;
                      const stepEnd = step?.finished_at ?? new Date().toISOString();
                      const stepStart = step?.started_at ?? step?.created_at;
                      return [
                        <tr
                          key={r.id}
                          onClick={() => setExpanded(open ? null : r.id)}
                          className="cursor-pointer text-sm text-gray-300 hover:bg-gray-900/40"
                        >
                          <td className="px-2 py-2 text-gray-600">
                            {open ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </td>
                          <td className="px-3 py-2">{r.email ?? "—"}</td>
                          <td className="px-3 py-2" title={r.job_type}>
                            <div>{r.tool}</div>
                            <div className="text-xs text-gray-500">
                              {r.featureLabel ?? r.job_type}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-400">{r.model ?? "—"}</td>
                          <td className="px-3 py-2">
                            <StatusPill status={r.status} />
                            {r.errorCode ? (
                              <div className="mt-1 font-mono text-[10px] text-red-400">
                                {r.errorCode}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            {step ? (
                              <>
                                <span className="font-mono text-xs text-gray-200">
                                  {step.step_key}
                                </span>
                                <div className="text-xs tabular-nums text-gray-500">
                                  {step.status} ·{" "}
                                  {fmtDur(Date.parse(stepEnd) - Date.parse(stepStart ?? stepEnd))}
                                  {r.stepCount > 1 ? ` · ${r.stepCount} steps` : ""}
                                </div>
                              </>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs tabular-nums">
                            {r.spentCredits}
                            {r.refundedCredits > 0 ? (
                              <span className="text-emerald-400"> → −{r.refundedCredits}</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {r.flags.map((f) => (
                                <FlagBadge key={f} flag={f} />
                              ))}
                              {r.cancelRequested && !r.cancelAllowed ? (
                                <span
                                  title="Cancel arrived after provider output was committed — credits are kept by design."
                                  className="rounded-full bg-gray-700 px-2 py-0.5 text-[11px] text-gray-300"
                                >
                                  cancel locked
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td
                            className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-gray-400"
                            title={new Date(r.created_at).toLocaleString()}
                          >
                            {fmtWhen(r.created_at)}
                          </td>
                          <td className="px-3 py-2 text-xs tabular-nums text-gray-500">
                            {since(r.created_at)}
                          </td>
                        </tr>,
                        open ? (
                          <tr key={`${r.id}-detail`}>
                            <td colSpan={10} className="p-0">
                              <JobDetail jobId={r.id} />
                            </td>
                          </tr>
                        ) : null,
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {rows.length > PAGE_SIZE ? (
              <div className="mt-3 flex items-center gap-3 text-xs text-gray-500">
                <span className="tabular-nums">
                  {pageStart + 1}–{pageStart + pageRows.length} of {rows.length}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    disabled={safePage === 0}
                    onClick={() => setPage(safePage - 1)}
                    className="rounded-lg border border-gray-800 bg-gray-900/50 px-3 py-1.5 text-gray-300 hover:border-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <span className="tabular-nums">
                    {safePage + 1} / {pageCount}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => setPage(safePage + 1)}
                    className="rounded-lg border border-gray-800 bg-gray-900/50 px-3 py-1.5 text-gray-300 hover:border-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          {failedSteps.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
                Failing steps across all users
              </h2>
              <div className="overflow-x-auto rounded-xl border border-gray-800">
                <table className="w-full">
                  <thead className="bg-gray-900/60">
                    <tr>
                      <th className={TH}>Tool</th>
                      <th className={TH}>Step</th>
                      <th className={TH}>Failures</th>
                      <th className={TH}>Last</th>
                      <th className={TH}>Last message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {failedSteps.map((s) => (
                      <tr
                        key={`${s.tool}-${s.step_key}`}
                        className="text-sm text-gray-300"
                      >
                        <td className="px-3 py-2">{s.tool ?? "—"}</td>
                        <td className="px-3 py-2 font-mono text-xs">{s.step_key}</td>
                        <td className="px-3 py-2 tabular-nums">{s.count}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">
                          {since(s.lastAt)} ago
                        </td>
                        <td className="max-w-md truncate px-3 py-2 text-xs text-gray-500">
                          {s.lastMessage ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

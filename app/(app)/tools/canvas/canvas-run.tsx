"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useReactFlow } from "@xyflow/react";
import { Loader2, Square, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useCreditBalance } from "@/app/(app)/credit-balance-context";
import {
  CANVAS_RUN_CONCURRENCY,
  CANVAS_RUN_MAX_NODES,
  canvasNodeFingerprint,
  canvasNodeHasOutput,
  canvasNodeOwnFingerprint,
  canvasRunEstimate,
  planCanvasRun,
  type CanvasRunGraphNode,
  type CanvasRunPlan,
} from "@/lib/canvas-run-plan";
import type { CanvasGraphEdge } from "@/lib/canvas-graph";

/**
 * Chain run: Run on a node executes it plus every upstream node that needs it.
 * Each node runs through its own Generate code (same route, idempotency key,
 * spend and refund rules as a click), so this file holds no billing logic.
 */

export type CanvasRunOutcome = "done" | "failed" | "cancelled" | "insufficient" | "busy" | "auth";

export type CanvasNodeRunner = {
  run: (options: { chain: boolean }) => Promise<CanvasRunOutcome>;
  cancel: () => Promise<unknown>;
  /** Credits this node's Generate would spend right now. */
  cost: () => number;
  /** Reason the node can't run once `pending` nodes have produced output, or null. */
  check: (pending: ReadonlySet<string>) => string | null;
};

export type CanvasRunStatus =
  | { state: "queued" | "running" | "done" | "skipped" }
  | { state: "failed" | "blocked"; reason: string };

type ReadyPlan = Extract<CanvasRunPlan, { ok: true }>;

type CanvasRunContext = {
  canRun: boolean;
  active: boolean;
  statuses: Record<string, CanvasRunStatus>;
  register: (id: string, runner: CanvasNodeRunner) => () => void;
  start: (targetId: string) => void;
};

const RunContext = createContext<CanvasRunContext>({
  canRun: false,
  active: false,
  statuses: {},
  register: () => () => {},
  start: () => {},
});

export function useCanvasRun(): CanvasRunContext {
  return useContext(RunContext);
}

/** Registers the node's latest Generate so a chain run can call it. */
export function useCanvasNodeRunner(id: string, runner: CanvasNodeRunner): void {
  const { register } = useCanvasRun();
  const latest = useRef(runner);
  useLayoutEffect(() => {
    latest.current = runner;
  });
  useEffect(
    () =>
      register(id, {
        run: (options) => latest.current.run(options),
        cancel: () => latest.current.cancel(),
        cost: () => latest.current.cost(),
        check: (pending) => latest.current.check(pending),
      }),
    [id, register]
  );
}

/** Reads the graph at call time, so a chain step sees outputs produced moments ago. */
export function useFreshCanvasGraph<T>(id: string, fallback: T) {
  const { getNodes, getEdges, getNode } = useReactFlow();
  return () => ({
    nodes: getNodes() as unknown as CanvasRunGraphNode[],
    edges: getEdges() as unknown as CanvasGraphEdge[],
    data: (getNode(id)?.data as T | undefined) ?? fallback,
  });
}

/** Node patch for a failed generate: the inline error plus the persisted red-border state. */
export function canvasRunFailure(message: string, fingerprint: string) {
  return { error: message, lastRunError: { message: message.slice(0, 160), fingerprint } };
}

async function fetchBalance(): Promise<number | null> {
  try {
    const res = await fetch("/api/credits/balance", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { balance?: number };
    return typeof data.balance === "number" ? data.balance : null;
  } catch {
    return null;
  }
}

async function runPool(ids: string[], limit: number, work: (id: string) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, ids.length) }, async () => {
      while (next < ids.length) await work(ids[next++]);
    })
  );
}

type Confirming = {
  plan: ReadyPlan;
  costs: Record<string, number>;
  total: number;
  balance: number | null;
  labels: Record<string, string>;
  resolve: (ok: boolean) => void;
};

export function CanvasRunProvider({
  canRun,
  pushHistory,
  children,
}: {
  canRun: boolean;
  pushHistory: () => void;
  children: React.ReactNode;
}) {
  const { getNodes, getEdges } = useReactFlow();
  const { balance } = useCreditBalance();
  const runners = useRef(new Map<string, CanvasNodeRunner>());
  const activeRef = useRef(false);
  const stopRef = useRef(false);
  const runningRef = useRef(new Set<string>());
  const [active, setActive] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, CanvasRunStatus>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);

  const register = useCallback((id: string, runner: CanvasNodeRunner) => {
    runners.current.set(id, runner);
    return () => {
      if (runners.current.get(id) === runner) runners.current.delete(id);
    };
  }, []);

  const setStatus = useCallback((id: string, status: CanvasRunStatus | null) => {
    setStatuses((current) => {
      const next = { ...current };
      if (status) next[id] = status;
      else delete next[id];
      return next;
    });
  }, []);

  const execute = useCallback(
    async (plan: ReadyPlan, costs: Record<string, number>, labels: Record<string, string>) => {
      pushHistory();
      stopRef.current = false;
      setStatuses(
        Object.fromEntries([
          ...plan.skip.map((id) => [id, { state: "skipped" } as CanvasRunStatus]),
          ...plan.run.map((id) => [id, { state: "queued" } as CanvasRunStatus]),
        ])
      );
      // Nodes that ended without output; anything downstream of them is blocked.
      const stopped = new Set<string>();
      let halt: string | null = null;
      const end = (id: string, status: CanvasRunStatus) => {
        stopped.add(id);
        setStatus(id, status);
      };

      for (const level of plan.levels) {
        if (halt || stopRef.current) break;
        const available = await fetchBalance();
        const levelCost = level.reduce((sum, id) => sum + costs[id], 0);
        if (available !== null && levelCost > available) {
          halt = "Not enough credits to continue.";
          break;
        }
        await runPool(level, CANVAS_RUN_CONCURRENCY, async (id) => {
          if (halt || stopRef.current) return;
          const graphNodes = getNodes() as unknown as CanvasRunGraphNode[];
          const node = graphNodes.find((item) => item.id === id);
          const runner = runners.current.get(id);
          if (!node || !runner) {
            end(id, { state: "blocked", reason: "This node was removed." });
            halt = "A node in the run was removed.";
            return;
          }
          if (canvasNodeOwnFingerprint(node) !== plan.own[id]) {
            end(id, { state: "blocked", reason: "Inputs changed. Run again." });
            halt = "A node changed during the run.";
            return;
          }
          // Generated by hand while it waited: reuse it instead of paying again.
          if (
            canvasNodeHasOutput(node) &&
            node.data.runFingerprint ===
              canvasNodeFingerprint(id, graphNodes, getEdges() as unknown as CanvasGraphEdge[])
          ) {
            setStatus(id, { state: "skipped" });
            return;
          }
          setStatus(id, { state: "running" });
          runningRef.current.add(id);
          const outcome = await runner.run({ chain: true });
          runningRef.current.delete(id);
          if (outcome === "done") {
            setStatus(id, { state: "done" });
            return;
          }
          const after = (getNodes() as unknown as CanvasRunGraphNode[]).find((item) => item.id === id);
          const message = typeof after?.data.error === "string" ? after.data.error : "";
          if (outcome === "failed") {
            end(id, { state: "failed", reason: message || "Generation failed." });
            halt = "A node failed.";
          } else if (outcome === "insufficient") {
            end(id, { state: "blocked", reason: "Not enough credits." });
            halt = "Not enough credits to continue.";
          } else if (outcome === "busy") {
            end(id, { state: "blocked", reason: "Already running. Wait for it to finish." });
            halt = "A node was already running.";
          } else if (outcome === "auth") {
            end(id, { state: "blocked", reason: "Sign in to continue." });
            halt = "Sign in to continue the run.";
          } else {
            end(id, { state: "blocked", reason: "Cancelled." });
            halt = "Run stopped.";
          }
        });
      }

      // Settle what never started: blocked behind a stopped node, or left idle on Stop.
      setStatuses((current) => {
        const next = { ...current };
        for (const id of plan.run) {
          if (next[id]?.state !== "queued") continue;
          const cause = plan.deps[id].find((dep) => stopped.has(dep));
          if (cause) {
            stopped.add(id);
            next[id] = { state: "blocked", reason: `Blocked by ${labels[cause] ?? "an earlier node"}` };
          } else if (stopRef.current) {
            delete next[id];
          } else {
            stopped.add(id);
            next[id] = { state: "blocked", reason: halt ?? "Not started." };
          }
        }
        return next;
      });
      setNotice(stopRef.current ? "Run stopped." : halt);
      activeRef.current = false;
      setActive(false);
    },
    [getEdges, getNodes, pushHistory, setStatus]
  );

  const start = useCallback(
    (targetId: string) => {
      if (!canRun || activeRef.current) return;
      activeRef.current = true;
      const release = () => {
        activeRef.current = false;
      };
      const nodes = getNodes() as unknown as CanvasRunGraphNode[];
      const edges = getEdges() as unknown as CanvasGraphEdge[];
      const labels = Object.fromEntries(
        nodes.map((node) => [node.id, node.data.label?.trim() || "Untitled node"])
      );
      const plan = planCanvasRun({ nodes, edges, targetId });
      setNotice(null);
      setStatuses({});
      if (!plan.ok) {
        release();
        if (plan.reason === "cycle") {
          setNotice(`These nodes feed each other in a loop: ${plan.nodeIds.map((id) => labels[id]).join(", ")}. Remove a connection to run.`);
        } else if (plan.reason === "too-many") {
          setNotice(`This run needs ${plan.count} nodes. Run up to ${CANVAS_RUN_MAX_NODES} at a time by starting from an earlier node.`);
        }
        return;
      }
      if (plan.run.length === 0) {
        release();
        setNotice("Everything feeding this node is up to date. Use Generate to make a new version.");
        return;
      }

      const pending = new Set(plan.run);
      const issues: Record<string, string> = {};
      for (const id of plan.run) {
        const runner = runners.current.get(id);
        const issue = runner ? runner.check(pending) : "This node isn't ready yet.";
        if (issue) issues[id] = issue;
      }
      if (Object.keys(issues).length > 0) {
        release();
        const next: Record<string, CanvasRunStatus> = {};
        for (const [id, reason] of Object.entries(issues)) next[id] = { state: "blocked", reason };
        setStatuses(next);
        setNotice("Fix the highlighted nodes, then run again. Nothing was charged.");
        return;
      }

      const costs = Object.fromEntries(plan.run.map((id) => [id, runners.current.get(id)!.cost()]));
      const total = canvasRunEstimate(plan, (id) => costs[id]);
      if (balance !== null && total > balance) {
        release();
        setNotice(`Insufficient credits. Required: ${total}, current: ${balance}.`);
        return;
      }

      // Every Run confirms its cost first, even when only the clicked node runs.
      setActive(true);
      const go = () => void execute(plan, costs, labels);
      setConfirming({
        plan,
        costs,
        total,
        balance,
        labels,
        resolve: (ok) => {
          setConfirming(null);
          if (ok) go();
          else {
            release();
            setActive(false);
          }
        },
      });
    },
    [balance, canRun, execute, getEdges, getNodes]
  );

  const stop = useCallback(() => {
    stopRef.current = true;
    for (const id of runningRef.current) void runners.current.get(id)?.cancel();
  }, []);

  const dismiss = useCallback(() => {
    setNotice(null);
    setStatuses({});
  }, []);

  const value = useMemo(
    () => ({ canRun, active, statuses, register, start }),
    [active, canRun, register, start, statuses]
  );

  return (
    <RunContext.Provider value={value}>
      {children}
      <CanvasRunSummary
        active={active && !confirming}
        statuses={statuses}
        notice={notice}
        onStop={stop}
        onDismiss={dismiss}
      />
      <ConfirmDialog
        open={confirming !== null}
        title={confirming && confirming.plan.run.length === 1 ? "Run this node?" : "Run this chain?"}
        description="Keep this tab open until it finishes. Closing it stops new steps; steps already running still finish and are saved to your library."
        confirmLabel={confirming ? `Run for ${confirming.total} credits` : "Run"}
        confirmVariant="primary"
        onConfirm={() => confirming?.resolve(true)}
        onCancel={() => confirming?.resolve(false)}
      >
        {confirming ? (
          <div className="mt-4 text-sm">
            <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {confirming.plan.run.map((id) => (
                <li key={id} className="flex justify-between gap-3">
                  <span className="truncate text-text-secondary">{confirming.labels[id]}</span>
                  <span className="shrink-0 tabular-nums text-text-primary">{confirming.costs[id]}</span>
                </li>
              ))}
            </ul>
            {confirming.plan.skip.length > 0 ? (
              <p className="mt-2 text-xs text-text-secondary">
                {confirming.plan.skip.length} up-to-date {confirming.plan.skip.length === 1 ? "node is" : "nodes are"} reused at no cost.
              </p>
            ) : null}
            <div className="mt-3 flex justify-between border-t border-white/10 pt-3 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{confirming.total} credits</span>
            </div>
            {confirming.balance !== null ? (
              <p className="mt-1 text-right text-xs text-text-secondary">Balance: {confirming.balance}</p>
            ) : null}
          </div>
        ) : null}
      </ConfirmDialog>
    </RunContext.Provider>
  );
}

function CanvasRunSummary({
  active,
  statuses,
  notice,
  onStop,
  onDismiss,
}: {
  active: boolean;
  statuses: Record<string, CanvasRunStatus>;
  notice: string | null;
  onStop: () => void;
  onDismiss: () => void;
}) {
  const counts = { done: 0, failed: 0, blocked: 0, total: 0 };
  for (const status of Object.values(statuses)) {
    if (status.state === "skipped") continue;
    counts.total += 1;
    if (status.state === "done") counts.done += 1;
    if (status.state === "failed") counts.failed += 1;
    if (status.state === "blocked") counts.blocked += 1;
  }
  if (!active && !notice && counts.total === 0) return null;
  const parts = [`${counts.done} of ${counts.total} done`];
  if (counts.failed) parts.push(`${counts.failed} failed`);
  if (counts.blocked) parts.push(`${counts.blocked} blocked`);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto absolute left-1/2 top-3 z-30 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-xl border border-white/10 bg-N50/95 px-3 py-2 text-xs text-text-primary shadow-lg shadow-black/40"
    >
      {active ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-secondary" aria-hidden /> : null}
      <div className="min-w-0 flex-1">
        {counts.total > 0 ? <p className="font-medium">{parts.join(", ")}</p> : null}
        {notice ? <p className="text-text-secondary">{notice}</p> : null}
      </div>
      {active ? (
        <button
          type="button"
          onClick={onStop}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-3 font-semibold hover:bg-white/15 md:h-8"
        >
          <Square className="h-3 w-3" aria-hidden />
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss run summary"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-icon-low-emphasis hover:bg-white/10 hover:text-text-primary md:h-8 md:w-8"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

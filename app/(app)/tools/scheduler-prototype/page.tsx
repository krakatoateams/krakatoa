import SchedulerPrototypeClient from "./SchedulerPrototypeClient";

// ── PROTOTYPE — throwaway exploration, not the real Scheduler ──────────────
// Answers one design question: does a platform-aware, reactive media limit
// (vs. today's "drop everything, silently truncate at submit time") feel
// better? No real upload/scheduling here — everything is local/mocked.
// Doesn't touch SchedulerPageClient.tsx or any of its imports.
export default function SchedulerPrototypePage() {
  return <SchedulerPrototypeClient />;
}

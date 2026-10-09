/** Self-check for `editor-export-pure.ts`, kept out of that module because the export workflow bundles it. */
import {
  EDITOR_EXPORT_ERRORS,
  EDITOR_EXPORT_PHASE_TIMEOUT_MS,
  EditorExportPhaseTimeout,
  type EditorExportErrorCode,
  classifyEditorExportFailure,
  classifySandboxCreateError,
  editorExportEncodePollMs,
  editorExportTimeoutMs,
  editorExportVcpus,
  nextEncodeStall,
  signedUploadArgs,
  withPhaseTimeout,
} from "./editor-export-pure";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`editor-export self-check: ${msg}`);
}

async function editorExportPureSelfCheck(): Promise<void> {
  const c = classifyEditorExportFailure;
  assert(c({ stage: "encode", timedOut: true }) === "EDITOR_EXPORT_TIMEOUT", "timeout");
  assert(c({ stage: "setup" }) === "EDITOR_EXPORT_RUNNER_UNAVAILABLE", "setup failure");
  assert(c({ stage: "upload", exitCode: 22 }) === "EDITOR_EXPORT_UPLOAD_FAILED", "upload failure");
  assert(c({ stage: "encode", exitCode: 137 }) === "EDITOR_EXPORT_OUT_OF_MEMORY", "oom exit code");
  assert(c({ stage: "encode", exitCode: 1, stderr: "HTTP error 403 Forbidden" }) === "EDITOR_EXPORT_INPUT_UNAVAILABLE", "input 403");
  assert(c({ stage: "encode", exitCode: 1, stderr: "Error while filtering" }) === "EDITOR_EXPORT_ENCODER_FAILED", "generic encoder failure");
  for (const code of Object.keys(EDITOR_EXPORT_ERRORS) as EditorExportErrorCode[]) {
    assert(!/[\u0080-￿]/.test(EDITOR_EXPORT_ERRORS[code]) && !/https?:|token/i.test(EDITOR_EXPORT_ERRORS[code]), `${code} message is plain English`);
  }
  assert(editorExportVcpus({ resolution: 720 }) === 2 && editorExportVcpus({ resolution: 1080 }) === 4, "runner sizing");
  assert(editorExportVcpus({ resolution: 480 }) === 2 && editorExportVcpus({ resolution: 2160 }) === 4, "4K clamped to Hobby");
  assert(editorExportVcpus({ resolution: 2160 }, { EDITOR_EXPORT_MAX_VCPUS: "8" }) === 8, "vcpu ceiling env");
  assert(editorExportVcpus({ resolution: 2160 }, { EDITOR_EXPORT_MAX_VCPUS: "junk" }) === 4, "invalid vcpu env");
  const t = editorExportTimeoutMs;
  assert(t({}) === 40 * 60_000, "default timeout 40 min");
  assert(t({ EDITOR_EXPORT_TIMEOUT_MS: "999999999" }) === 45 * 60_000, "timeout clamped to plan max");
  assert(t({ EDITOR_EXPORT_TIMEOUT_MS: "60000" }) === 60_000, "timeout override below ceiling");
  assert(t({ EDITOR_EXPORT_TIMEOUT_MS: "abc" }) === 40 * 60_000 && t({ EDITOR_EXPORT_TIMEOUT_MS: "-5" }) === 40 * 60_000, "invalid timeout env");
  assert(t({ EDITOR_EXPORT_TIMEOUT_MS: "999999999", EDITOR_EXPORT_PLAN_MAX_MS: "7200000" }) === 7_200_000, "plan max env");
  assert(editorExportEncodePollMs(0) === 3_000 && editorExportEncodePollMs(40) === 12_000, "adaptive poll");
  const apiErr = (status: number) => ({ response: { status } });
  assert(classifySandboxCreateError(apiErr(429)) === "EDITOR_EXPORT_BUSY", "429 busy");
  assert(classifySandboxCreateError(apiErr(402)) === "EDITOR_EXPORT_CAPACITY_REACHED", "402 capacity");
  assert(classifySandboxCreateError(apiErr(500)) === "EDITOR_EXPORT_RUNNER_UNAVAILABLE" && classifySandboxCreateError(null) === "EDITOR_EXPORT_RUNNER_UNAVAILABLE", "other create errors");
  const args = signedUploadArgs({ url: "https://x/y", file: "export/o.mp4", contentType: "video/mp4", cacheControl: "31536000, immutable" });
  assert(args.includes("cache-control: max-age=31536000, immutable") && args.at(-1) === "https://x/y", "signed upload argv");

  const phases = Object.values(EDITOR_EXPORT_PHASE_TIMEOUT_MS).reduce((a, b) => a + b, 0);
  assert(phases < 300_000, "start phases fit the 300 s step limit");
  const hung = await withPhaseTimeout("create", new Promise(() => {}), 5).catch((e: unknown) => e);
  assert(hung instanceof EditorExportPhaseTimeout && hung.phase === "create", "hung phase times out");
  assert((await withPhaseTimeout("sign", Promise.resolve(7), 50)) === 7, "fast phase resolves");

  const M = 60_000;
  let s = nextEncodeStall(null, null, 0);
  assert(!s.stalled && s.stall.sinceMs === 0, "first poll starts the clock");
  assert(nextEncodeStall(s.stall, null, 5 * M).stalled, "no out_time_us for 5 min stalls");
  s = nextEncodeStall(s.stall, 1_000, 4 * M);
  assert(!s.stalled && s.stall.sinceMs === 4 * M, "first reading resets the clock");
  assert(nextEncodeStall(s.stall, 1_000, 9 * M).stalled, "frozen out_time_us stalls");
  assert(!nextEncodeStall(s.stall, 1_000, 8 * M).stalled, "under the window is fine");
  let slow = s.stall;
  for (let t = 5 * M; t <= 30 * M; t += M) {
    const n = nextEncodeStall(slow, slow.outUs! + 1, t);
    assert(!n.stalled, "slow but advancing encode never stalls");
    slow = n.stall;
  }
  assert(nextEncodeStall(slow, null, slow.sinceMs + 5 * M).stalled, "unreadable progress keeps the old clock");
}

editorExportPureSelfCheck().then(() => console.log("editorExportPureSelfCheck: ok"));

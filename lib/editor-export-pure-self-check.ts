/** Self-check for `editor-export-pure.ts`, kept out of that module because the export workflow bundles it. */
import {
  EDITOR_EXPORT_ERRORS,
  EDITOR_EXPORT_PHASE_TIMEOUT_MS,
  EDITOR_EXPORT_START_BUDGET_MS,
  EditorExportPhaseTimeout,
  type EditorExportPhase,
  type EditorExportErrorCode,
  classifyEditorExportFailure,
  classifySandboxCreateError,
  editorExportEncodePollMs,
  editorExportMaxFileBytes,
  editorExportPhaseLimitMs,
  editorExportTimeoutMs,
  editorExportVcpus,
  nextEncodeStall,
  signedUploadArgs,
  uploadHttpStatus,
  withPhaseTimeout,
} from "./editor-export-pure";
import {
  EDITOR_EXPORT_MAX_FILE_BYTES,
  EXPORT_FORMAT_SPEC,
  EXPORT_FORMATS,
  EXPORT_RESOLUTIONS,
  exportDimensions,
  exportVideoArgs,
  exportVideoBitrateCapKbps,
} from "./editor-export-settings";

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
  assert(!args.includes("--fail") && args.includes("\\n%{http_code}"), "upload prints the HTTP status last");
  assert(uploadHttpStatus('{"Key":"krakatoa/u/v.mp4"}\n200') === 200 && uploadHttpStatus("413") === 413, "upload status parsed");
  const supabaseTooLarge = '{"statusCode":"413","error":"Payload too large","message":"The object exceeded the maximum allowed size"}\n400';
  assert(uploadHttpStatus(supabaseTooLarge) === 413, "Supabase 400 with statusCode 413 = too large");
  assert(uploadHttpStatus('{"statusCode":"4130"}\n400') === 400 && uploadHttpStatus('{"statusCode":"403"}\n400') === 400, "other 400s stay 400");
  assert(uploadHttpStatus("") === null && uploadHttpStatus("000") === null && uploadHttpStatus("junk") === null, "no response = null");
  assert(c({ stage: "upload", exitCode: 0, httpStatus: 413 }) === "EDITOR_EXPORT_FILE_TOO_LARGE", "413 = file too large");
  assert(c({ stage: "upload", exitCode: 0, httpStatus: 400 }) === "EDITOR_EXPORT_UPLOAD_FAILED", "other HTTP errors stay upload failed");
  assert(c({ stage: "upload", exitCode: 7, httpStatus: null }) === "EDITOR_EXPORT_UPLOAD_FAILED", "network failure stays upload failed");

  // Size cap: whenever applied, worst case (rate x (length + 2 s VBV buffer) + audio) fits ~42 MB of the 50 MB limit.
  assert(editorExportMaxFileBytes({}) === 50_000_000 && EDITOR_EXPORT_MAX_FILE_BYTES === 50_000_000, "50 MB default limit");
  assert(editorExportMaxFileBytes({ EDITOR_EXPORT_MAX_FILE_BYTES: "100000000" }) === 100_000_000, "limit env override");
  assert(editorExportMaxFileBytes({ EDITOR_EXPORT_MAX_FILE_BYTES: "junk" }) === 50_000_000, "invalid limit env");
  const cap = (format: (typeof EXPORT_FORMATS)[number], resolution: (typeof EXPORT_RESOLUTIONS)[number], durationSec: number, hasAudio = true, maxFileBytes?: number) => {
    const { w, h } = exportDimensions("16:9", resolution);
    return exportVideoBitrateCapKbps({ format, width: w, height: h, durationSec, hasAudio, maxFileBytes });
  };
  for (const format of EXPORT_FORMATS) {
    const audioKbps = Number.parseInt(EXPORT_FORMAT_SPEC[format].audioBitrate, 10);
    for (const resolution of EXPORT_RESOLUTIONS) {
      for (const sec of [0.1, 1, 5, 10, 20, 30, 45, 60]) {
        for (const hasAudio of [true, false]) {
          const k = cap(format, resolution, sec, hasAudio);
          if (k === null) continue;
          const worstBytes = ((k * (sec + 2) + (hasAudio ? audioKbps * sec : 0)) * 1000) / 8;
          assert(worstBytes <= 42_000_000, `${format} ${resolution}p ${sec}s fits the target (${Math.round(worstBytes)})`);
        }
      }
    }
  }
  assert(cap("mp4", 2160, 20) !== null && cap("mp4", 2160, 60)! < cap("mp4", 2160, 20)!, "4K is capped, tighter when longer");
  assert(cap("mp4", 2160, 60)! >= 5_000, "4K 60 s still gets ~5 Mbps");
  assert(cap("mp4", 2160, 1) === null, "short 4K never reaches the limit: uncapped");
  for (const resolution of [480, 720, 1080] as const) assert(cap("mp4", resolution, 20) === null, `${resolution}p 20 s unaffected`);
  assert(cap("mp4", 480, 60) === null, "480p never capped");
  // Boundary: capped only where CRF on detailed footage could pass the limit.
  assert(cap("mp4", 1080, 20) === null && cap("mp4", 1080, 30) !== null, "1080p capped from ~25 s");
  assert(cap("mp4", 720, 45) === null && cap("mp4", 720, 60) !== null, "720p capped only near 60 s");
  assert(cap("mp4", 2160, 20, true, 1_000_000_000) === null, "a larger limit lifts the cap");
  assert(cap("mp4", 2160, 60, false)! > cap("mp4", 2160, 60, true)!, "audio bits come out of the video budget");
  const mp4Args = exportVideoArgs({ format: "mp4", quality: "high" }, 5000).join(" ");
  assert(mp4Args.includes("-crf 20 -maxrate 5000k -bufsize 10000k"), "x264 keeps CRF, capped by VBV");
  assert(exportVideoArgs({ format: "webm", quality: "high" }, 5000).join(" ").includes("-b:v 5000k -crf 28"), "VP9 constrained quality");
  assert(exportVideoArgs({ format: "mp4", quality: "high" }).join(" ") === "-c:v libx264 -crf 20 -pix_fmt yuv420p", "uncapped args unchanged");

  const order: EditorExportPhase[] = ["sign", "probe", "create", "prepare", "ffmpegStart"];
  for (const snapshot of [true, false]) {
    // Worst case: every phase runs to its limit. The total still ends inside the step.
    let elapsed = 0;
    for (const phase of order) elapsed += editorExportPhaseLimitMs(phase, elapsed, snapshot);
    assert(elapsed <= EDITOR_EXPORT_START_BUDGET_MS && EDITOR_EXPORT_START_BUDGET_MS < 300_000, `start phases fit the 300 s step (snapshot=${snapshot})`);
    assert(editorExportPhaseLimitMs("ffmpegStart", elapsed - EDITOR_EXPORT_PHASE_TIMEOUT_MS.ffmpegStart, snapshot) === 30_000, "ffmpegStart keeps its reserve");
  }
  assert(editorExportPhaseLimitMs("prepare", 10_000, true) === 90_000, "snapshot prepare unchanged");
  assert(editorExportPhaseLimitMs("prepare", 10_000, false) >= 140_000, "slow no-snapshot install fits");
  assert(editorExportPhaseLimitMs("prepare", 300_000, false) === 0, "exhausted budget times out at once");
  const hung = await withPhaseTimeout("create", new Promise(() => {}), 5).catch((e: unknown) => e);
  assert(hung instanceof EditorExportPhaseTimeout && hung.phase === "create", "hung phase times out");
  assert((await withPhaseTimeout("sign", Promise.resolve(7), 50)) === 7, "fast phase resolves");

  const M = 60_000;
  let s = nextEncodeStall(null, null, 0);
  assert(!s.stalled && s.stall.sinceMs === 0, "first poll starts the clock");
  assert(!nextEncodeStall(s.stall, null, 9 * M).stalled, "slow input open before first progress is not a stall");
  assert(nextEncodeStall(s.stall, null, 10 * M).stalled, "no out_time_us within the allowance stalls");
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

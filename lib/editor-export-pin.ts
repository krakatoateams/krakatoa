/**
 * Pinned, checksum-verified FFmpeg + font for the Editor export sandbox. One verification routine shared by the
 * runtime fallback (no snapshot configured) and `scripts/bake-editor-ffmpeg.ts`. No `server-only` so the bake
 * script and self-check run under tsx. Runnable as `npx tsx lib/editor-export-pin.ts`.
 */
import { createHash } from "node:crypto";
import { EDITOR_FONT_URL } from "@/lib/editor-font";

export const FFMPEG_VERSION = "7.0.2";
/** Exact-version file (not the moving "release" URL). */
export const FFMPEG_URL = `https://johnvansickle.com/ffmpeg/releases/ffmpeg-${FFMPEG_VERSION}-amd64-static.tar.xz`;
/** SHA-256 computed from the downloaded file; its MD5 matched the publisher's .md5 for this release (2026-10-09). */
export const FFMPEG_SHA256 = "abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67";
/** SHA-256 of Poppins-ExtraBold.ttf at the pinned google/fonts revision in `lib/editor-font.ts`. */
export const FONT_SHA256 = "f2ab17c1a63a0ecc12c2461848fc8a469395e3cd2d641803e889c643d9f958e1";

export const WORK = "export";
export const FFMPEG_BIN = `${WORK}/ff/ffmpeg`;
export const FONT_FILE = `${WORK}/Poppins.ttf`;

export type SandboxRun = (cmd: string, args: string[]) => Promise<{ ok: boolean; stdout: string }>;

export const sha256Hex = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** True when `sha256sum` output ("<hex>  <file>") carries exactly the expected digest. */
export function sha256SumMatches(sumOutput: string, expectedHex: string): boolean {
  return sumOutput.trim().split(/\s+/)[0]?.toLowerCase() === expectedHex.toLowerCase();
}

async function downloadVerified(run: SandboxRun, url: string, dest: string, sha256: string): Promise<boolean> {
  if (!(await run("curl", ["-fsSL", "--retry", "3", "-o", dest, url])).ok) return false;
  const sum = await run("sha256sum", [dest]);
  return sum.ok && sha256SumMatches(sum.stdout, sha256);
}

/** Download + verify + extract the pinned FFmpeg (and optionally the font). False = fail closed. */
export async function installPinnedTools(run: SandboxRun, withFont: boolean): Promise<boolean> {
  if (!(await run("mkdir", ["-p", `${WORK}/ff`])).ok) return false;
  const tarball = `${WORK}/ff.tar.xz`;
  if (!(await downloadVerified(run, FFMPEG_URL, tarball, FFMPEG_SHA256))) return false;
  if (!(await run("tar", ["-xJf", tarball, "-C", `${WORK}/ff`, "--strip-components=1"])).ok) return false;
  return !withFont || downloadVerified(run, EDITOR_FONT_URL, FONT_FILE, FONT_SHA256);
}

/** Cheap sanity check of the FFmpeg build the graph needs. Whole-word encoder match ("libvpx-vp9" is not "libvpx"). */
export async function ffmpegHasCapabilities(run: SandboxRun, encoders: string[], needsFont: boolean): Promise<boolean> {
  const [enc, filt, ver] = await Promise.all([
    run(FFMPEG_BIN, ["-hide_banner", "-encoders"]),
    run(FFMPEG_BIN, ["-hide_banner", "-filters"]),
    run(FFMPEG_BIN, ["-hide_banner", "-version"]),
  ]);
  if (!enc.ok || !filt.ok || !ver.ok) return false;
  if (!/\bdrawtext\b/.test(filt.stdout) || !ver.stdout.includes("--enable-libfreetype")) return false;
  if (!encoders.every((e) => new RegExp(`\\s${e}\\s`).test(enc.stdout))) return false;
  return !needsFont || (await run("test", ["-f", FONT_FILE])).ok;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`editor-export-pin self-check: ${msg}`);
}

export async function editorExportPinSelfCheck(): Promise<void> {
  const abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"; // SHA-256("abc")
  assert(sha256Hex("abc") === abc, "known test vector");
  assert(sha256SumMatches(`${abc}  export/ff.tar.xz\n`, abc), "sum matches");
  assert(!sha256SumMatches(`${abc.replace(/^./, "0")}  x`, abc) && !sha256SumMatches("", abc), "sum mismatch fails");
  assert(/^[0-9a-f]{64}$/.test(FFMPEG_SHA256) && /^[0-9a-f]{64}$/.test(FONT_SHA256) && !FFMPEG_URL.includes("release-amd64"), "pins are exact");

  // Fail closed: a wrong tarball digest must stop before extraction and before anything is executed.
  const calls: string[] = [];
  const fake: SandboxRun = async (cmd) => {
    calls.push(cmd);
    return { ok: true, stdout: cmd === "sha256sum" ? `${"0".repeat(64)}  f` : "" };
  };
  assert(!(await installPinnedTools(fake, true)) && !calls.includes("tar"), "bad checksum never extracts");

  const good = (stdout: Record<string, string>): SandboxRun => async (_c, a) => ({ ok: true, stdout: stdout[a[1]] ?? "" });
  const encOut = " V....D libx264  \n V....D libvpx-vp9 \n A....D libopus \n A....D aac ";
  const caps = { "-encoders": encOut, "-filters": " T drawtext ", "-version": "--enable-libfreetype" };
  assert(await ffmpegHasCapabilities(good(caps), ["libx264", "aac"], false), "capable build passes");
  assert(!(await ffmpegHasCapabilities(good({ ...caps, "-version": "" }), ["libx264"], false)), "missing libfreetype fails");
  assert(!(await ffmpegHasCapabilities(good({ ...caps, "-encoders": " V libvpx " }), ["libvpx-vp9"], false)), "missing encoder fails");
}

if (require.main === module) {
  editorExportPinSelfCheck().then(() => console.log("editorExportPinSelfCheck: ok"));
}

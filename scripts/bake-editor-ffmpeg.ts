/**
 * One-off: bake the Vercel Sandbox snapshot the Editor export boots from.
 * Usage: `vercel env pull` (OIDC token, expires after 12 h) then `npm run editor:bake-ffmpeg`.
 * Prints the snapshot id to set as EDITOR_EXPORT_SNAPSHOT_ID (the snapshot is region-bound; never expires).
 */
import { Sandbox } from "@vercel/sandbox";
import { ffmpegHasCapabilities, ffmpegSmokeEncodes, installPinnedTools, type SandboxRun } from "../lib/editor-export-pin";

const REQUIRED_ENCODERS = ["libx264", "libvpx-vp9", "libopus", "aac"];

async function main() {
  const sandbox = await Sandbox.create({ timeout: 15 * 60 * 1000, persistent: false });
  try {
    const run: SandboxRun = async (cmd, args) => {
      const r = await sandbox.runCommand(cmd, args);
      return { ok: r.exitCode === 0, stdout: await r.stdout() };
    };
    if (!(await installPinnedTools(run, true))) throw new Error("Pinned FFmpeg/font download or SHA-256 verification failed.");
    if (!(await ffmpegHasCapabilities(run, REQUIRED_ENCODERS, true))) throw new Error("FFmpeg capability check failed.");
    if (!(await ffmpegSmokeEncodes(run))) throw new Error("FFmpeg drawtext/MP4/WebM smoke encode failed.");
    for (const tool of ["tar", "curl"]) console.log((await run(tool, ["--version"])).stdout.split("\n")[0]);
    const snapshot = await sandbox.snapshot({ expiration: 0 });
    console.log(`EDITOR_EXPORT_SNAPSHOT_ID=${snapshot.snapshotId}`);
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "bake failed");
  process.exit(1);
});

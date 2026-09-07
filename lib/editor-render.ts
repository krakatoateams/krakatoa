/**
 * Build the Rendi FFmpeg graph for an Editor export: black composition of
 * `durationSec`, overlay each clip full-frame in its time window, then
 * overlay / drawtext with enable='between(t,…)'.
 *
 * Pure graph builder — runnable as `npx tsx lib/editor-render.ts`.
 * The route calls `runEditorRender` which talks to Rendi.
 */

import {
  runRendiCommandWithRetry,
  getRendiOutputUrl,
  type RunRendiOptions,
} from "@/lib/rendi";
import { getFontUrl } from "@/lib/reels-pipeline/rendi-stitch";
import {
  EDITOR_CANVAS,
  clipLayerDurationSec,
  clipSourceOutSec,
  sequenceDurationSec,
  sortedOverlays,
  sortedSequence,
  validateEditorExport,
  type EditorClip,
  type EditorDocument,
  type EditorOverlay,
} from "@/lib/editor-document";

export type EditorMediaUrls = Record<string, string>;

export type EditorFfmpegGraph = {
  command: string;
  inputFiles: Record<string, string>;
  outputFiles: Record<string, string>;
  durationSec: number;
  width: number;
  height: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function escapeDrawtext(text: string): string {
  return text
    .slice(0, 200)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\u2019")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}

function colorToFfmpeg(color: string): string {
  const hex = color.replace("#", "").toUpperCase();
  return hex.length === 6 ? `0x${hex}` : "0xFFFFFF";
}

function mediaUrlFor(
  urls: EditorMediaUrls,
  creationId: string | null,
  storagePath: string | null,
  id: string
): string | null {
  if (urls[id]) return urls[id];
  if (creationId && urls[creationId]) return urls[creationId];
  if (storagePath && urls[storagePath]) return urls[storagePath];
  return null;
}

function placeClipFilter(
  inputIndex: number,
  clip: EditorClip,
  width: number,
  height: number,
  label: string
): string {
  const start = round2(clip.inSec);
  const end = round2(clipSourceOutSec(clip));
  const at = round2(clip.startSec);
  return (
    `[${inputIndex}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS+${at}/TB,` +
    `fps=30,scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[${label}]`
  );
}

export function buildEditorFfmpegGraph(
  doc: EditorDocument,
  urls: EditorMediaUrls
): EditorFfmpegGraph {
  const invalid = validateEditorExport(doc);
  if (invalid) throw new Error(invalid.message);

  const { w: width, h: height } = EDITOR_CANVAS[doc.aspect];
  const durationSec = round2(sequenceDurationSec(doc));
  const sequence = sortedSequence(doc);
  const overlays = sortedOverlays(doc);

  const inputFiles: Record<string, string> = {};
  const inputArgs: string[] = [];
  let inputIndex = 0;

  const filters: string[] = [
    `color=c=black:s=${width}x${height}:d=${durationSec}:r=30,format=yuv420p[base]`,
  ];

  const clipOverlays: { clip: EditorClip; index: number; label: string }[] = [];
  for (const clip of sequence) {
    const url = mediaUrlFor(urls, clip.creationId, clip.storagePath, clip.id);
    if (!url) throw new Error(`Missing media URL for clip ${clip.id}.`);
    const alias = `in_s${inputIndex}`;
    inputFiles[alias] = url;
    inputArgs.push(`-i {{${alias}}}`);
    const label = `v${clipOverlays.length}`;
    filters.push(placeClipFilter(inputIndex, clip, width, height, label));
    clipOverlays.push({ clip, index: inputIndex, label });
    inputIndex += 1;
  }

  let current = "base";
  let step = 0;
  for (const placed of clipOverlays) {
    const start = round2(placed.clip.startSec);
    const end = round2(placed.clip.endSec);
    const next = `c${step}`;
    filters.push(
      `[${current}][${placed.label}]overlay=0:0:enable='between(t,${start},${end})'[${next}]`
    );
    current = next;
    step += 1;
  }

  const overlayInputs: { overlay: EditorOverlay; index: number; kind: "image" | "video" }[] = [];
  for (const overlay of overlays) {
    if (overlay.kind === "text") continue;
    const url = mediaUrlFor(urls, overlay.creationId, overlay.storagePath, overlay.id);
    if (!url) throw new Error(`Missing media URL for overlay ${overlay.id}.`);
    const alias = overlay.kind === "image" ? `in_oi${inputIndex}` : `in_ov${inputIndex}`;
    inputFiles[alias] = url;
    inputArgs.push(`-i {{${alias}}}`);
    overlayInputs.push({ overlay, index: inputIndex, kind: overlay.kind });
    inputIndex += 1;
  }

  const hasText = overlays.some((o) => o.kind === "text");
  if (hasText) {
    const fontUrl = getFontUrl("Poppins");
    if (fontUrl) {
      inputFiles.in_font = fontUrl;
    }
  }

  for (const overlay of overlays) {
    const x = Math.round(overlay.x * width);
    const y = Math.round(overlay.y * height);
    const ow = Math.max(2, Math.round(overlay.w * width));
    const oh = Math.max(2, Math.round(overlay.h * height));
    const start = round2(overlay.startSec);
    const end = round2(overlay.endSec);
    const enable = `enable='between(t,${start},${end})'`;
    const next = `t${step}`;

    if (overlay.kind === "text") {
      const text = escapeDrawtext(overlay.text || "");
      const fontsize = Math.max(12, Math.round(overlay.fontSize || 48));
      const fontcolor = colorToFfmpeg(overlay.color || "#FFFFFF");
      const fontfile = inputFiles.in_font ? `:fontfile={{in_font}}` : "";
      filters.push(
        `[${current}]drawtext=text='${text}':fontsize=${fontsize}:fontcolor=${fontcolor}:x=${x}:y=${y}${fontfile}:${enable}[${next}]`
      );
      current = next;
      step += 1;
      continue;
    }

    const mapped = overlayInputs.find((item) => item.overlay.id === overlay.id);
    if (!mapped) continue;
    const ovLabel = `ov${step}`;
    const dur = round2(Math.max(0.04, overlay.endSec - overlay.startSec));
    if (mapped.kind === "video") {
      filters.push(
        `[${mapped.index}:v]trim=duration=${dur},setpts=PTS-STARTPTS,scale=${ow}:${oh}:force_original_aspect_ratio=decrease,setsar=1,format=yuv420p[${ovLabel}]`
      );
    } else {
      filters.push(
        `[${mapped.index}:v]scale=${ow}:${oh}:force_original_aspect_ratio=decrease,setsar=1,format=yuv420p[${ovLabel}]`
      );
    }
    filters.push(`[${current}][${ovLabel}]overlay=${x}:${y}:${enable}[${next}]`);
    current = next;
    step += 1;
  }

  const command =
    `${inputArgs.join(" ")} -filter_complex "${filters.join(";")}" ` +
    `-map "[${current}]" -t ${durationSec} -c:v libx264 -crf 20 -pix_fmt yuv420p -an {{out_v}}`;

  return {
    command,
    inputFiles,
    outputFiles: { out_v: "editor_export.mp4" },
    durationSec,
    width,
    height,
  };
}

export async function runEditorRender(
  doc: EditorDocument,
  urls: EditorMediaUrls,
  rendiOptions?: RunRendiOptions
): Promise<{ url: string; durationSec: number; width: number; height: number }> {
  const graph = buildEditorFfmpegGraph(doc, urls);
  const result = await runRendiCommandWithRetry(
    graph.command,
    graph.inputFiles,
    graph.outputFiles,
    rendiOptions
  );
  return {
    url: getRendiOutputUrl(result, "out_v"),
    durationSec: graph.durationSec,
    width: graph.width,
    height: graph.height,
  };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`editor-render self-check: ${msg}`);
}

export function editorRenderSelfCheck(): void {
  const doc: EditorDocument = {
    v: 1,
    aspect: "9:16",
    durationSec: 8,
    sequence: [
      {
        id: "c1",
        creationId: "a",
        storagePath: null,
        startSec: 0,
        endSec: 2,
        inSec: 0,
        sourceDurationSec: 4,
        order: 0,
      },
      {
        id: "c2",
        creationId: null,
        storagePath: "u/videos/x.mp4",
        startSec: 3,
        endSec: 5,
        inSec: 1,
        sourceDurationSec: 6,
        order: 1,
      },
    ],
    overlays: [
      {
        id: "t1",
        kind: "text",
        startSec: 0.5,
        endSec: 3,
        x: 0.1,
        y: 0.8,
        w: 0.8,
        h: 0.1,
        z: 2,
        text: "Hello: world",
        fontSize: 40,
        color: "#FFAA00",
        creationId: null,
        storagePath: null,
      },
      {
        id: "i1",
        kind: "image",
        startSec: 1,
        endSec: 3.5,
        x: 0.05,
        y: 0.05,
        w: 0.25,
        h: 0.2,
        z: 1,
        text: null,
        fontSize: null,
        color: null,
        creationId: "img1",
        storagePath: null,
      },
    ],
  };
  const graph = buildEditorFfmpegGraph(doc, {
    c1: "https://example.com/a.mp4",
    c2: "https://example.com/b.mp4",
    i1: "https://example.com/logo.png",
  });
  assert(graph.durationSec === 8, "composition duration is the export length");
  assert(graph.width === 720 && graph.height === 1280, "9:16 canvas");
  assert(graph.command.includes("color=c=black"), "black composition base");
  assert(!graph.command.includes("concat="), "clips are layers, not concatenated");
  assert(graph.command.includes("overlay=0:0:enable='between(t,0,2)'"), "first clip window");
  assert(graph.command.includes("overlay=0:0:enable='between(t,3,5)'"), "second clip window");
  assert(graph.command.includes("drawtext="), "text overlay uses drawtext");
  assert(graph.command.includes("overlay="), "image overlay uses overlay");
  assert(graph.command.includes("enable='between(t,"), "time-window enable");
  assert(graph.command.includes("Hello\\: world") || graph.command.includes("Hello\\:"), "colon escaped in drawtext");
  assert(graph.inputFiles.in_s0 === "https://example.com/a.mp4", "clip urls mapped");
  assert(Boolean(graph.inputFiles.in_font), "Poppins attached for text");
  assert(graph.command.includes("-an"), "v1 export is picture-only");
  assert(clipLayerDurationSec(doc.sequence[0]) === 2, "clip layer span");

  let threw = false;
  try {
    buildEditorFfmpegGraph(doc, { c1: "https://example.com/a.mp4" });
  } catch {
    threw = true;
  }
  assert(threw, "missing clip URL fails the graph");
}

if (require.main === module) {
  editorRenderSelfCheck();
  console.log("editorRenderSelfCheck: ok");
}

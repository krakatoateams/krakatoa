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
import { probeAudioSources } from "@/lib/editor-audio-probe";
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

/**
 * Visible, unmuted sequence clip or video overlay — the layers the preview
 * plays sound for. The export also requires the source to have an audio stream.
 */
export function isAudibleLayer(layer: EditorClip | EditorOverlay): boolean {
  if (layer.hidden || layer.muted === true) return false;
  return !("kind" in layer) || layer.kind === "video";
}

/** Source URLs of audible layers — what `runEditorRender` probes for audio. */
export function audibleLayerUrls(doc: EditorDocument, urls: EditorMediaUrls): string[] {
  return [...doc.sequence, ...doc.overlays]
    .filter(isAudibleLayer)
    .map((layer) => mediaUrlFor(urls, layer.creationId, layer.storagePath, layer.id))
    .filter((url): url is string => Boolean(url));
}

/** Common sample format so `amix` never renegotiates between sources. */
const AUDIO_FORMAT = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";

function placeAudioFilter(inputIndex: number, trim: string, startSec: number, label: string): string {
  const delayMs = Math.round(startSec * 1000);
  return `[${inputIndex}:a]${trim},asetpts=PTS-STARTPTS,${AUDIO_FORMAT},adelay=${delayMs}:all=1[${label}]`;
}

function overlayDurationSec(overlay: EditorOverlay): number {
  return round2(Math.max(0.04, overlay.endSec - overlay.startSec));
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

/**
 * Audio: each audible layer (see `isAudibleLayer`) whose source has an audio
 * stream is trimmed, delayed to its timeline window, and mixed; with no
 * audible source the export stays picture-only (`-an`). `runEditorRender`
 * probes which sources have audio.
 *
 * @param audioUrls source URLs verified to carry an audio stream. A layer whose
 *   URL is absent is treated as silent, so FFmpeg never reads a missing `[n:a]`.
 */
export function buildEditorFfmpegGraph(
  doc: EditorDocument,
  urls: EditorMediaUrls,
  audioUrls: ReadonlySet<string>
): EditorFfmpegGraph {
  const invalid = validateEditorExport(doc);
  if (invalid) throw new Error(invalid.message);

  const { w: width, h: height } = EDITOR_CANVAS[doc.aspect];
  const durationSec = round2(sequenceDurationSec(doc));
  const sequence = sortedSequence(doc).filter((clip) => !clip.hidden);
  const overlays = sortedOverlays(doc).filter((overlay) => !overlay.hidden);

  const inputFiles: Record<string, string> = {};
  const inputArgs: string[] = [];
  let inputIndex = 0;

  const filters: string[] = [
    `color=c=black:s=${width}x${height}:d=${durationSec}:r=30,format=yuv420p[base]`,
  ];

  const audioLabels: string[] = [];
  const addAudio = (layer: EditorClip | EditorOverlay, url: string, index: number, trim: string) => {
    if (!isAudibleLayer(layer) || !audioUrls.has(url)) return;
    const label = `a${audioLabels.length}`;
    filters.push(placeAudioFilter(index, trim, layer.startSec, label));
    audioLabels.push(label);
  };

  const clipOverlays: { clip: EditorClip; index: number; label: string }[] = [];
  for (const clip of sequence) {
    const url = mediaUrlFor(urls, clip.creationId, clip.storagePath, clip.id);
    if (!url) throw new Error(`Missing media URL for clip ${clip.id}.`);
    const alias = `in_s${inputIndex}`;
    inputFiles[alias] = url;
    inputArgs.push(`-i {{${alias}}}`);
    const label = `v${clipOverlays.length}`;
    filters.push(placeClipFilter(inputIndex, clip, width, height, label));
    addAudio(clip, url, inputIndex, `atrim=start=${round2(clip.inSec)}:end=${round2(clipSourceOutSec(clip))}`);
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
    addAudio(overlay, url, inputIndex, `atrim=duration=${overlayDurationSec(overlay)}`);
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
    const dur = overlayDurationSec(overlay);
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

  let audioArgs = "-an";
  if (audioLabels.length > 0) {
    filters.push(
      `${audioLabels.map((l) => `[${l}]`).join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,` +
        `apad,atrim=duration=${durationSec}[aout]`
    );
    audioArgs = `-map "[aout]" -c:a aac -b:a 192k`;
  }

  const command =
    `${inputArgs.join(" ")} -filter_complex "${filters.join(";")}" ` +
    `-map "[${current}]" -t ${durationSec} -c:v libx264 -crf 20 -pix_fmt yuv420p ${audioArgs} {{out_v}}`;

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
  // Probe failures resolve to "silent" so a source without audio never fails the export.
  const audioUrls = await probeAudioSources(audibleLayerUrls(doc, urls));
  const graph = buildEditorFfmpegGraph(doc, urls, audioUrls);
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
        locked: false,
        hidden: false,
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
        locked: false,
        hidden: false,
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
        locked: false,
        hidden: false,
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
        locked: false,
        hidden: false,
      },
    ],
  };
  const urls: EditorMediaUrls = {
    c1: "https://example.com/a.mp4",
    c2: "https://example.com/b.mp4",
    i1: "https://example.com/logo.png",
  };
  const graph = buildEditorFfmpegGraph(doc, urls, new Set());
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
  assert(graph.command.includes("-an"), "no source with audio → picture-only");
  assert(!graph.command.includes("[0:a]") && !graph.command.includes("amix"), "no audio chains without audio sources");
  assert(clipLayerDurationSec(doc.sequence[0]) === 2, "clip layer span");

  let threw = false;
  try {
    buildEditorFfmpegGraph(doc, { c1: "https://example.com/a.mp4" }, new Set());
  } catch {
    threw = true;
  }
  assert(threw, "missing clip URL fails the graph");

  // --- Audio ---
  const fmt = AUDIO_FORMAT;
  const withAudio = new Set(["https://example.com/a.mp4", "https://example.com/b.mp4", "https://example.com/v.mp4"]);
  const videoOverlay: EditorOverlay = {
    ...doc.overlays[1],
    id: "v1",
    kind: "video",
    startSec: 2,
    endSec: 4.5,
    creationId: "vid1",
    muted: false,
  };
  const avDoc: EditorDocument = { ...doc, overlays: [...doc.overlays, videoOverlay] };
  const avUrls = { ...urls, v1: "https://example.com/v.mp4" };
  const av = buildEditorFfmpegGraph(avDoc, avUrls, withAudio).command;
  assert(
    av.includes(`[0:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS,${fmt},adelay=0:all=1[a0]`),
    "unmuted clip audio trimmed to its source window"
  );
  assert(
    av.includes(`[1:a]atrim=start=1:end=3,asetpts=PTS-STARTPTS,${fmt},adelay=3000:all=1[a1]`),
    "non-zero inSec and startSec: atrim from inSec, adelay to startSec"
  );
  assert(
    av.includes(`[3:a]atrim=duration=2.5,asetpts=PTS-STARTPTS,${fmt},adelay=2000:all=1[a2]`),
    "unmuted video overlay audio from source 0 for its window"
  );
  assert(!av.includes("[2:a]"), "image overlay never contributes audio");
  assert(
    av.includes("[a0][a1][a2]amix=inputs=3:duration=longest:normalize=0,apad,atrim=duration=8[aout]"),
    "overlapping layers mixed, padded/trimmed to durationSec"
  );
  assert(av.includes(`-map "[aout]" -c:a aac`) && !av.includes("-an"), "mixed audio mapped and AAC-encoded");
  assert((av.match(/-i /g) ?? []).length === 4, "audio reuses video inputs (no duplicate -i)");

  const mutedClip = buildEditorFfmpegGraph(
    { ...avDoc, sequence: [doc.sequence[0], { ...doc.sequence[1], muted: true }] },
    avUrls,
    withAudio
  ).command;
  assert(!mutedClip.includes("[1:a]") && mutedClip.includes("amix=inputs=2"), "muted clip is silent");

  const mutedOverlay = buildEditorFfmpegGraph(
    { ...avDoc, overlays: [...doc.overlays, { ...videoOverlay, muted: true }] },
    avUrls,
    withAudio
  ).command;
  assert(!mutedOverlay.includes("[3:a]") && mutedOverlay.includes("amix=inputs=2"), "muted video overlay is silent");

  const hidden = buildEditorFfmpegGraph(
    { ...avDoc, sequence: [doc.sequence[0], { ...doc.sequence[1], hidden: true }] },
    avUrls,
    withAudio
  ).command;
  assert(
    !hidden.includes("atrim=start=1:end=3") && hidden.includes("[a0][a1]amix=inputs=2"),
    "hidden clip is silent (only c1 + video overlay mixed)"
  );

  const mixedSources = buildEditorFfmpegGraph(avDoc, avUrls, new Set(["https://example.com/a.mp4"])).command;
  assert(
    mixedSources.includes("[0:a]") && !mixedSources.includes("[1:a]") && !mixedSources.includes("[3:a]") &&
      mixedSources.includes("amix=inputs=1"),
    "source without audio stream is silent; others still export"
  );

  const allMuted = buildEditorFfmpegGraph(
    {
      ...avDoc,
      sequence: avDoc.sequence.map((c) => ({ ...c, muted: true })),
      overlays: [...doc.overlays, { ...videoOverlay, muted: true }],
    },
    avUrls,
    withAudio
  );
  assert(
    allMuted.command.endsWith("-pix_fmt yuv420p -an {{out_v}}") && !/:a\]|amix/.test(allMuted.command),
    "all muted → today's picture-only output (-an)"
  );

  assert(isAudibleLayer(doc.sequence[0]), "legacy clip (muted undefined) is audible");
  assert(!isAudibleLayer({ ...doc.sequence[0], muted: true }), "muted clip not audible");
  assert(!isAudibleLayer({ ...doc.sequence[0], hidden: true }), "hidden clip not audible");
  assert(!isAudibleLayer(doc.overlays[0]) && !isAudibleLayer(doc.overlays[1]), "text/image overlays not audible");
  assert(isAudibleLayer(videoOverlay), "unmuted video overlay audible");
  assert(
    audibleLayerUrls(avDoc, avUrls).join() === "https://example.com/a.mp4,https://example.com/b.mp4,https://example.com/v.mp4",
    "probe list covers only audible layers"
  );
}

if (require.main === module) {
  editorRenderSelfCheck();
  console.log("editorRenderSelfCheck: ok");
}

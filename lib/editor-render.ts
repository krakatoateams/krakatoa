/**
 * Build the FFmpeg graph for an Editor export: black composition of
 * the derived `durationSec` (latest layer end), overlay each clip full-frame in its time window, then
 * overlay / drawtext with enable='between(t,…)'.
 *
 * Pure graph builder — runnable as `npx tsx --conditions=react-server lib/editor-render.ts`
 * The export runs in-system (Vercel Sandbox, see `lib/editor-export-core.ts`);
 * the editor never calls Rendi or any third-party renderer.
 */

import {
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_RESOLUTIONS,
  EXPORT_FORMAT_SPEC,
  exportAudioArgs,
  exportOutputFilename,
  exportContainerArgs,
  exportVideoArgs,
  exportDimensions,
  parseExportSettings,
  type EditorExportSettings,
} from "@/lib/editor-export-settings";
import { EDITOR_FONT_URL } from "@/lib/editor-font";
import {
  EDITOR_CANVAS,
  clipLayerDurationSec,
  clipSourceOutSec,
  sequenceDurationSec,
  sortedOverlays,
  sortedSequence,
  textOverlayLayout,
  validateEditorExport,
  type EditorClip,
  type EditorDocument,
  type EditorOverlay,
} from "@/lib/editor-document";

export type EditorMediaUrls = Record<string, string>;

export type EditorFfmpegGraph = {
  /** Human-readable form of `args` (placeholders unresolved). Never run through a shell. */
  command: string;
  /** Argument vector with `{{alias}}` placeholders; resolve with `localizeFfmpegArgs`. */
  args: string[];
  inputFiles: Record<string, string>;
  outputFiles: Record<string, string>;
  durationSec: number;
  width: number;
  height: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function escapeDrawtext(text: string): string {
  return text
    .slice(0, 200)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\u2019")
    .replace(/:/g, "\\:")
    // argv (no shell) reaches FFmpeg unmodified: a literal % needs three backslashes to survive option parsing.
    .replace(/%/g, "\\\\\\%");
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
  scaleFlags: string,
  label: string
): string {
  const start = round2(clip.inSec);
  const end = round2(clipSourceOutSec(clip));
  const at = round2(clip.startSec);
  return (
    `[${inputIndex}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS+${at}/TB,` +
    `fps=30,scale=${width}:${height}:force_original_aspect_ratio=decrease${scaleFlags},` +
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
  audioUrls: ReadonlySet<string>,
  settings: EditorExportSettings = DEFAULT_EXPORT_SETTINGS
): EditorFfmpegGraph {
  const invalid = validateEditorExport(doc);
  if (invalid) throw new Error(invalid.message);

  const out = exportDimensions(doc.aspect, settings.resolution);
  const canvas = EDITOR_CANVAS[doc.aspect];
  // Overlay coordinates remain normalized to the preview canvas, but composition happens at the requested output size.
  const { w: width, h: height } = out;
  const textScale = out.h / canvas.h;
  const scaleFlags = out.w === canvas.w && out.h === canvas.h ? "" : ":flags=lanczos";
  const durationSec = round2(sequenceDurationSec(doc));
  const sequence = sortedSequence(doc).filter((clip) => !clip.hidden);
  const overlays = sortedOverlays(doc).filter((overlay) => !overlay.hidden);

  const inputFiles: Record<string, string> = {};
  const inputArgs: string[] = [];
  let inputIndex = 0;
  const addInput = (alias: string) => inputArgs.push("-i", `{{${alias}}}`);

  const filters: string[] = [
    `color=c=black:s=${width}x${height}:d=${durationSec}:r=30,format=yuv420p[base]`,
  ];

  const clipOverlays: { clip: EditorClip; index: number; label: string }[] = [];
  for (const clip of sequence) {
    const url = mediaUrlFor(urls, clip.creationId, clip.storagePath, clip.id);
    if (!url) throw new Error(`Missing media URL for clip ${clip.id}.`);
    const alias = `in_s${inputIndex}`;
    inputFiles[alias] = url;
    addInput(alias);
    const label = `v${clipOverlays.length}`;
    filters.push(placeClipFilter(inputIndex, clip, width, height, scaleFlags, label));
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
    addInput(alias);
    overlayInputs.push({ overlay, index: inputIndex, kind: overlay.kind });
    inputIndex += 1;
  }

  // Dedicated audio inputs prevent FFmpeg demuxer buffer deadlocks between concurrent video overlay and audio amix filters.
  const audioLabels: string[] = [];
  const addAudio = (layer: EditorClip | EditorOverlay, url: string, trim: string) => {
    if (!isAudibleLayer(layer) || !audioUrls.has(url)) return;
    const alias = `in_a${audioLabels.length}`;
    inputFiles[alias] = url;
    addInput(alias);
    const audioInputIndex = inputIndex;
    inputIndex += 1;
    const label = `a${audioLabels.length}`;
    filters.push(placeAudioFilter(audioInputIndex, trim, layer.startSec, label));
    audioLabels.push(label);
  };

  for (const clip of sequence) {
    const url = mediaUrlFor(urls, clip.creationId, clip.storagePath, clip.id);
    if (url) {
      addAudio(clip, url, `atrim=start=${round2(clip.inSec)}:end=${round2(clipSourceOutSec(clip))}`);
    }
  }

  for (const overlay of overlays) {
    if (overlay.kind !== "video") continue;
    const url = mediaUrlFor(urls, overlay.creationId, overlay.storagePath, overlay.id);
    if (url) {
      addAudio(overlay, url, `atrim=start=${round2(overlay.inSec ?? 0)}:end=${round2((overlay.inSec ?? 0) + overlayDurationSec(overlay))}`);
    }
  }

  const hasText = overlays.some((o) => o.kind === "text");
  if (hasText) {
    inputFiles.in_font = EDITOR_FONT_URL;
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
      const layout = textOverlayLayout(overlay, { w: width, h: height }, textScale);
      const text = escapeDrawtext(overlay.text || "");
      const fontcolor = colorToFfmpeg(overlay.color || "#FFFFFF");
      const fontfile = inputFiles.in_font ? `:fontfile={{in_font}}` : "";
      const drawX = `${layout.box.x}+(${layout.box.w}-text_w)/2`;
      const drawY = `${layout.box.y}+(${layout.box.h}-text_h)/2`;
      const shadowArgs = `:shadowcolor=${layout.shadow.color}:shadowx=${layout.shadow.x}:shadowy=${layout.shadow.y}`;
      filters.push(
        `[${current}]drawtext=text='${text}':fontsize=${layout.fontSize}:fontcolor=${fontcolor}:x=${drawX}:y=${drawY}${shadowArgs}${fontfile}:${enable}[${next}]`
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
        `[${mapped.index}:v]trim=start=${round2(overlay.inSec ?? 0)}:end=${round2((overlay.inSec ?? 0) + dur)},setpts=PTS-STARTPTS+${round2(overlay.startSec)}/TB,scale=${ow}:${oh}:force_original_aspect_ratio=decrease${scaleFlags},setsar=1,format=yuv420p[${ovLabel}]`
      );
    } else {
      filters.push(
        `[${mapped.index}:v]scale=${ow}:${oh}:force_original_aspect_ratio=decrease${scaleFlags},setsar=1,format=yuv420p[${ovLabel}]`
      );
    }
    filters.push(`[${current}][${ovLabel}]overlay=${x}:${y}:${enable}[${next}]`);
    current = next;
    step += 1;
  }

  filters.push(`[${current}]fps=${settings.fps},format=yuv420p[vfinal]`);
  current = "vfinal";

  let audioArgs = ["-an"];
  if (audioLabels.length > 0) {
    filters.push(
      `${audioLabels.map((l) => `[${l}]`).join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,` +
        `apad,atrim=duration=${durationSec}[aout]`
    );
    audioArgs = ["-map", "[aout]", ...exportAudioArgs(settings.format)];
  }

  const args = [
    ...inputArgs,
    "-filter_complex", filters.join(";"),
    "-map", `[${current}]`,
    "-t", String(durationSec),
    ...exportVideoArgs(settings),
    ...audioArgs,
    ...exportContainerArgs(settings.format),
    "{{out_v}}",
  ];
  const command = args.map((a) => (/[\s[\]";]/.test(a) ? `"${a}"` : a)).join(" ");

  return {
    command,
    args,
    inputFiles,
    outputFiles: { out_v: exportOutputFilename(settings.format) },
    durationSec,
    width: out.w,
    height: out.h,
  };
}

/**
 * Resolve `{{alias}}` placeholders for a local run: inputs become their URL,
 * `{{out_v}}` the local output path, `{{in_font}}` a local font file. Returned
 * as an argv (no shell), so user text can never be interpreted as a command.
 */
export function localizeFfmpegArgs(
  args: readonly string[],
  values: Record<string, string>
): string[] {
  return args.map((arg) =>
    arg.replace(/\{\{([a-z0-9_]+)\}\}/gi, (_m, key: string) => {
      const v = values[key];
      if (v === undefined) throw new Error(`Unresolved FFmpeg placeholder: ${key}`);
      return v;
    })
  );
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`editor-render self-check: ${msg}`);
}

export function editorRenderSelfCheck(): void {
  const doc: EditorDocument = {
    v: 1,
    aspect: "9:16",
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
  assert(graph.durationSec === 5, "export length is the latest layer end");
  assert(graph.width === 720 && graph.height === 1280, "9:16 canvas");
  assert(graph.command.includes("-crf 23"), "default quality is Standard (CRF 23)");
  const hq = buildEditorFfmpegGraph(doc, urls, new Set(), { resolution: 480, quality: "high", fps: 60, format: "mp4" });
  assert(hq.width === 480 && hq.height === 854, "480p keeps 9:16 with even dimensions");
  assert(hq.command.includes("-crf 20") && hq.command.includes("fps=60"), "quality + fps applied");
  assert(parseExportSettings({ resolution: 999 }) === null, "unsupported resolution rejected");
  assert(parseExportSettings({ fps: 24 }) === null, "unsupported fps rejected");
  assert(graph.command.includes("color=c=black"), "black composition base");
  assert(!graph.command.includes("concat="), "clips are layers, not concatenated");
  assert(graph.command.includes("overlay=0:0:enable='between(t,0,2)'"), "first clip window");
  assert(graph.command.includes("overlay=0:0:enable='between(t,3,5)'"), "second clip window");
  assert(graph.command.includes("drawtext="), "text overlay uses drawtext");
  assert(graph.command.includes("overlay="), "image overlay uses overlay");
  assert(graph.command.includes("enable='between(t,"), "time-window enable");
  assert(graph.command.includes("Hello\\: world") || graph.command.includes("Hello\\:"), "colon escaped in drawtext");

  const expectedTextLayout = textOverlayLayout(doc.overlays[0], { w: 720, h: 1280 });
  assert(
    graph.command.includes(`x=${expectedTextLayout.box.x}+(${expectedTextLayout.box.w}-text_w)/2`),
    "drawtext centers x in overlay box"
  );
  assert(
    graph.command.includes(`y=${expectedTextLayout.box.y}+(${expectedTextLayout.box.h}-text_h)/2`),
    "drawtext centers y in overlay box"
  );
  assert(graph.command.includes(`fontsize=${expectedTextLayout.fontSize}`), "drawtext uses shared font size");
  assert(
    graph.command.includes(
      `shadowcolor=${expectedTextLayout.shadow.color}:shadowx=${expectedTextLayout.shadow.x}:shadowy=${expectedTextLayout.shadow.y}`
    ),
    "drawtext uses shared shadow values"
  );

  const escapedText = escapeDrawtext("It's 100%: perfect\nSecond line");
  assert(
    escapedText === "It\u2019s 100\\\\\\%\\: perfect\nSecond line",
    "escapeDrawtext handles colon, apostrophe, percent, and explicit newline"
  );

  assert(graph.inputFiles.in_s0 === "https://example.com/a.mp4", "clip urls mapped");
  assert(Boolean(graph.inputFiles.in_font), "Poppins attached for text");
  assert(graph.command.includes("-an"), "no source with audio → picture-only");
  assert(!graph.command.includes("[0:a]") && !graph.command.includes("amix"), "no audio chains without audio sources");
  assert(clipLayerDurationSec(doc.sequence[0]) === 2, "clip layer span");

  // --- #296: formats and 4K ---
  assert(parseExportSettings(undefined)?.format === "mp4", "missing settings default to mp4");
  assert(parseExportSettings({ resolution: 720 })?.format === "mp4", "missing format defaults to mp4 (older clients)");
  assert(parseExportSettings({ format: "webm" })?.format === "webm", "webm accepted");
  assert(parseExportSettings({ format: "mkv" }) === null && parseExportSettings({ format: "video/mp4" }) === null, "unknown format rejected");
  assert(parseExportSettings({ resolution: 2160 })?.resolution === 2160, "2160 accepted");
  assert(parseExportSettings({ resolution: 1440 }) === null, "unknown resolution still rejected");
  const dims = (aspect: EditorDocument["aspect"]) => exportDimensions(aspect, 2160);
  assert(dims("16:9").w === 3840 && dims("16:9").h === 2160, "4K 16:9 is 3840x2160");
  assert(dims("9:16").w === 2160 && dims("9:16").h === 3840, "4K 9:16 is 2160x3840");
  assert(dims("1:1").w === 2160 && dims("1:1").h === 2160, "4K 1:1 is 2160x2160");
  const mp4 = buildEditorFfmpegGraph(doc, urls, new Set(["https://example.com/a.mp4"]), { ...DEFAULT_EXPORT_SETTINGS, format: "mp4" });
  assert(
    mp4.command.includes("libx264") && mp4.command.includes("-c:a aac") && mp4.command.includes("+faststart") && !mp4.command.includes("libvpx"),
    "mp4 = H.264 + AAC + faststart"
  );
  assert(mp4.outputFiles.out_v === `editor_export.${EXPORT_FORMAT_SPEC.mp4.ext}` && EXPORT_FORMAT_SPEC.mp4.mime === "video/mp4", "mp4 ext/mime from table");
  const webm = buildEditorFfmpegGraph(doc, urls, new Set(["https://example.com/a.mp4"]), { resolution: 2160, quality: "standard", fps: 60, format: "webm" });
  assert(
    webm.command.includes("libvpx-vp9") && webm.command.includes("libopus") && webm.command.includes("-b:v 0 -crf 33") &&
      webm.command.includes("-row-mt 1") && !webm.command.includes("libx264") && !webm.command.includes("faststart"),
    "webm = VP9 constant quality + Opus"
  );
  assert(webm.width === 2160 && webm.height === 3840, "4K 9:16 graph dimensions");
  assert(webm.command.includes("color=c=black:s=2160x3840"), "4K composes on its output canvas");
  assert(webm.command.includes("scale=2160:3840:force_original_aspect_ratio=decrease:flags=lanczos"), "4K clips scale from source directly to output with Lanczos");
  assert(webm.command.includes("fontsize=120") && webm.command.includes("shadowx=6:shadowy=6"), "4K text scales from the preview coordinate space");
  assert(!webm.command.includes("scale=720:1280:force_original_aspect_ratio=decrease"), "4K never routes clips through the 720p canvas");
  assert(webm.outputFiles.out_v === "editor_export.webm" && EXPORT_FORMAT_SPEC.webm.mime === "video/webm", "webm ext/mime from table");
  assert(buildEditorFfmpegGraph(doc, urls, new Set(), { ...DEFAULT_EXPORT_SETTINGS, format: "webm" }).command.includes("-an"), "webm without audio is -an");

  // 720p 16:9 and 9:16 compose at their existing preview canvases, so their complete commands stay stable.
  const golden720 = (aspect: "16:9" | "9:16") => {
    const goldenDoc: EditorDocument = {
      v: 1,
      aspect,
      sequence: [{ id: "c", creationId: "c", storagePath: null, startSec: 0, endSec: 1, inSec: 0, sourceDurationSec: 1, order: 0, locked: false, hidden: false }],
      overlays: [],
    };
    return buildEditorFfmpegGraph(goldenDoc, { c: "https://example.com/c.mp4" }, new Set()).command;
  };
  assert(
    golden720("16:9") === `-i {{in_s0}} -filter_complex "color=c=black:s=1280x720:d=1:r=30,format=yuv420p[base];[0:v]trim=start=0:end=1,setpts=PTS-STARTPTS+0/TB,fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v0];[base][v0]overlay=0:0:enable='between(t,0,1)'[c0];[c0]fps=30,format=yuv420p[vfinal]" -map "[vfinal]" -t 1 -c:v libx264 -crf 23 -pix_fmt yuv420p -an -movflags +faststart {{out_v}}`,
    "16:9 720p command stays byte-identical"
  );
  assert(
    golden720("9:16") === `-i {{in_s0}} -filter_complex "color=c=black:s=720x1280:d=1:r=30,format=yuv420p[base];[0:v]trim=start=0:end=1,setpts=PTS-STARTPTS+0/TB,fps=30,scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v0];[base][v0]overlay=0:0:enable='between(t,0,1)'[c0];[c0]fps=30,format=yuv420p[vfinal]" -map "[vfinal]" -t 1 -c:v libx264 -crf 23 -pix_fmt yuv420p -an -movflags +faststart {{out_v}}`,
    "9:16 720p command stays byte-identical"
  );
  for (const aspect of ["9:16", "1:1", "16:9"] as const) {
    for (const resolution of EXPORT_RESOLUTIONS) {
      const output = exportDimensions(aspect, resolution);
      const aspectDoc: EditorDocument = {
        ...doc,
        aspect,
        overlays: [{ ...doc.overlays[0], text: "First line\\nSecond line" }],
      };
      const rendered = buildEditorFfmpegGraph(aspectDoc, urls, new Set(), { ...DEFAULT_EXPORT_SETTINGS, resolution });
      const layout = textOverlayLayout(aspectDoc.overlays[0], output, output.h / EDITOR_CANVAS[aspect].h);
      assert(rendered.width === output.w && rendered.height === output.h && output.w % 2 === 0 && output.h % 2 === 0, `${aspect} ${resolution}p output dimensions`);
      assert(rendered.command.includes(`color=c=black:s=${output.w}x${output.h}`), `${aspect} ${resolution}p composes at output dimensions`);
      assert(rendered.command.includes(`x=${layout.box.x}+(${layout.box.w}-text_w)/2`) && rendered.command.includes(`y=${layout.box.y}+(${layout.box.h}-text_h)/2`), `${aspect} ${resolution}p keeps multiline text centered in its relative box`);
    }
  }

  // --- In-system run: placeholders resolve to argv entries (no shell) ---
  const local = localizeFfmpegArgs(graph.args, {
    in_s0: "https://example.com/a.mp4",
    in_s1: "https://example.com/b.mp4",
    in_oi2: "https://example.com/logo.png",
    in_font: "export/Poppins.ttf",
    out_v: "export/editor_export.mp4",
  });
  assert(local.at(-1) === "export/editor_export.mp4", "output is the local file");
  assert(local.includes("https://example.com/a.mp4") && !local.some((a) => /\{\{in_s/.test(a)), "inputs substituted");
  assert(local.join(" ").includes("fontfile=export/Poppins.ttf") && !local.join(" ").includes("{{"), "font substituted, no placeholders left");
  assert(local.includes("libx264") && local.includes("-filter_complex"), "argv carries the encode and filter graph");
  let unresolved = false;
  try {
    localizeFfmpegArgs(graph.args, { out_v: "x" });
  } catch {
    unresolved = true;
  }
  assert(unresolved, "unresolved placeholder throws");
  const quoteDoc: EditorDocument = {
    ...doc,
    overlays: [{ ...doc.overlays[0], text: 'a"b $(x) `y`' }],
  };
  const quoted = buildEditorFfmpegGraph(quoteDoc, urls, new Set()).args.find((a) => a.includes("drawtext="));
  assert(Boolean(quoted?.includes('a"b $(x) `y`')), "user text stays one literal argv entry");
  assert(!JSON.stringify(graph).includes("rendi"), "graph is renderer-neutral");

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
    av.includes(`[4:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS,${fmt},adelay=0:all=1[a0]`),
    "unmuted clip audio trimmed to its source window"
  );
  assert(
    av.includes(`[5:a]atrim=start=1:end=3,asetpts=PTS-STARTPTS,${fmt},adelay=3000:all=1[a1]`),
    "non-zero inSec and startSec: atrim from inSec, adelay to startSec"
  );
  assert(
    av.includes(`[6:a]atrim=start=0:end=2.5,asetpts=PTS-STARTPTS,${fmt},adelay=2000:all=1[a2]`),
    "unmuted video overlay audio from source 0 for its window"
  );
  const inDoc: EditorDocument = { ...avDoc, overlays: avDoc.overlays.map((o) => (o.id === "v1" ? { ...o, inSec: 1 } : o)) };
  const inCmd = buildEditorFfmpegGraph(inDoc, avUrls, withAudio).command;
  assert(inCmd.includes("atrim=start=1:end=3.5,asetpts"), "video overlay audio trimmed from its inSec");
  assert(inCmd.includes("trim=start=1:end=3.5,setpts=PTS-STARTPTS+2/TB,scale="), "video overlay video trimmed from its inSec and shifted to its startSec");
  assert(av.includes("trim=start=0:end=2.5,setpts=PTS-STARTPTS+2/TB,scale="), "video overlay video PTS shifted to startSec so it plays instead of freezing");
  assert(!av.includes("[2:a]") && !av.includes("[3:a]"), "image overlay and video inputs never contribute audio");
  assert(
    av.includes("[a0][a1][a2]amix=inputs=3:duration=longest:normalize=0,apad,atrim=duration=5[aout]"),
    "overlapping layers mixed, padded/trimmed to durationSec"
  );
  assert(av.includes(`-map "[aout]" -c:a aac`) && !av.includes("-an"), "mixed audio mapped and AAC-encoded");
  assert((av.match(/-i /g) ?? []).length === 7, "audio uses dedicated inputs to prevent demuxer deadlock");

  const mutedClip = buildEditorFfmpegGraph(
    { ...avDoc, sequence: [doc.sequence[0], { ...doc.sequence[1], muted: true }] },
    avUrls,
    withAudio
  ).command;
  assert(!mutedClip.includes("atrim=start=1:end=3") && mutedClip.includes("amix=inputs=2"), "muted clip is silent");

  const mutedOverlay = buildEditorFfmpegGraph(
    { ...avDoc, overlays: [...doc.overlays, { ...videoOverlay, muted: true }] },
    avUrls,
    withAudio
  ).command;
  assert(!mutedOverlay.includes("atrim=start=0:end=2.5") && mutedOverlay.includes("amix=inputs=2"), "muted video overlay is silent");

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
    mixedSources.includes("[4:a]") && !mixedSources.includes("[5:a]") && !mixedSources.includes("[6:a]") &&
      mixedSources.includes("amix=inputs=1"),
    "source without audio stream is silent; others still export"
  );

  // Issue #244 regression check: multi-clip timeline reusing same source media across overlapping intervals
  const duplicateSourceDoc: EditorDocument = {
    v: 1,
    aspect: "9:16",
    sequence: [
      { id: "c1", creationId: "a", storagePath: null, startSec: 1.2, endSec: 3.2, inSec: 3.7, sourceDurationSec: 8, order: 0, locked: false, hidden: false },
      { id: "c2", creationId: "a", storagePath: null, startSec: 2.0, endSec: 3.8, inSec: 6.2, sourceDurationSec: 8, order: 1, locked: false, hidden: false },
    ],
    overlays: [],
  };
  const dupGraph = buildEditorFfmpegGraph(
    duplicateSourceDoc,
    { c1: "https://example.com/same.mp4", c2: "https://example.com/same.mp4" },
    new Set(["https://example.com/same.mp4"])
  );
  // Video inputs are 0 and 1; audio inputs are 2 and 3 (separate demuxers)
  assert((dupGraph.command.match(/-i /g) ?? []).length === 4, "reused sources separate video and audio inputs");
  assert(dupGraph.command.includes("[2:a]") && dupGraph.command.includes("[3:a]"), "audio reads from dedicated audio inputs");
  assert(!dupGraph.command.includes("[0:a]") && !dupGraph.command.includes("[1:a]"), "video inputs are not read as audio");

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
    allMuted.command.includes(" -an ") && allMuted.command.includes("-movflags +faststart") && allMuted.command.endsWith("{{out_v}}") && !/:a\]|amix/.test(allMuted.command),
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

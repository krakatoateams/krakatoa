/**
 * Rendi (cloud FFmpeg) stitching helpers shared by the Seedance and Veo reels
 * pipelines. These wrap the lower-level `lib/rendi.ts` client and reproduce the
 * exact FFmpeg filter graphs the old inline route code used, so output is
 * byte-for-byte equivalent:
 *   - concatScenes()        per-scene normalize (tpad/trim/fps/scale/pad/sar) + concat
 *   - mergeVideoAudioSubs() merge combined video + speed-fit TTS audio + subtitles
 *   - burnSubtitles()       burn the hosted .ass onto the merged video
 *   - extractVeoAudio()     pull the MP3 track out of a Veo clip (single mode)
 */
import {
  runRendiCommand,
  getRendiOutputUrl,
  extractAudioMp3,
} from "@/lib/rendi";

// Remote Google Fonts (TTF for FFmpeg/libass). Pinned to commit ca9288e18a —
// `@main` removed the static Montserrat-*.ttf weights (only the variable font
// is published now), which libass can't resolve for a specific weight reliably.
export const FONTS_REF = "ca9288e18a";

export function getFontUrl(fontname: string): string | undefined {
  const fontUrls: Record<string, string> = {
    Poppins: `https://cdn.jsdelivr.net/gh/google/fonts@${FONTS_REF}/ofl/poppins/Poppins-ExtraBold.ttf`,
    Montserrat: `https://cdn.jsdelivr.net/gh/google/fonts@${FONTS_REF}/ofl/montserrat/Montserrat-Bold.ttf`,
    Bangers: `https://cdn.jsdelivr.net/gh/google/fonts@${FONTS_REF}/ofl/bangers/Bangers-Regular.ttf`,
  };
  return fontUrls[fontname];
}

/**
 * Normalize each scene's video to exactly `perSceneDurStr` seconds and (for
 * multi-scene reels) concat them. `tpad=stop_mode=clone:stop_duration=2` freezes
 * the last frame for short Seedance/Veo outputs; the subsequent `trim` clamps to
 * the exact per-scene budget. fps/scale/pad/setsar/format normalization is
 * REQUIRED so generative outputs with mismatched fps/SAR can be concatenated.
 */
export async function concatScenes(
  sceneVideoUrls: string[],
  perSceneDurStr: string,
  targetW: number,
  targetH: number
): Promise<string> {
  const vInputFiles: Record<string, string> = {};
  sceneVideoUrls.forEach((url, i) => {
    vInputFiles[`in_v${i + 1}`] = url;
  });
  const vInputArgs = sceneVideoUrls.map((_, i) => `-i {{in_v${i + 1}}}`).join(" ");
  const normalizedStreams = sceneVideoUrls
    .map(
      (_, i) =>
        `[${i}:v]tpad=stop_mode=clone:stop_duration=2,trim=duration=${perSceneDurStr},setpts=PTS-STARTPTS,fps=30,scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v${i}]`
    )
    .join(";");
  const concatInputs = sceneVideoUrls.map((_, i) => `[v${i}]`).join("");

  if (sceneVideoUrls.length === 1) {
    const result = await runRendiCommand(
      `${vInputArgs} -filter_complex "${normalizedStreams}" -map "[v0]" -c:v libx264 -crf 20 -pix_fmt yuv420p {{out_v}}`,
      vInputFiles,
      { out_v: "combined_video.mp4" }
    );
    return getRendiOutputUrl(result, "out_v");
  }
  const result = await runRendiCommand(
    `${vInputArgs} -filter_complex "${normalizedStreams};${concatInputs}concat=n=${sceneVideoUrls.length}:v=1:a=0[v]" -map "[v]" -c:v libx264 -crf 20 -pix_fmt yuv420p {{out_v}}`,
    vInputFiles,
    { out_v: "combined_video.mp4" }
  );
  return getRendiOutputUrl(result, "out_v");
}

/**
 * Merge combined video + continuous TTS audio + subtitles (+ optional font).
 * Audio chain: apad (infinite trailing silence) -> optional atempo (time-stretch
 * to land on target, pitch-preserving) -> atrim to exact finalDuration ->
 * asetpts (clean 0-based PTS). `shortest` is set only for the Veo per-scene path.
 */
export async function mergeVideoAudioSubs(opts: {
  combinedVideoUrl: string;
  fullAudioUrl: string;
  srtUrl: string;
  fontUrl?: string;
  audioSpeedFactor: number;
  finalDuration: number;
  shortest: boolean;
}): Promise<string> {
  let mergeCommand = `-i {{in_video}} -i {{in_audio}} -i {{in_srt}}`;
  const mergeInputs: Record<string, string> = {
    in_video: opts.combinedVideoUrl,
    in_audio: opts.fullAudioUrl,
    in_srt: opts.srtUrl,
  };
  if (opts.fontUrl) {
    mergeCommand += ` -attach {{in_font}} -metadata:s:t:0 mimetype=application/x-truetype-font -metadata:s:t:0 filename="font.ttf"`;
    mergeInputs.in_font = opts.fontUrl;
  }
  const atempoStage =
    Math.abs(opts.audioSpeedFactor - 1) > 0.001
      ? `atempo=${opts.audioSpeedFactor.toFixed(4)},`
      : "";
  mergeCommand += ` -filter_complex "[1:a]apad,${atempoStage}atrim=duration=${opts.finalDuration.toFixed(
    3
  )},asetpts=PTS-STARTPTS[a]"`;
  mergeCommand += ` -map 0:v:0 -map "[a]" -map 2:s:0 -c:v copy -c:a aac -c:s copy${
    opts.shortest ? " -shortest" : ""
  } {{out_merged}}`;

  const result = await runRendiCommand(mergeCommand, mergeInputs, {
    out_merged: "merged.mkv",
  });
  return getRendiOutputUrl(result, "out_merged");
}

/**
 * Burn subtitles onto a video from the hosted .ass file directly (more reliable
 * than reading the embedded subtitle stream on multi-scene concats). Keeps any
 * existing audio track (`-map 0:a:0?`) — important for Veo single's native audio.
 */
export async function burnSubtitles(videoUrl: string, srtUrl: string): Promise<string> {
  const result = await runRendiCommand(
    `-i {{in_video}} -i {{in_srt}} -vf "subtitles={{in_srt}}" -map 0:v:0 -map 0:a:0? -c:v libx264 -crf 20 -c:a copy {{out_final}}`,
    { in_video: videoUrl, in_srt: srtUrl },
    { out_final: "final_video.mp4" }
  );
  return getRendiOutputUrl(result, "out_final");
}

/** Extract the first audio stream from a Veo clip as a hosted MP3 (single mode). */
export async function extractVeoAudio(videoUrl: string): Promise<string> {
  return extractAudioMp3(videoUrl);
}

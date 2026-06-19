/**
 * Advanced SubStation Alpha (.ass) subtitle builder, shared by every reels
 * engine. Lifted verbatim from the Veo route's `buildAssContent` (which is the
 * parameterized form of the Seedance route's inline ASS writer).
 *
 * IMPORTANT (WYSIWYG): the MarginV math here —
 *   actualMarginV = floor((marginV / 100) * (playResY - fontsize * 1.5))
 * must stay in sync with the ReelsGen live caption preview CSS
 * (`bottom: calc(...)` in the Reels Creator composer). Seedance renders against
 * a fixed 480x854 PlayRes (libass scales to the real frame), while Veo uses the
 * real output dimensions — callers pass the right playResX/playResY.
 */
import { hexToAssColor, formatAssTime } from "@/lib/reels-helpers";
import type { CaptionStyle, WordChunk } from "./types";

export function buildAssContent(
  style: CaptionStyle,
  playResX: number,
  playResY: number,
  words: WordChunk[],
  audioSpeedFactor: number,
  finalDuration: number
): string {
  const primaryColorASS = hexToAssColor(style.primaryColor);
  const outlineColorASS = hexToAssColor(style.outlineColor);
  const highlightColorASS = hexToAssColor(style.highlightColor);
  // Cap max margin so 100% places text at the top edge, not completely off-screen.
  const maxMarginV = playResY - style.fontsize * 1.5;
  const actualMarginV = Math.floor((style.marginV / 100) * maxMarginV);

  let assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 1

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontname},${style.fontsize},${primaryColorASS},&H000000FF,${outlineColorASS},&H00000000,-1,0,0,0,100,100,0,0,1,${style.outlineThickness},0,2,10,10,${actualMarginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // When audio is time-stretched by atempo, the spoken word at original time T
  // plays at T/audioSpeedFactor in the final video. Scale timestamps to match,
  // then clamp to finalDuration.
  for (const w of words) {
    const text = w.text.trim();
    if (!text) continue;
    const start = w.start / audioSpeedFactor;
    const end = Math.min(w.end / audioSpeedFactor, finalDuration);
    if (start >= finalDuration) continue;
    const lineText = `{\\c${highlightColorASS}}{\\b1}${text.toUpperCase()}{\\b0}`;
    assContent += `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${lineText}\n`;
  }

  if (!assContent.includes("Dialogue:")) {
    assContent += `Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,(No speech detected)\n`;
  }
  return assContent;
}

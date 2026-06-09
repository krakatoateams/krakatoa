import { NextRequest, NextResponse } from "next/server";
import { createReplicateClient, runWithRetry } from "@/lib/replicate-utils";
import { extractAudioMp3 } from "@/lib/rendi";

// Audio extraction (Rendi) + Whisper + Gemini — give the pipeline headroom
export const maxDuration = 120;

const WHISPER_MODEL =
  "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c";
const LLM_MODEL = "google/gemini-2.5-flash";

function joinReplicateOutput(output: unknown): string {
  if (Array.isArray(output)) {
    return (output as string[]).join("").trim();
  }
  return String(output ?? "").trim();
}

function extractTranscript(wRes: unknown): string {
  if (!wRes || typeof wRes !== "object") return "";
  const obj = wRes as Record<string, unknown>;

  if (typeof obj.transcription === "string") return obj.transcription.trim();
  if (typeof obj.text === "string") return obj.text.trim();

  if (Array.isArray(obj.chunks)) {
    return (obj.chunks as { text?: string }[])
      .map((c) => (c.text ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  if (Array.isArray(obj.segments)) {
    return (obj.segments as { text?: string }[])
      .map((s) => (s.text ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  return "";
}

function buildPrompt(opts: {
  transcript: string | null;
  title?: string;
  tags?: string;
  description?: string;
}): string {
  const { transcript, title, tags, description } = opts;

  const lines: string[] = [
    "You are a YouTube Shorts content expert. Generate an engaging caption for a YouTube Short.",
    "",
    "Context about the video:",
  ];

  if (transcript) lines.push(`Video transcript: "${transcript}"`);
  if (title) lines.push(`Video title: "${title}"`);
  if (tags) lines.push(`Tags/topics: ${tags}`);
  if (description) lines.push(`Creator's description: "${description}"`);

  lines.push(
    "",
    "Write a caption with this exact structure:",
    "1. A strong hook (first line, max 10 words, must grab attention)",
    "2. Body (2-3 sentences describing what the video is about)",
    "3. 5-8 relevant hashtags",
    "4. 2-3 relevant emojis",
    "",
    "Rules:",
    "- Always write the caption in English, even if the transcript or context is in another language",
    "- Never use placeholder text like [Your Name] or [Topic]",
    "- Be specific based on the actual content provided",
    "- Keep total length under 300 characters",
    "- Sound natural and engaging, not robotic",
    "- If no context is available, write a generic but engaging YouTube Shorts caption",
    "",
    "Return only the caption, nothing else.",
  );

  return lines.join("\n");
}

// General mode: one caption that broadly fits a whole batch of videos.
// No transcript/audio — only the title + tags creators typed per card.
function buildGeneralPrompt(videos: { title?: string; tags?: string }[]): string {
  const lines: string[] = [
    "You are a YouTube Shorts content expert. Generate ONE engaging caption that broadly fits an entire batch of related Shorts.",
    "",
    "The creator is bulk-scheduling these videos and wants a single shared caption that works for all of them.",
    "",
    "Videos in this batch:",
  ];

  videos.forEach((v, i) => {
    const parts: string[] = [];
    if (v.title) parts.push(`title: "${v.title}"`);
    if (v.tags) parts.push(`tags: ${v.tags}`);
    if (parts.length > 0) lines.push(`${i + 1}. ${parts.join(" — ")}`);
  });

  lines.push(
    "",
    "Write a caption with this exact structure:",
    "1. A strong hook (first line, max 10 words, must grab attention)",
    "2. Body (2-3 sentences that broadly describe the theme shared across these videos)",
    "3. 5-8 relevant hashtags",
    "4. 2-3 relevant emojis",
    "",
    "Rules:",
    "- The caption must read naturally for ANY video in the batch — stay general, do not reference one specific video",
    "- Always write the caption in English",
    "- Never use placeholder text like [Your Name] or [Topic]",
    "- Base it on the actual titles and tags provided",
    "- Keep total length under 300 characters",
    "- Sound natural and engaging, not robotic",
    "",
    "Return only the caption, nothing else.",
  );

  return lines.join("\n");
}

function buildPolishPrompt(existingCaption: string): string {
  return [
    "You are a YouTube Shorts content expert.",
    "Polish this caption draft to be more engaging:",
    "",
    `"${existingCaption}"`,
    "",
    "Improve:",
    "- Hook (first line must grab attention in max 10 words)",
    "- Flow and readability",
    "- Hashtags (keep relevant ones, improve if needed)",
    "- Emojis (add if missing, max 3)",
    "",
    "Rules:",
    "- Keep the same topic and intent",
    "- Never change the core message",
    "- Keep under 300 characters",
    "- Return only the caption, nothing else",
  ].join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const mode: string = (body.mode ?? "generate").toString();
    const description: string = (body.description ?? "").toString().trim();
    const title: string = (body.title ?? "").toString().trim();
    const tags: string = (body.tags ?? "").toString().trim();
    const videoUrl: string = (body.videoUrl ?? "").toString().trim();
    const existingCaption: string = (body.existingCaption ?? "").toString().trim();

    const replicate = createReplicateClient();

    // ----- General mode: one shared caption for a batch, no transcription -----
    if (mode === "general") {
      const rawVideos = Array.isArray(body.videos) ? body.videos : [];
      const videos = rawVideos
        .map((v: unknown) => {
          const obj = (v ?? {}) as Record<string, unknown>;
          return {
            title: (obj.title ?? "").toString().trim(),
            tags: (obj.tags ?? "").toString().trim(),
          };
        })
        .filter((v: { title: string; tags: string }) => v.title || v.tags);

      if (videos.length === 0) {
        return NextResponse.json(
          { error: "Provide at least one video with a title or tags." },
          { status: 400 },
        );
      }

      const generalOutput = await runWithRetry(replicate, LLM_MODEL, {
        input: {
          prompt: buildGeneralPrompt(videos),
          max_tokens: 300,
          temperature: 0.7,
        },
      });

      const generalCaption = joinReplicateOutput(generalOutput);
      if (!generalCaption) {
        return NextResponse.json(
          { error: "Model returned an empty response. Please try again." },
          { status: 502 },
        );
      }

      return NextResponse.json({ caption: generalCaption, mode: "general" });
    }

    // ----- Polish mode: rewrite an existing caption, no transcription -----
    if (mode === "polish") {
      if (!existingCaption) {
        return NextResponse.json(
          { error: "existingCaption is required to polish a caption." },
          { status: 400 },
        );
      }

      const polishOutput = await runWithRetry(replicate, LLM_MODEL, {
        input: {
          prompt: buildPolishPrompt(existingCaption),
          max_tokens: 300,
          temperature: 0.7,
        },
      });

      const polished = joinReplicateOutput(polishOutput);
      if (!polished) {
        return NextResponse.json(
          { error: "Model returned an empty response. Please try again." },
          { status: 502 },
        );
      }

      return NextResponse.json({ caption: polished, mode: "polish" });
    }

    // ----- Generate mode: build a caption from video/context -----
    if (!description && !title && !tags && !videoUrl) {
      return NextResponse.json(
        {
          error:
            "Provide at least one of: videoUrl, title, tags, or description.",
        },
        { status: 400 },
      );
    }

    let transcript: string | null = null;
    if (videoUrl) {
      // Strip query params so the URL ends in a real file extension (.mp4/.mov).
      // Supabase public URLs carry no auth token in the query string, so this is safe.
      const sourceUrl = videoUrl.split("?")[0];
      try {
        // Whisper is unreliable demuxing audio straight from a video container,
        // so extract a hosted MP3 via Rendi first, then transcribe that.
        console.log("[generate-caption] extracting audio from:", sourceUrl);
        const audioUrl = await extractAudioMp3(sourceUrl);
        console.log("[generate-caption] whisper audio url:", audioUrl);

        const wRes = await runWithRetry(replicate, WHISPER_MODEL, {
          input: {
            audio: audioUrl,
            // No `language` pin → Whisper auto-detects the spoken language.
            // The caption is forced to English via the Gemini prompt instead.
            // `task: "transcribe"` = transcribe only, no translation.
            task: "transcribe",
            batch_size: 64,
          },
        });
        const text = extractTranscript(wRes);
        transcript = text.length > 0 ? text : null;
      } catch (err) {
        // Soft-fail: audio extraction or Whisper failed (e.g. silent video,
        // no audio track, Rendi/Replicate error). Continue with title/tags/
        // description only rather than failing the whole request.
        console.warn(
          "[generate-caption] audio extraction or Whisper failed, continuing without transcript:",
          err instanceof Error ? err.message : err,
        );
        transcript = null;
      }
    }

    const prompt = buildPrompt({
      transcript,
      title: title || undefined,
      tags: tags || undefined,
      description: description || undefined,
    });

    const output = await runWithRetry(replicate, LLM_MODEL, {
      input: {
        prompt,
        max_tokens: 300,
        temperature: 0.7,
      },
    });

    const caption = joinReplicateOutput(output);

    if (!caption) {
      return NextResponse.json(
        { error: "Model returned an empty response. Please try again." },
        { status: 502 },
      );
    }

    return NextResponse.json({ caption, usedTranscript: !!transcript });
  } catch (err: unknown) {
    console.error("[generate-caption]", err);

    const message =
      err instanceof Error ? err.message : "Unexpected error occurred.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

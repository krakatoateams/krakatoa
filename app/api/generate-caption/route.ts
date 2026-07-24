import { NextRequest, NextResponse } from "next/server";
import { createReplicateClient, runWithRetry } from "@/lib/replicate-utils";
import { extractAudioMp3 } from "@/lib/rendi";
import { getSessionUserId } from "@/lib/resolve-user";
import {
  assertPathOwnedByUser,
  resolveStoragePath,
  signStoragePathForPipeline,
} from "@/lib/storage-signed-url";
import { assertToolEnabled, ToolDisabledError } from "@/lib/tool-access";
import { getScheduleModels, replicateRef } from "@/lib/model-resolver";

// Audio extraction (Rendi) + Whisper + Gemini — give the pipeline headroom
export const maxDuration = 120;

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

type CaptionFormat = "short" | "video";

function buildPrompt(opts: {
  transcript: string | null;
  title?: string;
  tags?: string;
  description?: string;
  format?: CaptionFormat;
}): string {
  const { transcript, title, tags, description, format = "short" } = opts;

  // Long-form video: a richer description, no forced #Shorts, longer allowance.
  if (format === "video") {
    const lines: string[] = [
      "You are a YouTube content expert. Generate an engaging description for a regular (long-form) YouTube video.",
      "",
      "Context about the video:",
    ];

    if (transcript) lines.push(`Video transcript: "${transcript}"`);
    if (title) lines.push(`Video title: "${title}"`);
    if (tags) lines.push(`Tags/topics: ${tags}`);
    if (description) lines.push(`Creator's description: "${description}"`);

    lines.push(
      "",
      "Write a description with this structure:",
      "1. A compelling opening line that summarizes the value of the video",
      "2. Body (2-4 sentences describing what viewers will learn or see)",
      "3. 3-6 relevant hashtags",
      "",
      "Rules:",
      "- Always write in English, even if the transcript or context is in another language",
      "- Do NOT add a #Shorts hashtag — this is a regular video, not a Short",
      "- Never use placeholder text like [Your Name] or [Topic]",
      "- Be specific based on the actual content provided",
      "- Keep it concise but informative (a few short paragraphs is fine)",
      "- Sound natural and engaging, not robotic",
      "- If no context is available, write a generic but engaging YouTube video description",
      "",
      "Return only the description, nothing else.",
    );

    return lines.join("\n");
  }

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
    "3. 5-8 relevant hashtags (include #Shorts)",
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

function isSupabaseSignedUrl(url: string): boolean {
  return url.includes("/object/sign/");
}

/** URL external services (Rendi) can fetch — never strip signed URL tokens. */
function urlForExternalFetch(url: string): string {
  if (isSupabaseSignedUrl(url)) return url;
  return url.split("?")[0];
}

/** Resolve a fetchable video URL for Rendi/Whisper (pipeline TTL when ours). */
async function resolveCaptionVideoFetchUrl(params: {
  videoUrl: string;
  storagePath: string;
}): Promise<string | null> {
  const path = resolveStoragePath(params.storagePath || null, params.videoUrl || null);
  if (path) {
    const userId = await getSessionUserId();
    if (!userId) throw new Error("Not authenticated.");
    await assertPathOwnedByUser(path, userId);
    return signStoragePathForPipeline(path, userId);
  }
  if (params.videoUrl.startsWith("http")) return urlForExternalFetch(params.videoUrl);
  return null;
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
    try {
      await assertToolEnabled("schedule");
    } catch (e) {
      if (e instanceof ToolDisabledError) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
      }
      throw e;
    }

    const body = await req.json();
    const mode: string = (body.mode ?? "generate").toString();
    const description: string = (body.description ?? "").toString().trim();
    const title: string = (body.title ?? "").toString().trim();
    const tags: string = (body.tags ?? "").toString().trim();
    const videoUrl: string = (body.videoUrl ?? "").toString().trim();
    const storagePath: string = (body.storage_path ?? body.storagePath ?? "").toString().trim();
    const existingCaption: string = (body.existingCaption ?? "").toString().trim();
    const format: CaptionFormat = body.format === "video" ? "video" : "short";

    const replicate = createReplicateClient();
    const { llm, whisper } = await getScheduleModels();
    const llmModel = replicateRef(llm);
    const whisperModel = replicateRef(whisper);

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

      const generalOutput = await runWithRetry(replicate, llmModel, {
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

      const polishOutput = await runWithRetry(replicate, llmModel, {
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
    if (!description && !title && !tags && !videoUrl && !storagePath) {
      return NextResponse.json(
        {
          error:
            "Provide at least one of: videoUrl, storage_path, title, tags, or description.",
        },
        { status: 400 },
      );
    }

    let transcript: string | null = null;
    // Distinguish the two reasons `transcript` ends up null so the client can
    // show an honest message: "no_audio" = pipeline ran but found no speech;
    // "failed" = extraction/Whisper threw (e.g. missing RENDI_API_KEY, provider
    // error, timeout). Defaults to "no_audio" (incl. the no-videoUrl case).
    let transcriptStatus: "ok" | "no_audio" | "failed" = "no_audio";
    if (videoUrl || storagePath) {
      let sourceUrl: string;
      try {
        const resolved = await resolveCaptionVideoFetchUrl({ videoUrl, storagePath });
        if (!resolved) {
          return NextResponse.json(
            { error: "Could not resolve a fetchable video URL." },
            { status: 400 },
          );
        }
        sourceUrl = resolved;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const status = /not authenticated/i.test(message)
          ? 401
          : /forbidden/i.test(message)
            ? 403
            : 400;
        return NextResponse.json({ error: message }, { status });
      }
      try {
        // Whisper is unreliable demuxing audio straight from a video container,
        // so extract a hosted MP3 via Rendi first, then transcribe that.
        console.log("[generate-caption] extracting audio from:", sourceUrl.split("?")[0]);
        const audioUrl = await extractAudioMp3(sourceUrl);
        console.log("[generate-caption] whisper audio url:", audioUrl);

        const wRes = await runWithRetry(replicate, whisperModel, {
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
        if (text.length > 0) {
          transcript = text;
          transcriptStatus = "ok";
        } else {
          transcript = null;
          transcriptStatus = "no_audio";
        }
      } catch (err) {
        // Soft-fail: audio extraction or Whisper failed (e.g. silent video,
        // no audio track, Rendi/Replicate error). Continue with title/tags/
        // description only rather than failing the whole request — but flag it
        // as "failed" (not "no_audio") so the UI doesn't wrongly claim silence.
        console.warn(
          "[generate-caption] audio extraction or Whisper failed, continuing without transcript:",
          err instanceof Error ? err.message : err,
        );
        transcript = null;
        transcriptStatus = "failed";
      }
    }

    const prompt = buildPrompt({
      transcript,
      title: title || undefined,
      tags: tags || undefined,
      description: description || undefined,
      format,
    });

    const output = await runWithRetry(replicate, llmModel, {
      input: {
        prompt,
        // Long-form descriptions get more room than the 300-char Shorts caption.
        max_tokens: format === "video" ? 600 : 300,
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

    return NextResponse.json({
      caption,
      usedTranscript: !!transcript,
      transcriptStatus,
    });
  } catch (err: unknown) {
    console.error("[generate-caption]", err);

    const message =
      err instanceof Error ? err.message : "Unexpected error occurred.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import type Replicate from "replicate";
import { createReplicateClient, runWithRetry } from "@/lib/replicate-utils";
import { extractAudioMp3 } from "@/lib/rendi";
import { getSessionUserId } from "@/lib/resolve-user";
import {
  assertPathOwnedByUser,
  resolveStoragePath,
  signStoragePathForPipeline,
} from "@/lib/storage-signed-url";
import { assertToolEnabled, ToolDisabledError } from "@/lib/tool-access";
import { getScheduleModels, replicateRef, type ReplicateModelRef } from "@/lib/model-resolver";

// Audio extraction (Rendi) + Whisper + Gemini — give the pipeline headroom
export const maxDuration = 120;

function joinReplicateOutput(output: unknown): string {
  if (Array.isArray(output)) {
    return (output as string[]).join("").trim();
  }
  return String(output ?? "").trim();
}

/**
 * Cheap signal that a generation got cut short instead of completing its
 * structure (opening line + body + hashtags + emojis) — e.g. Gemini aborting
 * mid-response. Every prompt variant explicitly asks for hashtags, so their
 * total absence is a reliable enough tell.
 */
function looksIncomplete(caption: string): boolean {
  return !caption.includes("#");
}

/**
 * Retry the SAME request if the caption looks cut short. openai/gpt-5 (see
 * lib/model-resolver.ts's `schedule.llm` — switched from Gemini 2.5 Flash
 * after direct testing showed Gemini unreliably truncates this kind of
 * structured "caption + hashtags" creative-writing task, worse still with an
 * image attached, while GPT-5 completes it reliably) rarely needs this; it's
 * a light safety net, not the primary reliability mechanism.
 */
async function generateCaptionText(
  replicate: Replicate,
  model: ReplicateModelRef,
  input: Record<string, unknown>,
  attempts = 3,
): Promise<string> {
  let last = "";
  for (let i = 0; i < attempts; i++) {
    const output = await runWithRetry(replicate, model, { input });
    last = joinReplicateOutput(output);
    if (last && !looksIncomplete(last)) return last;
  }
  return last;
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
  hasImage?: boolean;
}): string {
  const { transcript, title, tags, description, format = "short", hasImage } = opts;

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

  const lines: string[] = hasImage
    ? [
        "You are a social media content expert. Write an engaging caption for a photo post based on the attached image — including any visible text on it, like an event name, speaker, date, or location if it's a poster or flyer.",
        "",
        "Context:",
      ]
    : [
        "You are a YouTube Shorts content expert. Write an engaging caption for a YouTube Short.",
        "",
        "Context about the video:",
      ];

  if (transcript) lines.push(`Video transcript: "${transcript}"`);
  if (title) lines.push(`${hasImage ? "Creator's original idea/prompt" : "Video title"}: "${title}"`);
  if (tags) lines.push(`Tags/topics: ${tags}`);
  if (description) lines.push(`Creator's description: "${description}"`);

  lines.push(
    "",
    `Keep it short and natural, 1-2 sentences, then add 3-5 relevant hashtags${hasImage ? "" : " (include #Shorts)"} and 2 emojis. Write in English, stay under 300 characters, never use placeholder text like [Your Name], and return only the caption text.`,
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
    "Write ONE short, natural caption (2-3 sentences) that broadly fits the theme shared across all of them — don't reference one specific video. Then add 3-5 relevant hashtags and 2 emojis. Write in English, stay under 300 characters, never use placeholder text like [Your Name], and return only the caption text.",
  );

  return lines.join("\n");
}

/**
 * Instagram caption for a Photo Studio social post. There is no video and no
 * transcript — the creator's post idea (sent as `title`) plus optional tags carry
 * the context. Kept short so it stays comfortable inside the scheduler hand-off URL.
 */
function buildInstagramPrompt(opts: {
  title?: string;
  tags?: string;
  description?: string;
  hasImage?: boolean;
}): string {
  const lines: string[] = [
    opts.hasImage
      ? "You are an Instagram content expert. Write an engaging caption for a single feed post based on the attached image — including any visible text on it, like an event name, speaker, date, or location if it's a poster or flyer."
      : "You are an Instagram content expert. Write an engaging caption for a single Instagram feed post.",
    "",
    "Context:",
  ];

  if (opts.title) lines.push(`Creator's original idea/prompt for this post: "${opts.title}"`);
  if (opts.tags) lines.push(`Tags/topics: ${opts.tags}`);
  if (opts.description) lines.push(`Creator's notes: "${opts.description}"`);

  lines.push(
    "",
    "Keep it short and natural, 1-2 sentences, then add 3-5 relevant hashtags (no #Shorts — this is Instagram, not YouTube) and 2 emojis. Write in English, stay under 500 characters, never use placeholder text like [Your Name], and return only the caption text.",
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

/** Resolve a fetchable image URL for the vision caption model (pipeline TTL when ours). */
async function resolveCaptionImageFetchUrl(params: {
  imageUrl: string;
  storagePath: string;
}): Promise<string | null> {
  const path = resolveStoragePath(params.storagePath || null, params.imageUrl || null);
  if (path) {
    const userId = await getSessionUserId();
    if (!userId) throw new Error("Not authenticated.");
    await assertPathOwnedByUser(path, userId);
    return signStoragePathForPipeline(path, userId);
  }
  if (params.imageUrl.startsWith("http")) return urlForExternalFetch(params.imageUrl);
  return null;
}

function buildPolishPrompt(existingCaption: string): string {
  return [
    "You are a YouTube Shorts content expert. Polish this caption draft to read more naturally and flow better, keeping its relevant hashtags and up to 3 emojis:",
    "",
    `"${existingCaption}"`,
    "",
    "Keep the same topic, intent, and core message, stay under 300 characters, and return only the polished caption text.",
  ].join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Which surface is asking. Default "youtube" keeps the scheduler untouched;
    // "instagram" is the Photo Studio social post, which lives under the photo tool.
    const platform: "youtube" | "instagram" =
      body.platform === "instagram" ? "instagram" : "youtube";

    try {
      await assertToolEnabled(platform === "instagram" ? "photo" : "schedule");
    } catch (e) {
      if (e instanceof ToolDisabledError) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
      }
      throw e;
    }

    const mode: string = (body.mode ?? "generate").toString();
    const description: string = (body.description ?? "").toString().trim();
    const title: string = (body.title ?? "").toString().trim();
    const tags: string = (body.tags ?? "").toString().trim();
    const videoUrl: string = (body.videoUrl ?? "").toString().trim();
    const storagePath: string = (body.storage_path ?? body.storagePath ?? "").toString().trim();
    // Cover photo of a photo post (Scheduler) — mutually exclusive with videoUrl/
    // storagePath above, which are video-only (Whisper transcription).
    const photoStoragePath: string = (body.photo_storage_path ?? body.photoStoragePath ?? "").toString().trim();
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

      const generalCaption = await generateCaptionText(replicate, llmModel, {
        prompt: buildGeneralPrompt(videos),
        max_completion_tokens: 400,
        reasoning_effort: "low",
      });
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

      const polished = await generateCaptionText(replicate, llmModel, {
        prompt: buildPolishPrompt(existingCaption),
        max_completion_tokens: 400,
        reasoning_effort: "low",
      });
      if (!polished) {
        return NextResponse.json(
          { error: "Model returned an empty response. Please try again." },
          { status: 502 },
        );
      }

      return NextResponse.json({ caption: polished, mode: "polish" });
    }

    // ----- Instagram: caption a Photo Studio social post, no transcription -----
    if (platform === "instagram") {
      const imageUrlRaw: string = (body.imageUrl ?? "").toString().trim();
      const imageStoragePath: string = (body.image_storage_path ?? body.storage_path ?? body.storagePath ?? "")
        .toString()
        .trim();

      if (!title && !tags && !description && !imageUrlRaw && !imageStoragePath) {
        return NextResponse.json(
          { error: "Describe the post first, then generate a caption." },
          { status: 400 },
        );
      }

      let resolvedImageUrl: string | null = null;
      if (imageUrlRaw || imageStoragePath) {
        try {
          resolvedImageUrl = await resolveCaptionImageFetchUrl({
            imageUrl: imageUrlRaw,
            storagePath: imageStoragePath,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          const status = /not authenticated/i.test(message)
            ? 401
            : /forbidden/i.test(message)
              ? 403
              : 400;
          return NextResponse.json({ error: message }, { status });
        }
      }

      const igCaption = await generateCaptionText(replicate, llmModel, {
        prompt: buildInstagramPrompt({
          title: title || undefined,
          tags: tags || undefined,
          description: description || undefined,
          hasImage: !!resolvedImageUrl,
        }),
        ...(resolvedImageUrl ? { image_input: [resolvedImageUrl] } : {}),
        max_completion_tokens: 500,
        reasoning_effort: "low",
      });

      if (!igCaption) {
        return NextResponse.json(
          { error: "Model returned an empty response. Please try again." },
          { status: 502 },
        );
      }

      return NextResponse.json({
        caption: igCaption,
        platform: "instagram",
        usedImage: !!resolvedImageUrl,
      });
    }

    // ----- Generate mode: build a caption from video/photo/context -----
    if (!description && !title && !tags && !videoUrl && !storagePath && !photoStoragePath) {
      return NextResponse.json(
        {
          error:
            "Provide at least one of: videoUrl, storage_path, photo_storage_path, title, tags, or description.",
        },
        { status: 400 },
      );
    }

    let resolvedPhotoUrl: string | null = null;
    // Photo posts have no video/transcript — resolve the cover photo instead so
    // the model can actually see it, mirroring the Instagram branch above.
    if (!videoUrl && !storagePath && photoStoragePath) {
      try {
        resolvedPhotoUrl = await resolveCaptionImageFetchUrl({
          imageUrl: "",
          storagePath: photoStoragePath,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const status = /not authenticated/i.test(message)
          ? 401
          : /forbidden/i.test(message)
            ? 403
            : 400;
        return NextResponse.json({ error: message }, { status });
      }
    }

    let transcript: string | null = null;
    // Distinguish the two reasons `transcript` ends up null so the client can
    // show an honest message: "no_audio" = pipeline ran but found no speech;
    // "failed" = extraction/Whisper threw (e.g. missing RENDI_API_KEY, provider
    // error, timeout). Stays null when there was no video at all (e.g. a photo
    // post) so the client doesn't wrongly warn "no audio detected".
    let transcriptStatus: "ok" | "no_audio" | "failed" | null = null;
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
      hasImage: !!resolvedPhotoUrl,
    });

    const caption = await generateCaptionText(replicate, llmModel, {
      prompt,
      ...(resolvedPhotoUrl ? { image_input: [resolvedPhotoUrl] } : {}),
      // Long-form descriptions get more room than the 300-char Shorts caption.
      max_completion_tokens: format === "video" ? 700 : 400,
      reasoning_effort: "low",
    });

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
      usedImage: !!resolvedPhotoUrl,
    });
  } catch (err: unknown) {
    console.error("[generate-caption]", err);

    const message =
      err instanceof Error ? err.message : "Unexpected error occurred.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

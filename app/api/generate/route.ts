/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { NextResponse } from 'next/server';
import Replicate from 'replicate';
import { supabase } from '@/lib/supabase';
import { STORAGE_BUCKET, videosStoragePath, videosTempStoragePath } from '@/lib/storage-buckets';

// Allow up to 10 minutes for this route (LLM + generation + whisper + rendi)
export const maxDuration = 600;
// Helper to format seconds to ASS timestamp (H:MM:SS.cs)
function formatAssTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { theme, numScenes, durationPerScene, resolution, captionStyle, voiceId, emotion } = body;
    const SCENE_COUNT = numScenes || 1;
    const RESOLUTION = resolution || "480p";
    const VOICE_ID: string = voiceId || "English_CaptivatingStoryteller";
    // "auto" means let the LLM pick the emotion that fits the theme; anything else
    // overrides the LLM suggestion with the user's explicit choice.
    const USER_EMOTION: string = String(emotion || "auto").toLowerCase();

    const style = captionStyle || {
      fontname: "Arial",
      fontsize: 28,
      primaryColor: "#FFFFFF",
      highlightColor: "#FFFF00",
      outlineColor: "#000000",
      outlineThickness: 4,
      marginV: 15,
      highlightOnly: false
    };

    const hexToAssColor = (hex: string) => {
      const r = hex.slice(1, 3);
      const g = hex.slice(3, 5);
      const b = hex.slice(5, 7);
      return `&H00${b}${g}${r}`;
    };

    if (!theme) {
      return NextResponse.json({ error: 'Theme is required' }, { status: 400 });
    }

    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });

    const runWithRetry = async (model: any, options: any, maxRetries = 10) => {
      for (let i = 0; i < maxRetries; i++) {
        try {
          return await replicate.run(model, options);
        } catch (e: any) {
          const errMsg = e.message || String(e);
          if (errMsg.includes('429')) {
            let delayMs = 15000; // default 15 seconds
            try {
              const match = errMsg.match(/"retry_after":\s*(\d+)/);
              if (match && match[1]) {
                delayMs = (parseInt(match[1]) + 2) * 1000; // Add 2s buffer
              }
            } catch (_) {}
            console.warn(`[Replicate 429 Rate Limit] Retrying in ${delayMs/1000}s (Attempt ${i+1}/${maxRetries})...`);
            await new Promise(res => setTimeout(res, delayMs));
          } else {
            throw e;
          }
        }
      }
      throw new Error(`Failed to run replicate model ${model} after ${maxRetries} retries due to rate limits.`);
    };

    // User-selected per-scene duration is a STRICT constraint: each scene's final
    // video is exactly DURATION_PER_SCENE seconds, total reel = SCENE_COUNT * that.
    const DURATION_PER_SCENE = durationPerScene || 5;
    const TOTAL_DURATION = SCENE_COUNT * DURATION_PER_SCENE;

    // Use Gemini 2.5 Flash on Replicate — strong creative writing for cinematic
    // prompts and reliable structured JSON. Dynamic thinking is enabled on the
    // scene-breakdown step where hard constraints (exact scene count, word caps,
    // verbatim style-anchor copy) benefit from a touch of reasoning.
    const LLM_MODEL = 'google/gemini-2.5-flash';

    // Robust JSON extractor: strips markdown fences, finds the first balanced
    // JSON object/array in the response, and parses it.
    const extractJson = (raw: string): any => {
      const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
      try { return JSON.parse(cleaned); } catch (_) {}

      const findBalanced = (text: string, open: string, close: string): string | null => {
        const start = text.indexOf(open);
        if (start === -1) return null;
        let depth = 0;
        for (let i = start; i < text.length; i++) {
          if (text[i] === open) depth++;
          else if (text[i] === close) {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
          }
        }
        return null;
      };

      const arr = findBalanced(cleaned, '[', ']');
      if (arr) { try { return JSON.parse(arr); } catch (_) {} }
      const obj = findBalanced(cleaned, '{', '}');
      if (obj) { try { return JSON.parse(obj); } catch (_) {} }
      throw new Error('No valid JSON found in LLM response');
    };

    console.log(`[Step 1A] Generating Style Anchor, Negative Prompt, and Narrator Emotion for theme: "${theme}"...`);
    // Step 1A: LLM Style + Narrator Emotion Generation
    // narrator_emotion is one of MiniMax speech-02-turbo's supported emotions
    // (happy, sad, angry, fearful, disgusted, surprised, neutral). The LLM picks
    // the one that best matches the theme's storytelling mood.
    const styleSystemPrompt = `You are a cinematographer and audio director. Given a video theme, return a JSON object with exactly three fields:
- style_anchor: comma-separated string of 6-8 visual descriptors defining the consistent look, setting, lighting, and style for ALL scenes (always include photorealistic and 9:16 vertical)
- negative_prompt: comma-separated list of visual things to avoid
- narrator_emotion: ONE of these exact values describing the storytelling voice mood — "auto", "happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm", "fluent", "neutral". Use "auto" only when no specific mood fits.
Return ONLY raw JSON, nothing else.`;

    const styleLlmOutput = await runWithRetry(LLM_MODEL, {
      input: {
        prompt: theme,
        system_instruction: styleSystemPrompt,
        max_output_tokens: 512,
        temperature: 0.7,
        thinking_budget: 0,
      },
    });

    const styleRawJson = Array.isArray(styleLlmOutput) ? styleLlmOutput.join('') : String(styleLlmOutput);

    // MiniMax speech-02-turbo supported emotions (per its schema).
    const VALID_EMOTIONS = ["auto", "happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm", "fluent", "neutral"];
    let styleAnchor = "";
    let negativePrompt = "";
    let llmSuggestedEmotion = "auto";
    try {
      const styleData = extractJson(styleRawJson);
      styleAnchor = styleData.style_anchor || "photorealistic, 9:16 vertical";
      negativePrompt = styleData.negative_prompt || "ugly, broken, blurry";
      const emo = String(styleData.narrator_emotion || "").toLowerCase().trim();
      llmSuggestedEmotion = VALID_EMOTIONS.includes(emo) ? emo : "auto";
    } catch (e) {
      console.warn('Failed to parse style JSON, using fallbacks:', styleRawJson);
      styleAnchor = "photorealistic, highly detailed, cinematic lighting, 9:16 vertical";
      negativePrompt = "blurry, low quality, distorted, watermark";
    }

    // User's explicit emotion choice wins; "auto" defers to the LLM's suggestion.
    const narratorEmotion = (USER_EMOTION === "auto" || !VALID_EMOTIONS.includes(USER_EMOTION))
      ? llmSuggestedEmotion
      : USER_EMOTION;

    console.log(`[Style Anchor]: ${styleAnchor}`);
    console.log(`[Negative Prompt]: ${negativePrompt}`);
    console.log(`[Narrator Voice]: ${VOICE_ID}`);
    console.log(`[Narrator Emotion]: ${narratorEmotion} (user="${USER_EMOTION}", llm="${llmSuggestedEmotion}")`);

    // Per-scene word cap derived from user's DURATION_PER_SCENE. Empirically MiniMax
    // speech-02-turbo speaks at ~1.7 words/sec with sentence punctuation pauses, so
    // we cap at 1.7 wps. Any residual overshoot is handled by ffmpeg's atempo
    // filter in the merge step (speed-fit safety net).
    const MAX_WORDS_PER_SCENE = Math.max(6, Math.floor(DURATION_PER_SCENE * 1.7));

    console.log(`[Step 1B] Breaking down scenes (${SCENE_COUNT} x ${DURATION_PER_SCENE}s, max ${MAX_WORDS_PER_SCENE} words each) with LLM...`);
    // Step 1B: LLM Scene Breakdown — narrations written as ONE continuous monologue
    // split into scene-aligned chunks. When joined with spaces, they must read as a
    // single flowing story so the single TTS call produces natural prosody throughout.
    const systemPrompt = `You are a video producer. The user gives a theme. Return a JSON array of exactly ${SCENE_COUNT} scene(s) to make a faceless video (Reels/TikTok).
All scenes must exist in the same visual world and location.

STYLE ANCHOR (append this exact string verbatim at the end of every video_prompt):
"${styleAnchor}"

NARRATION RULES (CRITICAL):
- The narrations from all scenes will be JOINED with spaces and spoken as ONE continuous monologue by a single narrator.
- Write them as one flowing story split into scene-sized chunks. Each scene's narration must connect naturally to the next.
- Use connective phrases between scenes ("but then…", "suddenly…", "what happens next…", "and that's when…") so the listener never feels a hard cut.
- DO NOT repeat information between scenes.
- DO NOT start a scene's narration with a phrase that only makes sense in isolation (e.g., "Welcome back!").
- Each scene's narration MUST be ${MAX_WORDS_PER_SCENE} words or fewer.
- Spell out digits as words ("100" → "one hundred") for clean TTS pronunciation.

Each scene must have:
- "scene_id": number (e.g., 1)
- "video_prompt": string (highly detailed visual description for a text-to-video model. CRITICAL: Every video_prompt MUST end with the literal STYLE ANCHOR string above, copied exactly. Do NOT write the words "the style anchor" — copy the actual descriptors.)
- "narration": string (voiceover text following the NARRATION RULES above)

Return ONLY raw JSON array, nothing else.`;

    // Try up to 3 times to get exactly SCENE_COUNT valid scenes.
    let scenes: any[] = [];
    let lastRaw = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      const llmOutput = await runWithRetry(LLM_MODEL, {
        input: {
          prompt: theme,
          system_instruction: systemPrompt,
          max_output_tokens: 1500,
          temperature: 0.8,
          dynamic_thinking: true,
        },
      });

      lastRaw = Array.isArray(llmOutput) ? llmOutput.join('') : String(llmOutput);
      try {
        const parsed = extractJson(lastRaw);
        // Some models return { scenes: [...] } instead of a bare array
        const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.scenes) ? parsed.scenes : null);
        if (Array.isArray(arr) && arr.length === SCENE_COUNT) {
          scenes = arr;
          break;
        }
        console.warn(`[Step 1B attempt ${attempt}] Got ${Array.isArray(arr) ? arr.length : 'invalid'} scenes, expected ${SCENE_COUNT}. Retrying...`);
      } catch (e) {
        console.warn(`[Step 1B attempt ${attempt}] JSON parse failed:`, lastRaw.slice(0, 300));
      }
    }

    if (!Array.isArray(scenes) || scenes.length !== SCENE_COUNT) {
      console.error('Failed to get correct scene count after 3 attempts. Last raw output:', lastRaw);
      throw new Error(`LLM did not return exactly ${SCENE_COUNT} scene(s) after 3 attempts.`);
    }

    // Safety net: ensure every video_prompt actually ends with the style anchor
    // (LLMs sometimes write "the style anchor" literally instead of substituting the value)
    // Also hard-truncate narration to MAX_WORDS_PER_SCENE to keep each scene under
    // Seedance's 10s ceiling no matter what the LLM produced.
    for (const scene of scenes) {
      let p = String(scene.video_prompt || '').trim();
      p = p.replace(/[,.\s]*and\s+the\s+style\s+anchor\.?\s*$/i, '');
      p = p.replace(/[,.\s]*the\s+style\s+anchor\.?\s*$/i, '');
      if (!p.toLowerCase().includes(styleAnchor.toLowerCase().slice(0, 20))) {
        p = `${p.replace(/[.,\s]+$/, '')}, ${styleAnchor}`;
      }
      scene.video_prompt = p;

      const narrationWords = String(scene.narration || '').trim().split(/\s+/).filter(Boolean);
      if (narrationWords.length > MAX_WORDS_PER_SCENE) {
        console.warn(`[Scene ${scene.scene_id}] narration ${narrationWords.length} words > cap, truncating`);
        scene.narration = narrationWords.slice(0, MAX_WORDS_PER_SCENE).join(' ');
      } else {
        scene.narration = narrationWords.join(' ');
      }

      console.log(`[Scene ${scene.scene_id} prompt]: ${p}`);
      console.log(`[Scene ${scene.scene_id} narration]: ${scene.narration}`);
    }

    // Shared extractor for Replicate's many output shapes (FileOutput, string, array, etc.)
    const extractMediaUrl = (res: any): string => {
      if (typeof res === "string") return res;
      if (res && typeof res === "object") {
        if (typeof res.url === 'function') {
          const u = res.url();
          return (u && u.href) ? u.href : String(u);
        }
        if (res instanceof URL) return res.toString();
        if (typeof res.toString === 'function') {
          const s = res.toString();
          if (s.startsWith('http')) return s;
        }
        if ('audio' in res && typeof res.audio?.url === 'function') return res.audio.url();
        if ('audio' in res && typeof res.audio?.url === 'string') return res.audio.url;
        if ('audio_url' in res) return res.audio_url;
        if ('audio_file' in res) return res.audio_file;
        if ('url' in res && typeof res.url === 'string') return res.url;
        if ('video' in res && typeof res.video === 'string') return res.video;
        if ('output' in res && typeof res.output === 'string') return res.output;
        if (Array.isArray(res)) {
          const first = res[0];
          return typeof first?.url === 'function' ? first.url() : String(first);
        }
      }
      return String(res);
    };

    // ---------- Step 2+3: TTS + Whisper with speed-correction retry ----------
    // The user paid for TOTAL_DURATION seconds, so we must deliver exactly that.
    // MiniMax speech rate varies wildly per voice_id (1.5-2.7 wps), so a single
    // static word cap can't reliably hit the target across all voices.
    //
    // Strategy: run TTS at speed=1.0, measure with Whisper, and if the result is
    // significantly off-target, re-run with a corrected speed parameter. MiniMax's
    // `speed` parameter is roughly linear with duration, so `speed = currentDur /
    // targetDur` produces audio close to the target on the second pass. Any small
    // residual is corrected by ffmpeg's atempo in the merge step. Final reel is
    // ALWAYS exactly TOTAL_DURATION seconds.
    type WordChunk = { text: string; start: number; end: number };

    const fullNarration = scenes.map(s => String(s.narration || '').trim()).filter(Boolean).join(' ');
    if (!fullNarration) {
      throw new Error('All scene narrations are empty — LLM failed to produce a script.');
    }

    const generateTtsAndTranscribe = async (text: string, speed: number): Promise<{ audioUrl: string; words: WordChunk[]; duration: number }> => {
      console.log(`[TTS] Generating at speed=${speed.toFixed(3)}, emotion="${narratorEmotion}", voice="${VOICE_ID}"...`);
      const ttsRes = await runWithRetry("minimax/speech-02-turbo", {
        input: {
          text,
          voice_id: VOICE_ID,
          emotion: narratorEmotion,
          speed,
          pitch: 0,
          language_boost: "English",
          audio_format: "mp3",
          bitrate: 128000
        }
      });
      const url = extractMediaUrl(ttsRes);
      if (!url || !url.startsWith('http')) {
        console.error('Failed to extract TTS audio URL:', ttsRes);
        throw new Error('Failed to generate TTS audio.');
      }
      console.log(`[TTS] Audio URL: ${url}`);

      console.log('[Whisper] Transcribing audio...');
      const wRes = await runWithRetry(
        "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c",
        {
          input: { audio: url, language: "english", timestamp: "word", batch_size: 64 }
        }
      ) as any;

      const words: WordChunk[] = [];
      if (wRes?.chunks) {
        for (const c of wRes.chunks) {
          const txt = String(c.text || '').trim();
          if (!txt) continue;
          words.push({ text: txt, start: c.timestamp?.[0] ?? 0, end: c.timestamp?.[1] ?? (c.timestamp?.[0] ?? 0) + 0.3 });
        }
      } else if (wRes?.segments) {
        for (const seg of wRes.segments) {
          for (const w of (seg.words || [])) {
            const txt = String(w.word || w.text || '').trim();
            if (!txt) continue;
            words.push({ text: txt, start: w.start ?? seg.start ?? 0, end: w.end ?? seg.end ?? (w.start ?? 0) + 0.3 });
          }
        }
      }
      if (words.length === 0) {
        throw new Error('Whisper returned no word timestamps.');
      }
      const dur = words[words.length - 1].end;
      console.log(`[Whisper] ${words.length} words transcribed across ${dur.toFixed(2)}s`);
      return { audioUrl: url, words, duration: dur };
    };

    // Pass 1: speed=1.0
    console.log('[Step 2/3] First TTS+Whisper pass at speed=1.0...');
    let { audioUrl: fullAudioUrl, words: whisperWords, duration: audioEndTotal } =
      await generateTtsAndTranscribe(fullNarration, 1.0);

    // If first pass missed target by more than ~15%, re-run with corrected speed
    // (within MiniMax's supported speed range, clamped to [0.5, 2.0]).
    const RATIO_TOLERANCE_LOW = 0.85;
    const RATIO_TOLERANCE_HIGH = 1.15;
    const MINIMAX_SPEED_MIN = 0.5;
    const MINIMAX_SPEED_MAX = 2.0;

    const firstRatio = audioEndTotal / TOTAL_DURATION;
    if (firstRatio < RATIO_TOLERANCE_LOW || firstRatio > RATIO_TOLERANCE_HIGH) {
      const correctedSpeed = Math.max(MINIMAX_SPEED_MIN, Math.min(MINIMAX_SPEED_MAX, firstRatio));
      console.log(`[TTS retry] Pass 1 ratio=${firstRatio.toFixed(3)} outside tolerance — re-running at speed=${correctedSpeed.toFixed(3)}`);
      ({ audioUrl: fullAudioUrl, words: whisperWords, duration: audioEndTotal } =
        await generateTtsAndTranscribe(fullNarration, correctedSpeed));
    } else {
      console.log(`[TTS] Pass 1 ratio=${firstRatio.toFixed(3)} within tolerance — no retry needed.`);
    }

    // Step 4: Compute residual atempo to land exactly on TOTAL_DURATION.
    // After the optional retry, audio should be close to target; atempo handles
    // any small residual. The final reel is ALWAYS exactly TOTAL_DURATION.
    const ATEMPO_MIN = 0.5;
    const ATEMPO_MAX = 2.0;
    let audioSpeedFactor = 1.0;
    const finalRatio = audioEndTotal / TOTAL_DURATION;
    if (Math.abs(1 - finalRatio) > 0.01) {
      audioSpeedFactor = Math.max(ATEMPO_MIN, Math.min(ATEMPO_MAX, finalRatio));
      console.log(`[Audio] Final residual atempo=${audioSpeedFactor.toFixed(4)} (audio ${audioEndTotal.toFixed(2)}s → ${TOTAL_DURATION}s)`);
    } else {
      console.log(`[Audio] Audio ${audioEndTotal.toFixed(2)}s ≈ budget ${TOTAL_DURATION}s — no atempo needed.`);
    }
    const finalDuration = TOTAL_DURATION;
    const perSceneDuration = DURATION_PER_SCENE;

    // ---------- Step 5: Parallel Seedance video generation ----------
    // Each scene's video is exactly DURATION_PER_SCENE seconds (user's choice).
    // Total reel = SCENE_COUNT * DURATION_PER_SCENE.
    console.log(`[Step 5] Parallel Seedance video generation (${DURATION_PER_SCENE}s per scene)...`);
    const videoPromises = scenes.map(scene => {
      console.log(`[Seedance] Scene ${scene.scene_id}: requesting ${DURATION_PER_SCENE}s`);
      return runWithRetry("bytedance/seedance-2.0-fast", {
        input: {
          prompt: scene.video_prompt,
          aspect_ratio: "9:16",
          negative_prompt: negativePrompt,
          duration: DURATION_PER_SCENE,
          resolution: RESOLUTION,
          generate_audio: false
        }
      });
    });

    const videoResponses = await Promise.all(videoPromises);
    const sceneVideoUrls: string[] = videoResponses.map((res, i) => {
      const url = extractMediaUrl(res);
      if (!url || !url.startsWith('http')) {
        console.error(`Failed to extract video URL for scene ${scenes[i].scene_id}:`, res);
        throw new Error(`Failed to generate video for scene ${scenes[i].scene_id}.`);
      }
      return url;
    });

    console.log('[Step 6] Build ASS subtitle file from continuous Whisper timeline...');
    // Subtitle timestamps come directly from the single Whisper pass — no per-scene
    // offset math because audio is now one continuous file, and the trimmed-and-concatenated
    // video timeline matches the audio timeline exactly.
    const primaryColorASS = hexToAssColor(style.primaryColor);
    const outlineColorASS = hexToAssColor(style.outlineColor);
    const highlightColorASS = hexToAssColor(style.highlightColor);

    // Cap max margin so 100% places text at the top edge, not completely off-screen
    const maxMarginV = 854 - (style.fontsize * 1.5);
    const actualMarginV = Math.floor((style.marginV / 100) * maxMarginV);

    let assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: 480
PlayResY: 854
WrapStyle: 1

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontname},${style.fontsize},${primaryColorASS},&H000000FF,${outlineColorASS},&H00000000,-1,0,0,0,100,100,0,0,1,${style.outlineThickness},0,2,10,10,${actualMarginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const formatAssTime = (s: number) => {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = Math.floor(s % 60);
      const cs = Math.floor((s % 1) * 100);
      return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
    };

    // When audio is time-stretched by atempo, the spoken word at original time T
    // plays at T/audioSpeedFactor in the final video. Scale subtitle timestamps to
    // match. Then clamp to finalDuration (= TOTAL_DURATION).
    for (const w of whisperWords) {
      const text = w.text.trim();
      if (!text) continue;
      const start = w.start / audioSpeedFactor;
      const end = Math.min(w.end / audioSpeedFactor, finalDuration);
      if (start >= finalDuration) continue;
      const lineText = `{\\c${highlightColorASS}}{\\b1}${text.toUpperCase()}{\\b0}`;
      assContent += `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${lineText}\n`;
    }

    if (!assContent.includes('Dialogue:')) {
      assContent += `Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,(No speech detected)\n`;
    }

    console.log('[Step 5] Upload ASS to Supabase...');
    // Step 5: Upload ASS to Supabase
    const srtFilename = videosTempStoragePath(`captions_${Date.now()}.ass`);
    const { error: uploadError } = await supabase
      .storage
      .from(STORAGE_BUCKET)
      .upload(srtFilename, assContent, {
        contentType: 'text/plain',
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('Supabase upload error:', uploadError);
      throw new Error('Failed to upload captions to storage');
    }

    const { data: { publicUrl: srtUrl } } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(srtFilename);

    console.log('[Step 6] Rendi FFmpeg Processing (2-step)...');
    // Step 6: Rendi API — single command endpoint (free plan compatible)
    const rendiApiKey = process.env.RENDI_API_KEY;
    if (!rendiApiKey) {
      throw new Error("RENDI_API_KEY is not set.");
    }

    // Helper to run a single Rendi command and poll for completion
    const runRendiSingle = async (
      ffmpegCommand: string,
      inputFiles: Record<string, string>,
      outputFiles: Record<string, string>
    ) => {
      const payload = {
        ffmpeg_command: ffmpegCommand,
        input_files: inputFiles,
        output_files: outputFiles
      };

      console.log('[Rendi] Submitting:', ffmpegCommand.substring(0, 120) + '...');

      const resp = await fetch("https://api.rendi.dev/v1/run-ffmpeg-command", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": rendiApiKey
        },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Rendi API failed (${resp.status}): ${errText || resp.statusText}`);
      }

      const { command_id } = await resp.json();
      console.log(`[Rendi] Job ID: ${command_id}. Polling...`);

      let attempts = 0;
      while (attempts < 120) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const poll = await fetch(`https://api.rendi.dev/v1/commands/${command_id}`, {
          headers: { "X-API-KEY": rendiApiKey }
        });
        if (poll.ok) {
          const data = await poll.json();
          const status = (data.status || '').toUpperCase();
          console.log(`[Rendi] Status: ${status}`);
          if (status === 'SUCCESS' || status === 'COMPLETED') return data;
          if (status === 'FAILED' || status === 'ERROR') {
            throw new Error(`Rendi failed: ${JSON.stringify(data.error_message || data.error_status || data)}`);
          }
        }
        attempts++;
      }
      throw new Error('Rendi polling timed out.');
    };

    // Helper to extract output URL
    const getRendiUrl = (pollData: any, alias: string): string => {
      const url = pollData.output_files?.[alias]?.storage_url;
      if (!url) throw new Error(`Rendi output "${alias}" URL not found.`);
      return url;
    };

    // Remote Google Fonts (TTF format for FFmpeg libass compatibility).
    // Pinned to commit ca9288e18a — `@main` removed the static Montserrat-*.ttf
    // files (only the variable font Montserrat[wght].ttf is published now),
    // which libass/FFmpeg can't resolve for a specific weight reliably.
    const FONTS_REF = "ca9288e18a";
    const fontUrls: Record<string, string> = {
      "Poppins": `https://cdn.jsdelivr.net/gh/google/fonts@${FONTS_REF}/ofl/poppins/Poppins-ExtraBold.ttf`,
      "Montserrat": `https://cdn.jsdelivr.net/gh/google/fonts@${FONTS_REF}/ofl/montserrat/Montserrat-Bold.ttf`,
      "Bangers": `https://cdn.jsdelivr.net/gh/google/fonts@${FONTS_REF}/ofl/bangers/Bangers-Regular.ttf`
    };
    const fontUrl = fontUrls[style.fontname];

    // ---------- Rendi: concat videos + normalize audio to TOTAL_DURATION + merge ----------
    // Each scene's video is normalized to exactly DURATION_PER_SCENE seconds
    // (the user's strict per-scene budget). The continuous TTS audio is pad/trimmed
    // to TOTAL_DURATION so video and audio always end on the same frame.
    const targetW = RESOLUTION === "720p" ? 720 : 480;
    const targetH = RESOLUTION === "720p" ? 1280 : 854;

    const vInputFiles: Record<string, string> = {};
    sceneVideoUrls.forEach((url, i) => { vInputFiles[`in_v${i + 1}`] = url; });
    const vInputArgs = sceneVideoUrls.map((_, i) => `-i {{in_v${i + 1}}}`).join(" ");

    // `tpad=stop_mode=clone:stop_duration=2` extends short Seedance outputs by
    // freezing the last frame; the subsequent `trim` clamps to exactly
    // perSceneDuration seconds. perSceneDuration matches DURATION_PER_SCENE in
    // the normal/overshoot case, or shrinks to audioEndTotal/SCENE_COUNT when the
    // narration undershoots the budget (so video ends with audio, no silence).
    const perSceneDurStr = perSceneDuration.toFixed(3);
    const normalizedStreams = sceneVideoUrls
      .map((_, i) => `[${i}:v]tpad=stop_mode=clone:stop_duration=2,trim=duration=${perSceneDurStr},setpts=PTS-STARTPTS,fps=30,scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v${i}]`)
      .join(";");
    const concatInputs = sceneVideoUrls.map((_, i) => `[v${i}]`).join("");

    let combinedVideoUrl: string;
    if (sceneVideoUrls.length === 1) {
      console.log(`[Rendi] Trimming single scene video to ${perSceneDurStr}s...`);
      const singleVResult = await runRendiSingle(
        `${vInputArgs} -filter_complex "${normalizedStreams}" -map "[v0]" -c:v libx264 -crf 20 -pix_fmt yuv420p {{out_v}}`,
        vInputFiles,
        { out_v: "combined_video.mp4" }
      );
      combinedVideoUrl = getRendiUrl(singleVResult, 'out_v');
    } else {
      console.log(`[Rendi] Trimming + concatenating ${sceneVideoUrls.length} videos (${perSceneDurStr}s each)...`);
      const concatVResult = await runRendiSingle(
        `${vInputArgs} -filter_complex "${normalizedStreams};${concatInputs}concat=n=${sceneVideoUrls.length}:v=1:a=0[v]" -map "[v]" -c:v libx264 -crf 20 -pix_fmt yuv420p {{out_v}}`,
        vInputFiles,
        { out_v: "combined_video.mp4" }
      );
      combinedVideoUrl = getRendiUrl(concatVResult, 'out_v');
    }

    // Merge combined video + speed-fit TTS audio + subtitles + optional font.
    // Audio filter chain:
    //   apad           → infinite silence appended (handles short narration)
    //   atempo=X       → time-stretch when measured audio ≠ target (preserves pitch)
    //   atrim=TOTAL    → hard-cuts to exact target length (safety net for tiny overshoot
    //                     past atempo, or to remove the trailing silence from apad)
    //   asetpts        → reset PTS so downstream sees clean 0-based timestamps
    // Combined video is also TOTAL_DURATION seconds → streams stay aligned.
    let mergeCommand = `-i {{in_video}} -i {{in_audio}} -i {{in_srt}}`;
    const mergeInputs: any = { in_video: combinedVideoUrl, in_audio: fullAudioUrl, in_srt: srtUrl };

    if (fontUrl) {
      mergeCommand += ` -attach {{in_font}} -metadata:s:t:0 mimetype=application/x-truetype-font -metadata:s:t:0 filename="font.ttf"`;
      mergeInputs.in_font = fontUrl;
    }
    // Apply atempo whenever duration differs from target (both speed-up and slow-down).
    // Omitting atempo when factor < 1 used to break sync with subtitle scaling below.
    const atempoStage =
      Math.abs(audioSpeedFactor - 1) > 0.001 ? `atempo=${audioSpeedFactor.toFixed(4)},` : '';
    mergeCommand += ` -filter_complex "[1:a]apad,${atempoStage}atrim=duration=${finalDuration.toFixed(3)},asetpts=PTS-STARTPTS[a]"`;
    mergeCommand += ` -map 0:v:0 -map "[a]" -map 2:s:0 -c:v copy -c:a aac -c:s copy {{out_merged}}`;

    const mergeResult = await runRendiSingle(mergeCommand, mergeInputs, { out_merged: "merged.mkv" });
    const mergedVideoUrl = getRendiUrl(mergeResult, 'out_merged');

    // Burn subtitles onto the merged video from the original ASS file directly.
    // Reading from the input video's embedded subtitle stream can cause timing issues
    // on multi-scene videos; pointing libass at the .ass file is more reliable.
    console.log('[Step 6b] Rendi: Burning subtitles...');

    const subtitleResult = await runRendiSingle(
      `-i {{in_video}} -i {{in_srt}} -vf "subtitles={{in_srt}}" -map 0:v:0 -map 0:a:0? -c:v libx264 -crf 20 -c:a copy {{out_final}}`,
      { in_video: mergedVideoUrl, in_srt: srtUrl },
      { out_final: "final_video.mp4" }
    );
    const rendiVideoUrl = getRendiUrl(subtitleResult, 'out_final');

    // Step 7: Download from Rendi and upload to Supabase
    console.log('[Step 7] Uploading final video to Supabase...');
    const videoResponse = await fetch(rendiVideoUrl);
    if (!videoResponse.ok) {
      throw new Error(`Failed to download video from Rendi: ${videoResponse.statusText}`);
    }
    const videoBuffer = await videoResponse.arrayBuffer();

    const finalFilename = videosStoragePath(`reels_${Date.now()}.mp4`);
    const { error: finalUploadError } = await supabase
      .storage
      .from(STORAGE_BUCKET)
      .upload(finalFilename, videoBuffer, {
        contentType: 'video/mp4',
        cacheControl: '3600',
        upsert: false
      });

    if (finalUploadError) {
      throw new Error(`Failed to upload final video to Supabase: ${finalUploadError.message}`);
    }

    const { data: { publicUrl: finalVideoUrl } } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(finalFilename);

    // Step 8: Cleanup intermediate SRT file
    console.log('[Step 8] Cleaning up...');
    try {
      await supabase.storage.from(STORAGE_BUCKET).remove([srtFilename]);
    } catch (cleanupErr) {
      console.warn('Cleanup warning (non-fatal):', cleanupErr);
    }

    console.log('Pipeline complete! Video URL:', finalVideoUrl);
    return NextResponse.json({ videoUrl: finalVideoUrl });

  } catch (error: any) {
    console.error('Generate pipeline error:', error);
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
}


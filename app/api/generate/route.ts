/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { NextResponse } from 'next/server';
import Replicate from 'replicate';
import { supabase } from '@/lib/supabase';

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
    const { theme, numScenes, durationPerScene, resolution, captionStyle } = body;
    const SCENE_COUNT = numScenes || 1;
    const RESOLUTION = resolution || "480p";

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

    // Use requested values with fallbacks
    const DURATION_PER_SCENE = durationPerScene || 5;

    // Calculate approximate word limit (avg speaking rate is ~150 words per minute, so ~2.5 words per second)
    const WORD_LIMIT = Math.floor(DURATION_PER_SCENE * 2.5);

    // Use gpt-4o-mini on Replicate — far more reliable than Llama 3 8B for
    // structured JSON output (Llama frequently returned 1 scene when asked for N).
    const LLM_MODEL = 'openai/gpt-4o-mini';

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

    console.log(`[Step 1A] Generating Style Anchor and Negative Prompt for theme: "${theme}"...`);
    // Step 1A: LLM Style Anchor Generation
    const styleSystemPrompt = `You are a cinematographer. Given a video theme, return a JSON object with exactly two fields: style_anchor (a comma-separated string of 6-8 visual descriptors defining the consistent look, setting, lighting, and style for ALL scenes — always include photorealistic and 9:16 vertical) and negative_prompt (comma-separated list of things to avoid visually). Return ONLY raw JSON, nothing else.`;

    const styleLlmOutput = await runWithRetry(LLM_MODEL, {
      input: {
        prompt: theme,
        system_prompt: styleSystemPrompt,
        max_completion_tokens: 512,
        temperature: 0.7,
      },
    });

    const styleRawJson = Array.isArray(styleLlmOutput) ? styleLlmOutput.join('') : String(styleLlmOutput);

    let styleAnchor = "";
    let negativePrompt = "";
    try {
      const styleData = extractJson(styleRawJson);
      styleAnchor = styleData.style_anchor || "photorealistic, 9:16 vertical";
      negativePrompt = styleData.negative_prompt || "ugly, broken, blurry";
    } catch (e) {
      console.warn('Failed to parse style JSON, using fallbacks:', styleRawJson);
      styleAnchor = "photorealistic, highly detailed, cinematic lighting, 9:16 vertical";
      negativePrompt = "blurry, low quality, distorted, watermark";
    }

    console.log(`[Style Anchor]: ${styleAnchor}`);
    console.log(`[Negative Prompt]: ${negativePrompt}`);

    console.log(`[Step 1B] Breaking down scenes (${SCENE_COUNT} x ${DURATION_PER_SCENE}s) with LLM...`);
    // Step 1B: LLM Scene Breakdown
    const systemPrompt = `You are a video producer. The user gives a theme. Return a JSON array of exactly ${SCENE_COUNT} scene(s) to make a faceless video (Reels/TikTok).
All scenes must exist in the same visual world and location.

STYLE ANCHOR (append this exact string verbatim at the end of every video_prompt):
"${styleAnchor}"

Each scene must have:
- "scene_id": number (e.g., 1)
- "video_prompt": string (highly detailed visual description for a text-to-video model. CRITICAL: Every video_prompt MUST end with the literal STYLE ANCHOR string above, copied exactly. Do NOT write the words "the style anchor" — copy the actual descriptors.)
- "narration": string (voiceover text. CRITICAL: For a ${DURATION_PER_SCENE}s video, this MUST be exactly ${WORD_LIMIT} words or less. Do not exceed this limit.)
- "duration": ${DURATION_PER_SCENE}

Return ONLY raw JSON array, nothing else.`;

    // Try up to 3 times to get exactly SCENE_COUNT valid scenes.
    let scenes: any[] = [];
    let lastRaw = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      const llmOutput = await runWithRetry(LLM_MODEL, {
        input: {
          prompt: theme,
          system_prompt: systemPrompt,
          max_completion_tokens: 1500,
          temperature: 0.8,
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
    for (const scene of scenes) {
      let p = String(scene.video_prompt || '').trim();
      // Strip any literal placeholder phrasing the LLM may have hallucinated
      p = p.replace(/[,.\s]*and\s+the\s+style\s+anchor\.?\s*$/i, '');
      p = p.replace(/[,.\s]*the\s+style\s+anchor\.?\s*$/i, '');
      // Append the real style anchor if it isn't already present
      if (!p.toLowerCase().includes(styleAnchor.toLowerCase().slice(0, 20))) {
        p = `${p.replace(/[.,\s]+$/, '')}, ${styleAnchor}`;
      }
      scene.video_prompt = p;
      console.log(`[Scene ${scene.scene_id} prompt]: ${p}`);
    }

    console.log('[Step 2] Generation of Media (Audio + Video in parallel, no reference chaining)...');

    // Generate Audio in parallel for all scenes
    const audioPromises = scenes.map(scene => runWithRetry("minimax/speech-02-turbo", {
      input: {
        text: scene.narration,
        emotion: "neutral",
        speed: 0.95,
        pitch: 0,
        language_boost: "English",
        audio_format: "mp3",
        bitrate: 128000
      }
    }));

    // Generate Video in parallel — no reference chaining so each scene gets fresh
    // motion, camera angles, and composition while sharing the style_anchor for visual consistency.
    const videoPromises = scenes.map(scene => runWithRetry("bytedance/seedance-2.0-fast", {
      input: {
        prompt: scene.video_prompt,
        aspect_ratio: "9:16",
        negative_prompt: negativePrompt,
        duration: DURATION_PER_SCENE,
        resolution: RESOLUTION,
        generate_audio: false
      }
    }));

    console.log('[Step 2] Waiting for all video + audio generations...');
    const [videoResponses, audioResponses] = await Promise.all([
      Promise.all(videoPromises),
      Promise.all(audioPromises)
    ]);

    const videoResults: string[] = videoResponses.map((videoRes: any) => {
      let videoUrl = "";
      if (typeof videoRes === "string") {
        videoUrl = videoRes;
      } else if (videoRes && typeof videoRes === "object") {
        if (typeof videoRes.url === 'function') videoUrl = videoRes.url().href || videoRes.url();
        else if (videoRes instanceof URL) videoUrl = videoRes.toString();
        else if (typeof videoRes.toString === 'function' && videoRes.toString().startsWith('http')) videoUrl = videoRes.toString();
        else if ('url' in videoRes && typeof videoRes.url === 'string') videoUrl = videoRes.url;
        else if ('video' in videoRes) videoUrl = videoRes.video;
        else if ('output' in videoRes && typeof videoRes.output === 'string') videoUrl = videoRes.output;
        else if (Array.isArray(videoRes)) {
          const first = videoRes[0];
          videoUrl = typeof first?.url === 'function' ? first.url() : String(first);
        }
        else videoUrl = String(videoRes);
      } else {
        videoUrl = String(videoRes);
      }
      return videoUrl;
    });

    const mediaResults = scenes.map((scene, index) => {
      const videoUrl = videoResults[index];
      const audioRes = audioResponses[index];

      let audioUrl = "";
      if (typeof audioRes === "string") {
        audioUrl = audioRes;
      } else if (audioRes && typeof audioRes === "object") {
        if (typeof (audioRes as any).url === 'function') audioUrl = (audioRes as any).url().href || (audioRes as any).url();
        else if (audioRes instanceof URL) audioUrl = audioRes.toString();
        else if (typeof (audioRes as any).toString === 'function' && (audioRes as any).toString().startsWith('http')) audioUrl = (audioRes as any).toString();
        else if ('audio' in audioRes && typeof (audioRes as any).audio?.url === 'function') audioUrl = (audioRes as any).audio.url();
        else if ('audio' in audioRes && typeof (audioRes as any).audio?.url === 'string') audioUrl = (audioRes as any).audio.url;
        else if ('audio_url' in audioRes) audioUrl = (audioRes as any).audio_url;
        else if ('audio_file' in audioRes) audioUrl = (audioRes as any).audio_file;
        else if ('url' in audioRes && typeof (audioRes as any).url === 'string') audioUrl = (audioRes as any).url;
        else if ('output' in audioRes && typeof (audioRes as any).output === 'string') audioUrl = (audioRes as any).output;
        else if (Array.isArray(audioRes)) {
          const first = audioRes[0];
          audioUrl = typeof first?.url === 'function' ? first.url() : String(first);
        }
        else audioUrl = String(audioRes);
      } else {
        audioUrl = String(audioRes);
      }

      if (!videoUrl || !audioUrl) {
        console.error("Failed to extract media URLs:", { videoUrl, audioRes });
        throw new Error(`Failed to generate media for scene ${scene.scene_id}. Check logs for details.`);
      }

      return {
        scene_id: scene.scene_id,
        videoUrl,
        audioUrl,
        narration: scene.narration,
        offset: index * DURATION_PER_SCENE
      };
    });

    // Step 3: Whisper Timestamps — run sequentially per scene (not parallel) to avoid rate limits
    const whisperResults = [];
    for (const media of mediaResults) {
      if (!media.audioUrl) {
        throw new Error(`Audio URL is missing for scene ${media.scene_id}. TTS generation may have failed.`);
      }
      console.log(`[Whisper] Processing scene ${media.scene_id} audio: ${media.audioUrl}`);
      const whisperRes = await runWithRetry(
        "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c",
        {
          input: {
            audio: media.audioUrl,
            language: "english",
            timestamp: "word",
            batch_size: 64,
          }
        }
      );
      console.log(`[Whisper] Scene ${media.scene_id} result:`, JSON.stringify(whisperRes).slice(0, 200));
      whisperResults.push({ ...media, whisper: whisperRes });
    }

    console.log('[Step 4] Build ASS subtitle file...');
    // Step 4: Build ASS subtitles (For accurate MarginV mapping)
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

    for (const res of whisperResults) {
      const offset = res.offset;
      const whisperOutput = res.whisper as any;

      // incredibly-fast-whisper returns { chunks: [{text, timestamp:[start,end]}] }
      // openai/whisper returns { segments: [{words:[{word,start,end}]}] }
      const chunks: Array<{ text: string; start: number; end: number }> = [];

      if (whisperOutput?.chunks) {
        // incredibly-fast-whisper format
        for (const chunk of whisperOutput.chunks) {
          chunks.push({
            text: (chunk.text || '').trim(),
            start: chunk.timestamp?.[0] ?? 0,
            end: chunk.timestamp?.[1] ?? (chunk.timestamp?.[0] ?? 0) + 0.5,
          });
        }
      } else if (whisperOutput?.segments) {
        // openai/whisper / whisperx format
        for (const segment of whisperOutput.segments) {
          const words = segment.words || [];
          if (words.length > 0) {
            for (const w of words) {
              chunks.push({
                text: (w.word || w.text || '').trim(),
                start: w.start ?? segment.start ?? 0,
                end: w.end ?? segment.end ?? (w.start ?? 0) + 0.5,
              });
            }
          } else {
            chunks.push({
              text: (segment.text || '').trim(),
              start: segment.start ?? 0,
              end: segment.end ?? (segment.start ?? 0) + 0.5,
            });
          }
        }
      }

      for (const chunk of chunks) {
        if (!chunk.text) continue;
        const start = chunk.start + offset;
        const end = chunk.end + offset;
        const lineText = `{\\c${highlightColorASS}}{\\b1}${chunk.text.toUpperCase()}{\\b0}`;
        assContent += `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${lineText}\n`;
      }
    }

    if (!assContent.includes('Dialogue:')) {
      assContent += `Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,(No speech detected)\n`;
    }

    console.log('[Step 5] Upload ASS to Supabase...');
    // Step 5: Upload ASS to Supabase
    const srtFilename = `captions_${Date.now()}.ass`;
    const { error: uploadError } = await supabase
      .storage
      .from('videos')
      .upload(srtFilename, assContent, {
        contentType: 'text/plain',
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('Supabase upload error:', uploadError);
      throw new Error('Failed to upload captions to storage');
    }

    const { data: { publicUrl: srtUrl } } = supabase.storage.from('videos').getPublicUrl(srtFilename);

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

    // Remote Google Fonts (TTF format for FFmpeg libass compatibility)
    const fontUrls: Record<string, string> = {
      "Poppins": "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/poppins/Poppins-ExtraBold.ttf",
      "Montserrat": "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/montserrat/Montserrat-Bold.ttf",
      "Bangers": "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/bangers/Bangers-Regular.ttf"
    };
    const fontUrl = fontUrls[style.fontname];

    let mergedVideoUrl: string;

    if (SCENE_COUNT === 1) {
      // Single scene: merge video + audio + subtitles + font
      let mergeCommand = `-i {{in_video}} -i {{in_audio}} -i {{in_srt}}`;
      const mergeInputs: any = { in_video: whisperResults[0].videoUrl, in_audio: whisperResults[0].audioUrl, in_srt: srtUrl };
      
      if (fontUrl) {
        mergeCommand += ` -attach {{in_font}} -metadata:s:t:0 mimetype=application/x-truetype-font -metadata:s:t:0 filename="font.ttf"`;
        mergeInputs.in_font = fontUrl;
      }
      mergeCommand += ` -map 0:v:0 -map 1:a:0 -map 2:s:0 -c:v copy -c:a aac -c:s copy -shortest {{out_merged}}`;

      const mergeResult = await runRendiSingle(mergeCommand, mergeInputs, { out_merged: "merged.mkv" });
      mergedVideoUrl = getRendiUrl(mergeResult, 'out_merged');
    } else {
      // Multi-scene: concat videos, concat audios, then merge
      const vInputFiles: Record<string, string> = {};
      whisperResults.forEach((res, i) => { vInputFiles[`in_v${i+1}`] = res.videoUrl; });
      const vInputArgs = whisperResults.map((_, i) => `-i {{in_v${i+1}}}`).join(" ");
      const vFilterStreams = whisperResults.map((_, i) => `[${i}:v]`).join("");

      const aInputFiles: Record<string, string> = {};
      whisperResults.forEach((res, i) => { aInputFiles[`in_a${i+1}`] = res.audioUrl; });
      const aInputArgs = whisperResults.map((_, i) => `-i {{in_a${i+1}}}`).join(" ");
      const aFilterStreams = whisperResults.map((_, i) => `[${i}:a]`).join("");

      console.log(`[Rendi] Concatenating ${SCENE_COUNT} videos...`);
      // Normalize each input (fps, resolution, sar, pixel format) before concatenation.
      // Seedance outputs can vary in fps/sar; without normalization the concat filter
      // silently produces broken output (e.g., only the first scene plays).
      const targetW = RESOLUTION === "720p" ? 720 : 480;
      const targetH = RESOLUTION === "720p" ? 1280 : 854;
      const normalizedStreams = whisperResults
        .map((_, i) => `[${i}:v]fps=30,scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v${i}]`)
        .join(";");
      const concatInputs = whisperResults.map((_, i) => `[v${i}]`).join("");
      const concatVResult = await runRendiSingle(
        `${vInputArgs} -filter_complex "${normalizedStreams};${concatInputs}concat=n=${SCENE_COUNT}:v=1:a=0[v]" -map "[v]" -c:v libx264 -crf 20 -pix_fmt yuv420p {{out_v}}`,
        vInputFiles,
        { out_v: "combined_video.mp4" }
      );
      const combinedVideoUrl = getRendiUrl(concatVResult, 'out_v');

      console.log(`[Rendi] Concatenating ${SCENE_COUNT} audios...`);
      // Pad each audio clip with silence and trim to exactly DURATION_PER_SCENE seconds
      // before concatenating, so audio stays in sync with the per-scene video offsets
      // even if the TTS clip is shorter than the scene duration.
      const paddedStreams = whisperResults
        .map((_, i) => `[${i}:a]apad=pad_dur=${DURATION_PER_SCENE},atrim=duration=${DURATION_PER_SCENE}[a${i}]`)
        .join(";");
      const paddedConcatInputs = whisperResults.map((_, i) => `[a${i}]`).join("");
      const audioFilterComplex = `${paddedStreams};${paddedConcatInputs}concat=n=${SCENE_COUNT}:v=0:a=1[a]`;
      const concatAResult = await runRendiSingle(
        `${aInputArgs} -filter_complex "${audioFilterComplex}" -map "[a]" {{out_a}}`,
        aInputFiles,
        { out_a: "combined_audio.mp3" }
      );
      const combinedAudioUrl = getRendiUrl(concatAResult, 'out_a');

      let mergeCommand = `-i {{in_video}} -i {{in_audio}} -i {{in_srt}}`;
      const mergeInputs: any = { in_video: combinedVideoUrl, in_audio: combinedAudioUrl, in_srt: srtUrl };
      
      if (fontUrl) {
        mergeCommand += ` -attach {{in_font}} -metadata:s:t:0 mimetype=application/x-truetype-font -metadata:s:t:0 filename="font.ttf"`;
        mergeInputs.in_font = fontUrl;
      }
      mergeCommand += ` -map 0:v:0 -map 1:a:0 -map 2:s:0 -c:v copy -c:a aac -c:s copy -shortest {{out_merged}}`;

      const mergeResult = await runRendiSingle(mergeCommand, mergeInputs, { out_merged: "merged.mkv" });
      mergedVideoUrl = getRendiUrl(mergeResult, 'out_merged');
    }

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

    const finalFilename = `reels_${Date.now()}.mp4`;
    const { error: finalUploadError } = await supabase
      .storage
      .from('videos')
      .upload(finalFilename, videoBuffer, {
        contentType: 'video/mp4',
        cacheControl: '3600',
        upsert: false
      });

    if (finalUploadError) {
      throw new Error(`Failed to upload final video to Supabase: ${finalUploadError.message}`);
    }

    const { data: { publicUrl: finalVideoUrl } } = supabase.storage.from('videos').getPublicUrl(finalFilename);

    // Step 8: Cleanup intermediate SRT file
    console.log('[Step 8] Cleaning up...');
    try {
      await supabase.storage.from('videos').remove([srtFilename]);
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


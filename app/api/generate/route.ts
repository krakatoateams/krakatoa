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

    // Use requested values with fallbacks
    const DURATION_PER_SCENE = durationPerScene || 5;

    // Calculate approximate word limit (avg speaking rate is ~150 words per minute, so ~2.5 words per second)
    const WORD_LIMIT = Math.floor(DURATION_PER_SCENE * 2.5);

    console.log(`[Step 1A] Generating Style Anchor and Negative Prompt for theme: "${theme}"...`);
    // Step 1A: LLM Style Anchor Generation
    const styleSystemPrompt = `You are a cinematographer. Given a video theme, return a JSON object with two fields: style_anchor (a comma-separated string of 6-8 visual descriptors that define the consistent look, setting, lighting, and style for ALL scenes of this video — photorealistic, 9:16 vertical always included) and negative_prompt (things to avoid visually). Return ONLY raw JSON, nothing else.`;

    const styleLlmOutput = await replicate.run('meta/meta-llama-3-8b-instruct', {
      input: {
        prompt: theme,
        system_prompt: styleSystemPrompt,
        max_tokens: 512,
      },
    });

    const styleRawJson = Array.isArray(styleLlmOutput) ? styleLlmOutput.join('') : String(styleLlmOutput);
    const styleCleanJson = styleRawJson.replace(/```json\n?|\n?```/g, '').trim();
    
    let styleAnchor = "";
    let negativePrompt = "";
    try {
      const styleData = JSON.parse(styleCleanJson);
      styleAnchor = styleData.style_anchor || "photorealistic, 9:16 vertical";
      negativePrompt = styleData.negative_prompt || "ugly, broken, blurry";
    } catch (e) {
      console.warn('Failed to parse style JSON, using fallbacks:', styleCleanJson);
      styleAnchor = "photorealistic, highly detailed, cinematic lighting, 9:16 vertical";
      negativePrompt = "blurry, low quality, distorted, watermark";
    }
    
    console.log(`[Style Anchor]: ${styleAnchor}`);
    console.log(`[Negative Prompt]: ${negativePrompt}`);

    console.log(`[Step 1B] Breaking down scenes (${SCENE_COUNT} x ${DURATION_PER_SCENE}s) with LLM...`);
    // Step 1B: LLM Scene Breakdown
    const systemPrompt = `You are a video producer. The user gives a theme. Return a JSON array of exactly ${SCENE_COUNT} scene(s) to make a faceless video (Reels/TikTok). 
All scenes must exist in the same visual world. Every video_prompt must end with: ${styleAnchor}

Each scene must have:
- "scene_id": number (e.g., 1)
- "video_prompt": string (highly detailed visual description for a text-to-video model. CRITICAL: Every video_prompt MUST end exactly with the style anchor provided above.)
- "narration": string (voiceover text. CRITICAL: For a ${DURATION_PER_SCENE}s video, this MUST be exactly ${WORD_LIMIT} words or less. Do not exceed this limit.)
- "duration": ${DURATION_PER_SCENE}

Return ONLY raw JSON array, nothing else.`;

    const llmOutput = await replicate.run('meta/meta-llama-3-8b-instruct', {
      input: {
        prompt: theme,
        system_prompt: systemPrompt,
        max_tokens: 1024,
      },
    });

    // The LLM output might be a stream/array of strings or a single string. 
    // Join if it's an array.
    const rawJson = Array.isArray(llmOutput) ? llmOutput.join('') : String(llmOutput);
    
    // Clean up potential markdown blocks
    const cleanJson = rawJson.replace(/```json\n?|\n?```/g, '').trim();
    let scenes: any[];
    try {
      scenes = JSON.parse(cleanJson);
    } catch (e) {
      console.error('Failed to parse JSON from LLM:', cleanJson);
      throw new Error('LLM failed to generate valid JSON scenes.');
    }

    if (!Array.isArray(scenes) || scenes.length !== SCENE_COUNT) {
      throw new Error(`LLM did not return exactly ${SCENE_COUNT} scene(s).`);
    }

    console.log('[Step 2] Parallel generation of Video and Audio...');
    // Step 2: Parallel Video and Audio Generation
    const mediaPromises = scenes.map(async (scene, index) => {
      // Generate Video (bytedance/seedance-2.0-fast)
      const videoPromise = replicate.run("bytedance/seedance-2.0-fast", {
        input: {
          prompt: scene.video_prompt,
          aspect_ratio: "9:16",
          negative_prompt: negativePrompt,
          duration: DURATION_PER_SCENE,
          resolution: RESOLUTION
        }
      });

      // Generate Audio (minimax/speech-02-turbo or equivalent TTS)
      const audioPromise = replicate.run("minimax/speech-02-turbo", {
        input: {
          text: scene.narration,
        }
      });

      const [videoRes, audioRes] = await Promise.all([videoPromise, audioPromise]);
      
      // Robustly handle the output structure based on model.
      let videoUrl = "";
      if (typeof videoRes === "string") {
        videoUrl = videoRes;
      } else if (videoRes && typeof videoRes === "object") {
        if (typeof (videoRes as any).url === 'function') videoUrl = (videoRes as any).url().href || (videoRes as any).url();
        else if (videoRes instanceof URL) videoUrl = videoRes.toString();
        else if (typeof (videoRes as any).toString === 'function' && (videoRes as any).toString().startsWith('http')) videoUrl = (videoRes as any).toString();
        else if ('url' in videoRes && typeof (videoRes as any).url === 'string') videoUrl = (videoRes as any).url;
        else if ('video' in videoRes) videoUrl = (videoRes as any).video;
        else if ('output' in videoRes && typeof (videoRes as any).output === 'string') videoUrl = (videoRes as any).output;
        else if (Array.isArray(videoRes)) {
          const first = videoRes[0];
          videoUrl = typeof first?.url === 'function' ? first.url() : String(first);
        }
        else videoUrl = String(videoRes);
      } else {
        videoUrl = String(videoRes);
      }

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
        console.error("Failed to extract media URLs:", { videoRes, audioRes });
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

    const mediaResults = await Promise.all(mediaPromises);

    // Step 3: Whisper Timestamps — run sequentially per scene (not parallel) to avoid rate limits
    const whisperResults = [];
    for (const media of mediaResults) {
      if (!media.audioUrl) {
        throw new Error(`Audio URL is missing for scene ${media.scene_id}. TTS generation may have failed.`);
      }
      console.log(`[Whisper] Processing scene ${media.scene_id} audio: ${media.audioUrl}`);
      const whisperRes = await replicate.run(
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
      const concatVResult = await runRendiSingle(
        `${vInputArgs} -filter_complex "${vFilterStreams}concat=n=${SCENE_COUNT}:v=1:a=0[v]" -map "[v]" {{out_v}}`,
        vInputFiles,
        { out_v: "combined_video.mp4" }
      );
      const combinedVideoUrl = getRendiUrl(concatVResult, 'out_v');

      console.log(`[Rendi] Concatenating ${SCENE_COUNT} audios...`);
      const concatAResult = await runRendiSingle(
        `${aInputArgs} -filter_complex "${aFilterStreams}concat=n=${SCENE_COUNT}:v=0:a=1[a]" -map "[a]" {{out_a}}`,
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

    // Burn subtitles onto the merged video using standard ASS
    console.log('[Step 6b] Rendi: Burning subtitles...');
    
    const subtitleResult = await runRendiSingle(
      `-i {{in_video}} -vf "subtitles={{in_video}}" -c:v libx264 -crf 20 -c:a copy {{out_final}}`,
      { in_video: mergedVideoUrl },
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


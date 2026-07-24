/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { NextResponse } from 'next/server';
import Replicate from 'replicate';
import { supabase } from '@/lib/supabase';
import { createSignedStorageUrl } from "@/lib/storage-signed-url";
import { STORAGE_BUCKET, videosStoragePath, videosTempStoragePath } from '@/lib/storage-buckets';

// Allow up to 5 minutes for this route (WhisperX + Rendi polling)
export const maxDuration = 300;

// Helper to format seconds to ASS timestamp (H:MM:SS.cs)
function formatAssTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

// Helper to run a single Rendi FFmpeg command and poll for completion
async function runRendiCommand(
  rendiApiKey: string,
  ffmpegCommand: string,
  inputFiles: Record<string, string>,
  outputFiles: Record<string, string>
): Promise<any> {
  const payload = {
    ffmpeg_command: ffmpegCommand,
    input_files: inputFiles,
    output_files: outputFiles
  };

  console.log('[Rendi] Submitting command:', ffmpegCommand);

  const response = await fetch("https://api.rendi.dev/v1/run-ffmpeg-command", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": rendiApiKey
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Rendi API Error (${response.status}):`, errText);
    throw new Error(`Rendi API request failed (${response.status}): ${errText || response.statusText}`);
  }

  const { command_id } = await response.json();
  console.log(`[Rendi] Job ID: ${command_id}. Polling...`);

  // Poll until completed
  let attempts = 0;
  while (attempts < 120) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const pollResponse = await fetch(`https://api.rendi.dev/v1/commands/${command_id}`, {
      headers: { "X-API-KEY": rendiApiKey }
    });

    if (pollResponse.ok) {
      const pollData = await pollResponse.json();
      const status = (pollData.status || '').toUpperCase();
      console.log(`[Rendi] Poll status: ${status}`);

      if (status === 'SUCCESS' || status === 'COMPLETED') {
        console.log('[Rendi] Full SUCCESS response:', JSON.stringify(pollData).substring(0, 1000));
        return pollData;
      } else if (status === 'FAILED' || status === 'ERROR') {
        throw new Error(`Rendi processing failed: ${JSON.stringify(pollData.error_message || pollData.error_status || pollData)}`);
      }
    }
    attempts++;
  }
  throw new Error('Rendi polling timed out.');
}

// Helper to extract the output URL from Rendi poll result
function extractRendiOutputUrl(pollData: any, alias: string): string {
  // Primary: output_files.alias.storage_url (documented format)
  let url = pollData.output_files?.[alias]?.storage_url;

  // Fallback: if it's a direct string
  if (!url && typeof pollData.output_files?.[alias] === 'string') {
    url = pollData.output_files[alias];
  }

  if (!url) {
    console.error('[Rendi] Could not find output URL. Full response:', JSON.stringify(pollData).substring(0, 1000));
    throw new Error(`Rendi output "${alias}" URL not found in response.`);
  }

  console.log(`[Rendi] Extracted URL for "${alias}": ${url}`);
  return url;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { audioPredictionId, videoPredictionId } = body;
    const style = body.captionStyle || {
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

    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });

    const rendiApiKey = process.env.RENDI_API_KEY;
    if (!rendiApiKey) {
      throw new Error("RENDI_API_KEY is not set.");
    }

    if (!audioPredictionId || !videoPredictionId) {
      throw new Error("audioPredictionId and videoPredictionId are required for testing.");
    }

    // Step 1: Get Prediction outputs from Replicate
    console.log('[Test Step 1] Fetching prediction outputs from Replicate...');
    const [audioPrediction, videoPrediction] = await Promise.all([
      replicate.predictions.get(audioPredictionId),
      replicate.predictions.get(videoPredictionId)
    ]);

    let audioUrl = "";
    const audioRes = audioPrediction.output;
    if (typeof audioRes === "string") {
      audioUrl = audioRes;
    } else if (audioRes && typeof audioRes === "object") {
      if ('audio' in audioRes && (audioRes as any).audio?.url) audioUrl = (audioRes as any).audio.url;
      else if ('audio_url' in audioRes) audioUrl = (audioRes as any).audio_url;
      else if ('audio_file' in audioRes) audioUrl = (audioRes as any).audio_file;
      else if ('url' in audioRes) audioUrl = (audioRes as any).url;
      else if ('output' in audioRes && typeof (audioRes as any).output === 'string') audioUrl = (audioRes as any).output;
      else if (Array.isArray(audioRes)) audioUrl = audioRes[0];
    }

    let videoUrl = "";
    const videoRes = videoPrediction.output;
    if (typeof videoRes === "string") {
      videoUrl = videoRes;
    } else if (videoRes && typeof videoRes === "object") {
      if ('url' in videoRes) videoUrl = (videoRes as any).url;
      else if ('video' in videoRes) videoUrl = (videoRes as any).video;
      else if ('output' in videoRes && typeof (videoRes as any).output === 'string') videoUrl = (videoRes as any).output;
      else if (Array.isArray(videoRes)) videoUrl = videoRes[0];
    }

    if (!audioUrl || !videoUrl) {
      throw new Error(`Failed to extract URLs from predictions. Audio URL: ${audioUrl}, Video URL: ${videoUrl}`);
    }

    console.log('[Test Step 1] Video URL:', videoUrl);
    console.log('[Test Step 1] Audio URL:', audioUrl);

    // Step 2: Run Whisper Timestamping
    console.log(`[Test Step 2] Running Whisper on audio URL...`);
    const whisperRes = await replicate.run(
      "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c",
      {
        input: {
          audio: audioUrl,
          language: "english",
          timestamp: "word",
          batch_size: 64,
        }
      }
    );
    console.log('[Test Step 2] Whisper done. Result preview:', JSON.stringify(whisperRes).substring(0, 300));

    // Step 3: Build ASS subtitle file
    console.log('[Test Step 3] Build ASS subtitle file...');
    
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

    const whisperOutput = whisperRes as any;
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
      const start = chunk.start;
      const end = chunk.end;

      const lineText = `{\\c${highlightColorASS}}{\\b1}${chunk.text.toUpperCase()}{\\b0}`;
      
      // ASS timestamp: H:MM:SS.cs
      const formatAssTime = (s: number) => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        const cs = Math.floor((s % 1) * 100);
        return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
      };

      assContent += `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${lineText}\n`;
    }

    if (!assContent.includes('Dialogue:')) {
      assContent += `Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,(No speech detected)\n`;
    }

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
      throw new Error(`Failed to upload captions: ${uploadError.message}`);
    }

    const { url: srtUrl } = await createSignedStorageUrl(srtFilename, "pipeline");
    console.log('[Test Step 4] SRT URL:', srtUrl);

    // Step 5a: Rendi - Merge video + audio and embed font into an MKV
    console.log('[Test Step 5a] Rendi: Merging video + audio + font...');
    
    // Remote Google Fonts (TTF format for FFmpeg libass compatibility)
    const fontUrls: Record<string, string> = {
      "Poppins": "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/poppins/Poppins-ExtraBold.ttf",
      "Montserrat": "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/montserrat/Montserrat-Bold.ttf",
      "Bangers": "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/bangers/Bangers-Regular.ttf"
    };
    const fontUrl = fontUrls[style.fontname];

    let mergeCommand = `-i {{in_video}} -i {{in_audio}} -i {{in_srt}}`;
    const mergeInputs: any = { in_video: videoUrl, in_audio: audioUrl, in_srt: srtUrl };

    if (fontUrl) {
      mergeCommand += ` -attach {{in_font}} -metadata:s:t:0 mimetype=application/x-truetype-font -metadata:s:t:0 filename="font.ttf"`;
      mergeInputs.in_font = fontUrl;
    }

    mergeCommand += ` -map 0:v:0 -map 1:a:0 -map 2:s:0 -c:v copy -c:a aac -c:s copy -shortest {{out_merged}}`;

    const mergeResult = await runRendiCommand(
      rendiApiKey,
      mergeCommand,
      mergeInputs,
      { out_merged: "merged.mkv" } // Use MKV container to support embedded fonts
    );
    const mergedVideoUrl = extractRendiOutputUrl(mergeResult, 'out_merged');

    // Step 5b: Rendi - Burn subtitles onto merged video using standard ASS
    console.log('[Test Step 5b] Rendi: Burning subtitles...');
    
    const subtitleResult = await runRendiCommand(
      rendiApiKey,
      `-i {{in_video}} -vf "subtitles={{in_video}}" -c:v libx264 -crf 20 -c:a copy {{out_final}}`,
      { in_video: mergedVideoUrl },
      { out_final: "final_video.mp4" }
    );
    const rendiVideoUrl = extractRendiOutputUrl(subtitleResult, 'out_final');
    console.log('[Test Step 5b] Final video on Rendi:', rendiVideoUrl);

    // Step 6: Download from Rendi and upload to Supabase for permanent storage
    console.log('[Test Step 6] Downloading from Rendi and uploading to Supabase...');
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

    const { url: finalVideoUrl } = await createSignedStorageUrl(finalFilename, "ui");
    console.log('[Test Step 6] Final Supabase URL:', finalVideoUrl);

    // Step 7: Cleanup intermediate SRT file
    console.log('[Test Step 7] Cleaning up intermediate files...');
    try {
      await supabase.storage.from(STORAGE_BUCKET).remove([srtFilename]);
    } catch (cleanupErr) {
      console.warn('Cleanup warning (non-fatal):', cleanupErr);
    }

    console.log('=== Test Pipeline COMPLETE! ===');
    console.log('Supabase Video URL:', finalVideoUrl);
    return NextResponse.json({ videoUrl: finalVideoUrl });

  } catch (error: any) {
    console.error('Test pipeline error:', error);
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
}

/**
 * Copy every Supabase Storage object to the same app path in R2.
 * `R2_KEY_PREFIX` is added only on the R2 key, so a shared bucket stays separated.
 * Dry-run unless `--execute`. Never deletes from Supabase.
 *
 *   npm run storage:copy-to-r2
 *   npm run storage:copy-to-r2 -- --execute
 */
import { MEDIA_CACHE_CONTROL } from "@/lib/storage-buckets";
import { downloadFrom, headObjectOnR2, listKeysFrom, putObjectOnR2 } from "@/lib/media-storage";

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ass: "text/plain",
};

function contentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const objects = await listKeysFrom("supabase");
  let copy = 0;
  let skip = 0;
  let mismatch = 0;

  for (const object of objects) {
    const head = await headObjectOnR2(object.path);
    if (head?.sha256 && head.size === object.size) {
      skip += 1;
      console.log(`skip\t${object.size}\t${object.path}`);
      continue;
    }
    console.log(`${execute ? "copy" : "would-copy"}\t${object.size}\t${object.path}`);
    if (!execute) {
      copy += 1;
      continue;
    }
    const bytes = await downloadFrom("supabase", object.path);
    if (!bytes || bytes.byteLength !== object.size) {
      mismatch += 1;
      console.log(`mismatch\tsize\t${object.path}`);
      continue;
    }
    try {
      await putObjectOnR2(object.path, bytes, contentType(object.path), MEDIA_CACHE_CONTROL);
      copy += 1;
    } catch (error) {
      mismatch += 1;
      console.log(`mismatch\t${error instanceof Error ? error.message : "put"}\t${object.path}`);
    }
  }

  console.log(JSON.stringify({ objects: objects.length, copy, skip, mismatch, execute }));
  if (mismatch > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

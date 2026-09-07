import type Replicate from "replicate";
import { supabaseServer } from "@/lib/supabase-server";
import { STORAGE_BUCKET } from "@/lib/storage-buckets";

/** Upload product image to Replicate Files API for use in model inputs. */
export async function uploadProductImageToReplicate(
  replicate: Replicate,
  file: File
): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return uploadBytesToReplicate(
    replicate,
    buffer,
    file.name || `product_${Date.now()}.jpg`,
    file.type || "image/jpeg"
  );
}

/** Download a private storage object and upload it to Replicate so vision models can fetch it. */
export async function uploadStoragePathToReplicate(
  replicate: Replicate,
  storagePath: string
): Promise<string> {
  const { data, error } = await supabaseServer.storage.from(STORAGE_BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error("Couldn't read the connected image.");
  }
  const filename = storagePath.split("/").pop() || `ref_${Date.now()}.png`;
  const buffer = Buffer.from(await data.arrayBuffer());
  return uploadBytesToReplicate(
    replicate,
    buffer,
    filename,
    data.type || mimeFromFilename(filename)
  );
}

async function uploadBytesToReplicate(
  replicate: Replicate,
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  const uploaded = (await replicate.files.create(buffer, {
    filename,
    contentType: contentType || "image/jpeg",
  })) as { urls?: { get?: string } };

  const url = uploaded.urls?.get;
  if (!url) {
    throw new Error("Replicate file upload did not return a URL");
  }
  return url;
}

function mimeFromFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png") || lower.endsWith(".apng")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "image/png";
}

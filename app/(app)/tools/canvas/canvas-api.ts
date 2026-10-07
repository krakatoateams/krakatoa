import { fetchSignedUrlBatch } from "@/lib/storage-sign-client";

export function describeCanvasIdempotencyError(
  status: number,
  data: { code?: string; error?: string }
): string | null {
  if (status === 409 && data?.code === "GENERATION_CANCELLED") return null;
  if (status === 409 && data?.code === "GENERATION_IN_PROGRESS") {
    return "Generation already in progress, please wait.";
  }
  if (status === 409 && data?.code === "IDEMPOTENCY_CONFLICT") {
    return data?.error || "This request conflicts with a previous one.";
  }
  if (status === 400 && data?.code === "IDEMPOTENCY_KEY_REQUIRED") {
    return data?.error || "Missing idempotency key. Please retry.";
  }
  return null;
}

export function pickGenerateCreationId(data: {
  historyItem?: { id?: string } | null;
}): string | null {
  const id = data.historyItem?.id?.trim();
  return id || null;
}

// Vercel caps request bodies at 4.5 MB, so connected references are re-encoded
// to JPEG (long side <= 2048px) before upload; the model input doesn't need more.
const REFERENCE_MAX_SIDE = 2048;
const REFERENCE_JPEG_QUALITY = 0.85;

export async function blobFileFromUrl(url: string, filename: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Couldn't read the connected image.");
  const blob = await res.blob();
  const type = blob.type || "image/jpeg";
  if (!type.startsWith("image/") || type === "image/gif") return new File([blob], filename, { type });
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, REFERENCE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = "#fff"; // JPEG has no alpha
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", REFERENCE_JPEG_QUALITY)
    );
    if (jpeg && jpeg.size < blob.size) return new File([jpeg], filename, { type: "image/jpeg" });
  } catch {
    // fall through: upload the original and let the status mapping explain a rejection
  }
  return new File([blob], filename, { type });
}

export async function resolveCanvasRefFrames(
  images: Array<{
    resultStoragePath: string | null;
    resultUrl: string | null;
  }>
): Promise<Array<{ url: string; path: string }>> {
  const withPath = images.filter((image) => image.resultStoragePath?.trim());
  const signed = withPath.length
    ? await fetchSignedUrlBatch(withPath.map((image) => ({ path: image.resultStoragePath! })))
    : [];
  const byPath = new Map(signed.map((item) => [item.storagePath, item.url]));
  const frames: Array<{ url: string; path: string }> = [];
  for (const image of images) {
    const path = image.resultStoragePath?.trim() || "";
    if (path) {
      const signedUrl = byPath.get(path);
      if (!signedUrl) {
        throw new Error("Couldn't use a connected image.");
      }
      frames.push({ url: signedUrl, path });
      continue;
    }
    if (image.resultUrl?.startsWith("http") || image.resultUrl?.startsWith("blob:")) {
      frames.push({ url: image.resultUrl, path });
      continue;
    }
    throw new Error(
      "A connected image isn't ready to send. Wait for the upload to finish, then try again."
    );
  }
  return frames;
}

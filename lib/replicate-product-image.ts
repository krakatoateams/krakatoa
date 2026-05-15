import type Replicate from "replicate";

/** Upload product image to Replicate Files API for use in model inputs. */
export async function uploadProductImageToReplicate(
  replicate: Replicate,
  file: File
): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const uploaded = (await replicate.files.create(buffer, {
    filename: file.name || `product_${Date.now()}.jpg`,
    contentType: file.type || "image/jpeg",
  })) as { urls?: { get?: string } };

  const url = uploaded.urls?.get;
  if (!url) {
    throw new Error("Replicate file upload did not return a URL");
  }
  return url;
}

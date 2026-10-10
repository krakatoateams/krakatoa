// Smoke check: ensureInstagramCompatibleImage still converts PNG -> JPEG
// through the lazily imported sharp. Run: npm run test:instagram-sharp-lazy
import assert from "node:assert/strict";
import { supabaseServer } from "@/lib/supabase-server";
import { ensureInstagramCompatibleImage } from "@/lib/instagram";

async function main() {
  const { default: sharp } = await import("sharp");
  const png = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "#f00" },
  }).png().toBuffer();

  const uploads: Array<{ path: string; body: Buffer; type: string }> = [];
  const storage = {
    from: () => ({
      download: async () => ({ data: new Blob([new Uint8Array(png)]), error: null }),
      upload: async (path: string, body: Buffer, opts: { contentType: string }) => {
        uploads.push({ path, body, type: opts.contentType });
        return { error: null };
      },
    }),
  };
  (supabaseServer as unknown as { storage: unknown }).storage = storage;

  const out = await ensureInstagramCompatibleImage("u1/photo.png");
  assert.equal(out, "u1/photo.instagram.jpg");
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].type, "image/jpeg");
  assert.deepEqual([...uploads[0].body.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  console.log("instagram-sharp-lazy self-check passed");
}

main();

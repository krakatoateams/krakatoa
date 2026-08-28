import { handlePhotoStoryboardGeneration } from "@/lib/photo-storyboard-generation";

export const maxDuration = 300;

/** @deprecated Prefer POST /api/generate-photo with `mode=storyboard`. */
export async function POST(req: Request) {
  return handlePhotoStoryboardGeneration(req);
}

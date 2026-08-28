import { readFile } from "node:fs/promises";
import path from "node:path";
import { getCurrentAdmin } from "@/lib/admin-auth";
import type { VideoAspectRatio } from "@/lib/video-models";

export const DEV_BLANK_REQUEST_KEY = "devBlank" as const;

/** Client body flag: admin-only blank placeholder instead of a real provider run. */
export function isDevBlankRequested(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return (body as Record<string, unknown>)[DEV_BLANK_REQUEST_KEY] === true;
}

/** Multipart form flag (`devBlank=true`). */
export function isDevBlankFormValue(value: FormDataEntryValue | null): boolean {
  return value === "true";
}

export class DevBlankForbiddenError extends Error {
  readonly code = "DEV_BLANK_FORBIDDEN";
  constructor(message = "Blank test mode is only available to admins.") {
    super(message);
    this.name = "DevBlankForbiddenError";
  }
}

/** Throws when the caller is not an active admin. */
export async function requireDevBlankAccess(): Promise<void> {
  const admin = await getCurrentAdmin();
  if (!admin) throw new DevBlankForbiddenError();
}

const DEV_ASSET_DIR = path.join(process.cwd(), "public", "dev");

const BLANK_VIDEO_BY_RATIO: Partial<Record<VideoAspectRatio, string>> = {
  "16:9": "blank-video-16x9.mp4",
  "9:16": "blank-video.mp4",
  "1:1": "blank-video-1x1.mp4",
  "4:3": "blank-video-4x3.mp4",
  "3:4": "blank-video-3x4.mp4",
};

export async function readBlankVideoBytes(
  aspectRatio: VideoAspectRatio = "9:16"
): Promise<Buffer> {
  const file = BLANK_VIDEO_BY_RATIO[aspectRatio] ?? "blank-video.mp4";
  return readFile(path.join(DEV_ASSET_DIR, file));
}

export async function readBlankImageBytes(): Promise<Buffer> {
  return readFile(path.join(DEV_ASSET_DIR, "blank.png"));
}

export function devBlankJobTag(): Record<string, unknown> {
  return { devBlank: true, provider: "dev_blank" };
}

/** JSON body field for admin blank mode (omit when false). */
export function devBlankJsonField(devBlank: boolean): { devBlank?: true } {
  return devBlank ? { devBlank: true } : {};
}

/** Multipart form flag for admin blank mode. */
export function appendDevBlankFormData(formData: FormData, devBlank: boolean): void {
  if (devBlank) formData.append(DEV_BLANK_REQUEST_KEY, "true");
}

/** Build `/tools/scheduler` deep-link query for a finished generation. */
export function schedulerHandoffHref(opts: {
  assetUrl: string;
  mediaType?: "image" | "video";
  title?: string;
  caption?: string;
}): string {
  const params = new URLSearchParams({ assetUrl: opts.assetUrl });
  if (opts.mediaType) params.set("mediaType", opts.mediaType);
  const title = opts.title?.trim();
  if (title) params.set("title", title.slice(0, 100));
  const caption = opts.caption?.trim();
  if (caption) params.set("caption", caption);
  return `/tools/scheduler?${params.toString()}`;
}

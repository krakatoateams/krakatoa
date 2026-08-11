# Supabase egress — why it ran out, and how the app avoids it now

**Status:** implemented and verified against the live project, Aug 11 2026.

Last month the project was throttled for exceeding the Supabase free-plan egress
quota. This documents what actually caused it — several of the obvious suspects turned
out to be innocent — and what the code now does instead.

## The quota

Free plan gives **two separate 5 GB pools per month**, not one:

| Pool | What lands here |
|---|---|
| Egress (uncached) | Anything served from the origin — a CDN miss |
| Cached egress | CDN cache hits (Supabase Basic CDN on free) |

Both matter, but the uncached pool is the one that ran dry, and a URL that changes on
every request can only ever produce misses.

## What was actually happening

Total stored media was **202 MB across 87 objects** (98 MB of photos, 85 MB of video)
and there had been **7 generation jobs in 14 days**. Egress was already at 500 MB in a
fresh cycle. So the bytes were not new — the same small set of files was being sent
over and over.

Three measurements narrowed it down.

**Supabase answers a conditional GET with 304 and a zero-byte body.** Verified with
`curl -H "If-None-Match: …"`: `http=304 downloaded_bytes=0` against `http=200
downloaded_bytes=2858242` for the same object. So a cached object costs nothing to
revalidate, and the `max-age=3600` on existing uploads was never the problem.

**The problem was signed URLs.** The bucket is private, so reads go through
`createSignedUrl`, and every call mints a URL with a fresh token. A different URL is a
different cache entry: the browser has no ETag to send, so it re-downloads the whole
file. Every page view, every refresh, every tab. That is the repeat-download loop that
drained the quota.

Worth knowing because it hides the bug: **two signings inside the same second produce
byte-identical URLs**, since the token is a JWT whose `iat`/`exp` have second
resolution. A single request that signs 100 history items therefore looks perfectly
stable. The divergence only appears across page loads.

**Full-resolution images were being shipped into thumbnail-sized boxes.** Grid cells
render at ~200 px; sources are PNGs up to 5.6 MB.

## What was ruled out

- **Autoplay video on the dashboard.** Looping replays from the browser's media cache
  and costs nothing; only the first fetch per browser is billed, and that revalidates
  to 304 afterwards.
- **Rewriting `cache-control` on the 87 existing objects.** Supabase serves the header
  from the object's S3 metadata, not from `storage.objects.metadata`. Updating that
  jsonb changes the column and nothing else — verified with a probe object that still
  returned `max-age=3600` on a guaranteed CDN miss. Doing it properly means
  re-uploading, which would spend 202 MB of egress to save almost nothing now that 304
  is confirmed working.
- **Video posters in the grid.** `preload="metadata"` plus a canvas frame capture pulls
  headers and the first frame, a few hundred KB, not the whole file.

## What the code does now

### Stable signed URLs (the main fix)

`SIGN_TTL.ui` is **30 days**, and `createSignedStorageUrl` in
[`lib/storage-signed-url.ts`](../../lib/storage-signed-url.ts) reads and writes the
`signed_url_cache` table (migration `060`) so the same object always resolves to the
same URL.

The cache is in Postgres rather than process memory on purpose: two serverless
instances handing out two different URLs for one object would defeat the entire point.

Only TTLs of a day or more are cached. `pipeline` (Rendi, Replicate) and `publish`
(TikTok, Instagram, YouTube) stay short and uncached — those consumers fetch a URL once
and never re-request it, so caching would add a round trip and buy nothing.

Ownership is still enforced before signing; the cache sits under
`assertPathOwnedByUser`, not around it.

### Image optimization instead of full-res sources

`next/image` no longer passes `unoptimized` for library and picker grids, and
`next.config.mjs` allows `/storage/v1/object/sign/**` with `minimumCacheTTL` at 30 days
(the default 60 s would send the optimizer back to Supabase every minute and undo the
saving).

Measured on a real 2.42 MB PNG through the optimizer:

| Rendition | Bytes | vs source |
|---|---|---|
| Source PNG from Supabase | 2,419,820 | — |
| `w=384` WebP (grid cell) | 20,776 | 116× smaller |
| `w=1080` WebP (preview modal) | 110,198 | 22× smaller |

Vercel fetches the source once and serves every later view from its own edge, so
Supabase sees roughly one read per image per cache period. Hobby includes 5,000
transformations per month; ~68 images across a few widths is about 200.

### Long cache-control on new uploads

`MEDIA_CACHE_CONTROL` in [`lib/storage-buckets.ts`](../../lib/storage-buckets.ts) is
`31536000, immutable`, applied at every upload site. Safe because generated filenames
are timestamped and never overwritten. Recovery staging under `{userId}/resumable/`
deliberately keeps `3600`: those paths are upserted on retry and only ever fetched by
Rendi and Replicate, so `immutable` would be a lie with no upside.

This is secondary to the signed-URL fix — 304 already made short TTLs cheap — but it
removes the revalidation round trip and survives cache eviction better.

## Check

```
npm run probe:signed-url-cache
```

Asserts that repeated `ui` signings return the identical URL, that short TTLs write no
cache row, and that a conditional GET on the result is 304 with zero bytes. Needs
`.env.local`; reads one small object once.

## Caveats

- **DevTools "Disable cache" bypasses all of this.** During development every reload
  re-downloads everything. If egress climbs while nobody is using the app, check that
  box first.
- A 30-day signed URL stays valid for 30 days if it leaks. Accepted deliberately for
  user-owned media; `publish` URLs remain at 15 minutes.
- Still unaddressed, in rough order of remaining value: raw `<img>` in the scheduler
  post cards, the 12.7 MB of trending-template video (2 MB files rendered into 176 px
  cards, worth re-encoding), and server-side pulls during publish and Rendi stitching.
  All are first-fetch costs that 304 handles on repeat, so none are urgent.
- If media traffic ever outgrows the free plan for real, Cloudflare R2 charges nothing
  for egress and would remove this constraint permanently rather than manage it.

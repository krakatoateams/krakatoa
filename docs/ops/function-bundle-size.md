# Function bundle size

Each route's server function ships the files listed in its
`.next/server/**/*.nft.json` trace. Stored size per deployment is the sum of
those traces.

## Measure

```bash
npm run build
node scripts/trace-size-report.mjs
```

It prints the total traced size, the per-route top packages for routes above
10 MB and the watched routes, and exits non-zero if a route that must skip
`sharp` still lists `sharp`/`@img`, or if `/api/cron` no longer lists it.

## sharp

`sharp` (with its libvips binary, ~17 MB) is loaded lazily inside
`ensureInstagramCompatibleImage` (`lib/instagram.ts`) and
`ensureTikTokCompatiblePhoto` (`lib/tiktok.ts`). Only `/api/cron` calls them, so
`next.config.mjs` `outputFileTracingExcludes` removes `node_modules/sharp/**`
and `node_modules/@img/**` from exactly these routes: `/api/posts`,
`/api/cron/instagram-token-refresh`, `/api/connections/instagram/callback`,
`/api/connections/tiktok/start`, `/api/connections/tiktok/callback`,
`/api/connections/tiktok/creator-info`. Never exclude it for `/api/cron` and do
not add a global exclude. Smoke check for the lazy path (needs Supabase env
vars, e.g. from `.env.local`): `npm run test:instagram-sharp-lazy`.

## Before / after (same local `next build`, macOS arm64, Next 15.5)

| Route | Before (MB) | After (MB) |
|---|---|---|
| `/api/cron` | 31.2 | 31.2 |
| `/api/posts` | 19.7 | 1.3 |
| `/api/cron/instagram-token-refresh` | 19.7 | 1.5 |
| `/api/connections/instagram/callback` | 19.7 | 1.5 |
| `/api/connections/tiktok/start` | 19.5 | 1.3 |
| `/api/connections/tiktok/callback` | 19.5 | 1.3 |
| `/api/connections/tiktok/creator-info` | 19.8 | 1.6 |
| Total, 172 entries | 418.7 | 309.1 |

## Rule

New heavy imports in a route need a trace-size check: rebuild and run the
script before and after.

# Security headers

Site-wide response headers are defined in `lib/security-headers.mjs` and
attached to `/:path*` by `next.config.mjs`. This covers HTML, APIs, static
assets, the Image Optimizer, and PWA files without expanding the auth
middleware matcher.

## Enforced policy

- CSP defaults to same-origin, blocks plugins, framing, inline event-handler
  attributes, and cross-origin form posts.
- Scripts allow same-origin Next.js code and inline App Router bootstrap.
- Styles allow inline React styles and Google Fonts used by the 404/Reels
  preview.
- Browser Supabase traffic is limited to the configured project over HTTPS/WSS.
- YouTube is the only frame source. PWA workers are same-origin.
- Hosted scheduler/marketing video remains compatible through `media-src https:`.
- HSTS is production-only and intentionally does not claim subdomains.
- MIME sniffing, external framing, high-detail cross-origin referrers, and
  unused camera/microphone/geolocation/payment/USB capabilities are disabled.

`'unsafe-inline'` for scripts/styles and broad HTTPS media are compatibility
tradeoffs, not targets for silent removal. A nonce CSP would force dynamic
rendering across the App Router; narrowing hosted media requires constraining
the Scheduler URL contract first.

## Change and verification

When adding a browser-loaded origin, update the smallest relevant CSP directive
and its assertion in `lib/security-headers-self-check.ts`. Do not add it to
`default-src`.

Run:

```bash
npm run test:security-headers
npm run ci:checks
```

For a production-server smoke test, confirm `/`, an authenticated app route, an
API route, `/sw.js`, and `/manifest.webmanifest` all return the same baseline
headers. Then exercise the affected browser feature and check the console for
CSP violations.

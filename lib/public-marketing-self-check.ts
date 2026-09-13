import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rootUrl = new URL("../", import.meta.url);

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, rootUrl), "utf8");
}

const landingContent = read("lib/landing-content.ts");
const landingMedia = read("lib/landing-media.ts");
const helloHero = read("components/landing-hello/HelloHero.tsx");
const helloPricing = read("components/landing-hello/HelloPricing.tsx");
const promoOffer = read("components/PromoOfferModal.tsx");
const helloFooter = read("components/landing-hello/HelloFooter.tsx");
const helloNav = read("components/landing-hello/HelloNav.tsx");
const testimonials = read("components/landing-hello/HelloTestimonials.tsx");
const legalPage = read("components/legal/LegalPage.tsx");
const privacy = read("app/privacy/page.tsx");
const terms = read("app/terms/page.tsx");
const dataDeletion = read("app/data-deletion/page.tsx");

assert.match(
  helloHero,
  /VIDEO_MODEL_SHOWREEL/,
  "the homepage video selector must only pair clips with actual video models",
);
assert.match(
  landingMedia,
  /export const VIDEO_MODEL_SHOWREEL/,
  "video-model showreels must have one shared truthful source",
);

for (const [name, source] of [
  ["landing content", landingContent],
  ["landing pricing", helloPricing],
  ["promo offer", promoOffer],
] as const) {
  assert.doesNotMatch(
    source,
    /CREDITS_PER_(IMAGE|VIDEO)|≈\s*\{|~50 credits per AI reel|1 per caption/,
    `${name} must not advertise static output counts that drift from admin pricing`,
  );
}
assert.match(
  landingContent,
  /Costs vary by model, duration, and resolution/,
  "public pricing must direct users to the authoritative per-tool quote",
);
assert.doesNotMatch(
  landingContent,
  /2-year validity|valid for 2 years/i,
  "credit-expiry copy must not contradict admin-managed expiry settings",
);
assert.match(
  landingContent,
  /Generation failures before the AI provider delivers its primary output/,
  "the purchase surface must disclose the Terms' stage-dependent generation refunds",
);

assert.match(
  helloFooter,
  /href="\/data-deletion"/,
  "the public footer must make data-deletion instructions discoverable",
);
assert.match(
  testimonials,
  /motion-reduce:animate-none/,
  "continuous testimonial motion must honor reduced-motion preferences",
);
assert.match(
  landingContent,
  /TESTIMONIALS_DISCLAIMER/,
  "unverified marketing testimonials must be explicitly labelled as illustrative",
);
assert.match(
  testimonials,
  /TESTIMONIALS_DISCLAIMER/,
  "the testimonial disclaimer must be visible beside the public social proof",
);
assert.match(
  helloNav,
  /inert=\{!menuOpen\}/,
  "the closed mobile navigation sheet must be removed from keyboard navigation",
);

assert.doesNotMatch(
  privacy + terms + dataDeletion,
  /Instagram (?:is planned|direncanakan)/,
  "legal pages must not describe the active Instagram connection as future work",
);
assert.doesNotMatch(
  terms,
  /fails due to an error on our part|gagal karena kesalahan sistem kami/,
  "Terms must not promise a blanket refund after irreversible provider work",
);
assert.match(
  terms,
  /primary provider output/,
  "Terms must explain the provider-commit boundary for generation refunds",
);
for (const source of [privacy, terms, dataDeletion]) {
  assert.match(
    source,
    /Instagram/,
    "each legal page must describe active Instagram data or service behavior",
  );
}
assert.match(
  privacy,
  /Vercel Analytics/,
  "the privacy policy must disclose the analytics processor mounted on every page",
);
assert.match(
  privacy,
  /Cloudflare/,
  "the privacy policy must disclose the public media CDN",
);
assert.match(
  privacy,
  /Amazon CloudFront/,
  "the privacy policy must cover every configured marketing media CDN",
);
assert.match(
  privacy,
  /YouTube marketing/,
  "the privacy policy must disclose the optional public YouTube embed",
);
assert.doesNotMatch(
  privacy,
  /encrypted password|kata sandi terenkripsi/,
  "the privacy policy must not claim that Supabase password hashes are encrypted passwords",
);

assert.match(legalPage, /lang="id"/);
assert.match(legalPage, /lang="en"/);
assert.match(
  legalPage,
  /titleLevel="h2"/,
  "the second-language document title must not create a second h1",
);
assert.match(
  legalPage,
  /const BlockHeading = titleLevel === "h1" \? "h3" : "h4"/,
  "subsection headings must remain nested under both language document titles",
);
assert.doesNotMatch(
  legalPage,
  /subject to change at any time without prior notice|dapat berubah sewaktu-waktu tanpa pemberitahuan sebelumnya/,
  "the shared legal footer must not contradict each policy's material-change notice",
);

console.log("public marketing self-check passed");

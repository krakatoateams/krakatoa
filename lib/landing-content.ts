/**
 * Single source of truth for public marketing copy on `/`
 * (`components/landing-hello/`). Copy only: no JSX, no styling, no layout.
 */

export const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
  { label: "Testimonials", href: "#testimonials" },
];

/** Nav bar CTA. Guests still point at /dashboard; middleware funnels them to login. */
export const NAV_CTA = {
  authed: { label: "Dashboard", href: "/dashboard" },
  guest: { label: "Start creating free", href: "/dashboard" },
};

export const NAV_LOGIN = { label: "Log in", href: "/login" };

/**
 * Primary conversion CTA, used by the closing footer (the hero has its own
 * local override — see HERO_PRIMARY_CTA in HelloHero.tsx). Label and
 * destination both depend on whether the visitor is signed in — guests land
 * on /dashboard's logged-out state rather than a standalone /login page, per
 * kelolako-dashboard-nonlogin-plan.
 */
export const PRIMARY_CTA = {
  authed: { label: "Go to dashboard", href: "/dashboard" },
  guest: { label: "Get started", href: "/dashboard" },
};

/* -------------------------------------------------------------------------- */
/* Hero                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Headline tokens (text + optional ornaments). The live homepage uses the
 * plain string derived below; the token form is kept so ornaments can return
 * without rewriting copy.
 */
export type HeadlineToken =
  | { kind: "text"; value: string }
  | { kind: "ornament"; emoji: string; variant: "pill" | "badge" | "circle" };

export const HERO_HEADLINE: HeadlineToken[][] = [
  [
    { kind: "text", value: "Everything" },
    { kind: "ornament", emoji: "🎬", variant: "pill" },
    { kind: "text", value: "You" },
  ],
  [
    { kind: "text", value: "Need" },
    { kind: "ornament", emoji: "🏷️", variant: "badge" },
    { kind: "text", value: "To Grow Your" },
  ],
  [
    { kind: "text", value: "Content" },
    { kind: "ornament", emoji: "📈", variant: "circle" },
    { kind: "text", value: "Reach" },
  ],
];

/** "Everything You Need To Grow Your Content Reach" */
export const HERO_HEADLINE_PLAIN = HERO_HEADLINE.flat()
  .filter(
    (token): token is Extract<HeadlineToken, { kind: "text" }> =>
      token.kind === "text"
  )
  .map((token) => token.value)
  .join(" ");

/** Plain-text headline split back into its three display lines. */
export const HERO_HEADLINE_LINES = HERO_HEADLINE.map((line) =>
  line
    .filter(
      (token): token is Extract<HeadlineToken, { kind: "text" }> =>
        token.kind === "text"
    )
    .map((token) => token.value)
    .join(" ")
);

export const HERO_CTA = {
  label: "See how",
  youtubeVideoId: "6kZpxHJd6P0",
};

/**
 * Supporting statement rendered beneath the hero showreel. Kept as plain copy
 * here; the homepage reveals it word-by-word on scroll.
 */
export const HERO_SUBCOPY =
  "Kelolako simplifies content creation for creators & brands, letting them generate scroll-stopping reels, studio-grade product photos, and ready-to-post captions in minutes, all from a single prompt.";

export const AI_MODELS_LABEL = "Powered by leading AI models";
export const AI_MODELS = ["Nano Banana 2", "Kling 3", "Seedance 2"];

/* -------------------------------------------------------------------------- */
/* About                                                                      */
/* -------------------------------------------------------------------------- */

export const ABOUT = {
  /** Rendered one per line on desktop, joined with spaces on mobile. */
  headingLines: ["AI video and images,", "from prompt to", "post in minutes."],
  body: "Generate faceless reels, cinematic clips, and studio-grade product photos with one AI suite, scripted, generated, captioned, and ready to publish.",
  cta: { label: "Explore our tools", href: "#features" },
  manifesto:
    "We don't just generate content, we help brands realize their voice at scale.",
  byline: "Kelolako team · est. 2026",
  stat: {
    value: "Free to start",
    label: "Register now, no commitment, no card required",
  },
};

/* -------------------------------------------------------------------------- */
/* Features                                                                   */
/* -------------------------------------------------------------------------- */

export type FeatureItem = {
  id: string;
  label: string;
  description: string;
  video: string;
  badge?: string;
  /** Maps to tool_configs.tool_key so the landing "Soon" badge tracks admin. */
  toolKey?: string;
};

export const FEATURES_HEADING =
  "Built for every stage of your content workflow";

export const FEATURES: FeatureItem[] = [
  {
    id: "video",
    label: "Video generation",
    description: "Scroll-stopping videos with narration, scenes, and captions.",
    video:
      "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260405_170732_8a9ccda6-5cff-4628-b164-059c500a2b41.mp4",
  },
  {
    id: "image",
    label: "Image generation",
    description: "Studio-grade images and product shots from a single prompt.",
    video:
      "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260418_063509_7d167302-4fd4-480b-8260-18ab572333d4.mp4",
  },
  {
    id: "virtual-creator",
    label: "Virtual Creator",
    description: "Bring a lifelike AI persona to life to front your content.",
    video:
      "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260405_074625_a81f018a-956b-43fb-9aee-4d1508e30e6a.mp4",
    badge: "New",
    toolKey: "virtual_creator",
  },
  {
    id: "scheduler",
    label: "Smart Scheduling",
    description: "Plan posts when your audience is most active.",
    video:
      "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260510_060007_60275ce7-030c-4668-a160-8f364ec537d3.mp4",
    toolKey: "schedule",
  },
];

/* -------------------------------------------------------------------------- */
/* Pricing                                                                    */
/* -------------------------------------------------------------------------- */

export const PRICING_HEADING = "Pricing that scales with your content.";
export const PRICING_SUBHEADING =
  "Buy credits and pay only for what you create. No subscription.";

export const PRICING_ASIDE = {
  heading: "Pay only for what you create.",
  body: "Buy credits in bulk and spend them across every Kelolako tool. No subscription. No surprise charges.",
  bullets: [
    "Mix & match across reels, photos, and captions",
    "Better value on larger packs",
    "No monthly commitment",
    "2-year validity from redemption",
  ],
  rateNote: "~50 credits per AI reel · 4 per product photo · 1 per caption",
  disclaimer:
    "Credits cannot be exchanged for memberships, nor refunded, transferred, or withdrawn.",
  policyLinkLabel: "Credits Policy",
};

export const CREDIT_POLICY = {
  title: "Credits Policy",
  dismissLabel: "Got it",
  items: [
    "Credits are non-refundable, non-transferable, and cannot be withdrawn or exchanged for cash.",
    "Credits cannot be exchanged for memberships or subscription plans.",
    "Credits are valid for 2 years from the date of redemption.",
    "Spent credits are consumed at generation time and are not returned for outputs you choose not to use.",
    "Kelolako may adjust credit pricing for future purchases; credits already purchased keep their granted value.",
  ],
};

// Where the "Purchase" CTA sends signed-in visitors. Guests never navigate —
// HelloPricing's CreditRow opens the sign-in modal in place instead.
export const CREDIT_CTA_HREF_AUTHED = "/dashboard/settings?tab=credits";

// Rough spend rates used only to estimate what a pack buys (matches the copy in
// the aside: ~50 credits per AI reel · 4 per product photo).
//
// Static on purpose, so keep them in step with `pricing_configs` by hand. Real
// billing resolves per generation in lib/pricing-resolver.ts and varies with
// model and length — video is charged PER SECOND (4-7 credits/s), so 50 stands
// in for a short reel, and 4 is the cheapest product-photo tier.
export const CREDITS_PER_IMAGE = 4;
export const CREDITS_PER_VIDEO = 50;

// Subscription plans are hidden for now — only credit packs are offered.
// Flip this to re-enable the Plans/Credits toggle and the plan tier cards.
export const SHOW_PLANS = false;

export type Plan = {
  id: "free" | "pro" | "studio";
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  features: string[];
  ctaHref: string;
  ctaLabel: string;
  featured?: boolean;
};

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cadence: "/mo",
    tagline: "Try the suite. Ship your first reel.",
    features: [
      "5 AI reels per month",
      "Standard templates",
      "Standard generation queue",
      "Kelolako watermark",
    ],
    ctaHref: "#growth",
    ctaLabel: "Start free",
  },
  {
    id: "pro",
    name: "Pro",
    price: "$29",
    cadence: "/mo",
    featured: true,
    tagline: "Everything solo creators need to grow.",
    features: [
      "50 AI reels per month",
      "All tools incl. Product Photo + Scheduler",
      "No watermark",
      "Priority generation",
      "Caption studio + ASS subtitles",
    ],
    ctaHref: "#growth",
    ctaLabel: "Get Pro",
  },
  {
    id: "studio",
    name: "Studio",
    price: "$99",
    cadence: "/mo",
    tagline: "For teams and growing brands.",
    features: [
      "Unlimited AI reels",
      "Team seats + roles",
      "API access",
      "Advanced analytics",
      "Priority support",
    ],
    ctaHref: "#growth",
    ctaLabel: "Talk to us",
  },
];

/* -------------------------------------------------------------------------- */
/* Testimonials                                                               */
/* -------------------------------------------------------------------------- */

export type TestimonialPlatform = "Instagram" | "TikTok" | "YouTube" | "X";

export type Testimonial = {
  quote: string;
  name: string;
  handle: string;
  platform: TestimonialPlatform;
};

export const TESTIMONIALS_HEADING = "Creators ship more with Kelolako.";

export const TESTIMONIALS: Testimonial[] = [
  {
    quote: "Kelolako cut my reel turnaround from 4 hours to 4 minutes.",
    name: "Maya Chen",
    handle: "@mayamakes",
    platform: "Instagram",
  },
  {
    quote: "Captions actually land on the beat. First tool that gets it.",
    name: "Diego Alvarez",
    handle: "@diegoshoots",
    platform: "TikTok",
  },
  {
    quote: "My product photos look like a $5k studio session.",
    name: "Priya Shah",
    handle: "@priyastudio",
    platform: "Instagram",
  },
  {
    quote: "Scheduling and reels in one place finally clicked for my team.",
    name: "Tomo Sato",
    handle: "@tomocreates",
    platform: "YouTube",
  },
  {
    quote: "The narration sounds human. My audience can't tell.",
    name: "Lena Rios",
    handle: "@lenaonair",
    platform: "TikTok",
  },
  {
    quote: "I post 5x more content with the same headcount.",
    name: "Jordan Pike",
    handle: "@jordanpike",
    platform: "Instagram",
  },
  {
    quote: "Honestly the only AI tool I pay for.",
    name: "Aisha Bello",
    handle: "@aishabuilds",
    platform: "X",
  },
  {
    quote: "Setup was 3 clicks. First post live in 10 minutes.",
    name: "Marco Russo",
    handle: "@marcofilms",
    platform: "YouTube",
  },
];

/* -------------------------------------------------------------------------- */
/* Closing CTA / footer                                                       */
/* -------------------------------------------------------------------------- */

export const FOOTER = {
  heading: "All eyes on your next post.",
  body: "Sign up free and start creating reels, product photos, and posts with Kelolako's AI suite.",
  copyright: "\u00a9 2026 Kelolako. Built for the future of content.",
  supportEmail: "support@kelolako.com",
  supportLabel: "Need support? We are here",
};

"use client";

type Platform = "Instagram" | "TikTok" | "YouTube" | "X";

type Testimonial = {
  quote: string;
  name: string;
  handle: string;
  platform: Platform;
};

const TESTIMONIALS: Testimonial[] = [
  {
    quote: "Krakatoa cut my reel turnaround from 4 hours to 4 minutes.",
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

const ROW_ONE = TESTIMONIALS;
const ROW_TWO = [...TESTIMONIALS].reverse();

const PLATFORM_STYLE: Record<Platform, string> = {
  Instagram: "bg-[#E1306C]/10 text-[#C13584]",
  TikTok: "bg-gray-900/[0.06] text-gray-900",
  YouTube: "bg-[#FF0000]/10 text-[#CC0000]",
  X: "bg-gray-900/[0.06] text-gray-900",
};

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function TestimonialCard({ t }: { t: Testimonial }) {
  return (
    <article className="flex w-[300px] shrink-0 flex-col gap-5 rounded-3xl bg-white p-6 ring-1 ring-black/[0.06] shadow-[0_12px_40px_-16px_rgba(0,0,0,0.08)] sm:w-[340px] sm:p-7 lg:w-[360px]">
      <p className="text-[15px] leading-relaxed text-gray-900">
        &ldquo;{t.quote}&rdquo;
      </p>
      <div className="mt-auto flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[12px] font-semibold text-white">
          {getInitials(t.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900">
            {t.name}
          </p>
          <p className="truncate text-[12px] text-gray-500">{t.handle}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${PLATFORM_STYLE[t.platform]}`}
        >
          {t.platform}
        </span>
      </div>
    </article>
  );
}

function MarqueeRow({
  items,
  direction,
}: {
  items: Testimonial[];
  direction: "left" | "right";
}) {
  const animationClass =
    direction === "left" ? "animate-marquee-left" : "animate-marquee-right";

  return (
    <div className="group/marquee relative">
      <div
        className={`flex w-max gap-4 sm:gap-5 ${animationClass} group-hover/marquee:[animation-play-state:paused]`}
      >
        {[...items, ...items].map((t, i) => (
          <TestimonialCard key={`${t.handle}-${i}`} t={t} />
        ))}
      </div>
    </div>
  );
}

export function TestimonialsSection() {
  return (
    <section
      id="testimonials"
      className="relative overflow-hidden bg-[#111827] pt-16 pb-16 sm:pt-20 sm:pb-20 lg:pt-28 lg:pb-28"
    >
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-10 px-5 sm:mb-12 sm:px-8 lg:mb-14 lg:px-12">
          <h2
            className="max-w-3xl font-medium leading-[1.08] tracking-[-0.02em] text-white"
            style={{ fontSize: "clamp(1.75rem, 5vw, 3rem)" }}
          >
            Creators ship more with Krakatoa.
          </h2>
        </div>
      </div>

      <div className="relative">
        <div className="flex flex-col gap-4 sm:gap-5">
          <MarqueeRow items={ROW_ONE} direction="left" />
          <MarqueeRow items={ROW_TWO} direction="right" />
        </div>

        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-[#111827] to-transparent sm:w-24"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-[#111827] to-transparent sm:w-24"
        />
      </div>
    </section>
  );
}

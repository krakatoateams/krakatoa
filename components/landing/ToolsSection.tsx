import Image from "next/image";
import Link from "next/link";
import { ArrowRight, AtSign, CalendarClock, Sparkles } from "lucide-react";
import { landingImages } from "@/lib/landing-images";

type FlagshipTool = {
  name: string;
  tag: string;
  description: string;
  href: string;
  video: string;
  featured?: boolean;
  hoverLight: boolean;
  hoverLabel: string;
};

type SuiteTool = {
  name: string;
  tag: string;
  description: string;
  href: string;
  image: string;
  icon: "calendar" | "instagram";
};

const FLAGSHIP_TOOLS: FlagshipTool[] = [
  {
    name: "ReelsGen",
    tag: "Video",
    description:
      "Faceless reels with AI narration, scene cuts, and burned-in captions — ready to post.",
    href: "/tools/reels",
    video:
      "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260516_122702_390f5305-8719-41d5-ae80-d23ab3796c28.mp4",
    featured: true,
    hoverLight: true,
    hoverLabel: "Launch tool",
  },
  {
    name: "Product Photo",
    tag: "Image",
    description:
      "Turn any product shot into studio-grade lighting and backgrounds in one click.",
    href: "/tools/photo",
    video:
      "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260516_123323_f909c2b8-ff6c-4edf-882b-8ebcdbe389b5.mp4",
    hoverLight: false,
    hoverLabel: "View tool",
  },
];

const SUITE_TOOLS: SuiteTool[] = [
  {
    name: "Scheduler",
    tag: "Publish",
    description:
      "Plan posts around when your audience is online — Calendar and YouTube built in.",
    href: "/tools/scheduler",
    image: landingImages.scheduler,
    icon: "calendar",
  },
  {
    name: "IG Automation",
    tag: "Social",
    description:
      "Generate and queue Instagram content on autopilot with smart engagement hooks.",
    href: "/tools/ig",
    image: landingImages.igAutomation,
    icon: "instagram",
  },
];

function SectionBadge({
  number,
  label,
}: {
  number: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white sm:text-xs">
        {number}
      </span>
      <span className="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-900 sm:text-[13px]">
        {label}
      </span>
    </div>
  );
}

function LaunchPill({ light, label }: { light: boolean; label: string }) {
  return (
    <span
      className={`mt-4 inline-flex h-9 items-center gap-2 overflow-hidden rounded-full pl-4 pr-3 text-[13px] font-medium transition-all duration-300 ${
        light
          ? "bg-white text-gray-900 group-hover:pr-4"
          : "bg-white/15 text-white ring-1 ring-white/25 backdrop-blur-sm group-hover:bg-white group-hover:text-gray-900"
      }`}
    >
      {label}
      <ArrowRight
        size={14}
        className="shrink-0 transition-transform duration-300 group-hover:translate-x-0.5"
      />
    </span>
  );
}

function FlagshipToolCard({ tool }: { tool: FlagshipTool }) {
  return (
    <Link
      href={tool.href}
      className={`group relative flex min-h-[280px] flex-col justify-end overflow-hidden rounded-2xl ring-1 ring-black/[0.06] transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_24px_48px_-12px_rgba(0,0,0,0.18)] sm:min-h-[320px] sm:rounded-3xl lg:min-h-[380px] ${
        tool.featured ? "lg:col-span-7" : "lg:col-span-5"
      }`}
    >
      <video
        src={tool.video}
        autoPlay
        muted
        loop
        playsInline
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-gray-950/90 via-gray-950/35 to-gray-950/10" />
      <div className="absolute inset-0 bg-[#F26522]/0 transition-colors duration-500 group-hover:bg-[#F26522]/[0.07]" />

      <span className="absolute left-5 top-5 rounded-full bg-white/95 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-900 shadow-sm sm:left-6 sm:top-6">
        {tool.tag}
      </span>

      {tool.featured && (
        <span className="absolute right-5 top-5 inline-flex items-center gap-1.5 rounded-full bg-[#F26522] px-3 py-1 text-[11px] font-semibold text-white sm:right-6 sm:top-6">
          <Sparkles className="h-3 w-3" strokeWidth={2.5} />
          Flagship
        </span>
      )}

      <div className="relative z-10 p-5 sm:p-6 lg:p-7">
        <h3 className="text-xl font-semibold tracking-tight text-white sm:text-2xl lg:text-[1.65rem]">
          {tool.name}
        </h3>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-white/75 sm:text-[15px]">
          {tool.description}
        </p>
        <LaunchPill light={tool.hoverLight} label={tool.hoverLabel} />
      </div>
    </Link>
  );
}

const SUITE_ICONS = {
  calendar: CalendarClock,
  instagram: AtSign,
} as const;

function SuiteToolCard({ tool }: { tool: SuiteTool }) {
  const Icon = SUITE_ICONS[tool.icon];

  return (
    <Link
      href={tool.href}
      className="group flex flex-col overflow-hidden rounded-2xl bg-[#FAFAFA] ring-1 ring-gray-200/80 transition-all duration-300 hover:bg-white hover:shadow-[0_16px_40px_-16px_rgba(0,0,0,0.12)] sm:flex-row sm:items-stretch"
    >
      <div className="relative aspect-[16/10] shrink-0 overflow-hidden sm:aspect-auto sm:w-[42%]">
        <Image
          src={tool.image}
          alt=""
          fill
          className="object-cover transition-transform duration-500 group-hover:scale-105"
          sizes="(max-width: 640px) 100vw, 30vw"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[#FAFAFA]/80 sm:bg-gradient-to-t sm:to-[#FAFAFA]/90" />
      </div>

      <div className="flex flex-1 flex-col justify-center p-5 sm:p-6">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-900 text-white">
            <Icon className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <span className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
            {tool.tag}
          </span>
        </div>
        <h3 className="text-lg font-semibold tracking-tight text-gray-900">{tool.name}</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-gray-600 sm:text-sm">
          {tool.description}
        </p>
        <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-gray-900 transition-colors group-hover:text-[#F26522]">
          Open tool
          <ArrowRight
            size={14}
            className="transition-transform duration-300 group-hover:translate-x-0.5"
          />
        </span>
      </div>
    </Link>
  );
}

export function ToolsSection() {
  return (
    <section id="tools" className="bg-[#F0F0F0] pt-16 sm:pt-20 lg:pt-28 pb-16 sm:pb-20 lg:pb-28">
      <div className="mx-auto max-w-[1440px]">
        <div className="px-5 sm:px-8 lg:px-12">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
            <div>
              <SectionBadge number="2" label="Creative suite" />
              <h2
                className="mt-6 font-medium leading-[1.06] tracking-[-0.03em] text-gray-900"
                style={{ fontSize: "clamp(1.75rem, 7vw, 4.2rem)" }}
              >
                Our tools
              </h2>
            </div>
            <p className="max-w-md text-[15px] leading-relaxed text-gray-600 sm:text-base lg:pb-2 lg:text-right">
              Ship reels, product shots, and scheduled posts from one workspace — built for
              creators who move fast.
            </p>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-5 px-5 sm:mt-12 sm:gap-6 sm:px-8 lg:mt-14 lg:grid-cols-12 lg:gap-7 lg:px-12">
          {FLAGSHIP_TOOLS.map((tool) => (
            <FlagshipToolCard key={tool.name} tool={tool} />
          ))}
        </div>

        <div className="mx-5 mt-10 rounded-2xl border border-gray-200/90 bg-white p-5 shadow-[0_1px_0_rgba(0,0,0,0.04)] sm:mx-8 sm:mt-12 sm:rounded-3xl sm:p-6 lg:mx-12 lg:mt-14 lg:p-8">
          <div className="mb-6 flex flex-col gap-2 border-b border-gray-100 pb-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold tracking-tight text-gray-900">
              More in the suite
            </p>
            <p className="text-[13px] text-gray-500">
              Publishing &amp; automation for daily growth
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-2">
            {SUITE_TOOLS.map((tool) => (
              <SuiteToolCard key={tool.name} tool={tool} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

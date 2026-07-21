import {
  BarChart3,
  Calendar,
  Camera,
  Clapperboard,
  Share2,
} from "lucide-react";
import { TextRollButton } from "./TextRollButton";

const TOOL_ICONS = [
  { Icon: Clapperboard, label: "AI Video Reels" },
  { Icon: Camera, label: "Product Photography" },
  { Icon: Calendar, label: "Smart Scheduling" },
  { Icon: Share2, label: "Social Automation" },
  { Icon: BarChart3, label: "Analytics" },
] as const;

export function LandingFooter() {
  return (
    <footer className="relative isolate overflow-hidden bg-gray-900 text-white">
      <div className="relative z-10 mx-auto max-w-[1440px] px-5 pb-16 pt-16 text-center sm:px-8 sm:pb-20 sm:pt-20 lg:px-12 lg:pb-24 lg:pt-24">
        <div className="flex justify-center gap-2.5 sm:gap-3">
          {TOOL_ICONS.map(({ Icon, label }) => (
            <span
              key={label}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15 sm:h-11 sm:w-11"
              title={label}
            >
              <Icon className="h-4 w-4 text-white sm:h-[18px] sm:w-[18px]" aria-hidden />
              <span className="sr-only">{label}</span>
            </span>
          ))}
        </div>

        <h2
          className="mx-auto mt-8 max-w-4xl font-semibold uppercase leading-[1.08] tracking-[-0.02em] text-white sm:mt-10"
          style={{ fontSize: "clamp(1.75rem, 5vw, 3.25rem)" }}
        >
          Take control of your content workflow
        </h2>

        <p className="mx-auto mt-5 max-w-2xl text-[15px] leading-relaxed text-white/75 sm:mt-6 sm:text-base">
          Benefit from AI-powered creation tools tailored to creators and growing brands.
          Ship reels, photos, and scheduled posts — all from one workspace.
        </p>

        <div className="mt-8 flex justify-center sm:mt-10">
          <TextRollButton
            href="#growth"
            className="inline-flex items-center gap-2 rounded-full bg-gray-950 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-black sm:px-6 sm:py-3"
            iconWrapperClassName="h-7 w-7 sm:h-8 sm:w-8"
            iconVariant="dark"
          >
            Get Started
          </TextRollButton>
        </div>
      </div>

      <div className="relative z-10 border-t border-white/10 px-5 py-6 sm:px-8 lg:px-12">
        <p className="mx-auto max-w-[1440px] text-center text-sm text-white/45">
          &copy; 2025 Kelolako. Built for the future of content.
        </p>
      </div>
    </footer>
  );
}

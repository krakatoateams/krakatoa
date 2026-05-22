import type { ReactNode } from "react";

type FloatingIcon = {
  label: string;
  accent: string;
  top: string;
  inset: string;
  nudgeY: string;
  rotate: string;
  scale?: number;
  delay?: string;
  duration?: string;
};

/** Irregular scatter — avoids mirrored zig-zag along a single column */
const LEFT_ICONS: FloatingIcon[] = [
  { label: "IG", accent: "bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af]", top: "1%", inset: "58%", nudgeY: "10px", rotate: "-11deg", scale: 1.02, delay: "0s", duration: "5.4s" },
  { label: "TT", accent: "bg-neutral-900", top: "17%", inset: "92%", nudgeY: "-16px", rotate: "9deg", delay: "0.7s", duration: "6.8s" },
  { label: "YT", accent: "bg-[#FF0000]", top: "28%", inset: "4%", nudgeY: "14px", rotate: "-5deg", scale: 0.94, delay: "1.3s", duration: "7.2s" },
  { label: "X", accent: "bg-neutral-950", top: "46%", inset: "48%", nudgeY: "-10px", rotate: "13deg", delay: "1.9s", duration: "5.9s" },
  { label: "FB", accent: "bg-[#1877F2]", top: "66%", inset: "78%", nudgeY: "-12px", rotate: "6deg", scale: 1.05, delay: "3.1s", duration: "6.3s" },
];

const RIGHT_ICONS: FloatingIcon[] = [
  { label: "LI", accent: "bg-[#0A66C2]", top: "6%", inset: "22%", nudgeY: "-14px", rotate: "7deg", delay: "0.2s", duration: "7.5s" },
  { label: "PT", accent: "bg-[#E60023]", top: "13%", inset: "88%", nudgeY: "11px", rotate: "-12deg", scale: 0.96, delay: "0.9s", duration: "5.6s" },
  { label: "SC", accent: "bg-[#FFFC00] text-neutral-900", top: "35%", inset: "6%", nudgeY: "-8px", rotate: "4deg", delay: "1.5s", duration: "8.4s" },
  { label: "TH", accent: "bg-[#9146FF]", top: "44%", inset: "62%", nudgeY: "15px", rotate: "-9deg", delay: "2.1s", duration: "6.1s" },
  { label: "TK", accent: "bg-[#00f2ea] text-neutral-900", top: "79%", inset: "12%", nudgeY: "9px", rotate: "-6deg", scale: 1.03, delay: "3.3s", duration: "5.2s" },
];

function FloatingSocialIcon({
  icon,
  side,
}: {
  icon: FloatingIcon;
  side: "left" | "right";
}) {
  const horizontal =
    side === "left" ? { left: icon.inset } : { right: icon.inset };

  const scale = icon.scale ?? 1;

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        top: icon.top,
        ...horizontal,
        transform: `translateY(${icon.nudgeY}) rotate(${icon.rotate}) scale(${scale})`,
      }}
      aria-hidden
    >
      <div
        className="animate-float-gentle"
        style={{
          animationDelay: icon.delay,
          animationDuration: icon.duration,
        }}
      >
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white"
          style={{
            boxShadow: "0 4px 14px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.06)",
          }}
        >
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full text-[9px] font-bold text-white ${icon.accent}`}
          >
            {icon.label}
          </span>
        </div>
      </div>
    </div>
  );
}

function SocialIconRail({
  icons,
  side,
}: {
  icons: FloatingIcon[];
  side: "left" | "right";
}) {
  return (
    <div
      className={`relative hidden lg:block shrink-0 w-[7.5rem] xl:w-[9.5rem] 2xl:w-[11rem] self-stretch min-h-[360px] ${
        side === "left" ? "-mr-2 xl:-mr-1" : "-ml-2 xl:-ml-1"
      }`}
      aria-hidden
    >
      {icons.map((icon, i) => (
        <FloatingSocialIcon key={`${side}-${icon.label}-${i}`} icon={icon} side={side} />
      ))}
    </div>
  );
}

/** Wraps hero copy so floating social placeholders sit beside the text in a scattered layout. */
export function HeroFloatingSocialIcons({ children }: { children: ReactNode }) {
  return (
    <div className="relative w-full max-w-6xl mx-auto">
      <div className="flex w-full items-stretch justify-center gap-2 xl:gap-6">
        <SocialIconRail icons={LEFT_ICONS} side="left" />
        <div className="min-w-0 flex-1 max-w-5xl flex flex-col items-center justify-center">
          {children}
        </div>
        <SocialIconRail icons={RIGHT_ICONS} side="right" />
      </div>
    </div>
  );
}

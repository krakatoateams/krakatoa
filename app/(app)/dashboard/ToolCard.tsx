import Link from "next/link";
import { ArrowRight } from "lucide-react";

export interface ToolCardProps {
  name: string;
  href: string;
  icon: React.ReactNode;
  accent: string;
  comingSoon?: boolean;
  thumbnail?: React.ReactNode;
}

export default function ToolCard({ name, href, icon, accent, comingSoon, thumbnail }: ToolCardProps) {
  const Wrapper = comingSoon ? "div" : Link;
  const wrapperProps = comingSoon ? {} : { href };

  return (
    <Wrapper
      {...(wrapperProps as { href: string })}
      className={`group relative flex flex-col rounded-xl bg-white/[0.04] p-5 transition-all ${
        comingSoon ? "opacity-60" : "hover:bg-white/[0.06]"
      }`}
    >
      {thumbnail}

      {comingSoon && (
        <span className="absolute right-4 top-4 rounded-full bg-warning/10 border border-warning/30 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-warning">
          Coming Soon
        </span>
      )}

      <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg ${accent}`}>
        {icon}
      </div>

      <h3 className="flex-1 text-base font-semibold text-N900">{name}</h3>

      <div
        className={`mt-4 inline-flex items-center gap-1.5 text-sm font-medium ${
          comingSoon ? "text-text-disabled" : "text-text-secondary group-hover:gap-2.5 transition-all"
        }`}
      >
        {comingSoon ? "Coming soon" : "Open Tool"}
        {!comingSoon && <ArrowRight className="h-3.5 w-3.5" />}
      </div>
    </Wrapper>
  );
}

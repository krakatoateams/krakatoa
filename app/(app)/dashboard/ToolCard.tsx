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
      className={`group relative flex flex-col rounded-xl border border-gray-800 bg-gray-900 p-5 transition-all ${
        comingSoon ? "opacity-60" : "hover:border-violet-500/40 hover:bg-gray-900/80"
      }`}
    >
      {thumbnail}

      {comingSoon && (
        <span className="absolute right-4 top-4 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-amber-400">
          Coming Soon
        </span>
      )}

      <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg ${accent}`}>
        {icon}
      </div>

      <h3 className="flex-1 text-base font-semibold text-white">{name}</h3>

      <div
        className={`mt-4 inline-flex items-center gap-1.5 text-sm font-medium ${
          comingSoon ? "text-gray-600" : "text-violet-400 group-hover:gap-2.5 transition-all"
        }`}
      >
        {comingSoon ? "Coming soon" : "Open Tool"}
        {!comingSoon && <ArrowRight className="h-3.5 w-3.5" />}
      </div>
    </Wrapper>
  );
}

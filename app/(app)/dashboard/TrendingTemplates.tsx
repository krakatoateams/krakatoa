"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

type TrendingTemplate = {
  id: string;
  videoUrl: string;
  thumbnailUrl: string | null;
};

/**
 * Dashboard "Trending templates" carousel. Shows a horizontal, scroll-snapping
 * row of short motion videos. Each card previews on hover and reveals a "Use
 * template" button that deep-links into Motion Control with the clip preloaded
 * as the driving video. Renders nothing until (and unless) templates load, so
 * it never leaves an empty placeholder.
 */
export default function TrendingTemplates() {
  const router = useRouter();
  const [templates, setTemplates] = useState<TrendingTemplate[] | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/templates/trending")
      .then((res) => (res.ok ? res.json() : { templates: [] }))
      .then((data) => {
        if (active) setTemplates(data.templates ?? []);
      })
      .catch(() => {
        if (active) setTemplates([]);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!templates || templates.length === 0) return null;

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: "smooth" });
  };

  const useTemplate = (videoUrl: string) => {
    router.push(
      `/tools/video?type=motion_control&templateVideo=${encodeURIComponent(videoUrl)}`
    );
  };

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">
          Trending templates
        </h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label="Scroll left"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-800 bg-gray-900 text-gray-400 transition-colors hover:border-violet-500/40 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label="Scroll right"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-800 bg-gray-900 text-gray-400 transition-colors hover:border-violet-500/40 hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onUse={() => useTemplate(template.videoUrl)}
          />
        ))}
      </div>
    </section>
  );
}

function TemplateCard({
  template,
  onUse,
}: {
  template: TrendingTemplate;
  onUse: () => void;
}) {
  return (
    <div className="group relative aspect-[9/16] w-40 shrink-0 snap-start overflow-hidden rounded-xl border border-gray-800 bg-gray-900 sm:w-44">
      <video
        src={template.videoUrl}
        poster={template.thumbnailUrl ?? undefined}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-label="Trending template preview"
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* Hover overlay with the Use template CTA, anchored to the bottom */}
      <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/70 via-black/10 to-transparent p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <button
          type="button"
          onClick={onUse}
          className="flex h-10 w-full items-center justify-center rounded-xl bg-white px-3 text-sm font-bold capitalize tracking-normal text-gray-900 shadow-lg shadow-black/20 transition-all hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Use template
        </button>
      </div>
    </div>
  );
}

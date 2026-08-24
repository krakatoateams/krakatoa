"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  TRENDING_TEMPLATES,
  VIRAL_TEMPLATES,
  VIRTUAL_PRODUCT_TRYON_TEMPLATES,
  tryOnTemplateHref,
  viralTemplateHref,
  productTryOnHref,
  type TrendingTemplate,
} from "@/lib/trending-templates";

/**
 * Dashboard template carousels. Photo try-on deep-links into Product try-on.
 * Video try-on cards deep-link into Motion Control (the clip is the driving
 * pose). Viral cards deep-link into Image to video with the clip's generation
 * prompt prefilled — the user supplies their own start photo.
 */
export default function TrendingTemplates() {
  return (
    <section className="mb-10 grid grid-cols-1 gap-6 md:grid-cols-2">
      <TemplateCarousel
        title="Photo try-on"
        templates={VIRTUAL_PRODUCT_TRYON_TEMPLATES}
        hrefFor={(t) =>
          productTryOnHref({
            productUrl: t.productImageUrl ?? "",
            characterUrl: t.characterImageUrl,
            prompt: t.prompt,
          })
        }
      />
      <TemplateCarousel
        title="Motion control"
        templates={TRENDING_TEMPLATES}
        hrefFor={(t) => tryOnTemplateHref(t.videoUrl ?? "")}
      />
    </section>
  );
}

export function ViralTemplates() {
  return (
    <section className="mb-10">
      <TemplateCarousel
        title="Viral templates"
        templates={VIRAL_TEMPLATES}
        hrefFor={(t) => viralTemplateHref(t.prompt ?? "")}
      />
    </section>
  );
}

function TemplateCarousel({
  title,
  templates,
  hrefFor,
}: {
  title: string;
  templates: TrendingTemplate[];
  hrefFor: (template: TrendingTemplate) => string;
}) {
  const router = useRouter();
  const scrollerRef = useRef<HTMLDivElement>(null);

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-text-disabled">
          {title}
        </h2>
        {templates.length > 0 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => scrollBy(-1)}
              aria-label="Scroll left"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.04] text-text-secondary transition-colors hover:bg-white/[0.08] hover:text-N900"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => scrollBy(1)}
              aria-label="Scroll right"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.04] text-text-secondary transition-colors hover:bg-white/[0.08] hover:text-N900"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div
        ref={scrollerRef}
        className="flex min-h-[17.75rem] snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onUse={() => router.push(hrefFor(template))}
          />
        ))}
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  onUse,
}: {
  template: TrendingTemplate;
  onUse: () => void;
}) {
  const thumbs = [template.characterImageUrl, template.referenceImageUrl].filter(
    (src): src is string => Boolean(src)
  );

  return (
    <div className="group relative aspect-[9/16] w-40 shrink-0 snap-start overflow-hidden rounded-xl bg-white/[0.04] sm:w-44">
      {template.videoUrl ? (
        <video
          src={template.videoUrl}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-label="Trending template preview"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : template.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={template.imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}

      {thumbs.length > 0 ? (
        <div className="absolute bottom-3 left-3 z-10 flex gap-1.5 transition-transform duration-200 group-hover:-translate-y-[52px]">
          {thumbs.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={src}
              src={src}
              alt=""
              width={48}
              height={48}
              className="h-12 w-12 rounded-lg object-cover shadow-lg shadow-N0/40 ring-2 ring-white/80"
            />
          ))}
        </div>
      ) : null}

      {/* Hover overlay + Use template CTA */}
      <div className="absolute inset-0 flex items-end bg-gradient-to-t from-N0/70 via-N0/10 to-transparent p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <button
          type="button"
          onClick={onUse}
          className="flex h-10 w-full items-center justify-center rounded-xl bg-bg-static-white px-3 text-sm font-bold capitalize tracking-normal text-text-static-black shadow-lg shadow-N0/20 transition-all hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Use template
        </button>
      </div>
    </div>
  );
}

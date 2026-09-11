"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  TRENDING_TEMPLATES,
  VIRAL_TEMPLATES,
  PRODUCT_REVIEW_TEMPLATES,
  VIRTUAL_PRODUCT_TRYON_TEMPLATES,
  tryOnTemplateHref,
  viralTemplateHref,
  productReviewTemplateHref,
  productTryOnHref,
  type TrendingTemplate,
} from "@/lib/trending-templates";

/**
 * Dashboard template carousels. Photo try-on → Product try-on. Motion control
 * clips → Motion control with the template video preloaded. Viral clips →
 * Viral Template composer (character upload only).
 */
export default function TrendingTemplates() {
  return (
    <section className="mb-8 grid grid-cols-1 gap-6 md:mb-16 md:grid-cols-2">
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

export function VideoTemplateCarousels() {
  return (
    <LazyWhenVisible className="mb-8 md:mb-16" minHeight="32rem">
    <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div className="min-w-0">
        <TemplateCarousel
          title="Product review templates"
          templates={PRODUCT_REVIEW_TEMPLATES}
          hrefFor={(t) => productReviewTemplateHref(t.id)}
        />
      </div>
      <div className="min-w-0">
        <TemplateCarousel
          title="Viral templates"
          templates={VIRAL_TEMPLATES}
          hrefFor={(t) => viralTemplateHref(t.id)}
        />
      </div>
    </section>
    </LazyWhenVisible>
  );
}

function LazyWhenVisible({
  children,
  className = "",
  minHeight,
}: {
  children: ReactNode;
  className?: string;
  minHeight: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShow(true);
        io.disconnect();
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {show ? children : <div style={{ minHeight }} aria-hidden />}
    </div>
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

      {templates.length === 0 ? (
        <p className="flex min-h-[14.25rem] items-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 text-sm text-text-disabled sm:min-h-[17.75rem]">
          Templates coming soon.
        </p>
      ) : (
        <div
          ref={scrollerRef}
          className="flex min-h-[14.25rem] snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [scrollbar-width:none] sm:min-h-[17.75rem] sm:gap-4 [&::-webkit-scrollbar]:hidden"
        >
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onUse={() => router.push(hrefFor(template))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Corner thumbs on template cards — separate from composer-only fields like the viral start frame. */
function templateThumbUrls(template: TrendingTemplate): string[] {
  if (template.characterImageUrl && template.productImageUrl) {
    return [template.characterImageUrl, template.productImageUrl];
  }
  if (template.productImageUrl) {
    return [template.characterImageUrl, template.referenceImageUrl].filter(
      (src): src is string => Boolean(src)
    );
  }
  if (template.characterImageUrl) return [template.characterImageUrl];
  if (template.referenceImageUrl) return [template.referenceImageUrl];
  return [];
}

function TemplateCard({
  template,
  onUse,
}: {
  template: TrendingTemplate;
  onUse: () => void;
}) {
  const thumbs = templateThumbUrls(template);
  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!template.videoUrl) return;
    const el = cardRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: "80px", threshold: 0.2 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [template.videoUrl]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (inView) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [inView]);

  const handlePreviewEnter = () => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    el.play().catch(() => {});
  };

  const handlePreviewLeave = () => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = true;
  };

  return (
    <div
      ref={cardRef}
      className="group relative aspect-[9/16] w-32 shrink-0 snap-start overflow-hidden rounded-xl bg-white/[0.04] sm:w-40 md:w-44"
      onMouseEnter={template.videoUrl ? handlePreviewEnter : undefined}
      onMouseLeave={template.videoUrl ? handlePreviewLeave : undefined}
    >
      {template.videoUrl ? (
        inView ? (
          <video
            ref={videoRef}
            src={template.videoUrl}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster={template.imageUrl}
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
        ) : null
      ) : template.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={template.imageUrl}
          alt=""
          loading="lazy"
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
          className="flex h-9 w-full items-center justify-center whitespace-nowrap rounded-xl bg-bg-static-white px-2 text-[11px] font-bold capitalize tracking-normal text-text-static-black shadow-lg shadow-N0/20 transition-all hover:brightness-95 sm:h-10 sm:px-3 sm:text-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          Use template
        </button>
      </div>
    </div>
  );
}

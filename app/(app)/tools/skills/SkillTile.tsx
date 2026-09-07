"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Pencil, Star } from "lucide-react";
import type { Skill } from "@/lib/skills";

const CARD =
  "group flex items-center gap-3 rounded-xl bg-white/[0.04] p-2 pr-2 text-left transition-colors hover:bg-white/[0.08]";

function RunningTitle({ text }: { text: string }) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [overflowPx, setOverflowPx] = useState(0);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const measure = measureRef.current;
    if (!viewport || !measure) return;

    const update = () => {
      const delta = measure.scrollWidth - viewport.clientWidth;
      setOverflowPx(delta > 1 ? delta : 0);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [text]);

  const running = overflowPx > 0;
  const durationSec = Math.max(5, overflowPx / 24);

  return (
    <span
      ref={viewportRef}
      title={text}
      className={`relative min-w-0 flex-1 overflow-hidden text-sm font-medium text-N900 ${
        running ? "[mask-image:linear-gradient(to_right,black_calc(100%-10px),transparent)]" : ""
      }`}
    >
      <span
        ref={measureRef}
        className="invisible absolute left-0 top-0 whitespace-nowrap"
        aria-hidden
      >
        {text}
      </span>
      {running ? (
        <span
          className="inline-flex w-max gap-8 whitespace-nowrap animate-marquee-left motion-reduce:animate-none"
          style={{ animationDuration: `${durationSec}s` }}
        >
          <span>{text}</span>
          <span aria-hidden>{text}</span>
        </span>
      ) : (
        <span className="block truncate whitespace-nowrap">{text}</span>
      )}
    </span>
  );
}

export function SkillTile({
  skill,
  active,
  favorite,
  dimmed,
  onSelect,
  onToggleFavorite,
  onModify,
}: {
  skill: Skill;
  active?: boolean;
  favorite: boolean;
  dimmed?: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onModify?: () => void;
}) {
  return (
    <div
      className={`${CARD} ${active ? "bg-white/10 ring-1 ring-white/15" : ""} ${
        dimmed ? "opacity-45" : ""
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white/5">
          {skill.thumb ? (
            <img
              key={skill.thumb}
              src={skill.thumb}
              alt=""
              width={48}
              height={48}
              className="h-12 w-12 object-cover"
            />
          ) : null}
        </span>
        <RunningTitle text={skill.title} />
      </button>
      <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center">
        {onModify ? (
          <button
            type="button"
            data-skill-admin-edit
            aria-label={`Modify ${skill.title}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onModify();
            }}
            className="absolute right-full flex h-8 w-8 items-center justify-center rounded-lg text-text-disabled opacity-0 transition-opacity hover:bg-white/10 hover:text-N900 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
          >
            <Pencil className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={favorite}
          aria-label={favorite ? `Unfavorite ${skill.title}` : `Favorite ${skill.title}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleFavorite();
          }}
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
            favorite
              ? "text-brand-primary hover:bg-brand-primary/10"
              : "text-text-disabled hover:bg-white/10 hover:text-N900"
          }`}
        >
          <Star className="h-4 w-4" fill={favorite ? "currentColor" : "none"} />
        </button>
      </div>
    </div>
  );
}

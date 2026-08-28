"use client";

import Link from "next/link";
import { ArrowRight, CalendarClock } from "lucide-react";
import { schedulerHandoffHref } from "@/lib/scheduler-handoff";

export function GenerationScheduleButton({
  assetUrl,
  mediaType,
  title,
  caption,
  label = "Schedule this post",
  className = "inline-flex h-10 items-center gap-2 rounded-radius-xl bg-gradient-to-br from-brand-primary-light to-brand-primary px-4 text-sm font-semibold text-text-on-solid transition-opacity hover:opacity-90",
  showArrow = false,
}: {
  assetUrl: string | null | undefined;
  mediaType?: "image" | "video";
  title?: string;
  caption?: string;
  label?: string;
  className?: string;
  showArrow?: boolean;
}) {
  const hrefAsset = assetUrl?.trim();
  if (!hrefAsset) return null;

  return (
    <Link
      href={schedulerHandoffHref({ assetUrl: hrefAsset, mediaType, title, caption })}
      className={className}
    >
      <CalendarClock className="h-4 w-4" />
      <span>{label}</span>
      {showArrow ? <ArrowRight className="h-4 w-4" /> : null}
    </Link>
  );
}

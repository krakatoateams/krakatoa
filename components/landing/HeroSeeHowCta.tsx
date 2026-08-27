"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { TextRollButton } from "@/components/landing/TextRollButton";
import { YouTubeEmbedOverlay } from "@/components/landing/YouTubeEmbedOverlay";
import { HERO_CTA } from "@/lib/landing-content";

type IconVariant = "dark" | "orange" | "invert";

export function HeroSeeHowCta({
  className,
  textClassName,
  iconWrapperClassName,
  iconClassName,
  icon,
  iconHoverClassName,
  iconVariant,
}: {
  className?: string;
  textClassName?: string;
  iconWrapperClassName?: string;
  iconClassName?: string;
  icon?: LucideIcon;
  iconHoverClassName?: string;
  iconVariant?: IconVariant;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TextRollButton
        className={className}
        textClassName={textClassName}
        iconWrapperClassName={iconWrapperClassName}
        iconClassName={iconClassName}
        icon={icon}
        iconHoverClassName={iconHoverClassName}
        iconVariant={iconVariant}
        onClick={() => setOpen(true)}
      >
        {HERO_CTA.label}
      </TextRollButton>

      <YouTubeEmbedOverlay
        open={open}
        videoId={HERO_CTA.youtubeVideoId}
        title={HERO_CTA.label}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

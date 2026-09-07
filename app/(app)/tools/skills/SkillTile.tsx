"use client";

import { Pencil, Star } from "lucide-react";
import type { Skill } from "@/lib/skills";

const CARD =
  "group flex items-center gap-3 rounded-xl bg-white/[0.04] p-2 pr-2 text-left transition-colors hover:bg-white/[0.08]";

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
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-N900">
          {skill.title}
        </span>
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

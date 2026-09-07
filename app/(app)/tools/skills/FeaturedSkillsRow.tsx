"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  isAgentSkill,
  skillHref,
  type Skill,
  type SkillId,
} from "@/lib/skills";
import { useSkillFavorites } from "@/lib/use-skill-favorites";
import { useSkillsCatalog, type CatalogSkill } from "./SkillsCatalogProvider";

const PILL =
  "inline-flex h-12 shrink-0 items-center gap-2.5 rounded-radius-xl border border-white/10 bg-white/[0.04] text-sm text-text-primary transition-colors";

export default function FeaturedSkillsRow({
  activeSkillId,
  onSelectSkill,
}: {
  activeSkillId: SkillId | null;
  onSelectSkill: (id: SkillId) => void;
}) {
  const { featured, skillById } = useSkillsCatalog();
  const { ids: favoriteIds } = useSkillFavorites();

  const chips = useMemo(() => {
    const seen = new Set<string>();
    const out: CatalogSkill[] = [];
    for (const id of favoriteIds) {
      const skill = skillById(id);
      if (!skill || seen.has(skill.id)) continue;
      seen.add(skill.id);
      out.push(skill);
    }
    for (const skill of featured) {
      if (seen.has(skill.id)) continue;
      seen.add(skill.id);
      out.push(skill);
    }
    return out;
  }, [favoriteIds, featured, skillById]);

  return (
    <div className="mt-4 flex flex-nowrap items-center gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {chips.map((skill) => (
        <FeaturedSkillChip
          key={skill.id}
          skill={skill}
          active={skill.id === activeSkillId}
          onSelectSkill={onSelectSkill}
        />
      ))}

      <Link
        href="/tools/skills"
        className={`${PILL} px-3.5 hover:border-white/20 hover:bg-white/[0.08]`}
      >
        All Skills
        <ChevronRight className="h-3.5 w-3.5 text-text-secondary" />
      </Link>
    </div>
  );
}

function FeaturedSkillChip({
  skill,
  active,
  onSelectSkill,
}: {
  skill: Skill;
  active: boolean;
  onSelectSkill: (id: SkillId) => void;
}) {
  const className = `${PILL} p-2 pr-3.5 ${
    active
      ? "border-white/25 bg-white/10 hover:bg-white/[0.12]"
      : "hover:border-white/20 hover:bg-white/[0.08]"
  }`;

  const body = (
    <>
      <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-white/5">
        {skill.thumb ? (
          <img
            key={skill.thumb}
            src={skill.thumb}
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 object-cover"
          />
        ) : null}
        {skill.badge === "new" ? (
          <span className="absolute left-0.5 top-0.5 rounded bg-N50 px-1 py-px text-[8px] font-bold uppercase leading-none text-N900">
            New
          </span>
        ) : null}
      </span>
      <span className="truncate font-medium">{skill.title}</span>
    </>
  );

  if (!isAgentSkill(skill)) {
    return (
      <Link href={skillHref(skill.id)} className={className}>
        {body}
      </Link>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelectSkill(skill.id)}
      className={className}
    >
      {body}
    </button>
  );
}

"use client";

import { useMemo, useState } from "react";
import {
  SKILL_CATEGORIES,
  type Skill,
  type SkillId,
} from "@/lib/skills";
import { useSkillFavorites } from "@/lib/use-skill-favorites";
import { SkillModifyPanel } from "./SkillModifyPanel";
import { SkillTile } from "./SkillTile";
import { useSkillsCatalog, type CatalogSkill } from "./SkillsCatalogProvider";

function canManageSkill(skill: CatalogSkill, isAdmin: boolean): boolean {
  if (skill.owned) return true;
  return isAdmin;
}

function SkillSection({
  title,
  items,
  activeId,
  isAdmin,
  manageEnabled,
  isFavorite,
  onSelect,
  onToggleFavorite,
  onModify,
}: {
  title: string;
  items: CatalogSkill[];
  activeId?: SkillId | null;
  isAdmin: boolean;
  manageEnabled: boolean;
  isFavorite: (id: string) => boolean;
  onSelect: (skill: Skill) => void;
  onToggleFavorite: (id: string) => void;
  onModify: (skill: CatalogSkill) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-4 text-base font-semibold text-N900">{title}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((skill) => {
          const manage = manageEnabled && canManageSkill(skill, isAdmin);
          return (
            <SkillTile
              key={skill.id}
              skill={skill}
              active={skill.id === activeId}
              favorite={isFavorite(skill.id)}
              onSelect={() => onSelect(skill)}
              onToggleFavorite={() => onToggleFavorite(skill.id)}
              onModify={manage ? () => onModify(skill) : undefined}
            />
          );
        })}
      </div>
    </section>
  );
}

export function SkillsGrid({
  activeId,
  onSelect,
  onModify,
}: {
  activeId?: SkillId | null;
  onSelect: (skill: Skill) => void;
  onModify?: (skill: CatalogSkill) => void;
}) {
  const { visible, isAdmin, refresh } = useSkillsCatalog();
  const { ids: favoriteIds, isFavorite, toggle } = useSkillFavorites();
  const [editing, setEditing] = useState<CatalogSkill | null>(null);

  const byId = useMemo(() => new Map(visible.map((skill) => [skill.id, skill])), [visible]);

  const favorites = useMemo(
    () => favoriteIds.map((id) => byId.get(id)).filter((skill): skill is CatalogSkill => Boolean(skill)),
    [favoriteIds, byId]
  );

  const yours = useMemo(
    () => visible.filter((skill) => skill.owned),
    [visible]
  );

  const byCategory = useMemo(() => {
    const map = new Map<string, CatalogSkill[]>();
    for (const category of SKILL_CATEGORIES) map.set(category.id, []);
    for (const skill of visible) {
      if (skill.owned) continue;
      const list = map.get(skill.category) ?? map.get(SKILL_CATEGORIES[0].id);
      list?.push(skill);
    }
    return map;
  }, [visible]);

  const openModify = (skill: CatalogSkill) => {
    if (onModify) onModify(skill);
    else setEditing(skill);
  };

  const sectionProps = {
    activeId,
    isAdmin,
    manageEnabled: Boolean(onModify),
    isFavorite,
    onSelect,
    onToggleFavorite: toggle,
    onModify: openModify,
  };

  return (
    <div className="flex flex-col gap-10">
      <SkillSection title="Favorite" items={favorites} {...sectionProps} />
      <SkillSection title="Your skills" items={yours} {...sectionProps} />

      {SKILL_CATEGORIES.map((category) => (
        <SkillSection
          key={category.id}
          title={category.title}
          items={byCategory.get(category.id) ?? []}
          {...sectionProps}
        />
      ))}

      {editing ? (
        <SkillModifyPanel
          kind={editing.owned ? "user" : "master"}
          skill={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

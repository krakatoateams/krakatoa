"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  FEATURED_SKILL_IDS,
  SKILLS,
  defaultSkillRecipe,
  type Skill,
  type SkillId,
} from "@/lib/skills";

export type CatalogSkill = Skill & {
  recipe: string;
  origin?: "catalog" | "overlay" | "custom";
  hidden?: boolean;
  owned?: boolean;
};

type SkillsCatalogValue = {
  skills: CatalogSkill[];
  /** Shared catalog minus hidden rows — same list the Skills page shows. */
  visible: CatalogSkill[];
  /** True after `/api/skills` has replaced the code fallback. */
  ready: boolean;
  isAdmin: boolean;
  refresh: () => Promise<void>;
  skillById: (id: string) => CatalogSkill | undefined;
  featured: CatalogSkill[];
};

const SkillsCatalogContext = createContext<SkillsCatalogValue | null>(null);

function withRecipes(list: Skill[]): CatalogSkill[] {
  return list.map((skill) => ({ ...skill, recipe: defaultSkillRecipe(skill.id) }));
}

export function SkillsCatalogProvider({ children }: { children: ReactNode }) {
  const parent = useContext(SkillsCatalogContext);
  if (parent) return children;
  return <SkillsCatalogProviderInner>{children}</SkillsCatalogProviderInner>;
}

function SkillsCatalogProviderInner({ children }: { children: ReactNode }) {
  const [skills, setSkills] = useState<CatalogSkill[]>(() => withRecipes(SKILLS));
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const refresh = useCallback(async () => {
    const [catalog, adminMe] = await Promise.all([
      fetch("/api/skills").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/admin/me").then((r) => (r.ok ? r.json() : { isAdmin: false })).catch(() => ({
        isAdmin: false,
      })),
    ]);
    setIsAdmin(Boolean(adminMe?.isAdmin));
    if (Array.isArray(catalog?.skills)) {
      setSkills(catalog.skills as CatalogSkill[]);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<SkillsCatalogValue>(() => {
    const byId = new Map(skills.map((s) => [s.id, s]));
    const visible = skills.filter((skill) => !skill.hidden);
    return {
      skills,
      visible,
      ready,
      isAdmin,
      refresh,
      skillById: (id: string) => {
        const found = byId.get(id as SkillId);
        if (!found || found.hidden) return undefined;
        return found;
      },
      featured: FEATURED_SKILL_IDS.map((id) => byId.get(id)).filter(
        (s): s is CatalogSkill => s != null && !s.hidden
      ),
    };
  }, [skills, ready, isAdmin, refresh]);

  return (
    <SkillsCatalogContext.Provider value={value}>{children}</SkillsCatalogContext.Provider>
  );
}

export function useSkillsCatalog(): SkillsCatalogValue {
  const ctx = useContext(SkillsCatalogContext);
  if (ctx) return ctx;
  const fallback = withRecipes(SKILLS);
  const byId = new Map(fallback.map((s) => [s.id, s]));
  const visible = fallback.filter((skill) => !skill.hidden);
  return {
    skills: fallback,
    visible,
    ready: false,
    isAdmin: false,
    refresh: async () => {},
    skillById: (id: string) => byId.get(id as SkillId),
    featured: FEATURED_SKILL_IDS.map((id) => byId.get(id)).filter(
      (s): s is CatalogSkill => s != null && !s.hidden
    ),
  };
}

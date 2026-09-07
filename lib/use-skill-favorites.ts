"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SKILL_FAVORITES_EVENT,
  loadSkillFavorites,
  toggleSkillFavorite,
} from "@/lib/skill-favorites";

export function useSkillFavorites() {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    setIds(loadSkillFavorites());
    const sync = () => setIds(loadSkillFavorites());
    window.addEventListener(SKILL_FAVORITES_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SKILL_FAVORITES_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = useCallback((id: string) => {
    setIds((current) => toggleSkillFavorite(id, current));
  }, []);

  const isFavorite = useCallback((id: string) => ids.includes(id), [ids]);

  return { ids, isFavorite, toggle };
}

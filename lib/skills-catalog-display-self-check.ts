import { readFileSync } from "node:fs";
import { catalogSkillsForDisplay } from "./skills-catalog-display";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** ponytail: locks the no-flash contract without a browser. */
export function skillsCatalogDisplaySelfCheck(): void {
  const fallback = [
    { id: "high-quality-film", hidden: false },
    { id: "change-background", hidden: false },
  ];
  const afterFetch = [
    { id: "high-quality-film", hidden: false },
    { id: "change-background", hidden: true },
  ];

  assert(
    catalogSkillsForDisplay(fallback, false).length === 0,
    "must not paint the code-fallback catalog before /api/skills settles"
  );
  assert(
    catalogSkillsForDisplay(afterFetch, true).map((s) => s.id).join(",") ===
      "high-quality-film",
    "after settle, hidden rows must stay off the grid"
  );
  assert(
    catalogSkillsForDisplay(fallback, true).length === 2,
    "a failed fetch that keeps the fallback must still show it once ready"
  );

  const grid = readFileSync(
    new URL("../app/(app)/tools/skills/SkillsGrid.tsx", import.meta.url),
    "utf8"
  );
  assert(
    grid.includes("catalogSkillsForDisplay"),
    "SkillsGrid must gate tiles through catalogSkillsForDisplay so the fallback cannot flash"
  );
  const featured = readFileSync(
    new URL("../app/(app)/tools/skills/FeaturedSkillsRow.tsx", import.meta.url),
    "utf8"
  );
  assert(
    featured.includes("catalogSkillsForDisplay"),
    "FeaturedSkillsRow must gate chips through catalogSkillsForDisplay so the fallback cannot flash"
  );
}

if (require.main === module) {
  skillsCatalogDisplaySelfCheck();
  console.log("skillsCatalogDisplaySelfCheck: ok");
}

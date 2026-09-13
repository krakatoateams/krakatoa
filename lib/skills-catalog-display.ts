/**
 * What the Skills catalog UI may paint for a given provider snapshot.
 *
 * The provider seeds the code catalog (`SKILLS`) until `/api/skills` settles.
 * Painting that fallback is the flicker: tiles appear, then vanish when the
 * live list omits hidden / tombstoned rows. Hold the grid empty (skeletons)
 * until `ready`, then show the settled visible list — including the code
 * fallback when the fetch failed and the provider kept it.
 */
export function catalogSkillsForDisplay<T extends { hidden?: boolean }>(
  skills: T[],
  ready: boolean
): T[] {
  if (!ready) return [];
  return skills.filter((skill) => !skill.hidden);
}

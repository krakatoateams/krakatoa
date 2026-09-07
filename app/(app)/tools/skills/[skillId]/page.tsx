import { notFound, redirect } from "next/navigation";
import { getSkill, skillHref } from "@/lib/skills";

/** Legacy per-skill URLs land on the omni form with that skill selected. */
export default function SkillDetailRedirect({ params }: { params: { skillId: string } }) {
  const skill = getSkill(params.skillId);
  if (!skill) notFound();
  redirect(skillHref(skill.id));
}

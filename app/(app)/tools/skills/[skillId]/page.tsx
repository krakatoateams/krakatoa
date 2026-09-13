import { notFound, redirect } from "next/navigation";
import { getSkill, skillHref } from "@/lib/skills";

/** Legacy per-skill URLs land on the omni form with that skill selected. */
export default async function SkillDetailRedirect({
  params,
}: {
  params: Promise<{ skillId: string }>;
}) {
  const { skillId } = await params;
  const skill = getSkill(skillId);
  if (!skill) notFound();
  redirect(skillHref(skill.id));
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import PageContainer from "@/app/(app)/dashboard/PageContainer";
import { useCurrentUser } from "@/lib/auth-context";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { skillHref } from "@/lib/skills";
import { SkillsGrid } from "./SkillsGrid";
import { SkillModifyPanel, type SkillEditorKind } from "./SkillModifyPanel";
import { SkillsCatalogProvider, useSkillsCatalog, type CatalogSkill } from "./SkillsCatalogProvider";

function SkillsCatalogBody() {
  const router = useRouter();
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
  const { isAdmin, refresh } = useSkillsCatalog();
  const [panel, setPanel] = useState<{
    kind: SkillEditorKind;
    skill: CatalogSkill | null;
  } | null>(null);

  const openUserCreate = () => {
    if (status !== "authenticated") {
      openSignInModal("/tools/skills");
      return;
    }
    setPanel({ kind: "user", skill: null });
  };

  return (
    <>
      <div className="mb-10">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h1 className="min-w-0 bg-gradient-to-b from-N900 to-N500 bg-clip-text font-display text-4xl font-bold tracking-tight text-transparent">
            Skills
          </h1>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {isAdmin ? (
            <button
              type="button"
              onClick={() => setPanel({ kind: "master", skill: null })}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-sm font-semibold text-N900 transition hover:bg-white/10"
            >
              Master skill (admin)
            </button>
          ) : null}
          <button
            type="button"
            onClick={openUserCreate}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-semibold text-N0 transition hover:bg-white/90"
          >
            <Plus className="h-4 w-4" />
            Add skill
          </button>
          </div>
        </div>
        <p className="max-w-xl text-body-3 text-text-secondary">
          Pick a recipe to generate from the Agent form. Skills you add stay on your
          account under Your skills.
        </p>
      </div>

      <SkillsGrid
        onSelect={(skill) => router.push(skillHref(skill.id))}
        onModify={(skill) =>
          setPanel({ kind: skill.owned ? "user" : "master", skill })
        }
      />

      {panel ? (
        <SkillModifyPanel
          kind={panel.kind}
          skill={panel.skill}
          onClose={() => setPanel(null)}
          onSaved={async () => {
            setPanel(null);
            await refresh();
          }}
        />
      ) : null}
    </>
  );
}

export default function SkillsCatalog() {
  return (
    <PageContainer>
      <SkillsCatalogProvider>
        <SkillsCatalogBody />
      </SkillsCatalogProvider>
    </PageContainer>
  );
}

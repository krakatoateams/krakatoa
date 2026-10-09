"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { AdminToast, useAdminToast } from "../admin-ui";
import type { DashboardTemplateKind } from "@/lib/dashboard-templates-pure";
import { useVideoDurationSec } from "@/lib/use-video-duration";

type TemplateRow = {
  slug: string;
  kind: DashboardTemplateKind;
  title: string;
  videoUrl: string;
  generationVideoUrl: string;
  prompt: string;
  characterThumbUrl: string;
  useSkill: boolean;
  skillId: string;
  durationSec: number | null;
  isActive: boolean;
  isNew?: boolean;
};

type ApiTemplate = {
  slug: string;
  kind: DashboardTemplateKind;
  title?: string;
  videoUrl: string;
  generationVideoUrl?: string;
  prompt?: string;
  characterThumbUrl?: string;
  skillId?: string;
  durationSec?: number;
  isActive: boolean;
};

type SkillOption = {
  id: string;
  title: string;
  mediaType: string;
};

const INPUT =
  "w-full rounded-md border border-white/10 bg-white/[0.02] px-2 py-1.5 text-sm text-white outline-none focus:border-white/30";

function toRow(template: ApiTemplate): TemplateRow {
  return {
    slug: template.slug,
    kind: template.kind,
    title: template.title ?? "",
    videoUrl: template.videoUrl,
    generationVideoUrl: template.generationVideoUrl ?? "",
    prompt: template.prompt ?? "",
    characterThumbUrl: template.characterThumbUrl ?? "",
    useSkill: Boolean(template.skillId?.trim()),
    skillId: template.skillId ?? "",
    durationSec: template.durationSec ?? null,
    isActive: template.isActive,
  };
}

function TemplateDurationStandard({
  videoUrl,
  durationSec,
  onDurationSec,
}: {
  videoUrl: string;
  durationSec: number | null;
  onDurationSec: (next: number | null) => void;
}) {
  const { durationSec: measuredSec, measuring, failed } = useVideoDurationSec(videoUrl);

  useEffect(() => {
    if (measuredSec == null) return;
    const rounded = Math.max(1, Math.round(measuredSec));
    if (durationSec !== rounded) onDurationSec(rounded);
  }, [durationSec, measuredSec, onDurationSec]);

  useEffect(() => {
    if (!videoUrl.trim()) onDurationSec(null);
  }, [videoUrl, onDurationSec]);

  let message = "Paste a preview URL to measure duration.";
  if (videoUrl.trim()) {
    if (measuring) message = "Measuring from preview video…";
    else if (failed) message = "Could not read duration from this preview URL.";
    else if (durationSec) message = `${durationSec}s standard — users cannot change clip length.`;
  }

  return (
    <div className="space-y-1 md:col-span-2">
      <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
        Duration standard
      </span>
      <p className="rounded-md border border-white/10 bg-white/[0.02] px-2 py-1.5 text-sm text-gray-300">
        {message}
      </p>
    </div>
  );
}

function slugFromUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return `template-${Date.now()}`;
  try {
    const pathname = new URL(trimmed).pathname;
    const file = pathname.split("/").filter(Boolean).pop();
    if (file) return file.replace(/[^\w.-]+/g, "-").slice(0, 120);
  } catch {
    const file = trimmed.split("/").filter(Boolean).pop();
    if (file) return file.replace(/[^\w.-]+/g, "-").slice(0, 120);
  }
  return `template-${Date.now()}`;
}

function CarouselEditor({
  kind,
  title,
  description,
}: {
  kind: DashboardTemplateKind;
  title: string;
  description: string;
}) {
  const { toast, show, dismiss } = useAdminToast();
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [initial, setInitial] = useState<TemplateRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [skillOptions, setSkillOptions] = useState<SkillOption[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/dashboard-templates?kind=${kind}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
        const next = (data.templates as ApiTemplate[]).map(toRow);
        setRows(next);
        setInitial(next);
      })
      .catch((e: unknown) => {
        show({ type: "error", message: e instanceof Error ? e.message : "Failed to load templates." });
        setRows([]);
        setInitial([]);
      })
      .finally(() => setLoading(false));
  }, [kind, show]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (kind !== "viral") {
      setSkillOptions([]);
      return;
    }
    let cancelled = false;
    fetch("/api/admin/skills", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json() as Promise<{ skills?: SkillOption[] }>;
      })
      .then((data) => {
        if (cancelled || !data?.skills) return;
        setSkillOptions(
          [...data.skills].sort((a, b) => a.title.localeCompare(b.title))
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const dirty = useMemo(
    () => !!rows && !!initial && JSON.stringify(rows) !== JSON.stringify(initial),
    [rows, initial]
  );

  const patch = (index: number, patchValue: Partial<TemplateRow>) => {
    setRows((prev) =>
      prev ? prev.map((row, i) => (i === index ? { ...row, ...patchValue } : row)) : prev
    );
  };

  const move = (index: number, delta: -1 | 1) => {
    setRows((prev) => {
      if (!prev) return prev;
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const addRow = () => {
    const newRow: TemplateRow = {
      slug: "",
      kind,
      title: "",
      videoUrl: "",
      generationVideoUrl: "",
      prompt: "",
      characterThumbUrl: "",
      useSkill: false,
      skillId: "",
      durationSec: null,
      isActive: true,
      isNew: true,
    };
    setRows((prev) => [newRow, ...(prev ?? [])]);
  };

  const removeRow = (index: number) => {
    setRows((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  };

  const save = async () => {
    if (!rows) return;
    if (kind === "viral") {
      const missingSkill = rows.find((row) => row.useSkill && !row.skillId.trim());
      if (missingSkill) {
        show({
          type: "error",
          message: `“${missingSkill.title || "Untitled template"}” uses a skill — pick one from the list.`,
        });
        return;
      }
      const missingPrompt = rows.find((row) => !row.useSkill && !row.prompt.trim());
      if (missingPrompt) {
        show({
          type: "error",
          message: `“${missingPrompt.title || "Untitled template"}” needs a generation prompt.`,
        });
        return;
      }
    }
    setSaving(true);
    show({ type: "loading", message: "Saving templates…" });
    try {
      const res = await fetch("/api/admin/dashboard-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          templates: rows.map((row, index) => ({
            slug: row.slug.trim() || slugFromUrl(row.videoUrl),
            kind,
            title: row.title,
            videoUrl: row.videoUrl,
            generationVideoUrl: row.generationVideoUrl || undefined,
            prompt: row.useSkill ? undefined : row.prompt || undefined,
            characterThumbUrl: row.characterThumbUrl || undefined,
            skillId: row.useSkill ? row.skillId.trim() || undefined : undefined,
            durationSec: row.durationSec ?? undefined,
            isActive: row.isActive,
            sortOrder: index,
          })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      const next = (data.templates as ApiTemplate[]).map(toRow);
      setRows(next);
      setInitial(next);
      show({ type: "success", message: "Templates saved." });
    } catch (e) {
      show({ type: "error", message: e instanceof Error ? e.message : "Failed to save templates." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-400">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white transition-colors hover:bg-white/[0.06]"
          >
            <Plus className="h-4 w-4" />
            Add template
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-black transition-opacity disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading templates…</p>
      ) : !rows || rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-gray-500">
          No templates yet. Add one with a Cloudflare / CDN preview link.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div
              key={`${row.slug}-${index}`}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label="Move up"
                    className="rounded p-1 text-gray-400 hover:text-white disabled:opacity-30"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === rows.length - 1}
                    aria-label="Move down"
                    className="rounded p-1 text-gray-400 hover:text-white disabled:opacity-30"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <span className="ml-2 text-xs uppercase tracking-wider text-gray-500">
                    #{index + 1}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={row.isActive}
                      onChange={(e) => patch(index, { isActive: e.target.checked })}
                    />
                    Active
                  </label>
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    aria-label="Delete template"
                    className="rounded p-1 text-gray-400 transition-colors hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-[minmax(140px,200px)_minmax(0,1fr)] lg:grid-cols-[minmax(160px,220px)_minmax(0,1fr)]">
                <div className="mx-auto w-full max-w-[220px] md:mx-0">
                  {row.videoUrl ? (
                    <div className="aspect-[9/16] overflow-hidden rounded-lg border border-white/10 bg-black/40">
                      <video
                        src={row.videoUrl}
                        muted
                        loop
                        playsInline
                        controls
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="flex aspect-[9/16] items-center justify-center rounded-lg border border-dashed border-white/10 bg-black/20 px-3 text-center text-xs text-gray-500">
                      Paste a preview URL to see the clip
                    </div>
                  )}
                </div>

                <div className="grid min-w-0 gap-3 md:grid-cols-2">
                  {kind === "viral" ? (
                    <div className="grid gap-3 md:col-span-2 md:grid-cols-[minmax(0,1fr)_minmax(220px,280px)]">
                      <label className="space-y-1">
                        <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
                          Title
                        </span>
                        <input
                          value={row.title}
                          onChange={(e) => patch(index, { title: e.target.value })}
                          placeholder="Helicopter golden hour"
                          className={INPUT}
                        />
                      </label>
                      <div className="space-y-1">
                        <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
                          Skill handoff
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={row.useSkill}
                            title="Use skill instead of Viral Template"
                            aria-label="Use skill instead of Viral Template"
                            className="shrink-0"
                            onChange={(e) =>
                              patch(index, {
                                useSkill: e.target.checked,
                                ...(e.target.checked ? {} : { skillId: "" }),
                              })
                            }
                          />
                          {row.useSkill ? (
                            <select
                              value={row.skillId}
                              onChange={(e) => patch(index, { skillId: e.target.value })}
                              className={`${INPUT} min-w-0 flex-1`}
                              required
                            >
                              <option value="">Select a skill…</option>
                              {row.skillId &&
                              !skillOptions.some((skill) => skill.id === row.skillId) ? (
                                <option value={row.skillId}>{row.skillId} (current)</option>
                              ) : null}
                              {skillOptions.map((skill) => (
                                <option key={skill.id} value={skill.id}>
                                  {skill.title} · {skill.mediaType}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-sm text-gray-500">Viral Template composer</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <label className="space-y-1 md:col-span-2">
                    <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
                      Preview URL (Cloudflare / CDN)
                    </span>
                    <input
                      value={row.videoUrl}
                      onChange={(e) => {
                        const videoUrl = e.target.value;
                        patch(index, {
                          videoUrl,
                          durationSec: null,
                          ...(row.isNew ? { slug: slugFromUrl(videoUrl) } : {}),
                        });
                      }}
                      placeholder="https://cdn.kelolako.com/..."
                      className={INPUT}
                    />
                  </label>
                  {kind === "viral" ? (
                    <TemplateDurationStandard
                      videoUrl={row.videoUrl}
                      durationSec={row.durationSec}
                      onDurationSec={(next) => patch(index, { durationSec: next })}
                    />
                  ) : null}
                  {kind === "motion_control" ? (
                    <label className="space-y-1 md:col-span-2">
                      <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
                        Generation URL (optional MP4)
                      </span>
                      <input
                        value={row.generationVideoUrl}
                        onChange={(e) => patch(index, { generationVideoUrl: e.target.value })}
                        placeholder="https://cdn.kelolako.com/.../clip.mp4"
                        className={INPUT}
                      />
                    </label>
                  ) : null}
                  {kind === "viral" ? (
                    <>
                      {!row.useSkill ? (
                        <label className="space-y-1 md:col-span-2">
                          <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
                            Generation prompt
                          </span>
                          <textarea
                            value={row.prompt}
                            onChange={(e) => patch(index, { prompt: e.target.value })}
                            rows={4}
                            placeholder="Cinematic vertical shot of the person in [Image1]…"
                            className={`${INPUT} min-h-[96px] resize-y`}
                          />
                        </label>
                      ) : null}
                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
                          Character thumb URL (optional)
                        </span>
                        <input
                          value={row.characterThumbUrl}
                          onChange={(e) => patch(index, { characterThumbUrl: e.target.value })}
                          placeholder="/viral-templates/character-thumb.webp"
                          className={INPUT}
                        />
                      </label>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast ? <AdminToast toast={toast} onDismiss={dismiss} /> : null}
    </section>
  );
}

export default function AdminTemplatesPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Dashboard templates</h1>
        <p className="mt-2 max-w-3xl text-sm text-gray-400">
          Manage the Viral templates and Motion control carousels on the dashboard. Paste
          Cloudflare / CDN links for previews — no upload needed. Reorder with the arrows,
          then save each section.
        </p>
      </div>

      <CarouselEditor
        kind="viral"
        title="Viral templates"
        description="Shown in the left dashboard carousel. Each card opens the Viral Template composer unless a skill ID is set."
      />
      <CarouselEditor
        kind="motion_control"
        title="Motion control"
        description="Shown in the right dashboard carousel. Preview URL is used in the UI; generation URL is sent to the model when different."
      />
    </div>
  );
}

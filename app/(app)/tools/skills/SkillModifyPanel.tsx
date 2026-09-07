"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, Loader2, Trash2, X } from "lucide-react";
import {
  SKILL_CATEGORIES,
  SKILL_INPUT_DEFAULTS,
  SKILL_INPUT_KEYS,
  defaultSkillInputs,
  defaultSkillRecipe,
  getSkill,
  isSkillId,
  type SkillCategoryId,
  type SkillInputKey,
  type SkillInputSlot,
  type SkillMediaType,
} from "@/lib/skills";
import type { CatalogSkill } from "./SkillsCatalogProvider";

export type SkillEditorKind = "user" | "master";

type SlotState = "off" | "optional" | "required";

function slotState(inputs: SkillInputSlot[], key: string): SlotState {
  const slot = inputs.find((s) => s.key === key);
  if (!slot) return "off";
  return slot.required ? "required" : "optional";
}

function inputsFromStates(
  mediaType: SkillMediaType,
  states: Record<SkillInputKey, SlotState>,
  previous: SkillInputSlot[]
): SkillInputSlot[] {
  const out: SkillInputSlot[] = [];
  for (const key of SKILL_INPUT_KEYS) {
    if (SKILL_INPUT_DEFAULTS[key].mediaType !== mediaType) continue;
    const state = states[key];
    if (state === "off") continue;
    const prev = previous.find((s) => s.key === key);
    out.push({
      key,
      label: prev?.label || SKILL_INPUT_DEFAULTS[key].label,
      required: state === "required",
    });
  }
  return out;
}

function emptyStates(mediaType: SkillMediaType, inputs: SkillInputSlot[]): Record<SkillInputKey, SlotState> {
  return {
    startFrame: mediaType === "video" ? slotState(inputs, "startFrame") : "off",
    subject: mediaType === "image" ? slotState(inputs, "subject") : "off",
    scene: mediaType === "image" ? slotState(inputs, "scene") : "off",
    character: mediaType === "image" ? slotState(inputs, "character") : "off",
  };
}

export function SkillModifyPanel({
  skill,
  kind,
  onClose,
  onSaved,
}: {
  skill: CatalogSkill | null;
  kind: SkillEditorKind;
  onClose: () => void;
  onSaved: (skill: CatalogSkill | null) => void;
}) {
  const creating = skill === null;
  const isUser = kind === "user" || Boolean(skill?.owned);
  const catalogBase = skill && isSkillId(skill.id) ? getSkill(skill.id) : undefined;
  const [title, setTitle] = useState(skill?.title ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [promptPlaceholder, setPromptPlaceholder] = useState(
    skill?.promptPlaceholder?.trim() || catalogBase?.promptPlaceholder || ""
  );
  const [recipe, setRecipe] = useState(
    skill?.recipe?.trim() ||
      (skill && isSkillId(skill.id) ? defaultSkillRecipe(skill.id) : "{prompt}")
  );
  const [category, setCategory] = useState<SkillCategoryId>(skill?.category ?? "storytelling");
  const [badgeNew, setBadgeNew] = useState(skill?.badge === "new");
  const [promptRequired, setPromptRequired] = useState(skill?.promptRequired ?? true);
  const [mediaType, setMediaType] = useState<SkillMediaType>(skill?.mediaType ?? "image");
  const [slots, setSlots] = useState<Record<SkillInputKey, SlotState>>(() =>
    emptyStates(skill?.mediaType ?? "image", skill?.inputs ?? defaultSkillInputs("image"))
  );
  const [thumbPreview, setThumbPreview] = useState(skill?.thumb ?? "");
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const builtin = !!skill && isSkillId(skill.id);
  const writeBase = isUser ? "/api/skills" : "/api/admin/skills";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const pickThumb = (file: File | null) => {
    if (!file) return;
    setThumbFile(file);
    setThumbPreview(URL.createObjectURL(file));
  };

  const setMedia = (next: SkillMediaType) => {
    setMediaType(next);
    setSlots(emptyStates(next, defaultSkillInputs(next)));
  };

  const payload = () => {
    const body: Record<string, unknown> = {
      title,
      description,
      promptPlaceholder,
      recipe,
      promptRequired,
      mediaType,
      inputs: inputsFromStates(mediaType, slots, skill?.inputs ?? []),
    };
    if (!isUser) {
      body.category = category;
      body.badge = badgeNew ? "new" : null;
    }
    return body;
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      let skillId = skill?.id;
      if (creating) {
        const res = await fetch(writeBase, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload()),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Create failed.");
        skillId = (data.skill as CatalogSkill).id;
      }

      if (!skillId) throw new Error("Missing skill id.");

      if (thumbFile) {
        const body = new FormData();
        body.append("file", thumbFile);
        const uploaded = await fetch(`${writeBase}/${skillId}/thumb`, {
          method: "POST",
          body,
        });
        const data = await uploaded.json().catch(() => ({}));
        if (!uploaded.ok) throw new Error(data.error || "Thumbnail upload failed.");
      }

      if (!creating) {
        const body = payload();
        if (builtin) {
          const { mediaType: _mediaType, ...rest } = body;
          void _mediaType;
          const res = await fetch(`${writeBase}/${skillId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(rest),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Save failed.");
          onSaved(data.skill as CatalogSkill);
          return;
        }
        const res = await fetch(`${writeBase}/${skillId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Save failed.");
        onSaved(data.skill as CatalogSkill);
        return;
      }

      const refreshed = await fetch(`${writeBase}/${skillId}`);
      const data = await refreshed.json().catch(() => ({}));
      onSaved((data.skill as CatalogSkill) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const revert = async () => {
    if (!skill) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${writeBase}/${skill.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revert: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Reset failed.");
      onSaved((data.skill as CatalogSkill) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!skill) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${writeBase}/${skill.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Delete failed.");
      onSaved(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setSaving(false);
      setConfirmDelete(false);
    }
  };

  if (typeof document === "undefined") return null;

  const slotKeys = SKILL_INPUT_KEYS.filter(
    (key) => SKILL_INPUT_DEFAULTS[key].mediaType === mediaType
  );

  return createPortal(
    <div
      data-skill-admin-edit
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-N0/70 px-4 py-10 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-3xl rounded-2xl border border-white/10 bg-N50 p-5 shadow-2xl shadow-N0/50">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-text-disabled">
              {isUser ? "Your skill" : "Master skill (admin)"}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-N900">
              {creating ? (isUser ? "Add a skill" : "Add a master skill") : skill.title}
            </h2>
            {isUser ? (
              <p className="mt-1 text-sm text-text-secondary">
                Only you can see this skill. It lives under Your skills.
              </p>
            ) : (
              <p className="mt-1 text-sm text-text-secondary">
                Stays in the shared catalog for everyone.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-secondary hover:bg-white/10 hover:text-N900"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-text-disabled">
              Thumbnail
            </p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="group relative h-24 w-24 overflow-hidden rounded-xl bg-white/5"
            >
              {thumbPreview ? (
                <img src={thumbPreview} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-text-disabled">
                  <ImagePlus className="h-5 w-5" />
                </span>
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-N0/50 opacity-0 transition-opacity group-hover:opacity-100">
                <ImagePlus className="h-5 w-5 text-N900" />
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => pickThumb(e.target.files?.[0] ?? null)}
            />
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-text-disabled">
              Title
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-N900 outline-none focus:border-white/25"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-text-disabled">
              Description
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={280}
              className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-N900 outline-none focus:border-white/25"
            />
          </label>

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-text-disabled">
              Output
            </p>
            <div className="flex gap-2">
              {(["image", "video"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  disabled={builtin}
                  onClick={() => setMedia(kind)}
                  className={`rounded-xl px-3 py-1.5 text-sm capitalize ${
                    mediaType === kind
                      ? "bg-white text-N0"
                      : "bg-white/5 text-text-secondary hover:bg-white/10"
                  } disabled:opacity-40`}
                >
                  {kind}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-text-disabled">
              Mandatory data
            </p>
            <p className="mb-2 text-xs text-text-secondary">
              Mark which inputs the user must provide before generating.
            </p>
            <label className="mb-2 flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2 text-sm text-text-primary">
              <span>Prompt</span>
              <input
                type="checkbox"
                checked={promptRequired}
                onChange={(e) => setPromptRequired(e.target.checked)}
                className="rounded border-white/20 bg-white/5"
              />
            </label>
            <div className="flex flex-col gap-2">
              {slotKeys.map((key) => (
                <label
                  key={key}
                  className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2 text-sm text-text-primary"
                >
                  <span>{SKILL_INPUT_DEFAULTS[key].label}</span>
                  <select
                    value={slots[key]}
                    onChange={(e) =>
                      setSlots((prev) => ({ ...prev, [key]: e.target.value as SlotState }))
                    }
                    className="rounded-lg border border-white/10 bg-N50 px-2 py-1 text-xs text-N900 outline-none"
                  >
                    <option value="off">Hidden</option>
                    <option value="optional">Optional</option>
                    <option value="required">Required</option>
                  </select>
                </label>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-text-disabled">
              Prompt placeholder
            </span>
            <input
              value={promptPlaceholder}
              onChange={(e) => setPromptPlaceholder(e.target.value)}
              maxLength={240}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-N900 outline-none focus:border-white/25"
            />
          </label>

          {isUser ? null : (
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-text-disabled">
              Category
            </span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as SkillCategoryId)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-N900 outline-none focus:border-white/25"
            >
              {SKILL_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          )}

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-text-disabled">
              Skill recipe
            </span>
            <p className="mb-1.5 text-xs text-text-secondary">
              Instructions the model follows. Use <code className="text-N900">{"{prompt}"}</code>{" "}
              where the user&apos;s text should go — this is how the skill works.
            </p>
            <textarea
              value={recipe}
              onChange={(e) => setRecipe(e.target.value)}
              rows={10}
              maxLength={8000}
              className="w-full resize-y rounded-xl border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs leading-relaxed text-N900 outline-none focus:border-white/25"
            />
          </label>

          {isUser ? null : (
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={badgeNew}
              onChange={(e) => setBadgeNew(e.target.checked)}
              className="rounded border-white/20 bg-white/5"
            />
            Show “New” badge
          </label>
          )}

          {error ? <p className="text-sm text-error">{error}</p> : null}

          <div className="flex items-center justify-between gap-3 pt-1">
            {!creating ? (
              <div className="flex flex-col items-start gap-1">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={remove}
                    disabled={saving}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm disabled:opacity-40 ${
                      confirmDelete
                        ? "bg-error text-white hover:bg-error"
                        : "text-text-secondary hover:bg-error/10 hover:text-error"
                    }`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {confirmDelete ? "Confirm delete" : "Delete"}
                  </button>
                  {builtin && !isUser ? (
                    <button
                      type="button"
                      onClick={revert}
                      disabled={saving}
                      className="text-sm text-text-secondary hover:text-N900 disabled:opacity-40"
                    >
                      Reset to catalog
                    </button>
                  ) : null}
                </div>
                {confirmDelete ? (
                  <p className="text-[11px] text-text-disabled">
                    Removes this skill {skill?.owned ? "from your account" : "for everyone"}. This
                    cannot be undone.
                  </p>
                ) : null}
              </div>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-3 py-2 text-sm text-text-secondary hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || !title.trim() || !recipe.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-N0 transition hover:bg-white/90 disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {creating ? "Create" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

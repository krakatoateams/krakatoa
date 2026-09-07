"use client";

import { useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { FolderKanban, Loader2, Pencil, Save } from "lucide-react";
import CreditBadge from "@/components/CreditBadge";
import { GENERATE_BTN_CLASS } from "@/components/studio/CreditButton";
import { GenerationCancelButton } from "@/components/studio/GenerationCancelButton";
import { EDITOR_ASPECTS, EDITOR_MAX_DURATION_SEC, type EditorAspect } from "@/lib/editor-document";

export default function EditorTopBar({
  title,
  dirty,
  saving,
  aspect,
  durationSec,
  exportReady,
  exporting,
  cancelling,
  onTitleChange,
  onTitleCommit,
  onSave,
  onOpen,
  onAspectChange,
  onDurationChange,
  onExport,
  onCancel,
}: {
  title: string;
  dirty: boolean;
  saving: boolean;
  aspect: EditorAspect;
  durationSec: number;
  exportReady: boolean;
  exporting: boolean;
  cancelling: boolean;
  onTitleChange: (title: string) => void;
  onTitleCommit: (title: string) => void;
  onSave: () => void;
  onOpen: () => void;
  onAspectChange: (aspect: EditorAspect) => void;
  onDurationChange: (durationSec: number) => void;
  onExport: () => void;
  onCancel: () => void;
}) {
  const titleRef = useRef<HTMLInputElement>(null);
  const titleAtFocus = useRef(title);
  const skipBlurCommit = useRef(false);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-N50 px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/dashboard" aria-label="Back to dashboard" className="flex shrink-0 items-center gap-2">
          <Image
            src="/Logo White transparent.svg"
            alt=""
            width={24}
            height={24}
            className="h-6 w-6 object-contain"
          />
          <span className="hidden font-display text-sm font-black uppercase tracking-[-0.4px] text-white sm:inline">
            KELOLAKO
          </span>
        </Link>
        <span className="h-4 w-px shrink-0 bg-white/10" aria-hidden />
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            title="Rename edit"
            aria-label="Rename edit"
            onClick={() => {
              const input = titleRef.current;
              if (!input) return;
              input.focus();
              input.select();
            }}
            className="rounded-md p-1 text-icon-low-emphasis transition-colors hover:bg-white/10 hover:text-text-primary"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <input
            ref={titleRef}
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            onFocus={() => {
              titleAtFocus.current = title;
            }}
            onBlur={(event) => {
              if (skipBlurCommit.current) {
                skipBlurCommit.current = false;
                return;
              }
              onTitleCommit(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                skipBlurCommit.current = true;
                onTitleChange(titleAtFocus.current);
                event.currentTarget.blur();
              }
            }}
            maxLength={80}
            aria-label="Edit name"
            className="min-w-0 max-w-[36vw] truncate rounded-lg bg-transparent px-1.5 py-1 text-sm font-semibold text-text-primary outline-none placeholder:text-text-secondary hover:bg-white/10 focus:bg-white/10 sm:max-w-xs"
            placeholder="Untitled edit"
          />
          {dirty ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-primary" title="Unsaved changes" />
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <label className="hidden items-center gap-1 sm:flex">
          <span className="text-[11px] font-medium text-text-secondary">Duration</span>
          <input
            type="number"
            min={0.1}
            max={EDITOR_MAX_DURATION_SEC}
            step={0.1}
            value={durationSec}
            onChange={(event) => onDurationChange(Number(event.target.value) || 0.1)}
            aria-label="Video duration in seconds"
            className="h-8 w-[4.25rem] rounded-lg bg-white/10 px-2 text-xs font-semibold tabular-nums text-text-primary outline-none hover:bg-white/15 focus:bg-white/15"
          />
          <span className="text-[11px] text-text-secondary">s</span>
        </label>
        <div className="hidden items-center gap-0.5 rounded-lg bg-white/5 p-0.5 sm:flex">
          {EDITOR_ASPECTS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onAspectChange(value)}
              className={`rounded-md px-2 py-1 text-[11px] font-semibold tabular-nums ${
                aspect === value
                  ? "bg-white/15 text-text-primary"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {value}
            </button>
          ))}
        </div>
        <CreditBadge
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-text-secondary transition-colors hover:bg-white/10 hover:text-text-primary"
          iconClassName="h-4 w-4"
        />
        <button
          type="button"
          onClick={onOpen}
          title="Open a saved edit"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-text-secondary transition-colors hover:bg-white/10 hover:text-text-primary"
        >
          <FolderKanban className="h-4 w-4" />
          <span className="hidden sm:inline">Open</span>
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty}
          title="Save edit (⌘S)"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 text-xs font-semibold text-text-primary transition-colors hover:bg-white/15 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? "Saving" : dirty ? "Save" : "Saved"}
        </button>
        <GenerationCancelButton
          visible={exporting}
          cancelling={cancelling}
          cancelAllowed
          onCancel={onCancel}
        />
        {!exporting ? (
          <button
            type="button"
            onClick={onExport}
            disabled={!exportReady}
            className={`${GENERATE_BTN_CLASS} h-8 px-4 text-xs`}
          >
            Export
          </button>
        ) : null}
      </div>
    </header>
  );
}

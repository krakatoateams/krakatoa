"use client";

import { useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { FolderKanban, Loader2, Pencil, Save, X } from "lucide-react";
import CreditBadge from "@/components/CreditBadge";

export default function CanvasTopBar({
  title,
  dirty,
  saving,
  onTitleChange,
  onTitleCommit,
  onSave,
  onOpen,
}: {
  title: string;
  dirty: boolean;
  saving: boolean;
  onTitleChange: (title: string) => void;
  onTitleCommit: (title: string) => void;
  onSave: () => void;
  onOpen: () => void;
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
            title="Rename canvas"
            aria-label="Rename canvas"
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
            aria-label="Canvas name"
            className="min-w-0 max-w-[42vw] truncate rounded-lg bg-transparent px-1.5 py-1 text-sm font-semibold text-text-primary outline-none placeholder:text-text-secondary hover:bg-white/10 focus:bg-white/10 sm:max-w-xs"
            placeholder="Untitled canvas"
          />
          {dirty ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-primary" title="Unsaved changes" />
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <CreditBadge
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-text-secondary transition-colors hover:bg-white/10 hover:text-text-primary"
          iconClassName="h-4 w-4"
        />
        <button
          type="button"
          onClick={onOpen}
          title="Open a saved canvas"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-text-secondary transition-colors hover:bg-white/10 hover:text-text-primary"
        >
          <FolderKanban className="h-4 w-4" />
          <span className="hidden sm:inline">Open</span>
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty}
          title="Save canvas (⌘S)"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 text-xs font-semibold text-text-primary transition-colors hover:bg-white/15 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? "Saving" : dirty ? "Save" : "Saved"}
        </button>
        <Link
          href="/dashboard"
          aria-label="Close canvas"
          className="rounded-lg p-1.5 text-icon-low-emphasis transition-colors hover:bg-white/10 hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </Link>
      </div>
    </header>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { User, Clapperboard, ImageIcon } from "lucide-react";
import {
  activeMentionQuery,
  escapeRegExp,
  type MentionAsset,
} from "@/lib/mention-assets";

/** Height of the top/bottom scroll fade on the prompt text. */
const EDGE_FADE_PX = 18;

function renderMentionBackdrop(text: string, mentions: MentionAsset[]): React.ReactNode {
  if (!mentions.length) return text;
  const names = [...mentions].sort((a, b) => b.name.length - a.name.length);
  const pattern = new RegExp(`@(?:${names.map((m) => escapeRegExp(m.name)).join("|")})`, "g");
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(
      <span
        key={key++}
        className="rounded bg-white/20 text-N900 shadow-[0_0_0_2px_rgba(255,255,255,0.25)]"
      >
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
  }
  nodes.push(text.slice(last));
  if (text.endsWith("\n")) nodes.push("\u200b");
  return nodes;
}

function KindBadge({ kind }: { kind: MentionAsset["kind"] }) {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-xs uppercase tracking-wide text-text-secondary">
      {kind === "character" ? (
        <User className="h-3 w-3" />
      ) : kind === "storyboard" ? (
        <Clapperboard className="h-3 w-3" />
      ) : (
        <ImageIcon className="h-3 w-3" />
      )}
      {kind}
    </span>
  );
}

/** Prompt textarea with @-mention support for saved characters, storyboards, and photo images. */
export default function MentionTextarea({
  value,
  onChange,
  mentions,
  onMentionsChange,
  assets,
  placeholder,
  rows = 2,
  maxLines = 5,
  disabled,
  className = "min-h-[48px]",
  maxLength,
}: {
  value: string;
  onChange: (next: string) => void;
  mentions: MentionAsset[];
  onMentionsChange: (next: MentionAsset[]) => void;
  assets: MentionAsset[];
  placeholder?: string;
  rows?: number;
  /** Tallest the box may auto-grow before it starts scrolling. */
  maxLines?: number;
  disabled?: boolean;
  className?: string;
  maxLength?: number;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const bdRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  // Which edges have text hidden past them — drives the scroll fade.
  const [fade, setFade] = useState({ top: false, bottom: false });

  const syncFade = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    const scrollable = el.scrollHeight - el.clientHeight;
    const top = el.scrollTop > 1;
    const bottom = scrollable > 1 && el.scrollTop < scrollable - 1;
    setFade((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
  }, []);

  // Grow with the text: `rows` stays the floor, `maxLines` the ceiling, and past
  // that the textarea scrolls (the backdrop follows via onScroll).
  const autosize = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    const cs = window.getComputedStyle(el);
    const line = Number.parseFloat(cs.lineHeight) || 24;
    const frame =
      Number.parseFloat(cs.paddingTop) +
      Number.parseFloat(cs.paddingBottom) +
      Number.parseFloat(cs.borderTopWidth) +
      Number.parseFloat(cs.borderBottomWidth);
    const minHeight = line * rows + frame;
    const maxHeight = line * Math.max(maxLines, rows) + frame;
    // Measure unconstrained first — once a height is set, scrollHeight can no
    // longer report how tall the content actually wants to be.
    el.style.height = "auto";
    const content = el.scrollHeight;
    el.style.height = `${Math.min(Math.max(content, minHeight), maxHeight)}px`;
    el.style.overflowY = content > maxHeight ? "auto" : "hidden";
    syncFade();
  }, [rows, maxLines, syncFade]);

  // Re-measure on every value change (typing, mention inserts, programmatic
  // resets) and whenever the width changes, since wrapping shifts line count.
  useEffect(autosize, [autosize, value]);
  useEffect(() => {
    window.addEventListener("resize", autosize);
    return () => window.removeEventListener("resize", autosize);
  }, [autosize]);

  const matches =
    query === null
      ? []
      : assets
          .filter((a) => {
            const q = query.toLowerCase();
            return q === "" || a.name.toLowerCase().includes(q);
          })
          .slice(0, 6);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    onChange(v);
    onMentionsChange(mentions.filter((m) => v.includes(`@${m.name}`)));
    setQuery(activeMentionQuery(v, e.target.selectionStart ?? v.length));
    setIndex(0);
  };

  const insert = (asset: MentionAsset) => {
    const el = taRef.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const replaced = before.replace(
      /(^|\s)@([^\s@]*)$/,
      (_m, lead: string) => `${lead}@${asset.name} `
    );
    onChange(replaced + after);
    if (!mentions.some((m) => m.id === asset.id)) onMentionsChange([...mentions, asset]);
    setQuery(null);
    setIndex(0);
    requestAnimationFrame(() => {
      const pos = replaced.length;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (query === null || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insert(matches[Math.min(index, matches.length - 1)]);
    } else if (e.key === "Escape") {
      setQuery(null);
    }
  };

  // Softens the cut where text runs past the box, on whichever edge is hiding
  // it. Only the text layer is masked, so the caret never fades out.
  const fadeMask =
    fade.top || fade.bottom
      ? `linear-gradient(to bottom, ${[
          fade.top ? `transparent 0px, #000 ${EDGE_FADE_PX}px` : "#000 0px",
          fade.bottom ? `#000 calc(100% - ${EDGE_FADE_PX}px), transparent 100%` : "#000 100%",
        ].join(", ")})`
      : undefined;

  return (
    <div className={`relative flex-1 ${className}`}>
      <div
        ref={bdRef}
        aria-hidden
        style={{ maskImage: fadeMask, WebkitMaskImage: fadeMask }}
        className="pointer-events-none absolute inset-0 min-h-[48px] w-full overflow-hidden whitespace-pre-wrap break-words text-base text-N900"
      >
        {renderMentionBackdrop(value, mentions)}
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onScroll={(e) => {
          if (bdRef.current) bdRef.current.scrollTop = e.currentTarget.scrollTop;
          syncFade();
        }}
        onBlur={() => setTimeout(() => setQuery(null), 120)}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        className="relative min-h-[48px] w-full resize-none whitespace-pre-wrap break-words bg-transparent text-base text-transparent caret-white placeholder:text-text-disabled focus:outline-none"
      />

      {query !== null && matches.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-white/10 bg-N50 p-1.5 shadow-2xl shadow-N0/50">
          {matches.map((asset, i) => (
            <button
              key={asset.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insert(asset);
              }}
              onMouseEnter={() => setIndex(i)}
              className={`flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors ${
                i === index ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset.url} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-N900">
                {asset.name}
              </span>
              <KindBadge kind={asset.kind} />
            </button>
          ))}
        </div>
      )}
      {query !== null && matches.length === 0 && (
        <div className="absolute left-0 top-full z-50 mt-2 w-72 rounded-2xl border border-white/10 bg-N50 px-3 py-2 text-sm text-text-secondary shadow-2xl shadow-N0/50">
          No matching library images.
        </div>
      )}
    </div>
  );
}

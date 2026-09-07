"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Type, ImageIcon, Video, Volume2 } from "lucide-react";
import { activeMentionQuery, escapeRegExp } from "@/lib/mention-assets";
import { CANVAS_KIND_LABELS, type CanvasNodeKind } from "@/lib/canvas-graph";

export type CanvasMentionable = {
  id: string;
  label: string;
  kind: CanvasNodeKind;
};

const ICONS: Record<CanvasNodeKind, typeof Type> = {
  prompt: Type,
  image: ImageIcon,
  video: Video,
  sound: Volume2,
};

const FIELD_TEXT =
  "whitespace-pre-wrap break-words px-3 py-2 text-sm leading-5";

function highlightMentions(text: string, labels: string[]): ReactNode {
  const names = Array.from(
    new Set(labels.map((label) => label.trim()).filter(Boolean))
  ).sort((a, b) => b.length - a.length);
  const nodes: ReactNode[] = [];
  if (!names.length || !text.includes("@")) {
    nodes.push(text);
  } else {
    const pattern = new RegExp(
      `@(?:${names.map((name) => escapeRegExp(name)).join("|")})(?=$|\\s|[.,!?;:])`,
      "g"
    );
    let last = 0;
    let key = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > last) nodes.push(text.slice(last, match.index));
      nodes.push(
        <span key={key++} className="font-bold text-brand-primary">
          {match[0]}
        </span>
      );
      last = match.index + match[0].length;
    }
    nodes.push(text.slice(last));
  }
  if (text.endsWith("\n")) nodes.push("\u200b");
  return nodes;
}

export default function CanvasMentionField({
  value,
  onChange,
  nodes,
  selfId,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  nodes: CanvasMentionable[];
  selfId: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const bdRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const assets = nodes.filter((node) => node.id !== selfId && node.label.trim());
  const names = assets.map((asset) => asset.label);

  const matches =
    query === null
      ? []
      : assets
          .filter((node) => {
            const q = query.toLowerCase();
            return q === "" || node.label.toLowerCase().includes(q);
          })
          .slice(0, 8);

  const insert = useCallback(
    (asset: CanvasMentionable) => {
      const el = taRef.current;
      const caret = el?.selectionStart ?? value.length;
      const before = value.slice(0, caret);
      const after = value.slice(caret);
      const replaced = before.replace(/(^|\s)@([^\s@]*)$/, (_m, lead: string) => `${lead}@${asset.label} `);
      onChange(replaced + after);
      setQuery(null);
      setIndex(0);
      requestAnimationFrame(() => {
        const pos = replaced.length;
        el?.focus();
        el?.setSelectionRange(pos, pos);
      });
    },
    [onChange, value]
  );

  useEffect(() => {
    if (query === null) return;
    setIndex(0);
  }, [query]);

  const syncScroll = () => {
    if (bdRef.current && taRef.current) {
      bdRef.current.scrollTop = taRef.current.scrollTop;
    }
  };

  return (
    <div className="relative mb-2 rounded-xl border border-white/10 bg-white/[0.04] focus-within:border-white/20">
      <div
        ref={bdRef}
        aria-hidden
        className={`pointer-events-none absolute inset-0 overflow-hidden text-text-primary ${FIELD_TEXT}`}
      >
        {highlightMentions(value, names)}
      </div>
      <textarea
        ref={taRef}
        value={value}
        disabled={disabled}
        rows={3}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next);
          setQuery(activeMentionQuery(next, event.target.selectionStart ?? next.length));
          setIndex(0);
        }}
        onScroll={syncScroll}
        onKeyDown={(event) => {
          if (query === null || matches.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setIndex((current) => (current + 1) % matches.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setIndex((current) => (current - 1 + matches.length) % matches.length);
          } else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            insert(matches[Math.min(index, matches.length - 1)]);
          } else if (event.key === "Escape") {
            setQuery(null);
          }
        }}
        onBlur={() => setTimeout(() => setQuery(null), 120)}
        className={`nodrag nowheel relative w-full resize-y bg-transparent text-transparent caret-white outline-none placeholder:text-text-secondary disabled:opacity-60 ${FIELD_TEXT}`}
      />
      {query !== null && matches.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-xl border border-white/10 bg-N50 p-1 shadow-lg shadow-black/50">
          {matches.map((asset, i) => {
            const Icon = ICONS[asset.kind];
            return (
              <button
                key={asset.id}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  insert(asset);
                }}
                onMouseEnter={() => setIndex(i)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium ${
                  i === index ? "bg-white/10 text-text-primary" : "text-text-secondary hover:bg-white/5"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {asset.label}
                <span className="ml-auto text-[10px] uppercase tracking-wide text-text-secondary">
                  {CANVAS_KIND_LABELS[asset.kind]}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

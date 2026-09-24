"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Hand, Maximize2, Minus, MousePointer2, Plus, Redo2, Undo2 } from "lucide-react";
import { EDITOR_VIEWPORT_ZOOM_MAX, EDITOR_VIEWPORT_ZOOM_MIN, clampZoomPercent } from "@/lib/editor-viewport";

export type EditorTool = "select" | "hand";

const ZOOM_PRESETS: Array<{ label: string; value: number | "fit"; shortcut?: string }> = [
  { label: "Zoom to fit", value: "fit", shortcut: "⌘ 0" },
  { label: "50%", value: 50 },
  { label: "100%", value: 100 },
  { label: "200%", value: 200 },
];

export default function EditorPreviewToolbar({
  tool,
  onToolChange,
  zoomPercent,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onSetZoom,
  onFit,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  tool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSetZoom: (percent: number) => void;
  onFit: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(Math.round(zoomPercent)));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) setDraft(String(Math.round(zoomPercent)));
    // Only resync the draft field when the popover opens, so typing isn't clobbered mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const commitDraft = (value: string) => {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && value.trim() !== "") onSetZoom(clampZoomPercent(parsed));
    else setDraft(String(Math.round(zoomPercent)));
  };

  return (
    <div
      ref={rootRef}
      className="pointer-events-auto absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg bg-black/50 p-1 text-white backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={() => onToolChange("select")}
        aria-pressed={tool === "select"}
        aria-label="Select tool"
        title="Select"
        className={`rounded-md p-1.5 hover:bg-white/15 ${tool === "select" ? "bg-white/20" : ""}`}
      >
        <MousePointer2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onToolChange("hand")}
        aria-pressed={tool === "hand"}
        aria-label="Hand tool"
        title="Hand — pan the canvas (hold Space to pan from any tool)"
        className={`rounded-md p-1.5 hover:bg-white/15 ${tool === "hand" ? "bg-white/20" : ""}`}
      >
        <Hand className="h-3.5 w-3.5" />
      </button>

      <span className="mx-0.5 h-4 w-px bg-white/20" aria-hidden />

      <button
        type="button"
        onClick={onZoomOut}
        disabled={!canZoomOut}
        aria-label="Zoom out"
        title="Zoom out (Cmd/Ctrl -)"
        className="rounded-md p-1.5 hover:bg-white/15 disabled:opacity-30"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>

      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="true"
          aria-expanded={open}
          aria-label="Zoom level"
          title="Zoom"
          onClick={() => setOpen((current) => !current)}
          className="flex min-w-[3.5rem] items-center justify-center gap-0.5 rounded-md px-1 py-1.5 text-[11px] tabular-nums hover:bg-white/15"
        >
          {Math.round(zoomPercent)}%
          <ChevronDown className="h-3 w-3 opacity-70" />
        </button>
        {open ? (
          <div
            role="dialog"
            aria-label="Zoom controls"
            className="absolute bottom-full right-0 z-30 mb-2 w-52 rounded-lg border border-white/10 bg-N50 p-3 text-text-primary shadow-xl"
          >
            <div className="mb-2 flex items-center justify-between text-xs font-medium">
              <span>Zoom</span>
              <span className="tabular-nums text-text-secondary">{Math.round(zoomPercent)}%</span>
            </div>
            <input
              type="range"
              min={EDITOR_VIEWPORT_ZOOM_MIN}
              max={EDITOR_VIEWPORT_ZOOM_MAX}
              step={1}
              value={zoomPercent}
              onChange={(event) => onSetZoom(Number(event.target.value))}
              aria-label="Zoom percent slider"
              className="mb-2 w-full accent-brand-primary"
            />
            <div className="mb-3 flex items-center gap-1">
              <input
                type="number"
                min={EDITOR_VIEWPORT_ZOOM_MIN}
                max={EDITOR_VIEWPORT_ZOOM_MAX}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => commitDraft(draft)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  commitDraft(draft);
                }}
                aria-label="Zoom percent"
                className="h-7 w-16 rounded-md bg-white/10 px-2 text-xs tabular-nums text-text-primary outline-none focus:bg-white/15"
              />
              <span className="text-xs text-text-secondary">%</span>
            </div>
            <div className="space-y-0.5">
              {ZOOM_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    if (preset.value === "fit") onFit();
                    else onSetZoom(preset.value);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1 text-xs hover:bg-white/10"
                >
                  <span className="flex items-center gap-1.5">
                    {preset.value === "fit" ? <Maximize2 className="h-3 w-3" /> : null}
                    {preset.label}
                  </span>
                  {preset.shortcut ? (
                    <span className="text-[10px] text-text-secondary">{preset.shortcut}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onZoomIn}
        disabled={!canZoomIn}
        aria-label="Zoom in"
        title="Zoom in (Cmd/Ctrl +)"
        className="rounded-md p-1.5 hover:bg-white/15 disabled:opacity-30"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>

      <span className="mx-0.5 h-4 w-px bg-white/20" aria-hidden />

      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        aria-label="Undo"
        title="Undo (Cmd/Ctrl Z)"
        className="rounded-md p-1.5 hover:bg-white/15 disabled:opacity-30"
      >
        <Undo2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        aria-label="Redo"
        title="Redo (Cmd/Ctrl Shift Z)"
        className="rounded-md p-1.5 hover:bg-white/15 disabled:opacity-30"
      >
        <Redo2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

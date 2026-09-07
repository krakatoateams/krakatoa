import { FolderOpen, ImageIcon, Type, Video, Volume2 } from "lucide-react";
import { CANVAS_KIND_LABELS, type CanvasNodeKind } from "@/lib/canvas-graph";

const ACTIONS: { kind: CanvasNodeKind; label: string; icon: typeof Type }[] = [
  { kind: "prompt", label: CANVAS_KIND_LABELS.prompt, icon: Type },
  { kind: "image", label: CANVAS_KIND_LABELS.image, icon: ImageIcon },
  { kind: "video", label: CANVAS_KIND_LABELS.video, icon: Video },
  { kind: "sound", label: CANVAS_KIND_LABELS.sound, icon: Volume2 },
];

const RAIL_BTN =
  "flex h-10 w-10 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-white/10 hover:text-text-primary";

export default function CanvasToolbar({
  onAdd,
  onOpenLibrary,
}: {
  onAdd: (kind: CanvasNodeKind) => void;
  onOpenLibrary: () => void;
}) {
  return (
    <div className="pointer-events-none absolute right-3 top-1/2 z-10 -translate-y-1/2 sm:right-4">
      <div className="pointer-events-auto flex flex-col items-center gap-1 rounded-2xl border border-white/10 bg-N50/90 p-1.5 shadow-lg shadow-black/40 backdrop-blur-md">
        {ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.kind}
              type="button"
              onClick={() => onAdd(action.kind)}
              title={`Add ${action.label}`}
              aria-label={`Add ${action.label} node`}
              className={RAIL_BTN}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
        <span className="my-0.5 h-px w-6 bg-white/10" aria-hidden />
        <button
          type="button"
          onClick={onOpenLibrary}
          title="Add from library"
          aria-label="Add from library"
          className={RAIL_BTN}
        >
          <FolderOpen className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function CanvasEmptyState({
  onAdd,
  onOpenLibrary,
}: {
  onAdd: (kind: CanvasNodeKind) => void;
  onOpenLibrary: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center p-6">
      <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-white/10 bg-N50/90 p-6 text-center shadow-xl shadow-black/40 backdrop-blur-md">
        <p className="font-display text-lg font-semibold text-text-primary">Add a node to start</p>
        <p className="mt-1 text-sm text-text-secondary">
          Drop a library still, or add a node and generate into it. Drag a handle to connect, or click it to add the next node.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.kind}
                type="button"
                onClick={() => onAdd(action.kind)}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-medium text-text-primary transition-colors hover:bg-white/10"
              >
                <Icon className="h-4 w-4" />
                {action.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={onOpenLibrary}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-medium text-text-primary transition-colors hover:bg-white/10"
          >
            <FolderOpen className="h-4 w-4" />
            Library
          </button>
        </div>
      </div>
    </div>
  );
}

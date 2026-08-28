"use client";

import { FlaskConical } from "lucide-react";
import { Tooltip } from "./Tooltip";

/** Admin-only: skip provider + credits; deliver bundled blank media. */
export function DevBlankTestToggle({
  isAdmin,
  enabled,
  onChange,
  disabled,
}: {
  isAdmin: boolean;
  enabled: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  if (!isAdmin) return null;

  const label = (
    <label
      className={`inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-radius-xl border px-3 text-xs font-semibold transition-colors ${
        enabled
          ? "border-warning/40 bg-warning/10 text-warning"
          : "border-white/15 bg-white/5 text-text-secondary hover:bg-white/10"
      } ${disabled ? "pointer-events-none opacity-40" : ""}`}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={enabled}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <FlaskConical className="h-3.5 w-3.5 shrink-0" />
      Blank
    </label>
  );

  return (
    <Tooltip label="Test mode — no credits, no AI">
      {label}
    </Tooltip>
  );
}

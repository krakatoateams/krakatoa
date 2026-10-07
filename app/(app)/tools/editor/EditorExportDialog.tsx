"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { GENERATE_BTN_CLASS } from "@/components/studio/CreditButton";
import {
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_FPS,
  EXPORT_QUALITIES,
  EXPORT_QUALITY_LABEL,
  EXPORT_RESOLUTIONS,
  type EditorExportSettings,
} from "@/lib/editor-export-settings";

const FIELD =
  "h-9 w-full rounded-lg bg-white/10 px-3 text-sm text-text-primary outline-none focus-visible:ring-1 focus-visible:ring-brand-primary";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-4 text-sm text-text-secondary">
      <span className="shrink-0">{label}</span>
      <span className="w-44">{children}</span>
    </label>
  );
}

export default function EditorExportDialog({
  defaultName,
  onClose,
  onConfirm,
}: {
  defaultName: string;
  onClose: () => void;
  onConfirm: (name: string, settings: EditorExportSettings) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [settings, setSettings] = useState<EditorExportSettings>(DEFAULT_EXPORT_SETTINGS);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Export settings"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-[#161616] p-5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            className="rounded-md p-1 text-icon-low-emphasis hover:bg-white/10 hover:text-text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h2 className="text-sm font-semibold text-text-primary">Export settings</h2>
        </div>
        <Field label="Name">
          <input
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            className={FIELD}
          />
        </Field>
        <Field label="Resolution">
          <select
            value={settings.resolution}
            onChange={(e) => setSettings({ ...settings, resolution: Number(e.target.value) as EditorExportSettings["resolution"] })}
            className={FIELD}
          >
            {EXPORT_RESOLUTIONS.map((r) => (
              <option key={r} value={r}>{r}p</option>
            ))}
          </select>
        </Field>
        <Field label="Quality">
          <select
            value={settings.quality}
            onChange={(e) => setSettings({ ...settings, quality: e.target.value as EditorExportSettings["quality"] })}
            className={FIELD}
          >
            {EXPORT_QUALITIES.map((q) => (
              <option key={q} value={q}>{EXPORT_QUALITY_LABEL[q]}</option>
            ))}
          </select>
        </Field>
        <Field label="Frame rate">
          <select
            value={settings.fps}
            onChange={(e) => setSettings({ ...settings, fps: Number(e.target.value) as EditorExportSettings["fps"] })}
            className={FIELD}
          >
            {EXPORT_FPS.map((f) => (
              <option key={f} value={f}>{f}fps</option>
            ))}
          </select>
        </Field>
        <Field label="Format">
          <select disabled className={`${FIELD} opacity-60`} defaultValue="mp4">
            <option value="mp4">MP4</option>
          </select>
        </Field>
        <button
          type="button"
          onClick={() => onConfirm(name, settings)}
          className={`${GENERATE_BTN_CLASS} h-10 w-full text-sm`}
        >
          Export
        </button>
      </div>
    </div>
  );
}

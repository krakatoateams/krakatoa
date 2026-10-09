"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { ChipDropdown } from "@/components/studio/ChipDropdown";
import { GENERATE_BTN_CLASS } from "@/components/studio/CreditButton";
import {
  DEFAULT_EXPORT_SETTINGS,
  EDITOR_EXPORT_MAX_FILE_BYTES,
  EXPORT_FORMATS,
  EXPORT_FORMAT_SPEC,
  EXPORT_FPS,
  EXPORT_QUALITIES,
  EXPORT_QUALITY_LABEL,
  EXPORT_RESOLUTIONS,
  EXPORT_RESOLUTION_LABEL,
  exportDimensions,
  exportVideoBitrateCapKbps,
  type EditorExportSettings,
} from "@/lib/editor-export-settings";
import type { EditorAspect } from "@/lib/editor-document";

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
  aspect,
  durationSec,
  onClose,
  onConfirm,
}: {
  defaultName: string;
  aspect: EditorAspect;
  durationSec: number;
  onClose: () => void;
  onConfirm: (name: string, settings: EditorExportSettings) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [settings, setSettings] = useState<EditorExportSettings>(DEFAULT_EXPORT_SETTINGS);
  // Same cap the server encodes with (audio assumed, so the hint errs on the side of showing).
  const { w, h } = exportDimensions(aspect, settings.resolution);
  const sizeCapped = exportVideoBitrateCapKbps({ format: settings.format, width: w, height: h, durationSec, hasAudio: true }) !== null;

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
          <ChipDropdown
            field
            icon={null}
            value={EXPORT_RESOLUTION_LABEL[settings.resolution]}
            options={EXPORT_RESOLUTIONS.map((r) => ({ id: String(r), label: EXPORT_RESOLUTION_LABEL[r] }))}
            activeId={String(settings.resolution)}
            onSelect={(id) => setSettings({ ...settings, resolution: Number(id) as EditorExportSettings["resolution"] })}
            sheetTitle="Select resolution"
          />
        </Field>
        <Field label="Quality">
          <ChipDropdown
            field
            icon={null}
            value={EXPORT_QUALITY_LABEL[settings.quality]}
            options={EXPORT_QUALITIES.map((q) => ({ id: q, label: EXPORT_QUALITY_LABEL[q] }))}
            activeId={settings.quality}
            onSelect={(id) => setSettings({ ...settings, quality: id as EditorExportSettings["quality"] })}
            sheetTitle="Select quality"
          />
        </Field>
        <Field label="Frame rate">
          <ChipDropdown
            field
            icon={null}
            value={`${settings.fps}fps`}
            options={EXPORT_FPS.map((f) => ({ id: String(f), label: `${f}fps` }))}
            activeId={String(settings.fps)}
            onSelect={(id) => setSettings({ ...settings, fps: Number(id) as EditorExportSettings["fps"] })}
            sheetTitle="Select frame rate"
          />
        </Field>
        <Field label="Format">
          <ChipDropdown
            field
            icon={null}
            value={EXPORT_FORMAT_SPEC[settings.format].label}
            options={EXPORT_FORMATS.map((f) => ({ id: f, label: EXPORT_FORMAT_SPEC[f].label }))}
            activeId={settings.format}
            onSelect={(id) => setSettings({ ...settings, format: id as EditorExportSettings["format"] })}
            sheetTitle="Select format"
          />
        </Field>
        {settings.resolution === 2160 && <p role="status" className="text-xs text-text-secondary">4K exports take longer.</p>}
        {sizeCapped && (
          <p role="status" className="text-xs text-text-secondary">
            Exports are saved up to {EDITOR_EXPORT_MAX_FILE_BYTES / 1_000_000} MB, so this length at {EXPORT_RESOLUTION_LABEL[settings.resolution]} is compressed to fit and
            may look softer. Choose a lower resolution or a shorter timeline for more detail.
          </p>
        )}
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

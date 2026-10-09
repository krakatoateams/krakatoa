import { creationItemDownloadFilename } from "@/lib/use-creation-item-actions";
import type { EditorExportPollData } from "@/lib/editor-export-progress";

type ExportDownloadState = {
  outcome: string;
  creationId: string | null;
  storagePath: string | null;
  title: string | null;
};

/** Finished-file fields copied into the dialog state from either success response. */
export function exportSuccessFields(data: EditorExportPollData | null | undefined) {
  return {
    creationId: data?.creation?.id ?? null,
    storagePath: data?.creation?.storagePath?.trim() || data?.storagePath?.trim() || null,
    title: data?.creation?.title ?? null,
  };
}

/** Storage path + filename for the Download button; null unless the export succeeded with a file. */
export function exportDownloadTarget(
  state: ExportDownloadState,
  mimeType?: string
): { storagePath: string; filename: string } | null {
  const storagePath = state.storagePath?.trim();
  if (state.outcome !== "success" || !storagePath) return null;
  return {
    storagePath,
    filename: creationItemDownloadFilename(
      {
        id: state.creationId ?? "export",
        mediaType: "video",
        storagePath,
        title: state.title ?? "",
        toolLabel: "",
      },
      mimeType
    ),
  };
}

export function editorExportDownloadSelfCheck() {
  const ok = { outcome: "success", creationId: "1a2b3c4d-xxxx", storagePath: "u/a.mp4", title: "My Video" };
  const t = exportDownloadTarget(ok);
  if (t?.filename !== "my-video-1a2b3c4d.mp4" || t.storagePath !== "u/a.mp4") throw new Error("mp4 target");
  if (exportDownloadTarget({ ...ok, storagePath: "u/a.webm" })?.filename !== "my-video-1a2b3c4d.webm") throw new Error("webm");
  if (exportDownloadTarget({ ...ok, outcome: "running" })) throw new Error("not success");
  if (exportDownloadTarget({ ...ok, storagePath: null })) throw new Error("no path");
  const f = exportSuccessFields({ storagePath: " top.mp4 ", creation: { id: "i", title: "T" } });
  if (f.storagePath !== "top.mp4" || f.creationId !== "i" || f.title !== "T") throw new Error("fields");
  if (exportSuccessFields(undefined).storagePath !== null) throw new Error("empty");
}

if (require.main === module) {
  editorExportDownloadSelfCheck();
  console.log("editorExportDownloadSelfCheck: ok");
}

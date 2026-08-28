import type { CreationHistoryItem } from "@/lib/creations";
import { VIRAL_TEMPLATES } from "@/lib/trending-templates";

/** Legacy viral runs stored the full provider prompt in metadata.prompt. */
const VIRAL_ASSEMBLED_PROMPT_RE =
  /^Viral template "([^"]+)" \(template id: [^)]+\)/;

const VIRAL_TEMPLATE_TITLES = new Set(
  VIRAL_TEMPLATES.map((t) => t.title?.trim()).filter((t): t is string => Boolean(t))
);

function isViralTemplateOnlyMetadata(
  meta: Record<string, unknown>,
  candidate: string
): boolean {
  if (typeof meta.viralTemplateId === "string" && meta.viralTemplateId.trim()) {
    return true;
  }
  if (typeof meta.viralTemplateTitle === "string" && meta.viralTemplateTitle.trim()) {
    return true;
  }
  if (!candidate) return false;
  if (VIRAL_ASSEMBLED_PROMPT_RE.test(candidate)) return true;
  if (VIRAL_TEMPLATE_TITLES.has(candidate)) return true;
  return false;
}

/**
 * User-typed prompt for library / asset detail UI. Viral templates and other
 * flows with no user prompt return "" — never the template title or job title.
 */
export function getCreationUserPrompt(item: CreationHistoryItem): string {
  const meta = item.metadata ?? {};
  const explicit =
    typeof meta.userPrompt === "string" ? meta.userPrompt.trim() : "";
  const raw = typeof meta.prompt === "string" ? meta.prompt.trim() : "";
  const candidate = explicit || raw;

  if (isViralTemplateOnlyMetadata(meta, candidate)) return "";
  if (explicit) return explicit;
  return raw;
}

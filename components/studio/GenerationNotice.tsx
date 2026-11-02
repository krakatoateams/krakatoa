import { StudioBanner } from "./layout";

/** Calm, neutral note after a run (not an error), e.g. a cancel that came too late; renders nothing when empty. */
export function GenerationNotice({ text, className = "mt-4" }: { text: string | null; className?: string }) {
  if (!text) return null;
  return (
    <StudioBanner tone="info" className={className}>
      <span role="status">{text}</span>
    </StudioBanner>
  );
}

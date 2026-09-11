"use client";

import { Children, isValidElement } from "react";
import BorderGlow from "@/components/BorderGlow";
import { StudioModeRail, type StudioModeId } from "./StudioModeRail";

export type { StudioModeId };

// Presentational layout shells shared by the studio tool composers. They own the
// canonical class strings so spacing / radius / mobile behavior can be tuned once
// and apply across Photo + Video + Skills. Page-specific spacing is passed via
// `className`.

type DivProps = {
  children: React.ReactNode;
  className?: string;
};

export const STUDIO_FORM_CLASS = "relative z-20 mt-0 py-0 lg:mt-10";

const STUDIO_FORM_HEADER = "StudioFormHeader";
const STUDIO_FORM_CARD = "StudioFormCard";
const STUDIO_MODEL_PANEL = "StudioModelPanel";

// Chip row that sits above the omni card. StudioForm places it in the same
// grid as the mode rail so the rail top-aligns with the card, not the chips.
export function StudioFormHeader({ children, className = "" }: DivProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>{children}</div>
  );
}
StudioFormHeader.displayName = STUDIO_FORM_HEADER;

function isStudioFormHeader(
  child: React.ReactNode
): child is React.ReactElement<{ children?: React.ReactNode; className?: string }> {
  return isValidElement(child) && child.type === StudioFormHeader;
}

function isStudioFormCard(child: React.ReactNode): child is React.ReactElement {
  return isValidElement(child) && child.type === StudioFormCard;
}

function isStudioModelPanel(child: React.ReactNode): child is React.ReactElement {
  return isValidElement(child) && child.type === StudioModelPanel;
}

// Keep the prompt card and the mobile model row as one flex item so the
// parent `gap-3` does not split them. The panel overlaps the card by 12px.
function groupCardAndModelPanel(nodes: React.ReactNode[]): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const next = nodes[i + 1];
    if (isStudioFormCard(node) && isStudioModelPanel(next)) {
      out.push(
        <div key={`card-model-${i}`} className="min-w-0">
          {node}
          {next}
        </div>
      );
      i += 1;
      continue;
    }
    out.push(node);
  }
  return out;
}

// The <form> wrapper. Always renders the Agent / Image / Video rail in one grid
// with the composer card so every studio form shares alignment and switching.
export function StudioForm({
  children,
  className = "",
  onSubmit,
  mode,
}: DivProps & { onSubmit: (e: React.FormEvent) => void; mode: StudioModeId }) {
  const childList = Children.toArray(children);
  const headers = childList.filter(isStudioFormHeader);
  const rest = childList.filter((child) => !isStudioFormHeader(child));
  const hasHeader = headers.length > 0;

  return (
    <form onSubmit={onSubmit} className={`${STUDIO_FORM_CLASS} ${className}`}>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start">
        {hasHeader ? (
          <div className="lg:col-start-2 max-lg:has-[>:not(.hidden)]:contents max-lg:[&:not(:has(>:not(.hidden)))]:hidden">
            {headers}
          </div>
        ) : null}
        <StudioModeRail
          active={mode}
          className={hasHeader ? "max-lg:order-first lg:col-start-1 lg:row-start-2" : ""}
        />
        <div
          className={`flex min-w-0 flex-col gap-3 ${hasHeader ? "lg:col-start-2 lg:row-start-2" : ""}`}
        >
          {groupCardAndModelPanel(rest)}
        </div>
      </div>
    </form>
  );
}

export const STUDIO_FORM_CARD_CLASS = "z-10 p-4 sm:p-5";

// The glass "form card" container that holds the prompt + controls.
// Cursor-follow border glow is shared by Agent / Photo / Video.
export function StudioFormCard({ children, className = "" }: DivProps) {
  return (
    <BorderGlow
      data-studio-form-card
      borderRadius={16}
      glowColor="22 90 72"
      backgroundColor="#121212"
      glowRadius={40}
      glowIntensity={1}
      coneSpread={25}
      edgeSensitivity={30}
      animated
      colors={["#FF995A", "#F26522", "#B24610"]}
      className={`${STUDIO_FORM_CARD_CLASS} ${className}`}
    >
      {children}
    </BorderGlow>
  );
}
StudioFormCard.displayName = STUDIO_FORM_CARD;

// Canonical horizontally-scrollable chip row style (scrolls on mobile, wraps on
// lg+). Exposed as a class constant so pages can apply it to an existing element
// via className, and as the <StudioChipRow> wrapper. Pairs with the portal-based
// ChipDropdown so menus are never clipped by the scroll.
export const STUDIO_CHIP_ROW_CLASS =
  "flex flex-nowrap items-center gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] lg:flex-wrap lg:overflow-visible lg:pb-0 [&::-webkit-scrollbar]:hidden";

export function StudioChipRow({ children, className = "" }: DivProps) {
  return <div className={`${STUDIO_CHIP_ROW_CLASS} ${className}`}>{children}</div>;
}

// Mobile-only panel that attaches under the form card (used for the Model row).
export function StudioModelPanel({ children, className = "" }: DivProps) {
  return (
    <div
      className={`-mt-3 rounded-b-radius-xl bg-white/[0.04] px-4 pb-4 pt-6 backdrop-blur-sm lg:hidden ${className}`}
    >
      {children}
    </div>
  );
}
StudioModelPanel.displayName = STUDIO_MODEL_PANEL;

// The result / output card shown after a successful generation.
export function StudioResultCard({ children, className = "" }: DivProps) {
  return (
    <div
      className={`mt-6 flex flex-col gap-4 rounded-radius-xl border border-white/10 bg-white/5 p-4 sm:flex-row ${className}`}
    >
      {children}
    </div>
  );
}

type BannerTone = "info" | "error" | "warning";

const BANNER_TONE: Record<BannerTone, string> = {
  info: "border-white/10 bg-white/5 text-text-secondary",
  error: "border-error/20 bg-error/10 text-error",
  warning: "border-warning/20 bg-warning/10 text-warning",
};

// Info / error / warning notice box. Caller controls top margin + alignment via
// `className` (e.g. "mt-4 items-start" or "mt-6 items-center").
export function StudioBanner({
  children,
  tone,
  className = "",
}: DivProps & { tone: BannerTone }) {
  return (
    <div
      className={`flex gap-3 rounded-2xl border p-4 text-sm ${BANNER_TONE[tone]} ${className}`}
    >
      {children}
    </div>
  );
}

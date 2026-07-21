"use client";

// Presentational layout shells shared by the studio tool composers. They own the
// canonical class strings so spacing / radius / mobile behavior can be tuned once
// and apply across Photo + Video. Page-specific spacing is passed via `className`.

type DivProps = {
  children: React.ReactNode;
  className?: string;
};

// The <form> wrapper. Base owns stacking only; each page passes its own vertical
// spacing (photo uses a tall hero margin, video a small one) via `className`.
export function StudioForm({
  children,
  className = "",
  onSubmit,
}: DivProps & { onSubmit: (e: React.FormEvent) => void }) {
  return (
    <form onSubmit={onSubmit} className={`relative z-20 ${className}`}>
      {children}
    </form>
  );
}

// The glass "form card" container that holds the prompt + controls.
export function StudioFormCard({ children, className = "" }: DivProps) {
  return (
    <div
      className={`rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm sm:p-5 ${className}`}
    >
      {children}
    </div>
  );
}

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
      className={`-mt-3 mb-6 rounded-b-[16px] bg-white/[0.04] px-4 pb-4 pt-6 backdrop-blur-sm lg:hidden ${className}`}
    >
      {children}
    </div>
  );
}

// The result / output card shown after a successful generation.
export function StudioResultCard({ children, className = "" }: DivProps) {
  return (
    <div
      className={`mt-6 flex flex-col gap-4 rounded-[16px] border border-white/10 bg-white/5 p-4 sm:flex-row ${className}`}
    >
      {children}
    </div>
  );
}

type BannerTone = "info" | "error" | "warning";

const BANNER_TONE: Record<BannerTone, string> = {
  info: "border-white/10 bg-white/5 text-gray-300",
  error: "border-red-500/20 bg-red-500/10 text-red-300",
  warning: "border-amber-500/20 bg-amber-500/10 text-amber-200",
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

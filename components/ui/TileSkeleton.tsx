"use client";

/** Footer bone widths, longest first — a title reads longer than the meta under it. */
const LINE_WIDTHS = ["w-3/4", "w-1/2", "w-2/5"];

/**
 * Pulsing stand-ins for a grid of media cards, shaped like the tiles that will
 * replace them so the layout doesn't shift when the first page arrives. Pass the
 * same grid classes the real grid uses.
 */
export function TileSkeleton({
  count,
  gridClassName,
  label,
  tileClassName = "rounded-xl border border-white/10",
  aspectClassName = "aspect-square",
  lines = 1,
}: {
  count: number;
  gridClassName: string;
  /** Read out in place of the tiles, which carry no accessible content. */
  label: string;
  tileClassName?: string;
  aspectClassName?: string;
  /** Footer text bones per tile, capped by LINE_WIDTHS. 0 hides the footer. */
  lines?: number;
}) {
  return (
    <div className={gridClassName} aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, tile) => (
        <div
          key={tile}
          className={`animate-pulse overflow-hidden ${tileClassName}`}
        >
          <div className={`w-full bg-white/[0.06] ${aspectClassName}`} />
          {lines > 0 && (
            <div className="space-y-1.5 px-3 py-2.5">
              {LINE_WIDTHS.slice(0, lines).map((width) => (
                <div key={width} className={`h-3 rounded bg-white/[0.08] ${width}`} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

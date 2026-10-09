"use client";

// Determinate when `value` is a number (0-100); indeterminate when null/undefined,
// in which case aria-valuenow is omitted. Motion is disabled under motion-reduce.
export function ProgressBar({
  value,
  label,
  valueText,
}: {
  value?: number | null;
  label: string;
  valueText?: string;
}) {
  const determinate = typeof value === "number";
  const fill = "bg-brand-primary";
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.round(value) : undefined}
      aria-valuetext={valueText}
      className="relative h-2 w-full overflow-hidden rounded-full bg-N100"
    >
      {determinate ? (
        <div
          className={`h-full rounded-full ${fill} transition-[width] duration-300 ease-out motion-reduce:transition-none`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      ) : (
        <div
          className={`absolute inset-y-0 left-0 w-2/5 rounded-full ${fill} animate-progress-sweep motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-40`}
        />
      )}
    </div>
  );
}

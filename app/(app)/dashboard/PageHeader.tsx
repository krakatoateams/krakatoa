/**
 * Shared page header for dashboard pages. Single source of truth for the page
 * title + description styling so every page matches. Optional `actions` render
 * to the right of the title on wider screens.
 */
export default function PageHeader({
  title,
  description,
  actions,
  className = "",
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mb-8 ${
        actions
          ? "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          : ""
      } ${className}`}
    >
      <div className={actions ? "min-w-0 flex-1" : undefined}>
        <h1 className="mb-0 bg-gradient-to-b from-N900 to-N500 bg-clip-text font-display text-[clamp(1.625rem,5vw,2.25rem)] font-bold leading-tight tracking-tight text-transparent sm:mb-0">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 text-body-3 text-text-secondary">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="min-w-0 shrink-0">{actions}</div> : null}
    </div>
  );
}

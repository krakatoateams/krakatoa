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
          ? "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
          : ""
      } ${className}`}
    >
      <div>
        <h1 className="mb-3 bg-gradient-to-b from-white to-gray-400 bg-clip-text text-4xl font-bold tracking-tight text-transparent">
          {title}
        </h1>
        {description ? (
          <p className="text-sm text-gray-500">{description}</p>
        ) : null}
      </div>
      {actions ?? null}
    </div>
  );
}

/**
 * Shared page container for dashboard pages. Single source of truth for the
 * content max-width and page padding so every dashboard page lines up. The
 * background is left flat (bg-N50 from the app shell) — no ambient orbs.
 */
export default function PageContainer({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative z-10 mx-auto max-w-5xl px-6 py-10 ${className}`}>
      {children}
    </div>
  );
}

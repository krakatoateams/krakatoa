/**
 * Shared page container for dashboard pages. Single source of truth for the
 * content max-width and page padding so every dashboard page lines up. Also
 * renders the ambient blurred-orb background used across the app (matches the
 * Photo studio at /tools/photo-v2) so every page shares one background style.
 */
export default function PageContainer({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <>
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-[10%] -top-[10%] h-[40%] w-[40%] rounded-full bg-purple-900/20 blur-[120px]" />
        <div className="absolute -right-[10%] top-[20%] h-[30%] w-[30%] rounded-full bg-indigo-900/20 blur-[120px]" />
      </div>
      <div className={`relative z-10 mx-auto max-w-5xl px-6 py-10 ${className}`}>
        {children}
      </div>
    </>
  );
}

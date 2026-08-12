import Link from "next/link";

const SECTION_GROUPS = [
  {
    label: "Foundations",
    items: [
      { href: "/design-system/colors", label: "Colors", description: "Raw scale + semantic aliases." },
      {
        href: "/design-system/typography",
        label: "Typography",
        description: "Space Grotesk headings, Inter body.",
      },
      { href: "/design-system/spacing", label: "Spacing", description: "8px-based spacing scale." },
      { href: "/design-system/radius", label: "Radius", description: "Corner-rounding scale." },
      { href: "/design-system/shadow", label: "Shadow", description: "Elevation levels and usage." },
    ],
  },
  {
    label: "Components",
    items: [
      {
        href: "/design-system/button",
        label: "Button",
        description: "Variant × size × state matrix.",
      },
    ],
  },
];

export default function DesignSystemOverviewPage() {
  return (
    <div className="space-y-spacing-xxl">
      <header>
        <h1 className="font-display text-h1 font-bold">Design System</h1>
        <p className="mt-spacing-sm text-body-2 text-text-secondary">
          Foundation tokens and components, rendered live from{" "}
          <code className="text-body-3">tailwind.config.mjs</code> and the real{" "}
          <code className="text-body-3">components/ui</code> source. Internal only — not linked
          from any nav, not built in production.
        </p>
      </header>

      {SECTION_GROUPS.map((group) => (
        <div key={group.label} className="space-y-spacing-md">
          <h2 className="font-display text-h3 font-bold">{group.label}</h2>
          <div className="grid gap-spacing-md sm:grid-cols-2">
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-radius-lg border border-border-default p-spacing-lg hover:bg-bg-surface"
              >
                <p className="text-body-2 font-semibold text-text-primary">{item.label}</p>
                <p className="mt-spacing-sm text-body-3 text-text-secondary">{item.description}</p>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

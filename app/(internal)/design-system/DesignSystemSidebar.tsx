"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Foundations",
    items: [
      { href: "/design-system/colors", label: "Colors" },
      { href: "/design-system/typography", label: "Typography" },
      { href: "/design-system/spacing", label: "Spacing" },
      { href: "/design-system/radius", label: "Radius" },
      { href: "/design-system/shadow", label: "Shadow" },
    ],
  },
  {
    label: "Components",
    items: [
      { href: "/design-system/button", label: "Button" },
      // Add new components here as they're built — this group is the
      // intended home for all of them, Button is just the first.
    ],
  },
];

export function DesignSystemSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-spacing-xxl h-fit w-48 shrink-0">
      <Link
        href="/design-system"
        className="mb-spacing-lg block font-display text-body-3 font-bold text-text-primary"
      >
        Kelolako DS
      </Link>
      <nav className="flex flex-col gap-spacing-xl">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="mb-spacing-sm px-spacing-md text-extra-small uppercase text-text-secondary">
              {group.label}
            </p>
            <div className="flex flex-col gap-spacing-sm">
              {group.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={
                      active
                        ? "rounded-radius-sm bg-bg-surface px-spacing-md py-spacing-sm text-body-3 font-semibold text-text-primary"
                        : "rounded-radius-sm px-spacing-md py-spacing-sm text-body-3 text-text-secondary hover:bg-bg-surface hover:text-text-primary"
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}

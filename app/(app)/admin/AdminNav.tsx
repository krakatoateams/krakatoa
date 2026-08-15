"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Overview", href: "/admin" },
  { label: "Monitoring", href: "/admin/monitoring" },
  { label: "Admin Users", href: "/admin/users" },
  { label: "Credits", href: "/admin/credits" },
  { label: "Pricing", href: "/admin/pricing" },
  { label: "Config", href: "/admin/config-v2" },
  { label: "Expiry", href: "/admin/expiry" },
  { label: "Usage", href: "/admin/usage" },
];

export default function AdminNav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname?.startsWith(href);

  return (
    <nav className="flex flex-wrap gap-1 border-b border-white/10">
      {TABS.map((tab) => {
        const active = isActive(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-white text-white"
                : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

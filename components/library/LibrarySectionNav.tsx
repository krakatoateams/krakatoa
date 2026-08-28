"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { libraryFavoriteCount } from "@/lib/library-favorites";

const SECTIONS = [
  { href: "/dashboard/assets", label: "My Library" },
  { href: "/dashboard/favorites", label: "Favorites" },
  { href: "/dashboard/trash", label: "Trash" },
] as const;

type Props = {
  /** Bump when the library refetches so trash / favorite counts stay fresh. */
  refreshKey?: number;
};

export function LibrarySectionNav({ refreshKey = 0 }: Props) {
  const pathname = usePathname();
  const [favoriteCount, setFavoriteCount] = useState(0);
  const [trashCount, setTrashCount] = useState(0);

  useEffect(() => {
    setFavoriteCount(libraryFavoriteCount());
  }, [refreshKey, pathname]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          "/api/creations/history?libraryCounts=1&libraryScope=photo&librarySection=browse&libraryFeature=all&limit=1"
        );
        const data = await res.json();
        if (!cancelled && res.ok) {
          setTrashCount(typeof data.libraryCounts?.trash === "number" ? data.libraryCounts.trash : 0);
        }
      } catch {
        if (!cancelled) setTrashCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const countFor = (href: string) => {
    if (href === "/dashboard/favorites") return favoriteCount;
    if (href === "/dashboard/trash") return trashCount;
    return null;
  };

  return (
    <nav
      className="flex max-w-full gap-1 overflow-x-auto border-b border-white/10"
      aria-label="Library sections"
    >
      {SECTIONS.map((section) => {
        const active = pathname === section.href;
        const count = countFor(section.href);
        return (
          <Link
            key={section.href}
            href={section.href}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-white/80 text-text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
            aria-current={active ? "page" : undefined}
          >
            {section.label}
            {count !== null ? (
              <span className={active ? "text-text-secondary" : "text-text-disabled"}>
                {" "}
                ({count})
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

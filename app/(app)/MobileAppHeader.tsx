"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ChevronDown,
  Coins,
  Link2,
  LogOut,
  Shield,
  SlidersHorizontal,
  User,
  type LucideIcon,
} from "lucide-react";
import { useCurrentUser } from "@/lib/auth-context";
import { getSupabaseAuthBrowser } from "@/lib/supabase-browser-auth";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import CreditBadge from "@/components/CreditBadge";
import { Button } from "@/components/ui/Button";

const PRIMARY_ITEMS: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Account", href: "/dashboard/settings?tab=account", icon: User },
  { label: "Credits", href: "/dashboard/settings?tab=credits", icon: Coins },
  { label: "Connections", href: "/dashboard/settings?tab=connections", icon: Link2 },
  { label: "Basic Settings", href: "/dashboard/settings?tab=settings", icon: SlidersHorizontal },
];

const ITEM =
  "flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-sm font-medium text-N900 transition-colors hover:bg-white/10";

export default function MobileAppHeader() {
  const { status, name, email, image } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status !== "authenticated") {
      setIsAdmin(false);
      return;
    }
    fetch("/api/admin/me")
      .then((res) => (res.ok ? res.json() : { isAdmin: false }))
      .then((d: { isAdmin?: boolean }) => setIsAdmin(Boolean(d.isAdmin)))
      .catch(() => setIsAdmin(false));
  }, [status]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-N50/95 px-4 backdrop-blur-md md:hidden">
      <Link href="/" aria-label="Kelolako home" className="flex min-w-0 items-center gap-2">
        <Image
          src="/Logo White transparent.svg"
          alt=""
          width={28}
          height={28}
          className="h-7 w-7 shrink-0 object-contain"
        />
        <span className="font-display text-sm font-black uppercase tracking-[-0.5px] text-white">
          KELOLAKO
        </span>
      </Link>

      <div className="flex shrink-0 items-center gap-2">
        {status === "authenticated" ? (
          <>
            <CreditBadge variant="topup" />
            <div ref={menuRef} className="relative">
              <button
                type="button"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-label="Account menu"
                onClick={() => setMenuOpen((open) => !open)}
                className="flex h-8 items-center gap-1 rounded-full text-N900 transition-colors hover:bg-white/10"
              >
                {image ? (
                  <Image
                    src={image}
                    alt={name ?? "Profile"}
                    width={32}
                    height={32}
                    className="h-8 w-8 rounded-full object-cover ring-1 ring-white/15"
                  />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-white/25 to-white/10 text-xs font-semibold ring-1 ring-white/15">
                    {name?.[0]?.toUpperCase() ?? "?"}
                  </span>
                )}
                <ChevronDown
                  className={`h-3.5 w-3.5 text-text-secondary transition-transform ${menuOpen ? "rotate-180" : ""}`}
                />
              </button>
              {menuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-[70] mt-2 w-[min(18.5rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-N50 p-3 shadow-2xl shadow-black/50"
                >
                  <div className="mb-2 flex items-center gap-3 px-1 py-1.5">
                    {image ? (
                      <Image
                        src={image}
                        alt=""
                        width={40}
                        height={40}
                        className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-white/15"
                      />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-white/25 to-white/10 text-sm font-semibold ring-1 ring-white/15">
                        {name?.[0]?.toUpperCase() ?? "?"}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-N900">{name ?? "Account"}</p>
                      {email ? (
                        <p className="truncate text-extra-small text-text-secondary">{email}</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-col">
                    {PRIMARY_ITEMS.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          role="menuitem"
                          onClick={closeMenu}
                          className={ITEM}
                        >
                          <Icon className="h-4 w-4 shrink-0 text-text-secondary" />
                          {item.label}
                        </Link>
                      );
                    })}
                    {isAdmin ? (
                      <Link href="/admin" role="menuitem" onClick={closeMenu} className={ITEM}>
                        <Shield className="h-4 w-4 shrink-0 text-text-secondary" />
                        Admin
                      </Link>
                    ) : null}
                  </div>

                  <div className="my-2 h-px bg-white/10" />

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeMenu();
                      void getSupabaseAuthBrowser()
                        .auth.signOut()
                        .then(() => {
                          window.location.href = "/dashboard";
                        });
                    }}
                    className={ITEM}
                  >
                    <LogOut className="h-4 w-4 shrink-0 text-text-secondary" />
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </>
        ) : status === "loading" ? (
          <div className="h-8 w-24 animate-pulse rounded-full bg-white/10" />
        ) : (
          <Button variant="primary" size="sm" onClick={() => openSignInModal()}>
            Sign in
          </Button>
        )}
      </div>
    </header>
  );
}

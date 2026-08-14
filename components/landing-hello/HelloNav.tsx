"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useCurrentUser } from "@/lib/auth-context";
import { NAV_CTA, NAV_LINKS, NAV_LOGIN } from "@/lib/landing-content";

/** First letter for the avatar circle, from name/email (falls back to "U"). */
function initialFrom(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.trim() || "U";
  return source.charAt(0).toUpperCase();
}

function Wordmark() {
  return (
    <Link
      href="/"
      aria-label="Kelolako home"
      className="flex shrink-0 items-center justify-self-center"
    >
      <Image
        src="/Logo White transparent.svg"
        alt="Kelolako"
        width={368}
        height={332}
        priority
        className="h-7 w-auto object-contain sm:h-8"
      />
    </Link>
  );
}

export function HelloNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { status, name, email } = useCurrentUser();
  const isAuthed = status === "authenticated";
  const cta = isAuthed ? NAV_CTA.authed : NAV_CTA.guest;
  const initial = initialFrom(name, email);

  // Lock the page while the mobile sheet is open.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40 mx-auto max-w-[800px] px-3 py-3 sm:py-5">
        <nav className="pointer-events-auto grid grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-full border border-white/[0.08] bg-[#171717]/45 p-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-[20px] backdrop-saturate-150 sm:px-5 sm:py-3">
          {/* Left: section links (desktop) / menu toggle (mobile) */}
          <div className="hidden items-center gap-6 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-sm text-[#aaaaaa] transition-colors hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#2a2a2a] text-[#cccccc] transition-colors hover:bg-white/[0.06] hover:text-white md:hidden"
          >
            <Menu className="h-[18px] w-[18px]" />
          </button>

          <Wordmark />

          {/* Right: sign-in + primary CTA */}
          <div className="hidden items-center justify-end gap-5 md:flex">
            {!isAuthed && (
              <Link
                href={NAV_LOGIN.href}
                className="text-sm text-[#aaaaaa] transition-colors hover:text-white"
              >
                {NAV_LOGIN.label}
              </Link>
            )}
            <Link
              href={cta.href}
              className="inline-flex items-center gap-2 rounded-full bg-[#fafafa] px-4 py-2 text-[13px] font-medium text-[#111111] transition-colors hover:bg-[#e0e0e0]"
            >
              {cta.label}
              {isAuthed && (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#111111] text-[11px] font-semibold text-white">
                  {initial}
                </span>
              )}
            </Link>
          </div>
          <div className="flex justify-end md:hidden">
            <Link
              href={cta.href}
              className="rounded-full bg-[#fafafa] px-3.5 py-2 text-[12px] font-medium text-[#111111] transition-colors hover:bg-[#e0e0e0]"
            >
              {isAuthed ? cta.label : "Start free"}
            </Link>
          </div>
        </nav>
      </div>

      {/* Mobile sheet */}
      <div
        className={`fixed inset-0 z-50 transition-opacity duration-300 md:hidden ${
          menuOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
        aria-hidden={!menuOpen}
      >
        <div
          className="absolute inset-0 bg-black/70 backdrop-blur-[15px]"
          onClick={() => setMenuOpen(false)}
        />
        <div
          className={`absolute inset-x-0 bottom-0 mx-3 mb-3 rounded-2xl bg-[#171717] p-6 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
            menuOpen ? "translate-y-0" : "translate-y-full"
          }`}
        >
          <div className="mb-6 flex items-center justify-between">
            <Image
              src="/Logo White transparent.svg"
              alt="Kelolako"
              width={368}
              height={332}
              className="h-6 w-auto object-contain"
            />
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[#2a2a2a] text-[#cccccc] transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <nav className="mb-8 flex flex-col gap-4">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="text-[28px] font-medium tracking-[-0.02em] text-white sm:text-[32px]"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex flex-col gap-3">
            {!isAuthed && (
              <Link
                href={NAV_LOGIN.href}
                onClick={() => setMenuOpen(false)}
                className="inline-flex w-full items-center justify-center rounded-full border border-[#2a2a2a] px-5 py-3 text-[15px] font-medium text-[#cccccc] transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                {NAV_LOGIN.label}
              </Link>
            )}
            <Link
              href={cta.href}
              onClick={() => setMenuOpen(false)}
              className="inline-flex w-full items-center justify-center rounded-full bg-[#fafafa] px-5 py-3.5 text-[15px] font-medium text-[#111111] transition-colors hover:bg-[#e0e0e0]"
            >
              {cta.label}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

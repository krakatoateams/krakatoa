"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Menu, X, ArrowRight } from "lucide-react";
import { useCurrentUser } from "@/lib/auth-context";
import { LondonClock } from "./LondonClock";
import { TextRollButton } from "./TextRollButton";

/** First letter for the avatar circle, from name/email (falls back to "U"). */
function initialFrom(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.trim() || "U";
  return source.charAt(0).toUpperCase();
}

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
  { label: "Testimonials", href: "#testimonials" },
];

/** Parse a CSS color string ("rgb(...)" / "rgba(...)") into [r,g,b,a]. */
function parseRgba(color: string): [number, number, number, number] | null {
  const match = color.match(
    /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i
  );
  if (!match) return null;
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    match[4] === undefined ? 1 : Number(match[4]),
  ];
}

/** Perceived (relative) luminance in 0..1 for an sRGB color. */
function relativeLuminance(r: number, g: number, b: number): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Walk up from an element to the first ancestor with a non-transparent bg. */
function effectiveBackground(el: Element | null): string {
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    const bg = window.getComputedStyle(node).backgroundColor;
    const rgba = parseRgba(bg);
    if (rgba && rgba[3] > 0.1) return bg;
    node = node.parentElement;
  }
  return "rgb(255, 255, 255)";
}

export function LandingNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Detect the background directly behind the nav and flip text to dark on
  // light sections (and light on dark sections) for legibility.
  useEffect(() => {
    const detect = () => {
      const nav = navRef.current;
      const wrapper = wrapperRef.current;
      if (!nav) return;
      const rect = nav.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const stack = document.elementsFromPoint(x, y);
      // Skip the nav (and its children); the first remaining node is behind it.
      const behind =
        stack.find((el) => !wrapper || !wrapper.contains(el)) ?? null;
      const rgba = parseRgba(effectiveBackground(behind));
      if (!rgba) return;
      const lum = relativeLuminance(rgba[0], rgba[1], rgba[2]);
      setTheme(lum > 0.55 ? "light" : "dark");
    };

    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(detect);
    };
    // Run now, then keep in sync while the nav animates its size/position.
    schedule();
    const timers = [150, 550].map((ms) => window.setTimeout(schedule, ms));
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [scrolled]);

  // In the default (top, unscrolled) state always use white text; only adapt
  // to light backgrounds once the user has scrolled.
  const light = scrolled && theme === "light";

  const { status, name, email } = useCurrentUser();
  const isAuthed = status === "authenticated";
  const initial = initialFrom(name, email);

  return (
    <>
      <div
        ref={wrapperRef}
        className="pointer-events-none fixed left-0 right-0 top-0 z-40 mx-auto max-w-[1440px] px-3 py-2 sm:px-1 sm:py-3"
      >
        <nav
          ref={navRef}
          className={`pointer-events-auto mx-auto flex w-full items-center justify-between gap-4 rounded-full bg-white md:bg-white/25 md:backdrop-blur-xl md:backdrop-saturate-150 p-[5px] pl-2 sm:pl-3 transition-[max-width,transform,box-shadow] duration-500 ease-out will-change-[max-width,transform] ${
            scrolled
              ? "max-w-[210px] sm:max-w-[640px] lg:max-w-[680px] translate-y-[6px] sm:translate-y-[10px] shadow-[0_10px_30px_rgba(0,0,0,0.12)]"
              : "max-w-[1440px] translate-y-[8px] sm:translate-y-[38px]"
          }`}
        >
          <div
            className={`flex items-center gap-4 sm:gap-6 min-w-0 transition-[padding] duration-500 ease-out ${
              scrolled ? "pl-1" : "pl-5"
            }`}
          >
            <Link
              href="/"
              aria-label="Kelolako home"
              className="flex items-center shrink-0"
            >
              <span
                className={`text-gray-900 text-[18px] sm:text-xl font-black tracking-normal transition-colors duration-300 ${
                  light ? "md:text-gray-900" : "md:text-white"
                }`}
              >
                KELOLAKO.
              </span>
            </Link>
            <div className="hidden md:flex items-center gap-6">
              {navLinks.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className={`text-sm transition-colors duration-300 ${
                    light
                      ? "text-gray-600 hover:text-gray-900"
                      : "text-white/90 hover:text-white"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="hidden md:flex items-center gap-4 lg:gap-5">
            {isAuthed ? (
              <Link
                href="/dashboard"
                className="group inline-flex items-center gap-2 bg-gray-900 text-white text-[13px] font-medium rounded-full pl-5 pr-2 py-2 hover:bg-gray-800 transition-colors"
              >
                Dashboard
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-bold text-gray-900">
                  {initial}
                </span>
              </Link>
            ) : (
              <TextRollButton
                href="/dashboard"
                className="inline-flex items-center gap-2 bg-gray-900 text-white text-[13px] font-medium rounded-full pl-5 pr-2 py-2 hover:bg-gray-800 transition-colors"
                iconVariant="dark"
              >
                Start creating free
              </TextRollButton>
            )}
          </div>

          <button
            type="button"
            className="md:hidden flex items-center justify-center w-10 h-10 rounded-full bg-gray-900 text-white"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </nav>
      </div>

      <div
        className={`fixed inset-0 z-50 md:hidden transition-opacity duration-300 ${
          menuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden={!menuOpen}
      >
        <div
          className="absolute inset-0 bg-black/60"
          onClick={() => setMenuOpen(false)}
        />
        <div
          className={`absolute bottom-0 left-0 right-0 mx-3 mb-3 rounded-2xl bg-white p-6 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
            menuOpen ? "translate-y-0" : "translate-y-full"
          }`}
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1.5 mb-6">
            <LondonClock className="text-[13px] text-gray-600" />
          </div>
          <nav className="flex flex-col gap-4 mb-8">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-[28px] sm:text-[32px] font-medium text-gray-900"
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <Link
            href="/dashboard"
            className="group inline-flex w-full items-center justify-between bg-gray-900 text-white rounded-full px-5 py-3.5 text-[15px] font-medium"
            onClick={() => setMenuOpen(false)}
          >
            {isAuthed ? "Dashboard" : "Start a project"}
            {isAuthed ? (
              <span className="flex w-8 h-8 items-center justify-center rounded-full bg-white text-[13px] font-bold text-gray-900">
                {initial}
              </span>
            ) : (
              <span className="flex w-8 h-8 items-center justify-center rounded-full bg-white transition-transform duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)] group-hover:-rotate-45">
                <ArrowRight className="w-4 h-4 text-gray-900" />
              </span>
            )}
          </Link>
        </div>
      </div>
    </>
  );
}

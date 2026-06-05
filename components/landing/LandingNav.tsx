"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X, ArrowRight } from "lucide-react";
import { LondonClock } from "./LondonClock";
import { TextRollButton } from "./TextRollButton";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
  { label: "Connect", href: "#" },
];

export function LandingNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <div className="pointer-events-none fixed left-0 right-0 top-0 z-40 mx-auto max-w-[1440px] px-3 py-2 sm:px-1 sm:py-3">
        <nav
          className={`pointer-events-auto mx-auto flex w-full items-center justify-between gap-4 rounded-full bg-white p-[5px] pl-2 sm:pl-3 transition-[max-width,transform,box-shadow] duration-500 ease-out will-change-[max-width,transform] ${
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
              aria-label="Krakatoa home"
              className="flex items-center shrink-0"
            >
              <span className="text-gray-900 text-[18px] sm:text-xl font-black tracking-[-1.9px]">
                KRAKATOA.
              </span>
            </Link>
            <div className="hidden md:flex items-center gap-6">
              {navLinks.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className="text-sm text-gray-900 hover:text-gray-500 transition-colors duration-300"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="hidden md:flex items-center gap-4 lg:gap-5">
            <LondonClock className="text-[13px] text-gray-600" />
            <TextRollButton
              href="/dashboard"
              className="inline-flex items-center gap-2 bg-gray-900 text-white text-[13px] font-medium rounded-full pl-5 pr-2 py-2 hover:bg-gray-800 transition-colors"
              iconVariant="dark"
            >
              Start creating free
            </TextRollButton>
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
            href="#growth"
            className="group inline-flex w-full items-center justify-between bg-gray-900 text-white rounded-full px-5 py-3.5 text-[15px] font-medium"
            onClick={() => setMenuOpen(false)}
          >
            Start a project
            <span className="flex w-8 h-8 items-center justify-center rounded-full bg-white transition-transform duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)] group-hover:-rotate-45">
              <ArrowRight className="w-4 h-4 text-gray-900" />
            </span>
          </Link>
        </div>
      </div>
    </>
  );
}

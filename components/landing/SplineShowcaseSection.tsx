"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { Mail } from "lucide-react";
import { TextRollButton } from "./TextRollButton";
import { useCurrentUser } from "@/lib/auth-context";

const SplineCoverEmbed = dynamic(
  () => import("./SplineCoverEmbed").then((m) => m.SplineCoverEmbed),
  { ssr: false }
);

export function SplineShowcaseSection() {
  const { status } = useCurrentUser();
  const isAuthed = status === "authenticated";

  return (
    <footer
      id="experience"
      className="relative min-h-[70vh] w-full overflow-hidden bg-gray-900 sm:min-h-[80vh] lg:min-h-screen"
    >
      <SplineCoverEmbed
        title="Googly eyes interactive scene"
        interactive
        cropBottom={80}
      />

      {/* Bottom gradient for legibility over the 3D scene */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-gray-900/85 via-gray-900/40 to-transparent"
      />

      {/* Overlay content. pointer-events-none on the wrapper so the
          Spline scene stays interactive; pointer-events-auto re-enabled
          only on interactive elements. */}
      <div className="pointer-events-none absolute inset-0 z-10">
        <div className="absolute inset-x-0 top-[calc(26%-100px)] flex justify-center px-5 sm:px-8 sm:top-[calc(28%-100px)] lg:px-12">
          <div className="max-w-2xl text-center">
            <h2
              className="font-medium leading-[1.1] tracking-[-0.02em] text-white"
              style={{ fontSize: "clamp(1.75rem, 4.2vw, 3.5rem)" }}
            >
              All eyes on your next post.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-white/70 sm:mt-5 sm:text-base">
              Sign up free and start creating reels, product photos, and posts
              with Krakatoa&apos;s AI suite.
            </p>
            <TextRollButton
              href={isAuthed ? "/dashboard" : "/login"}
              className="pointer-events-auto mt-7 inline-flex items-center gap-2 rounded-full bg-[#F26522] pl-5 pr-2 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#e05a1a] sm:mt-8 sm:pl-6 sm:text-sm"
              iconWrapperClassName="w-7 h-7 sm:w-8 sm:h-8"
              iconVariant="orange"
            >
              {isAuthed ? "Go to dashboard" : "Get started"}
            </TextRollButton>
          </div>
        </div>
      </div>

      {/* Bottom footer bar: logo (left), copyright (center), support pill (right) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 px-5 pb-4 sm:grid sm:grid-cols-3 sm:items-center sm:px-8 sm:pb-5 lg:px-12 lg:pb-6">
        <Image
          src="/Logo White transparent.svg"
          alt="Krakatoa"
          width={40}
          height={40}
          className="h-9 w-9 shrink-0 object-contain sm:justify-self-start"
        />

        <p className="text-center text-[11px] font-medium tracking-wide text-white/50 sm:justify-self-center sm:text-xs">
          &copy; 2025 Krakatoa. Built for the future of content.
        </p>

        <a
          href="mailto:krakatoa.teams@gmail.com"
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[11px] font-medium text-white/80 backdrop-blur-sm transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white sm:justify-self-end sm:text-xs"
        >
          <Mail className="h-3.5 w-3.5" strokeWidth={2} />
          Need support? We are here
        </a>
      </div>
    </footer>
  );
}

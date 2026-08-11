"use client";

import Image from "next/image";
import { Mail } from "lucide-react";
import { TextRollButton } from "@/components/landing/TextRollButton";
import { useCurrentUser } from "@/lib/auth-context";
import { FOOTER, PRIMARY_CTA } from "@/lib/landing-content";
import { ctaAccent } from "./theme";

export function HelloFooter() {
  const { status } = useCurrentUser();
  const cta =
    status === "authenticated" ? PRIMARY_CTA.authed : PRIMARY_CTA.guest;

  return (
    <footer
      id="experience"
      className="relative flex w-full flex-col bg-[#0a0a0a] px-5 pt-24 pb-6 sm:px-8 sm:pt-32 lg:px-12 lg:pt-40"
    >
      <div className="mx-auto w-full max-w-2xl text-center">
        <h2
          className="font-medium leading-[1.1] tracking-[-0.02em] text-white"
          style={{ fontSize: "clamp(1.75rem, 4.2vw, 3.5rem)" }}
        >
          {FOOTER.heading}
        </h2>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-[#8a8a8a] sm:mt-5 sm:text-base">
          {FOOTER.body}
        </p>
        <TextRollButton
          href={cta.href}
          className={`mt-7 sm:mt-8 ${ctaAccent}`}
          iconVariant="invert"
          iconWrapperClassName="w-7 h-7 sm:w-8 sm:h-8"
        >
          {cta.label}
        </TextRollButton>
      </div>

      {/* Bottom bar: logo (left), copyright (center), support pill (right) */}
      <div className="mx-auto mt-24 flex w-full max-w-[1440px] flex-col items-center gap-3 sm:mt-32 sm:grid sm:grid-cols-3 sm:items-center lg:mt-40">
        <Image
          src="/Logo White transparent.svg"
          alt="Kelolako"
          width={368}
          height={332}
          className="h-9 w-auto shrink-0 object-contain sm:justify-self-start"
        />

        <p className="text-center text-[11px] font-medium tracking-wide text-[#8a8a8a] sm:justify-self-center sm:text-xs">
          {FOOTER.copyright}
        </p>

        <a
          href={`mailto:${FOOTER.supportEmail}`}
          className="inline-flex items-center gap-2 rounded-full border border-[#2a2a2a] px-4 py-2 text-[11px] font-medium text-[#aaaaaa] transition-colors hover:border-[#3a3a3a] hover:bg-white/[0.06] hover:text-white sm:justify-self-end sm:text-xs"
        >
          <Mail className="h-3.5 w-3.5" strokeWidth={2} />
          {FOOTER.supportLabel}
        </a>
      </div>
    </footer>
  );
}

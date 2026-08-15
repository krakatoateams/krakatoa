"use client";

import { HelloHero } from "./HelloHero";
import { HelloStatement } from "./HelloStatement";
import { HelloAbout } from "./HelloAbout";
import { HelloFeatures } from "./HelloFeatures";
import { HelloPricing } from "./HelloPricing";
import { HelloTestimonials } from "./HelloTestimonials";
import { HelloFooter } from "./HelloFooter";

/**
 * Design variant of the landing page. Same sections, same copy (both pages read
 * from lib/landing-content) — restyled into arqe.ai's monochrome language.
 */
export function HelloLanding() {
  return (
    <div className="flex min-h-screen flex-col overflow-x-clip bg-N0 text-N700">
      <HelloHero />
      <HelloStatement />
      <HelloAbout />
      <HelloFeatures />
      <HelloPricing />
      <HelloTestimonials />
      <HelloFooter />
    </div>
  );
}

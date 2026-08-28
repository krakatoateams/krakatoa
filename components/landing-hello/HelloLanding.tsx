"use client";

import { HelloHero } from "./HelloHero";
import { HelloStatement } from "./HelloStatement";
import { HelloAbout } from "./HelloAbout";
import { HelloFeatures } from "./HelloFeatures";
import { HelloPricing } from "./HelloPricing";
import { HelloTestimonials } from "./HelloTestimonials";
import { HelloFooter } from "./HelloFooter";

/**
 * Canonical marketing homepage for `/`. Copy from lib/landing-content;
 * monochrome layout from this folder's section components.
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

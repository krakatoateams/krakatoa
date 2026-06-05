"use client";

import { HeroSectionVideoA } from "./HeroSectionVideo";
import { AboutSectionAlt } from "./AboutSectionAlt";
import { FeaturesSectionAlt } from "./FeaturesSectionAlt";
import { PricingSectionAlt } from "./PricingSectionAlt";
import { TestimonialsSection } from "./TestimonialsSection";
import { SplineShowcaseSection } from "./SplineShowcaseSection";

export function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white text-gray-900 overflow-x-clip font-sans">
      <HeroSectionVideoA />
      <AboutSectionAlt />
      <FeaturesSectionAlt />
      <PricingSectionAlt />
      <TestimonialsSection />
      <SplineShowcaseSection />
    </div>
  );
}

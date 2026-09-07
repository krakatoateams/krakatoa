"use client";

import { StudioFormCard } from "@/components/studio";

export default function CanvasOmniForm({ children }: { children: React.ReactNode }) {
  return <StudioFormCard className="nodrag nowheel !p-3">{children}</StudioFormCard>;
}

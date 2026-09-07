"use client";

import { useEffect, useState } from "react";

/** Tailwind `md` — true after mount on viewports ≥ 768px. */
export function useDesktopMedia(): boolean {
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return desktop;
}

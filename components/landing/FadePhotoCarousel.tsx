"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

/** Crossfading photo stack. Fills its (positioned) parent. */
export function FadePhotoCarousel({
  images,
  intervalMs = 4000,
}: {
  images: string[];
  intervalMs?: number;
}) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (images.length <= 1) return;
    const id = setInterval(
      () => setActive((prev) => (prev + 1) % images.length),
      intervalMs
    );
    return () => clearInterval(id);
  }, [images.length, intervalMs]);

  return (
    <>
      {images.map((src, i) => (
        <Image
          key={src}
          src={src}
          alt="AI-generated content creation"
          fill
          priority={i === 0}
          className={`object-cover object-[center_30%] transition-opacity duration-1000 ease-in-out ${
            i === active ? "opacity-100" : "opacity-0"
          }`}
          sizes="(min-width: 1024px) 50vw, 100vw"
        />
      ))}
    </>
  );
}

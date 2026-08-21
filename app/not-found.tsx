import { ArrowRight } from "lucide-react";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260622_204221_5339e40b-e73d-4ab0-9c65-79c18c66fd50.mp4";

export default function NotFound() {
  return (
    <div
      className="relative h-screen w-full overflow-hidden bg-black"
      style={{ fontFamily: "'Geist', sans-serif" }}
    >
      {/* Geist (weights 300–700) — the app default is Inter, so load it here
          just for this page. Next hoists these tags into <head>. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin="anonymous"
      />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&display=swap"
      />

      {/* Background video — sits behind all content. */}
      <video
        autoPlay
        muted
        loop
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
        style={{ objectPosition: "70% center" }}
      >
        <source src={VIDEO_URL} type="video/mp4" />
      </video>

      {/* 404 — centered, with the CTA below the text. */}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-6 text-center">
        <span className="text-7xl font-medium leading-none tracking-tight text-white [animation:fadeSlideUp_0.8s_ease_0.2s_both] sm:text-8xl md:text-[10rem] lg:text-[12rem]">
          404
        </span>
        <p className="mt-4 text-base text-white/60 [animation:fadeSlideUp_0.8s_ease_0.5s_both] sm:mt-6 sm:text-lg">
          Nothing at this address.
        </p>
        <a
          href="/"
          className="mt-7 inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-black transition-transform [animation:fadeSlideUp_0.8s_ease_0.9s_both] hover:scale-105 sm:mt-8 sm:px-6 sm:py-3"
        >
          Go to homepage <ArrowRight size={16} />
        </a>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Mountain, X } from "lucide-react";

export function GrowthToggleLogin() {
  const [on, setOn] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const { status } = useSession();
  const router = useRouter();

  const closeModal = useCallback(() => {
    setShowModal(false);
    setOn(false);
  }, []);

  useEffect(() => {
    if (!showModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showModal, closeModal]);

  const handleToggle = () => {
    const next = !on;
    setOn(next);
    if (!next) {
      setShowModal(false);
      return;
    }
    if (status === "authenticated") {
      router.push("/dashboard");
      return;
    }
    setShowModal(true);
  };

  return (
    <>
      <div className="flex flex-col items-center gap-0">
        <p className="font-emoji text-xl font-medium text-slate-700 tracking-wide">
          start your
        </p>
        <div
          className="inline-flex items-baseline font-display font-bold tracking-tight text-neutral-800 select-none -my-2.5"
          style={{ fontSize: "clamp(3rem, 11vw, 5.75rem)" }}
        >
          <span className="leading-none">gr</span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Growth mode"
            onClick={handleToggle}
            className="relative mx-[0.06em] inline-flex shrink-0 cursor-pointer items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-500"
            style={{
              width: "1.12em",
              height: "0.52em",
              marginTop: "0.06em",
            }}
          >
            <span
              className="absolute inset-0 rounded-full bg-gradient-to-r from-violet-200 via-violet-300 to-violet-500 shadow-inner"
              aria-hidden
            />
            <span
              className="absolute top-1/2 rounded-full bg-white shadow-md transition-transform duration-300 ease-out"
              style={{
                width: "0.4em",
                height: "0.4em",
                left: on ? "calc(100% - 0.4em - 0.06em)" : "0.06em",
                transform: "translateY(-50%)",
              }}
              aria-hidden
            />
          </button>
          <span className="leading-none">wth</span>
        </div>
      </div>

      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="growth-login-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className="relative w-full max-w-md rounded-3xl bg-white p-8 soft-shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeModal}
              aria-label="Close"
              className="absolute right-4 top-4 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-950"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-950">
                <Mountain className="h-5 w-5 text-white" />
              </div>
              <span className="font-display text-lg font-semibold tracking-tight text-neutral-950">
                Krakatoa
              </span>
            </div>

            <h2
              id="growth-login-title"
              className="font-display text-2xl font-semibold tracking-tight text-neutral-950"
            >
              Start Creating Free
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">
              The all-in-one creative engine for modern brands. Sign in to generate,
              automate, and dominate your social presence with Krakatoa&apos;s AI suite.
            </p>

            <button
              type="button"
              onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
              className="mt-8 flex w-full cursor-pointer items-center justify-center gap-3 rounded-full bg-neutral-950 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-neutral-800"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </button>
          </div>
        </div>
      )}
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { AuthModalShell } from "./AuthModalShell";
import { SignInForm } from "./SignInForm";
import { SignUpForm } from "./SignUpForm";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

type View = "signin" | "signup" | "forgot-password";

const ARIA_LABELS: Record<View, string> = {
  signin: "Sign in",
  signup: "Sign up",
  "forgot-password": "Forgot password",
};

export function SignInModal({
  open,
  initialView = "signin",
  next,
  onClose,
}: {
  open: boolean;
  /** Which form to land on when the modal opens — see openSignUpModal. */
  initialView?: "signin" | "signup";
  next?: string;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>(initialView);

  // Reset to the requested view every time this modal opens — otherwise
  // closing mid "forgot password" (or leaving it on "signup" from a prior
  // open) would strand the next open on the wrong view.
  useEffect(() => {
    if (open) setView(initialView);
  }, [open, initialView]);

  return (
    <AuthModalShell open={open} onClose={onClose} ariaLabel={ARIA_LABELS[view]}>
      {view === "signin" ? (
        <SignInForm
          next={next}
          onSuccess={onClose}
          onForgotPassword={() => setView("forgot-password")}
          onSwitchToSignUp={() => setView("signup")}
        />
      ) : view === "signup" ? (
        <SignUpForm next={next} onSwitchToSignIn={() => setView("signin")} />
      ) : (
        <ForgotPasswordForm onBackToSignIn={() => setView("signin")} />
      )}
    </AuthModalShell>
  );
}

"use client";

import { useEffect, useState } from "react";
import { AuthModalShell } from "./AuthModalShell";
import { AuthPromoPanel } from "./AuthPromoPanel";
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
  const [busy, setBusy] = useState(false);

  // Reset to the requested view every time this modal opens — otherwise
  // closing mid "forgot password" (or leaving it on "signup" from a prior
  // open) would strand the next open on the wrong view.
  useEffect(() => {
    if (open) {
      setView(initialView);
    } else {
      setBusy(false);
    }
  }, [open, initialView]);

  return (
    <AuthModalShell
      open={open}
      onClose={onClose}
      closeDisabled={busy}
      ariaLabel={ARIA_LABELS[view]}
      promoPanel={<AuthPromoPanel mode={view} />}
    >
      {view === "signin" ? (
        <SignInForm
          next={next}
          onSuccess={onClose}
          onBusyChange={setBusy}
          onForgotPassword={() => setView("forgot-password")}
          onSwitchToSignUp={() => setView("signup")}
        />
      ) : view === "signup" ? (
        <SignUpForm
          next={next}
          onBusyChange={setBusy}
          onSwitchToSignIn={() => setView("signin")}
        />
      ) : (
        <ForgotPasswordForm
          next={next}
          onBusyChange={setBusy}
          onBackToSignIn={() => setView("signin")}
        />
      )}
    </AuthModalShell>
  );
}

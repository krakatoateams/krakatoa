"use client";

import { useEffect, useState } from "react";
import { AuthModalShell } from "./AuthModalShell";
import { SignInForm } from "./SignInForm";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

type View = "signin" | "forgot-password";

export function SignInModal({
  open,
  next,
  onClose,
}: {
  open: boolean;
  next?: string;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>("signin");

  // Always land back on the sign-in form next time this modal opens —
  // otherwise closing mid "forgot password" would strand the next open on
  // the wrong view.
  useEffect(() => {
    if (open) setView("signin");
  }, [open]);

  return (
    <AuthModalShell
      open={open}
      onClose={onClose}
      ariaLabel={view === "signin" ? "Sign in" : "Forgot password"}
    >
      {view === "signin" ? (
        <SignInForm
          next={next}
          onSuccess={onClose}
          onForgotPassword={() => setView("forgot-password")}
        />
      ) : (
        <ForgotPasswordForm onBackToSignIn={() => setView("signin")} />
      )}
    </AuthModalShell>
  );
}

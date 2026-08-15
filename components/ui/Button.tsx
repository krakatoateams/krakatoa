"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "danger" | "on-media";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  children: ReactNode;
  /**
   * Style-guide use only: forces the hover or pressed visual treatment
   * without requiring a real pointer event. Leave unset for normal usage —
   * real interaction relies on native hover/active pseudo-classes.
   */
  previewState?: "hover" | "pressed";
}

const SIZE_STYLES: Record<ButtonSize, string> = {
  lg: "h-12 px-spacing-xl text-button-lg",
  md: "h-10 px-spacing-lg text-button-md",
  sm: "h-8 px-spacing-md text-button-sm",
};

const ICON_SIZE = "h-4 w-4 shrink-0";

type VariantRecipe = {
  enabled: string;
  hover: string;
  pressed: string;
  interactive: string;
  spinner: string;
};

// Every value below is a complete, literal class string (never built via
// runtime template interpolation) so Tailwind's static scanner can find
// pseudo-class variants like `hover:` and `active:` at build time.
const VARIANT_STYLES: Record<ButtonVariant, VariantRecipe> = {
  primary: {
    enabled: "bg-gradient-to-br from-brand-primary-light to-brand-primary text-text-on-solid",
    hover:
      "bg-gradient-to-br from-brand-primary-gradient-hover-start to-brand-primary-gradient-hover-end text-text-on-solid",
    pressed: "bg-brand-primary-gradient-pressed text-text-on-solid",
    interactive:
      "bg-gradient-to-br from-brand-primary-light to-brand-primary text-text-on-solid hover:from-brand-primary-gradient-hover-start hover:to-brand-primary-gradient-hover-end active:bg-none active:bg-brand-primary-gradient-pressed",
    spinner: "border-white/30 border-t-current",
  },
  secondary: {
    enabled: "bg-secondary-enabled text-brand-primary",
    hover: "bg-secondary-hover text-brand-primary",
    pressed: "bg-secondary-pressed text-brand-primary",
    interactive:
      "bg-secondary-enabled text-brand-primary hover:bg-secondary-hover active:bg-secondary-pressed",
    spinner: "border-spinner-track-brand border-t-brand-primary",
  },
  tertiary: {
    enabled: "bg-transparent text-brand-primary",
    hover: "bg-tertiary-hover text-brand-primary",
    pressed: "bg-tertiary-pressed text-brand-primary",
    interactive:
      "bg-transparent text-brand-primary hover:bg-tertiary-hover active:bg-tertiary-pressed",
    spinner: "border-spinner-track-brand border-t-brand-primary",
  },
  danger: {
    enabled: "bg-error text-text-on-solid",
    hover: "bg-danger-hover text-text-on-solid",
    pressed: "bg-danger-pressed text-text-on-solid",
    interactive: "bg-error text-text-on-solid hover:bg-danger-hover active:bg-danger-pressed",
    spinner: "border-white/30 border-t-current",
  },
  "on-media": {
    enabled: "bg-overlay-scrim text-text-on-solid border border-onmedia-border",
    hover: "bg-overlay-scrim-hover text-text-on-solid border border-onmedia-border",
    pressed: "bg-onmedia-pressed text-text-on-solid border border-onmedia-border",
    interactive:
      "bg-overlay-scrim text-text-on-solid border border-onmedia-border hover:bg-overlay-scrim-hover active:bg-onmedia-pressed",
    spinner: "border-white/30 border-t-current",
  },
};

const DISABLED_STYLES = "bg-bg-surface-2 text-text-secondary border border-border-default";

const BASE_STYLES = [
  "inline-flex items-center justify-center gap-spacing-sm rounded-radius-xl",
  "font-body font-semibold whitespace-nowrap",
  "transition-colors duration-150",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
  "focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
  "disabled:cursor-not-allowed",
].join(" ");

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    disabled = false,
    icon: Icon,
    children,
    previewState,
    className,
    type = "button",
    ...rest
  },
  ref
) {
  const recipe = VARIANT_STYLES[variant];
  const stateClasses = disabled
    ? DISABLED_STYLES
    : previewState === "hover"
      ? recipe.hover
      : previewState === "pressed"
        ? recipe.pressed
        : recipe.interactive;

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-disabled={disabled ? true : undefined}
      aria-busy={loading ? true : undefined}
      className={[BASE_STYLES, SIZE_STYLES[size], stateClasses, className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {loading ? (
        <span
          className={`${ICON_SIZE} animate-spin rounded-full border-2 ${recipe.spinner}`}
          aria-hidden="true"
        />
      ) : (
        <>
          {Icon ? <Icon className={ICON_SIZE} aria-hidden="true" /> : null}
          <span>{children}</span>
        </>
      )}
    </button>
  );
});

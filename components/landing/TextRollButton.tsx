import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type BaseProps = {
  children: ReactNode;
  className?: string;
  textClassName?: string;
  iconWrapperClassName?: string;
  iconClassName?: string;
  showIcon?: boolean;
  /** Icon rendered in the circle. Defaults to ArrowRight. */
  icon?: LucideIcon;
  /** Hover transform for the icon circle. Defaults to a -45deg rotate. */
  iconHoverClassName?: string;
  /**
   * dark = white circle on gray-900 button; orange = white circle with orange
   * arrow; invert = dark circle with white arrow, for light-on-dark pills.
   */
  iconVariant?: IconVariant;
};

type IconVariant = "dark" | "orange" | "invert";

const ICON_CIRCLE_CLASS: Record<IconVariant, string> = {
  dark: "bg-white",
  orange: "bg-white",
  invert: "bg-[#111111]",
};

const ICON_ARROW_CLASS: Record<IconVariant, string> = {
  dark: "text-gray-900",
  orange: "text-[#F26522]",
  invert: "text-white",
};

type ButtonProps = BaseProps &
  ComponentPropsWithoutRef<"button"> & { href?: undefined };

type LinkProps = BaseProps &
  ComponentPropsWithoutRef<typeof Link> & { href: string };

function RollLabel({ children, textClassName }: { children: ReactNode; textClassName?: string }) {
  return (
    <span className={`flex flex-col overflow-hidden h-5 ${textClassName ?? ""}`}>
      <span className="flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)] group-hover:-translate-y-1/2">
        <span>{children}</span>
        <span>{children}</span>
      </span>
    </span>
  );
}

function IconCircle({
  iconWrapperClassName,
  iconClassName,
  iconVariant = "orange",
  icon: Icon = ArrowRight,
  iconHoverClassName = "group-hover:-rotate-45",
}: {
  iconWrapperClassName?: string;
  iconClassName?: string;
  iconVariant?: IconVariant;
  icon?: LucideIcon;
  iconHoverClassName?: string;
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full ${ICON_CIRCLE_CLASS[iconVariant]} ${iconWrapperClassName ?? "w-6 h-6"}`}
    >
      <Icon
        className={`transition-transform duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${iconHoverClassName} ${ICON_ARROW_CLASS[iconVariant]} ${iconClassName ?? "w-3.5 h-3.5"}`}
      />
    </span>
  );
}

export function TextRollButton({
  children,
  className = "",
  textClassName,
  iconWrapperClassName,
  iconClassName,
  showIcon = true,
  icon,
  iconHoverClassName,
  iconVariant = "orange",
  href,
  ...rest
}: ButtonProps | LinkProps) {
  const inner = (
    <>
      <RollLabel textClassName={textClassName}>{children}</RollLabel>
      {showIcon && (
        <IconCircle
          iconWrapperClassName={iconWrapperClassName}
          iconClassName={iconClassName}
          iconVariant={iconVariant}
          icon={icon}
          iconHoverClassName={iconHoverClassName}
        />
      )}
    </>
  );

  const baseClass = `group inline-flex items-center gap-2 cursor-pointer ${className}`;

  if (href) {
    return (
      <Link href={href} className={baseClass} {...(rest as Omit<ComponentPropsWithoutRef<typeof Link>, "href">)}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" className={baseClass} {...(rest as ButtonProps)}>
      {inner}
    </button>
  );
}

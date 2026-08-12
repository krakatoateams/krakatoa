"use client";

import { ArrowRight, Trash2, Play } from "lucide-react";
import { Button, type ButtonVariant, type ButtonSize } from "@/components/ui/Button";

const VARIANTS: { key: ButtonVariant; label: string; icon: typeof ArrowRight }[] = [
  { key: "primary", label: "Primary", icon: ArrowRight },
  { key: "secondary", label: "Secondary", icon: ArrowRight },
  { key: "tertiary", label: "Tertiary", icon: ArrowRight },
  { key: "danger", label: "Danger", icon: Trash2 },
  { key: "on-media", label: "On Media", icon: Play },
];

const BUTTON_SIZES: ButtonSize[] = ["lg", "md", "sm"];

const STATE_ROWS = [
  { key: "enabled", label: "Enabled" },
  { key: "hover", label: "Hover" },
  { key: "pressed", label: "Pressed" },
  { key: "loading", label: "Loading" },
  { key: "disabled", label: "Disabled" },
] as const;

function renderStateButton(
  variant: ButtonVariant,
  size: ButtonSize,
  icon: typeof ArrowRight,
  label: string,
  state: (typeof STATE_ROWS)[number]["key"]
) {
  const Icon = icon;
  if (state === "loading") {
    return (
      <Button variant={variant} size={size} loading>
        {label}
      </Button>
    );
  }
  if (state === "disabled") {
    return (
      <Button variant={variant} size={size} disabled icon={Icon}>
        {label}
      </Button>
    );
  }
  if (state === "hover" || state === "pressed") {
    return (
      <Button variant={variant} size={size} previewState={state} icon={Icon}>
        {label}
      </Button>
    );
  }
  return (
    <Button variant={variant} size={size} icon={Icon}>
      {label}
    </Button>
  );
}

export default function ButtonPage() {
  return (
    <section className="space-y-spacing-xxl">
      <header>
        <h1 className="font-display text-h1 font-bold">Button</h1>
        <p className="mt-spacing-sm text-body-3 text-text-secondary">
          Five variants (<code className="text-body-3">primary</code>,{" "}
          <code className="text-body-3">secondary</code>,{" "}
          <code className="text-body-3">tertiary</code>,{" "}
          <code className="text-body-3">danger</code>,{" "}
          <code className="text-body-3">on-media</code>) across three sizes and five states —
          every combination below is the real <code className="text-body-3">components/ui/Button</code>{" "}
          component, not a mockup. Use <code className="text-body-3">primary</code> for the one
          main action per view, <code className="text-body-3">secondary</code>/
          <code className="text-body-3">tertiary</code> for supporting actions,{" "}
          <code className="text-body-3">danger</code> for destructive actions, and{" "}
          <code className="text-body-3">on-media</code> only over photo/video backgrounds.
          Hover/Pressed rows use the <code className="text-body-3">previewState</code> prop to show
          those states without requiring a live pointer; Loading and Disabled use the component&apos;s
          real props.
        </p>
      </header>

      {BUTTON_SIZES.map((size) => (
        <div key={size} className="space-y-spacing-lg">
          <h2 className="font-display text-h3 font-bold capitalize">{size} size</h2>
          <div className="overflow-x-auto rounded-radius-lg border border-border-default">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-bg-surface">
                  <th className="w-28 border-b border-border-default p-spacing-lg text-left text-extra-small text-text-secondary">
                    State
                  </th>
                  {VARIANTS.map((v) => (
                    <th
                      key={v.key}
                      className="border-b border-l border-border-default p-spacing-lg text-left text-extra-small text-text-secondary"
                    >
                      {v.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {STATE_ROWS.map((row) => (
                  <tr key={row.key}>
                    <td className="border-b border-border-default p-spacing-lg text-extra-small text-text-secondary">
                      {row.label}
                    </td>
                    {VARIANTS.map((v) => (
                      <td key={v.key} className="border-b border-l border-border-default p-spacing-lg">
                        {renderStateButton(v.key, size, v.icon, v.label, row.key)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}

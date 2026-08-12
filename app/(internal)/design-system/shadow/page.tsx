import { shadowScale } from "../tokens";

// Usage notes as documented in the Figma-verified shadow/elevation token doc.
const USAGE_NOTES: Record<string, string> = {
  "elevation-00": "Background / base level — no visible shadow.",
  "elevation-01": "Card, Snackbar, Notification Badge.",
  "elevation-02":
    "Dropdown menu, Button raised (on hover), Card raised (on hold), Popover, FAB, Modals, Dialogs.",
};

export default function ShadowPage() {
  return (
    <section className="space-y-spacing-lg">
      <header>
        <h1 className="font-display text-h1 font-bold">Shadow</h1>
        <p className="mt-spacing-sm text-body-3 text-text-secondary">
          Elevation communicates stacking order, not decoration — use the lowest level that gets
          the job done.
        </p>
      </header>
      <div className="flex flex-wrap gap-spacing-xl">
        {shadowScale.map((step) => (
          <div key={step.name} className="flex w-56 flex-col items-start gap-spacing-md">
            <div
              className="h-16 w-32 rounded-radius-md bg-bg-surface"
              style={{ boxShadow: step.value }}
            />
            <div>
              <p className="text-body-3 font-semibold text-text-primary">{step.name}</p>
              {USAGE_NOTES[step.name] ? (
                <p className="mt-spacing-sm text-body-3 text-text-secondary">
                  {USAGE_NOTES[step.name]}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

import { radiusScale } from "../tokens";

export default function RadiusPage() {
  return (
    <section className="space-y-spacing-lg">
      <header>
        <h1 className="font-display text-h1 font-bold">Radius</h1>
        <p className="mt-spacing-sm text-body-3 text-text-secondary">
          Smaller steps (<code className="text-body-3">radius-xs</code>–
          <code className="text-body-3">radius-sm</code>) suit inputs, chips, and small controls.
          <code className="text-body-3">radius-md</code>–<code className="text-body-3">radius-lg</code>{" "}
          is the default for cards and buttons. The largest steps (
          <code className="text-body-3">radius-2xl</code> and up) are for large surfaces like
          modals and hero panels.
        </p>
      </header>
      <div className="flex flex-wrap gap-spacing-lg">
        {radiusScale.map((step) => (
          <div key={step.name} className="flex flex-col items-start gap-spacing-sm">
            <div
              className="h-16 w-16 border border-border-default bg-bg-surface"
              style={{ borderRadius: step.value }}
            />
            <p className="text-body-3 text-text-secondary">
              {step.name} · {step.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

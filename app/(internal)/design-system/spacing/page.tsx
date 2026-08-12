import { spacingScale } from "../tokens";

export default function SpacingPage() {
  return (
    <section className="space-y-spacing-lg">
      <header>
        <h1 className="font-display text-h1 font-bold">Spacing</h1>
        <p className="mt-spacing-sm text-body-3 text-text-secondary">
          8px is the base unit — every step is a multiple of it. Reach for the smaller steps (
          <code className="text-body-3">spacing-sm</code>/
          <code className="text-body-3">spacing-md</code>) for tight in-component gaps like
          icon-to-label or form padding, and the larger steps (
          <code className="text-body-3">spacing-xl</code> and up) for section and layout spacing.
        </p>
      </header>
      <div className="flex flex-wrap items-end gap-spacing-lg">
        {spacingScale.map((step) => (
          <div key={step.name} className="flex flex-col items-start gap-spacing-sm">
            <div className="bg-brand-primary" style={{ width: step.value, height: step.value }} />
            <p className="text-body-3 text-text-secondary">
              {step.name} · {step.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

import { typographyScale } from "../tokens";

export default function TypographyPage() {
  return (
    <section className="space-y-spacing-lg">
      <header>
        <h1 className="font-display text-h1 font-bold">Typography</h1>
        <p className="mt-spacing-sm text-body-3 text-text-secondary">
          Space Grotesk (<code className="text-body-3">font-display</code>, Bold) is for headings
          — H1 through H3. Inter (<code className="text-body-3">font-ds-body</code>) is for
          everything else — body copy, labels, and UI text — at the weight shown per step.
        </p>
      </header>
      <div className="space-y-spacing-lg">
        {typographyScale.map((step) => (
          <div key={step.name} className="border-b border-border-default pb-spacing-lg">
            <p
              className={step.name.startsWith("h") ? "font-display font-bold" : "font-ds-body"}
              style={{ fontSize: step.size, lineHeight: step.lineHeight }}
            >
              {step.name} — The quick brown fox
            </p>
            <p className="mt-spacing-sm text-body-3 text-text-secondary">
              {step.size} / {step.lineHeight}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

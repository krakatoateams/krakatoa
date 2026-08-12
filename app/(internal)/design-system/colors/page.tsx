import { rawColorScales, alphaSwatches, semanticSwatches } from "../tokens";

export default function ColorsPage() {
  return (
    <section className="space-y-spacing-xl">
      <header>
        <h1 className="font-display text-h1 font-bold">Colors</h1>
        <p className="mt-spacing-sm text-body-3 text-text-secondary">
          The raw scale is the source of truth for every hex value in this system — reach for it
          directly only when defining a new semantic alias. Semantic aliases (
          <code className="text-body-3">text-primary</code>,{" "}
          <code className="text-body-3">bg-surface</code>,{" "}
          <code className="text-body-3">brand-primary</code>, etc.) carry meaning and are what
          components should actually use.
        </p>
      </header>

      <div className="space-y-spacing-lg">
        <h2 className="font-display text-h3 font-bold">Raw scale</h2>
        {rawColorScales.map((scale) => (
          <div key={scale.label}>
            <p className="mb-spacing-sm text-body-3 text-text-secondary">{scale.label}</p>
            <div className="flex flex-wrap gap-spacing-sm">
              {scale.swatches.map((swatch) => (
                <div key={swatch.name} className="w-20">
                  <div
                    className="h-16 rounded-radius-md border border-border-default"
                    style={{ backgroundColor: swatch.hex }}
                  />
                  <p className="mt-spacing-sm text-extra-small">{swatch.name}</p>
                  <p className="text-extra-small text-text-secondary">{swatch.hex}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-spacing-sm">
        <h2 className="font-display text-h3 font-bold">Alpha</h2>
        <div className="flex flex-wrap gap-spacing-sm">
          {alphaSwatches.map((swatch) => (
            <div key={swatch.name} className="w-32">
              <div
                className="h-16 rounded-radius-md border border-border-default bg-bg-base"
                style={{ backgroundColor: swatch.value }}
              />
              <p className="mt-spacing-sm text-extra-small">{swatch.name}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-spacing-sm">
        <h2 className="font-display text-h3 font-bold">Semantic aliases</h2>
        <div className="flex flex-wrap gap-spacing-sm">
          {semanticSwatches.map((swatch) => (
            <div key={swatch.name} className="w-32">
              <div
                className="h-16 rounded-radius-md border border-border-default"
                style={{ backgroundColor: swatch.value }}
              />
              <p className="mt-spacing-sm break-all text-extra-small">{swatch.name}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Fit the editor's preview canvas inside the available stage area ("contain"
 * sizing): as large as possible on the constraining axis while staying
 * fully inside the stage and preserving the target aspect ratio.
 *
 * Pure — no DOM — so it stays runnable as a self-check
 * (`npx tsx lib/editor-preview-size.ts`), mirroring lib/aspect-ratio-match.ts.
 */

export function containSize(
  stage: { w: number; h: number },
  ratio: { w: number; h: number },
  minSize = 0,
): { width: number; height: number } {
  if (!(stage.w > 0) || !(stage.h > 0) || !(ratio.w > 0) || !(ratio.h > 0)) {
    const height = minSize * (ratio.h > 0 && ratio.w > 0 ? ratio.h / ratio.w : 1);
    return { width: minSize, height };
  }

  const targetAspect = ratio.w / ratio.h;
  const stageAspect = stage.w / stage.h;

  let width: number;
  let height: number;
  if (targetAspect > stageAspect) {
    width = stage.w;
    height = width / targetAspect;
  } else {
    height = stage.h;
    width = height * targetAspect;
  }

  if (width < minSize || height < minSize) {
    const scale = Math.max(minSize / width, minSize / height);
    width *= scale;
    height *= scale;
  }

  return { width, height };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export function editorPreviewSizeSelfCheck(): void {
  // 9:16 canvas in a wide stage — height is the constraint.
  {
    const { width, height } = containSize({ w: 1000, h: 600 }, { w: 720, h: 1280 });
    assert(Math.abs(height - 600) < 1e-9, "9:16 in a wide stage must fill the stage height");
    assert(width < 1000, "9:16 in a wide stage must not fill the stage width");
    assert(Math.abs(width / height - 720 / 1280) < 1e-9, "aspect ratio must be preserved");
  }

  // 16:9 canvas in a tall stage — width is the constraint.
  {
    const { width, height } = containSize({ w: 500, h: 900 }, { w: 1280, h: 720 });
    assert(Math.abs(width - 500) < 1e-9, "16:9 in a tall stage must fill the stage width");
    assert(height < 900, "16:9 in a tall stage must not fill the stage height");
    assert(Math.abs(width / height - 1280 / 720) < 1e-9, "aspect ratio must be preserved");
  }

  // 1:1 canvas — the tighter of width/height binds.
  {
    const { width, height } = containSize({ w: 400, h: 900 }, { w: 1080, h: 1080 });
    assert(Math.abs(width - 400) < 1e-9, "1:1 in a narrow stage must fill the stage width");
    assert(Math.abs(height - 400) < 1e-9, "1:1 must stay square");
  }

  // Never overflow either stage dimension.
  for (const stage of [
    { w: 1200, h: 800 },
    { w: 300, h: 900 },
    { w: 600, h: 600 },
  ]) {
    for (const ratio of [
      { w: 720, h: 1280 },
      { w: 1080, h: 1080 },
      { w: 1280, h: 720 },
    ]) {
      const { width, height } = containSize(stage, ratio);
      assert(width <= stage.w + 1e-6, "computed width must not exceed the stage width");
      assert(height <= stage.h + 1e-6, "computed height must not exceed the stage height");
    }
  }

  // A minimum usable size overrides contain sizing on a collapsed stage,
  // but the aspect ratio still holds.
  {
    const { width, height } = containSize({ w: 10, h: 10 }, { w: 720, h: 1280 }, 160);
    assert(width >= 160 - 1e-9, "minSize must be respected on the narrow axis");
    assert(height >= 160 - 1e-9, "minSize must be respected on the tall axis");
    assert(Math.abs(width / height - 720 / 1280) < 1e-6, "aspect ratio must survive the minSize floor");
  }

  // No stage measurement yet (initial render before ResizeObserver fires).
  {
    const { width, height } = containSize({ w: 0, h: 0 }, { w: 720, h: 1280 }, 160);
    assert(width === 160, "an unmeasured stage must fall back to minSize width");
    assert(Math.abs(height - 160 * (1280 / 720)) < 1e-9, "fallback must still honor the ratio");
  }
}

if (require.main === module) {
  editorPreviewSizeSelfCheck();
  console.log("editorPreviewSizeSelfCheck: ok");
}

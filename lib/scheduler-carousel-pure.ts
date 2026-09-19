/**
 * Pure decision logic behind two Scheduler behaviors, extracted so they're
 * testable without React state or upload I/O (see CONTEXT.md's Carousel /
 * Separate posts entries for the vocabulary):
 *
 * - planDroppedItems: the Q2 default — 2+ photos in one drop become ONE
 *   carousel item; 0 or 1 photo (plus any videos) stay as separate items.
 * - splitCarouselPhotos: the undo — turns a carousel's photo list back into
 *   one group per photo, for the "Split into separate posts" control.
 */

export type DroppedFileKind = "photo" | "video";

export type PlannedItem =
  | { kind: "carousel"; photoCount: number }
  | { kind: "single"; contentType: DroppedFileKind };

/**
 * Order matches handleFilesAdded's real behavior: the photo group (carousel
 * or singles) is planned first, videos after.
 */
export function planDroppedItems(files: DroppedFileKind[]): PlannedItem[] {
  const photoCount = files.filter((f) => f === "photo").length;
  const videoCount = files.filter((f) => f === "video").length;

  const items: PlannedItem[] = [];
  if (photoCount >= 2) {
    items.push({ kind: "carousel", photoCount });
  } else {
    for (let i = 0; i < photoCount; i++) {
      items.push({ kind: "single", contentType: "photo" });
    }
  }
  for (let i = 0; i < videoCount; i++) {
    items.push({ kind: "single", contentType: "video" });
  }
  return items;
}

/**
 * One URL per resulting group, order preserved. Callers only invoke this
 * when photoUrls.length >= 2 (a 0/1-photo carousel is a caller-level no-op,
 * not this function's concern).
 */
export function splitCarouselPhotos(photoUrls: string[]): string[][] {
  return photoUrls.map((url) => [url]);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
}

export function schedulerCarouselSelfCheck(): void {
  // planDroppedItems
  assertEqual(planDroppedItems([]), [], "empty drop");
  assertEqual(
    planDroppedItems(["photo"]),
    [{ kind: "single", contentType: "photo" }],
    "single photo stays a single item",
  );
  assertEqual(
    planDroppedItems(["photo", "photo"]),
    [{ kind: "carousel", photoCount: 2 }],
    "2 photos merge into one carousel",
  );
  assertEqual(
    planDroppedItems(["photo", "photo", "photo", "photo", "photo"]),
    [{ kind: "carousel", photoCount: 5 }],
    "5 photos merge into one carousel",
  );
  assertEqual(
    planDroppedItems(["video"]),
    [{ kind: "single", contentType: "video" }],
    "single video stays a single item",
  );
  assertEqual(
    planDroppedItems(["photo", "video"]),
    [{ kind: "single", contentType: "photo" }, { kind: "single", contentType: "video" }],
    "1 photo + 1 video: no merge, photo first",
  );
  assertEqual(
    planDroppedItems(["photo", "photo", "photo", "video", "video"]),
    [{ kind: "carousel", photoCount: 3 }, { kind: "single", contentType: "video" }, { kind: "single", contentType: "video" }],
    "3 photos merge into one carousel, videos stay separate and come after",
  );

  // splitCarouselPhotos
  assertEqual(splitCarouselPhotos(["a", "b", "c"]), [["a"], ["b"], ["c"]], "3 photos split into 3 groups, order preserved");
  assertEqual(splitCarouselPhotos([]), [], "empty input splits to nothing");
}

if (require.main === module) {
  schedulerCarouselSelfCheck();
  console.log("schedulerCarouselSelfCheck: ok");
}

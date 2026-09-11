import {
  consumePendingDraftForOwner,
  hasPendingDraftForOwner,
  peekPendingDraftRaw,
  savePendingDraft,
} from "./pending-form-draft";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`pending-form-draft self-check: ${msg}`);
}

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

export function pendingFormDraftSelfCheck(): void {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });

  const path = "/tools/video";
  savePendingDraft(path, {
    draftOwner: "video:image-to-video",
    modelId: "seedance2_fast",
    prompt: "animate this",
  });

  assert(
    consumePendingDraftForOwner(path, "video:text-to-video") === null,
    "a mounted sibling must not consume another composer's draft",
  );

  const imageDraft = consumePendingDraftForOwner<{
    modelId?: string;
    prompt?: string;
  }>(path, "video:image-to-video");
  assert(imageDraft?.modelId === "seedance2_fast", "the owning composer restores its model");
  assert(imageDraft?.prompt === "animate this", "the owning composer restores its prompt");
  assert(
    consumePendingDraftForOwner(path, "video:image-to-video") === null,
    "an accepted draft is consumed exactly once",
  );

  savePendingDraft(path, {
    draftOwner: "video:storyboard-to-video",
    promptDraft: "x".repeat(1_450),
    selectedId: "storyboard-1",
    videoModelId: "seedance2_fast",
    resolution: "720p",
    aspectRatio: "9:16",
    language: "indonesian",
    devBlank: false,
  });
  assert(
    peekPendingDraftRaw(path) !== null,
    "a maximum-length storyboard prompt must fit the OAuth URL fallback",
  );
  consumePendingDraftForOwner(path, "video:storyboard-to-video");

  const oversizedDraft = JSON.stringify({
    draftOwner: "video:image-to-video",
    prompt: "x".repeat(5_000),
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        pathname: path,
        search: `?kdraft=${encodeURIComponent(oversizedDraft)}`,
        hash: "",
      },
      history: {
        replaceState() {},
      },
    },
  });
  assert(
    consumePendingDraftForOwner(path, "video:image-to-video") === null,
    "an oversized URL fallback must be rejected before parsing",
  );

  const importDraft = JSON.stringify({
    draftOwner: "video:storyboard-import",
    description: "A rooftop chase",
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        pathname: path,
        search: `?kdraft=${encodeURIComponent(importDraft)}`,
        hash: "",
      },
      history: {
        replaceState() {},
      },
    },
  });
  assert(
    hasPendingDraftForOwner(path, "video:storyboard-import"),
    "an owner-scoped URL fallback must reopen the matching form",
  );
  assert(
    !hasPendingDraftForOwner(path, "video:storyboard-to-video"),
    "an owner-scoped URL fallback must not reopen a sibling form",
  );
}

pendingFormDraftSelfCheck();
console.log("pending-form-draft self-check passed");

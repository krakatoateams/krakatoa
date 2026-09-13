import {
  consumePendingDraftForOwner,
  hasPendingDraftForOwner,
  pendingDraftOwner,
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

  has(key: string): boolean {
    return this.values.has(key);
  }
}

export function pendingFormDraftSelfCheck(): void {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: storage,
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
    pendingDraftOwner(path) === "video:storyboard-to-video",
    "a large text draft must stay available in same-tab session storage",
  );
  consumePendingDraftForOwner(path, "video:storyboard-to-video");

  const externalDraft = JSON.stringify({
    draftOwner: "video:storyboard-import",
    description: "A rooftop chase",
  });
  let cleanedUrl = "";
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        pathname: path,
        search: `?kdraft=${encodeURIComponent(externalDraft)}`,
        hash: "",
      },
      history: {
        replaceState(_state: unknown, _title: string, url: string) {
          cleanedUrl = url;
        },
      },
    },
  });
  assert(
    !hasPendingDraftForOwner(path, "video:storyboard-import"),
    "an unsigned URL must never count as a pending draft",
  );
  assert(
    consumePendingDraftForOwner(path, "video:storyboard-import") === null,
    "URL-provided prompt/settings payloads must be ignored",
  );
  assert(
    cleanedUrl === path,
    "legacy or attacker-provided draft payloads must be stripped from the URL",
  );

  sessionStorage.setItem("kelolako:pending-draft:/broken", "{not-json");
  assert(
    pendingDraftOwner("/broken") === null &&
      !storage.has("kelolako:pending-draft:/broken"),
    "malformed stored drafts must be cleared instead of retried forever",
  );

  sessionStorage.setItem("kelolako:pending-draft:/broken-owner", "{not-json");
  assert(
    !hasPendingDraftForOwner("/broken-owner", "video:storyboard-import") &&
      !storage.has("kelolako:pending-draft:/broken-owner"),
    "owner checks must also clear malformed stored drafts",
  );
}

pendingFormDraftSelfCheck();
console.log("pending-form-draft self-check passed");

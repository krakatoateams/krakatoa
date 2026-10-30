/**
 * Offline end-to-end check for the 4 switchable Photo tiers on BOTH providers (no network, no
 * FAL_KEY). Real pieces: buildPhotoProviderInput, the Fal adapter + catalog, cancelByRecordedProvider.
 * Fakes: the Fal client, the Replicate-side provider, and a ledger that follows the billing
 * contract (spend before submit, 402 creates no provider work, refund on failure, provider
 * recorded per prediction). The real route is covered by the live checklist in
 * docs/generation/fal-provider-live-test-checklist.md.
 */
import { GenerationCancelledError } from "./errors";
import { createFalPhotoProvider, type FalQueueLike } from "./fal-photo";
import { FAL_PRESET_DIMENSIONS, isValidFalCustomSize, mapFalPhotoInput } from "./fal-photo-catalog";
import { cancelByRecordedProvider } from "./cancel-by-provider";
import type { PhotoProvider } from "./photo-provider";
import {
  buildPhotoProviderInput,
  PRODUCT_PHOTO_TIERS,
  type PhotoAspectRatio,
  type ProductPhotoQuality,
} from "../product-photo";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`photoE2eSelfCheck: ${msg}`);
}

/** Tier id -> Fal catalog model (the t2i endpoint id). */
const FAL_MODEL: Record<string, string> = {
  basic: "fal-ai/nano-banana",
  balanced: "fal-ai/nano-banana-2",
  pro: "fal-ai/nano-banana-pro",
  gpt_image_2: "openai/gpt-image-2.5/flare/text-to-image",
};
const RATIOS: PhotoAspectRatio[] = ["1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9"];
const HOST_OK = "https://v3.fal.media/files/out.png";

type Ledger = { events: string[]; balance: number };

/** The contract in miniature: spend -> provider.run -> refund on any failure. */
async function chargedRun(
  ledger: Ledger,
  cost: number,
  provider: PhotoProvider,
  model: string,
  input: Record<string, unknown>,
  hooks?: Parameters<PhotoProvider["run"]>[0]["hooks"]
): Promise<{ status: 200 | 402; url?: string; error?: string }> {
  if (ledger.balance < cost) return { status: 402 }; // no provider work, no asset
  ledger.balance -= cost;
  ledger.events.push("spend");
  try {
    const url = await provider.run({ model, input, hooks });
    return { status: 200, url };
  } catch (e) {
    ledger.balance += cost;
    ledger.events.push("refund");
    return { status: 200, error: e instanceof Error ? e.message : "failed" };
  }
}

function fakeFal(log: string[], host = HOST_OK, failResult = false): FalQueueLike {
  let n = 0;
  return {
    queue: {
      submit: async (endpoint, o) => {
        log.push(`submit:${endpoint}`);
        log.push(`size:${JSON.stringify(o.input.image_size ?? null)}`);
        return { request_id: `req-${++n}` };
      },
      status: async () => ({ status: "COMPLETED" }),
      result: async () => {
        if (failResult) throw new Error("fal run failed");
        return { data: { images: [{ url: host }] } };
      },
      cancel: async (endpoint, o) => { log.push(`cancel:${endpoint}:${o.requestId}`); },
    },
    storage: { upload: async () => HOST_OK },
  };
}

function fakeReplicate(log: string[]): PhotoProvider {
  return {
    id: "replicate",
    commitsOnSubmit: false,
    uploadReference: async () => "https://replicate.delivery/ref.png",
    run: async ({ model }) => { log.push(`replicate-run:${model}`); return "https://replicate.delivery/out.png"; },
    cancelPredictions: async (ids) => { log.push(`replicate-cancel:${ids.join(",")}`); return { requested: ids.length, cancelled: ids.length }; },
    getPredictionStatus: async (id) => ({ id, status: "succeeded" }),
  };
}

async function main(): Promise<void> {
  const tiers = PRODUCT_PHOTO_TIERS.filter((t) => FAL_MODEL[t.id]);
  assert(tiers.length === 4, "all 4 switchable tiers exist");

  for (const tier of tiers) {
    const qualities: (ProductPhotoQuality | null)[] = tier.qualities ? tier.qualities.map((q) => q.id) : [null];
    const resolutions = tier.hasResolution ? tier.resolutions.map((r) => r.id as string) : [null];
    for (const withRef of [false, true]) {
      for (const ratio of RATIOS) {
        for (const quality of qualities) {
          for (const resolution of resolutions) {
            const tag = `${tier.id}/${withRef ? "ref" : "t2i"}/${ratio}/${quality ?? resolution ?? "-"}`;
            const input = buildPhotoProviderInput({
              tier, prompt: "p", aspectRatio: ratio,
              imageInput: withRef ? ["https://x.supabase.co/signed/a.png"] : null,
              providerResolution: resolution, quality,
            });

            // Fal: endpoint, mapped fields, valid size, recorded provider, normalized trusted output.
            const log: string[] = [];
            const ledger: Ledger = { events: [], balance: 100 };
            const ticks: string[] = [];
            const res = await chargedRun(ledger, 5, createFalPhotoProvider(fakeFal(log), 0), FAL_MODEL[tier.id], input, {
              onPrediction: (t) => ticks.push(t.id),
            });
            const supportsRef = tier.supportsReference && withRef;
            const mapped = mapFalPhotoInput(FAL_MODEL[tier.id], input);
            assert(res.url === HOST_OK, `${tag}: fal output normalized`);
            assert(ledger.events[0] === "spend" && ledger.events.length === 1, `${tag}: spend before submit, no refund on success`);
            assert(log[0] === `submit:${mapped.endpoint}` && mapped.endpoint.endsWith("/edit") === supportsRef, `${tag}: endpoint follows references`);
            assert(ticks.length > 0 && ticks.every((id) => id.includes("@")), `${tag}: prediction ids carry the endpoint`);
            const size = mapped.input.image_size as string | { width: number; height: number } | undefined;
            if (tier.providerFamily === "gpt_image") {
              const dims = typeof size === "string" ? FAL_PRESET_DIMENSIONS[size] : size;
              assert(!!dims && isValidFalCustomSize(dims.width, dims.height), `${tag}: image_size ${JSON.stringify(size)} within Fal limits`);
            }

            // Replicate: same Replicate-shaped input reaches the provider untouched.
            const rlog: string[] = [];
            const rres = await chargedRun({ events: [], balance: 100 }, 5, fakeReplicate(rlog), tier.providerModel, input);
            assert(rres.url?.startsWith("https://replicate.delivery/") === true && rlog[0] === `replicate-run:${tier.providerModel}`, `${tag}: replicate run`);
          }
        }
      }
    }

    // 402: no provider work and no spend.
    for (const p of [createFalPhotoProvider(fakeFal([]), 0), fakeReplicate([])]) {
      const log: string[] = [];
      const spy: PhotoProvider = { ...p, run: async (a) => { log.push("run"); return p.run(a); } };
      const ledger: Ledger = { events: [], balance: 1 };
      const r = await chargedRun(ledger, 5, spy, FAL_MODEL[tier.id], buildPhotoProviderInput({ tier, prompt: "p", aspectRatio: "1:1", providerResolution: tier.hasResolution ? tier.resolutions[0].id : null, quality: tier.qualities?.[0].id ?? null }));
      assert(r.status === 402 && log.length === 0 && ledger.events.length === 0 && ledger.balance === 1, `${tier.id}/${p.id}: 402 creates no provider work`);
    }

    // Failure after spend refunds; an untrusted Fal output host counts as a failure too.
    const input = buildPhotoProviderInput({ tier, prompt: "p", aspectRatio: "1:1", providerResolution: tier.hasResolution ? tier.resolutions[0].id : null, quality: tier.qualities?.[0].id ?? null });
    for (const fal of [fakeFal([], HOST_OK, true), fakeFal([], "https://evil.example/x.png")]) {
      const ledger: Ledger = { events: [], balance: 50 };
      const r = await chargedRun(ledger, 5, createFalPhotoProvider(fal, 0), FAL_MODEL[tier.id], input);
      assert(!!r.error && ledger.events.join() === "spend,refund" && ledger.balance === 50, `${tier.id}: failure refunds the spend`);
    }

    // Cancel mid-run: the Fal adapter cancels its own request and rethrows.
    const clog: string[] = [];
    let cancelled = false;
    try {
      await createFalPhotoProvider({ ...fakeFal(clog), queue: { ...fakeFal(clog).queue, status: async () => ({ status: "IN_PROGRESS" }) } }, 0)
        .run({ model: FAL_MODEL[tier.id], input, hooks: { abortCheck: async () => { throw new GenerationCancelledError(); } } });
    } catch (e) { cancelled = e instanceof GenerationCancelledError; }
    assert(cancelled && clog.some((l) => l.startsWith("cancel:")), `${tier.id}: mid-run cancel reaches Fal`);
  }

  // Cancel routing follows the RECORDED provider, whatever the config says now.
  const flog: string[] = [];
  const fal = createFalPhotoProvider(fakeFal(flog), 0);
  const rep = fakeReplicate(flog);
  const out = await cancelByRecordedProvider(
    { fal: ["r1@fal-ai/nano-banana/edit", "r2@fal-ai/nano-banana-2"], replicate: ["abc123"] },
    (id) => (id === "fal" ? fal : id === "replicate" ? rep : null)
  );
  assert(out.predictions === 3 && out.cancelled === 3, "cancel counts both providers");
  assert(flog.includes("cancel:fal-ai/nano-banana/edit:r1") && flog.includes("replicate-cancel:abc123"), "ids go to their own provider");
  assert(!flog.some((l) => l.startsWith("replicate-cancel:") && l.includes("@")), "fal ids never reach replicate");

  console.log("photoE2eSelfCheck: ok");
}
void main();

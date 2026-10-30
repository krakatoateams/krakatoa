import { cancelByRecordedProvider } from "./cancel-by-provider";
import { groupPredictionIdsByProvider } from "../generation-cancel-pure";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`cancelByProviderSelfCheck: ${msg}`);
}

async function main(): Promise<void> {
  const calls: Record<string, string[]> = {};
  const fake = (id: string) => ({
    cancelPredictions: async (ids: string[]) => {
      calls[id] = ids;
      if (id === "boom") throw new Error("x");
      return { requested: ids.length, cancelled: ids.length };
    },
  });
  const groups = groupPredictionIdsByProvider([
    { prediction_id: "a" },
    { prediction_id: "b", provider: "replicate" },
    { prediction_id: "c", provider: "fal" },
    { prediction_id: "", provider: "fal" },
  ]);
  assert(JSON.stringify(groups) === JSON.stringify({ replicate: ["a", "b"], fal: ["c"] }), "missing provider groups as replicate");

  const res = await cancelByRecordedProvider(groups, (id) => (id === "replicate" || id === "fal" ? fake(id) : null));
  assert(calls.replicate.join() === "a,b" && calls.fal.join() === "c", "each group goes to its own adapter");
  assert(res.predictions === 3 && res.cancelled === 3, "mixed-provider totals " + JSON.stringify(res));

  const skipped = await cancelByRecordedProvider({ gone: ["z"], boom: ["y"] }, (id) => (id === "boom" ? fake("boom") : null));
  assert(skipped.predictions === 2 && skipped.cancelled === 0, "unknown adapter and throwing adapter never fail the cancel");
  console.log("cancel-by-provider-self-check: ok");
}

void main();

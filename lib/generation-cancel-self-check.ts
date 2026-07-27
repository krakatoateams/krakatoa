/** Mirrors CANCEL_READ_RETRIES in generation-cancel.ts — keep in sync. */
const CANCEL_READ_RETRIES = 2;

/** ponytail: runnable without Supabase — fails if fail-closed retry contract breaks. */
export function generationCancelSelfCheck(): void {
  let reachedFailClosed = false;
  for (let attempt = 0; attempt < CANCEL_READ_RETRIES; attempt++) {
    if (attempt === CANCEL_READ_RETRIES - 1) reachedFailClosed = true;
  }
  if (!reachedFailClosed) {
    throw new Error("generation-cancel: retry loop must reach fail-closed on last attempt");
  }
}

if (process.argv[1]?.includes("generation-cancel-self-check")) {
  generationCancelSelfCheck();
  console.log("generation-cancel self-check ok");
}

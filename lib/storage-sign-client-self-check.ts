import { fetchSignedUrl } from "./storage-sign-client";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`storage-sign-client self-check: ${message}`);
}

type MockResponse = { ok: boolean; body: unknown };

function installMockFetch(responses: () => MockResponse) {
  let calls = 0;
  (global as unknown as { fetch: typeof fetch }).fetch = (async () => {
    calls += 1;
    const { ok, body } = responses();
    return {
      ok,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
  return () => calls;
}

async function testDedupesConcurrentRequests(): Promise<void> {
  const getCalls = installMockFetch(() => ({
    ok: true,
    body: { url: "https://x/signed-a", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), storagePath: "a" },
  }));

  const [first, second] = await Promise.all([
    fetchSignedUrl({ path: "self-check/dedupe-a" }),
    fetchSignedUrl({ path: "self-check/dedupe-a" }),
  ]);

  assert(getCalls() === 1, "concurrent requests for the same path must share one round trip");
  assert(first.url === second.url, "deduped calls must resolve to the same signed URL");
}

async function testReusesFreshCacheEntry(): Promise<void> {
  const getCalls = installMockFetch(() => ({
    ok: true,
    body: {
      url: "https://x/signed-b",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      storagePath: "b",
    },
  }));

  await fetchSignedUrl({ path: "self-check/reuse-b" });
  await fetchSignedUrl({ path: "self-check/reuse-b" });

  assert(getCalls() === 1, "a fresh cached entry must not trigger a second sign round trip");
}

async function testRefetchesNearExpiryEntry(): Promise<void> {
  const getCalls = installMockFetch(() => ({
    ok: true,
    body: {
      url: "https://x/signed-c",
      expiresAt: new Date(Date.now() + 1_000).toISOString(),
      storagePath: "c",
    },
  }));

  await fetchSignedUrl({ path: "self-check/expiry-c" });
  await fetchSignedUrl({ path: "self-check/expiry-c" });

  assert(getCalls() === 2, "an entry within the reuse margin of expiry must re-sign rather than serve stale");
}

async function testDoesNotCacheFailures(): Promise<void> {
  let fail = true;
  const getCalls = installMockFetch(() => {
    if (fail) {
      fail = false;
      return { ok: false, body: { error: "boom" } };
    }
    return {
      ok: true,
      body: {
        url: "https://x/signed-d",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        storagePath: "d",
      },
    };
  });

  await fetchSignedUrl({ path: "self-check/fail-d" }).then(
    () => assert(false, "first call was expected to fail"),
    () => {},
  );
  const result = await fetchSignedUrl({ path: "self-check/fail-d" });

  assert(getCalls() === 2, "a failed sign attempt must not be cached, so the next call retries");
  assert(result.url === "https://x/signed-d", "the retry after a failure must succeed");
}

async function main() {
  await testDedupesConcurrentRequests();
  await testReusesFreshCacheEntry();
  await testRefetchesNearExpiryEntry();
  await testDoesNotCacheFailures();
}

main().then(() => console.log("storage-sign-client self-check passed"));

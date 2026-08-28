import { isTrustedReplicateOutputUrl } from "./replicate-output-url";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  isTrustedReplicateOutputUrl("https://replicate.delivery/output.mp4"),
  "replicate.delivery must be trusted",
);
assert(
  isTrustedReplicateOutputUrl("https://pbxt.replicate.delivery/output.mp4"),
  "Replicate delivery subdomains must be trusted",
);
assert(
  !isTrustedReplicateOutputUrl("http://replicate.delivery/output.mp4"),
  "non-HTTPS output must be rejected",
);
assert(
  !isTrustedReplicateOutputUrl("https://replicate.delivery.attacker.example/output.mp4"),
  "hostname suffix spoof must be rejected",
);
assert(
  !isTrustedReplicateOutputUrl("https://127.0.0.1/internal"),
  "internal output URL must be rejected",
);

console.log("replicate-output-url self-check ok");

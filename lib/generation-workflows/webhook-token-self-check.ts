import {
  signWebhookCallbackToken,
  verifyWebhookCallbackToken,
} from "./webhook-token-pure";

export function webhookTokenSelfCheck(): void {
  const secret = "test-secret-for-self-check";
  const submissionId = "11111111-1111-1111-1111-111111111111";
  const token = signWebhookCallbackToken(submissionId, secret);
  if (!verifyWebhookCallbackToken(submissionId, token, secret)) {
    throw new Error("token must verify for matching submission");
  }
  if (verifyWebhookCallbackToken("other-id", token, secret)) {
    throw new Error("token must not verify for different submission");
  }
  if (verifyWebhookCallbackToken(submissionId, "v1.bad", secret)) {
    throw new Error("bad token must not verify");
  }
}

if (process.argv[1]?.includes("webhook-token-self-check")) {
  webhookTokenSelfCheck();
  console.log("webhook-token self-check ok");
}

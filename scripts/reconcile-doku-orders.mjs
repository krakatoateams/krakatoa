// One-off reconciliation: for every PENDING credit_order, ask DOKU the real
// status and (a) credit the wallet via the idempotent RPC + mark paid when
// SUCCESS, or (b) mark failed/expired otherwise. Mirrors the server-side
// reconcilePendingOrder logic. Safe to re-run (idempotent on purchase key).
//
// Run:  node scripts/reconcile-doku-orders.mjs
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    out[t.slice(0, eq).trim()] = v;
  }
  return out;
}

const env = loadEnv(new URL("../.env.local", import.meta.url).pathname);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const clientId = env.DOKU_CLIENT_ID.trim();
const secretKey = env.DOKU_SECRET_KEY.trim();
const baseUrl = env.DOKU_API_BASE?.trim()
  ? env.DOKU_API_BASE.trim().replace(/\/$/, "")
  : env.DOKU_ENV === "production"
    ? "https://api.doku.com"
    : "https://api-sandbox.doku.com";

const ts = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

async function checkStatus(invoice) {
  const target = `/orders/v1/status/${invoice}`;
  const requestId = crypto.randomUUID();
  const timestamp = ts();
  const component =
    `Client-Id:${clientId}\nRequest-Id:${requestId}\n` +
    `Request-Timestamp:${timestamp}\nRequest-Target:${target}`;
  const signature =
    "HMACSHA256=" +
    crypto.createHmac("sha256", secretKey).update(component, "utf8").digest("base64");
  const res = await fetch(`${baseUrl}${target}`, {
    method: "GET",
    headers: {
      "Client-Id": clientId,
      "Request-Id": requestId,
      "Request-Timestamp": timestamp,
      Signature: signature,
    },
  });
  const json = await res.json().catch(() => ({}));
  return {
    txn: (json.transaction?.status ?? "").toUpperCase(),
    order: json.order?.status ?? null,
    amount: Number(json.order?.amount),
    method: json.channel?.id ?? json.acquirer?.id ?? null,
  };
}

const { data: pending } = await sb
  .from("credit_orders")
  .select("id, invoice_number, profile_id, pack_id, credits, amount_idr, doku_token_id")
  .eq("status", "pending");

console.log(`Reconciling ${pending?.length ?? 0} pending orders against ${baseUrl}\n`);

for (const o of pending ?? []) {
  const s = await checkStatus(o.invoice_number);

  if (s.txn === "SUCCESS") {
    if (Number.isFinite(s.amount) && s.amount !== o.amount_idr) {
      console.log(`SKIP  ${o.invoice_number} amount mismatch doku=${s.amount} ours=${o.amount_idr}`);
      continue;
    }
    const { data: rpc, error: rpcErr } = await sb.rpc("krakatoa_apply_credit_transaction", {
      p_profile_id: o.profile_id,
      p_amount: o.credits,
      p_direction: "credit",
      p_type: "purchase",
      p_status: "succeeded",
      p_description: `Credit pack ${o.pack_id} (${o.credits} credits)`,
      p_metadata: {
        source: "doku",
        invoiceNumber: o.invoice_number,
        packId: o.pack_id,
        amountIdr: o.amount_idr,
        paymentMethod: s.method,
        reconciled: true,
      },
      p_idempotency_key: `purchase:doku:${o.invoice_number}`,
      p_job_id: null,
      p_asset_id: null,
    });
    if (rpcErr) {
      console.log(`ERROR ${o.invoice_number} rpc: ${rpcErr.message}`);
      continue;
    }
    const txId = rpc?.transaction?.id ?? null;
    const { error: updErr } = await sb
      .from("credit_orders")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        payment_method: s.method,
        credit_transaction_id: txId,
      })
      .eq("invoice_number", o.invoice_number)
      .eq("status", "pending");
    console.log(
      `PAID  ${o.invoice_number} +${o.credits} credits (replayed=${rpc?.replayed})` +
        (updErr ? ` [order update err: ${updErr.message}]` : "")
    );
  } else if (["EXPIRED", "FAILED", "VOID", "REFUND"].includes(s.txn)) {
    const status = s.txn === "EXPIRED" ? "expired" : "failed";
    await sb
      .from("credit_orders")
      .update({ status })
      .eq("invoice_number", o.invoice_number)
      .eq("status", "pending");
    console.log(`${status.toUpperCase().padEnd(5)} ${o.invoice_number} (doku=${s.txn})`);
  } else {
    console.log(`WAIT  ${o.invoice_number} still ${s.txn || "PENDING"} on DOKU`);
  }
}

console.log("\nDONE");

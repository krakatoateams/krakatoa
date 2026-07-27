# Generation Cancel Hardening — Ringkasan

> Plan lengkap: [`generation-cancel-hardening-plan.md`](generation-cancel-hardening-plan.md)

## Masalah

Audit menemukan cancel generation **tidak konsisten**:

- **Reels Creator** — cancel diabaikan saat fase Rendi/Whisper/upload (user tetap charged, video bisa tetap delivered).
- **Photo Studio & Storyboard image** — metered tapi **tidak ada cancel** (API + UI).
- **Storyboard import** — sama.
- **`isCancelRequested`** — error DB dianggap "tidak cancel" → generation lanjut.
- **Vercel timeout 300s** — function mati tanpa catch → refund bisa tidak jalan.

Yang sudah benar: T2V/I2V, Storyboard→Video, Motion Control (kecuali satu edge catch), arsitektur refund single-owner.

## Tujuan

1. **Cost** — tidak charge kredit untuk run yang user cancel; stop Rendi/Replicate baru sesegera mungkin.
2. **UX** — tombol Cancel di semua tool metered; status idle (bukan error merah) + refund.
3. **Recovery** — cron untuk job `running` yang stuck setelah timeout.

## Fase implementasi (11 fase)

| Fase | Isi |
|------|-----|
| **1** | ✅ `assertNotCancelled`, fail-closed `isCancelRequested`, self-check | `lib/generation-cancel.ts` |
| **2** | ✅ Checkpoint cancel di pipeline Seedance & Veo | `seedance.ts`, `veo.ts` |
| **3** | ✅ Guard pre-finalize di `generate-reels` | `generate-reels/route.ts` |
| **4** | ✅ Guard download/upload di `generate-video` | `generate-video/route.ts` |
| **5** | ✅ Cancel API + UI Photo & Storyboard image | `photo-v2`, `generate-photo`, `generate-storyboard` |
| **6** | ✅ Cancel API + UI storyboard import | `video/page` import modal, `storyboards/import` |
| **7** | ✅ Fix refund di motion-control status catch | `generate-motion-control/status` |
| **8** | ✅ Cron reconcile job stuck + refund | `generation-reconcile`, `/api/cron/generation-reconcile` |
| **9** | ✅ Cancel endpoint `already_cancelling` | `generations/cancel` |
| **Pass 2** | ✅ Storyboard-video post-Replicate guards; motion poll 409; LLM retry cancel; `refetchCredits` on cancel UI | lihat plan gap matrix |
| **10** | ✅ Dedup `extractMediaUrl`, `runWithRetry`/`runReplicateWithRetry`, `isMissingDbObject` | `replicate-server`, `replicate-utils`, `reels-helpers`, `generation-db-errors` |
| **11** | Update CLAUDE.md + dokumen ini | — |

**Urutan merge:** Fase 1–4 (Video/Reels risiko tertinggi) → 5–6 (Photo) → 7–9 → 8 bisa paralel setelah fase 1.

## Acceptance criteria

- Semua route dengan `spendCredits` punya path cancel + refund + 409 `GENERATION_CANCELLED`.
- Cancel saat Rendi → tidak ada video final di history/storage.
- Retry setelah cancel (same idempotency key) → generation baru jalan normal.
- Ledger: satu `spend` + satu `refund` per job yang di-cancel (no double refund).

## Tidak termasuk

- Caption API (gratis).
- Split `video/page.tsx` 4000 baris.
- Naikkan `maxDuration` Vercel (infra terpisah).

## Test manual (wajib)

10 skenario di plan §15 — terutama cancel during Rendi, Photo cancel, retry setelah cancel, cek `credit_transactions`.

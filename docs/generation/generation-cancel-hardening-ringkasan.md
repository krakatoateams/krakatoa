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
| **1** | Perbaiki `lib/generation-cancel.ts` (fail-closed + helper `assertNotCancelled`) |
| **2** | Checkpoint cancel di pipeline Seedance & Veo (sebelum LLM, Rendi, storage) |
| **3** | Guard pre-finalize di `generate-reels` |
| **4** | Guard download/upload di `generate-video` |
| **5** | Cancel API + UI Photo Studio & Storyboard image (`photo-v2`) |
| **6** | Cancel API + UI storyboard import (`video/page`) |
| **7** | Fix refund di motion-control status catch |
| **8** | Cron reconcile job stuck + refund backstop |
| **9** | Polish cancel endpoint (`already_cancelling`) |
| **10** | Ponytail: dedup replicate helpers (PR terpisah OK) |
| **11** | Update CLAUDE.md + dokumen ini |

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

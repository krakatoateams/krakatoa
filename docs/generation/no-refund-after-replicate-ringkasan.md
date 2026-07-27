# No refund setelah Replicate sukses — ringkasan

**Status:** Implemented (migration `055_generation_cancel_allowed.sql`).

## Kebijakan

Setelah Replicate **berhasil** menghasilkan output utama (video/gambar — biaya provider sudah ke-commit), user:

- **Tidak bisa cancel** yang menghentikan job + refund kredit
- Harus menunggu selesai (sukses) atau gagal (recoverable / failed)

Sebelum titik itu: cancel + refund tetap seperti sekarang.

Gagal total **setelah** commit (upload/Rendi/stitch): tetap **full refund**.

## Titik lock cancel (final)

| Tool | Kapan lock |
|------|------------|
| T2V / I2V | Setelah prediction video sukses + URL valid |
| Storyboard → video | Sama |
| Motion control | Prediction sukses (status poll, sebelum finalize) |
| Reels Seedance / Veo per-scene | Setelah **scene pertama** sukses |
| Reels Veo single | Setelah clip Veo sukses |
| Photo / storyboard gambar | Setelah `image_generation` sukses |
| Storyboard import | Setelah **vision LLM** selesai |

Abandon recoverable (`cancel` + `jobId`) **tidak** refund — biaya provider sudah terpakai.

## Implementasi

- `generation_requests.cancel_allowed` — `markProviderCommitted()` set `false`
- `POST /api/generations/cancel` → 409 `CANCEL_NOT_ALLOWED` bila locked
- `isRefundableUserCancellation()` di catch metered routes
- UI: `useGenerationStatusPoll` + `GenerationCancelButton` (“Finalizing…”)

Detail: [`no-refund-after-replicate-plan.md`](no-refund-after-replicate-plan.md)

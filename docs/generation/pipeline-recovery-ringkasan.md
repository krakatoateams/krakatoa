# Pipeline recovery — ringkasan

Staging artifact video generation disimpan di **`{userId}/resumable/{jobId}/`** — di luar `photos/` dan `videos/generated/`.

- **Status job `recoverable`**: Replicate/scene selesai, Rendi/upload gagal → kredit **di-hold** (tidak refund otomatis).
- **Resume**: `POST /api/generations/resume` + **Try again** in Video Studio (Reels Creator, T2V, I2V, storyboard).
- **Refund** hanya saat pengiriman benar-benar gagal: resume habis (5x), error terminal saat resume, atau TTL 24h **setelah** user sudah pernah Try again.
- **Abandon** (`cancel` + `jobId`): tidak refund — biaya provider sudah terpakai.
- **Cleanup**: purge folder resumable saat sukses, gagal terminal, abandon, atau TTL 24h (cron reconcile).
- **Migration**: `054_job_recoverable_status.sql` — jalankan `npm run db:setup` atau Supabase MCP.

Detail: [`pipeline-recovery-plan.md`](pipeline-recovery-plan.md)

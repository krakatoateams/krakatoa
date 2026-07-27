# Pipeline recovery — ringkasan

Staging artifact video generation disimpan di **`{userId}/resumable/{jobId}/`** — di luar `photos/` dan `videos/generated/`.

- **Status job `recoverable`**: Replicate/scene selesai, Rendi/upload gagal → kredit **di-hold** (tidak refund otomatis).
- **Resume**: `POST /api/generations/resume` + **Try again** in Video Studio (Reels Creator, T2V, I2V, storyboard).
- **Cleanup**: purge folder resumable saat sukses, gagal terminal, cancel, atau TTL 24h (cron reconcile).
- **Migration**: `054_job_recoverable_status.sql` — jalankan `npm run db:setup` atau Supabase MCP.

Detail: [`pipeline-recovery-plan.md`](pipeline-recovery-plan.md)

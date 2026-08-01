# Admin Monitoring — `/admin/monitoring`

> Panel read-only untuk memantau semua generation lintas user: siapa lagi generate apa, sampai step mana, dan mana yang error / macet / kreditnya nyangkut.

**Status: code selesai, belum diuji ke DB.** Supabase project sedang restricted (`exceed_egress_quota`), jadi query-nya belum pernah benar-benar jalan. Lihat [Yang belum diverifikasi](#yang-belum-diverifikasi) sebelum percaya angkanya.

---

## Kenapa ada

Observability Krakatoa sebelumnya cuma `console.error` + beberapa kolom `jsonb` yang tersebar dan tidak pernah di-join. Datanya sudah lengkap di DB — yang hilang cuma jalur baca untuk admin.

| Data | Sumber | Sebelumnya |
|---|---|---|
| Job + status + error | `jobs` | `getAdminJobs` tidak select `error` — alasan gagal ada di DB tapi tak pernah sampai UI |
| Step pipeline | `job_steps` | Tidak ada endpoint admin sama sekali |
| Cancel state | `generation_requests.cancel_requested` / `.cancel_allowed` | Tidak pernah di-join ke `jobs` |
| Replicate prediction ID | `generation_predictions.prediction_id` | Tidak pernah ditampilkan |
| Spend / refund | `credit_transactions` (`job_id`, `type`) | Tidak pernah dibandingkan per job |
| Recovery state | `jobs.output.recovery` | Tidak pernah ditampilkan |

**Tidak ada tabel atau kolom baru.** Migrasi `057` cuma menambah dua index read-perf.

---

## File

| File | Isi |
|---|---|
| [`lib/admin-monitoring-flags.ts`](../../lib/admin-monitoring-flags.ts) | Klasifikasi anomali. Pure, tanpa Supabase, tanpa clock. Ada self-check runnable. |
| [`lib/admin-monitoring-db.ts`](../../lib/admin-monitoring-db.ts) | Query layer (service role, cross-profile). 3 fungsi. |
| [`app/api/admin/monitoring/route.ts`](../../app/api/admin/monitoring/route.ts) | `GET ?window=&tool=&status=&flag=&limit=` |
| [`app/api/admin/monitoring/[jobId]/route.ts`](../../app/api/admin/monitoring/%5BjobId%5D/route.ts) | `GET` drill-down satu job |
| [`app/(app)/admin/monitoring/page.tsx`](../../app/(app)/admin/monitoring/page.tsx) | UI, poll 5 detik + tombol Pause |
| [`supabase/migrations/057_admin_monitoring_indexes.sql`](../../supabase/migrations/057_admin_monitoring_indexes.sql) | Dua index. **Belum di-apply.** |

Auth ikut gate admin yang sudah ada — `withAdmin()` ([`lib/admin-api.ts`](../../lib/admin-api.ts)) di route, `getCurrentAdmin()` di [`app/(app)/admin/layout.tsx`](../../app/(app)/admin/layout.tsx). Tidak ada endpoint mutasi, jadi tidak ada permukaan tulis baru.

---

## Tiga anomali

Semua aturan ada di `classifyJobFlags()`. Konstanta ambangnya di file yang sama.

### `stuck`
`status ∈ {queued, running}` dan `updated_at` lebih tua dari **10 menit**.

Semua route berat di-pin `maxDuration = 300` (batas Vercel Hobby), jadi lewat 10 menit artinya mati, bukan lambat. Job `recoverable` **tidak** dihitung stuck — itu memang diparkir menunggu **Try again** user.

### `cancel_not_honored`
`cancel_requested = true`, `cancel_allowed = true`, job masih `queued`/`running`, dan cancel diminta lebih dari **2 menit** lalu.

`cancel_allowed = false` **bukan** anomali. Itu post-commit lock dari `markProviderCommitted()` — API sudah benar menjawab 409 `CANCEL_NOT_ALLOWED` dan run-nya lanjut sampai selesai. Di tabel ditandai badge abu `cancel locked`, bukan merah.

### `refund_missing`
Job `failed`/`cancelled` dan `spend > refund` — **kecuali** empat jalur di mana menahan kredit itu memang benar:

| Kondisi | Kenapa tidak refund |
|---|---|
| `errorCode` pre-spend (`INSUFFICIENT_CREDITS`, `PRICING_CONFIG_MISSING`, `TOOL_DISABLED`, `IDEMPOTENCY_*`, `GENERATION_IN_PROGRESS`) | Spend belum pernah terjadi |
| `cancel_allowed = false` | User cancel setelah provider deliver — biaya provider sudah terpakai |
| `GENERATION_ABANDONED` | `user_abandon` — user buang sendiri job recoverable-nya |
| `RECOVERY_TTL_EXPIRED` dengan `resumeAttempts = 0` | User tidak pernah coba resume |

Empat kode terminal recoverable (`GENERATION_ABANDONED`, `RECOVERY_TTL_EXPIRED`, `RESUME_EXHAUSTED`, `DELIVERY_FAILED`) di-map balik ke enum `RecoverableTerminalReason` lalu **didelegasikan ke `shouldRefundRecoverableTerminal()`** di [`lib/pipeline-recovery/refund-policy-pure.ts`](../../lib/pipeline-recovery/refund-policy-pure.ts).

> **Penting kalau nanti policy refund berubah:** jangan edit aturannya di `admin-monitoring-flags.ts`. Ubah di `refund-policy-pure.ts` — panel ikut otomatis. Kalau ada kode error terminal **baru**, tambahkan ke map `RECOVERABLE_TERMINAL_CODES`, kalau tidak panel akan menganggapnya "refund seharusnya keluar" dan jadi false positive.

---

## Batas yang disengaja

| Batasan | Alasan | Kapan diperbaiki |
|---|---|---|
| **Read-only, tanpa tombol aksi** | Force-refund/force-fail butuh audit trail + guard idempotency biar tidak double-refund | Setelah tahu anomali mana yang benar-benar sering muncul |
| **Step detail cuma lengkap di Reels** | Route lain (photo, video, storyboard, motion-control) nulis 1–2 step; pipeline-nya memang pendek | Kalau panel terbukti buta di situ |
| **Scene paralel kolaps jadi 1 baris** | Tiap route punya `currentStepId: string \| null` tunggal, jadi 5 scene Seedance paralel semuanya jadi satu row `video_generation` | Butuh ubah kontrak step di semua route generate |
| **Step write di-`safe()`-wrap** | Kalau tulis `job_steps` sendiri gagal, kegagalannya tidak kelihatan di manapun | Butuh jalur log terpisah |
| **Tanpa pagination** | `limit` 200 newest-first, konsisten dengan tab admin lain. UI kasih label `(capped — narrow the window)` kalau kena | Kalau volume job melewatinya |
| **Counts ikut filter status** | Chip dihitung dari hasil query, jadi kalau filter `status=failed` aktif chip Running jadi 0 | Kalau bikin bingung, pisahkan jadi count query sendiri |
| **Tanpa Sentry / log eksternal** | `jobs.error` + `job_steps.error` sudah menampung yang dibutuhkan | Kalau butuh stack trace atau alert push |

---

## Yang belum diverifikasi

Sudah lolos:

- ✅ `npm run test:monitoring-flags` — 18 assert, semua cabang anomali + exclusion
- ✅ `npm run lint` — bersih
- ✅ `npm run build` — ketiga route terbit

**Belum pernah jalan ke DB sungguhan.** Supabase project `ybfmllqcvvexldsteuaw` menolak semua query dengan:

```
Service for this project is restricted due to the following violations: exceed_egress_quota
```

Yang berarti belum terbukti benar:

1. **Filter `.or()` di `getAdminMonitoring`** — `status.in.(queued,running,recoverable),created_at.gte.<iso>`. Syntax-nya sesuai dokumentasi PostgREST, tapi kalau salah seluruh panel balas 500. **Ini risiko terbesar.**
2. **Embed `jobs(tool)` di `getAdminFailedStepAggregates`** — bergantung pada FK `job_steps.job_id → jobs.id` yang dikenali PostgREST.
3. **Bentuk kolom nyata** — `credit_transactions.type` benar berisi `spend`/`refund`, `generation_requests.job_id` benar terisi (kolomnya `on delete set null`, jadi bisa `null` untuk job lama).
4. **Angka anomali di data historis** — apakah `refund_missing` menyala wajar, atau justru banjir false positive dari job lama sebelum policy refund sekarang ada.
5. **Performa tanpa index 057** — panel tetap jalan, tapi agregat failing-step akan seq-scan `job_steps`.

### Cara menuntaskan verifikasi

Begitu kuota Supabase pulih:

**1. Apply migrasi**

```bash
npm run db:setup
```

Butuh `SUPABASE_ACCESS_TOKEN=sbp_...` **atau** `DATABASE_URL=postgresql://...` di `.env.local` — saat ini belum ada, jadi `db:setup` gagal duluan. Alternatif: paste isi `057_admin_monitoring_indexes.sql` ke SQL Editor Supabase. Idempotent, aman dijalankan dua kali.

**2. Smoke test query layer (tanpa perlu login admin / dev server)**

```bash
npm run admin:probe-monitoring
npm run admin:probe-monitoring -- --window=168 --limit=100
```

[`scripts/probe-monitoring.ts`](../../scripts/probe-monitoring.ts) memanggil ketiga fungsi query layer dan print hasilnya. Read-only. Kalau selesai dengan `probe-monitoring: ok`, poin 1–3 di atas beres — throw apapun berarti masih ada yang salah.

**3. Uji end-to-end di UI**

| Skenario | Yang harus terlihat |
|---|---|
| Jalankan satu Reels Creator | Baris `running`, step berganti `style_anchor → scene_breakdown → tts_generation → whisper_transcription → video_generation → rendi_render → storage_upload` tanpa reload |
| Cancel di tengah jalan (sebelum scene pertama) | Status `cancelled`, ledger punya spend **dan** refund, **tanpa** flag `refund_missing` |
| Cancel setelah scene pertama selesai (API balas 409) | Detail menunjukkan `cancel_allowed: false`, badge `cancel locked`, **tanpa** flag merah — ini yang membuktikan exclusion-nya jalan |
| Paksa gagal (unset `RENDI_API_KEY` sementara) | Job `failed`, step `rendi_render` merah dengan pesan error, refund tercatat |
| Buka window 7 hari | Cek chip `Refund missing` — kalau angkanya besar, periksa beberapa job manual sebelum percaya; kemungkinan ada kode error lama yang belum masuk `RECOVERABLE_TERMINAL_CODES` |

---

## Menambah anomali baru

1. Tambah nilai ke type `JobFlag` di `lib/admin-monitoring-flags.ts`.
2. Tulis aturannya di `classifyJobFlags()` — **input lewat parameter**, jangan baca DB atau `Date.now()` di dalam fungsi, itu yang bikin file ini tetap bisa di-self-check.
3. Tambah assert positif **dan** negatif di `adminMonitoringFlagsSelfCheck()`. Kasus negatif lebih penting: false positive membunuh kegunaan panel lebih cepat daripada false negative.
4. Tambah entry di `FLAG_LABEL` + `FLAG_HINT` dan satu `<Chip>` di `page.tsx`.
5. `counts.anomalies` otomatis ikut karena bertipe `Record<JobFlag, number>` — TypeScript akan menolak build sampai nilai barunya diinisialisasi.

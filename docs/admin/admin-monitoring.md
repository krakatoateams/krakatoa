# Admin Monitoring — `/admin/monitoring`

> Panel read-only untuk memantau semua generation lintas user: siapa lagi generate apa, sampai step mana, dan mana yang error / macet / kreditnya nyangkut.

**Status: terverifikasi ke DB live + jalur baca UI (11 Agu 2026).** Migrasi `057` applied, `npm run admin:probe-monitoring` lolos, dan panel sudah menampilkan data nyata yang cocok dengan probe. Yang tersisa cuma skenario cancel/gagal yang butuh generation sungguhan — lihat [Sisa verifikasi](#sisa-verifikasi-uji-e2e-di-ui).

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
| [`supabase/migrations/057_admin_monitoring_indexes.sql`](../../supabase/migrations/057_admin_monitoring_indexes.sql) | Dua index. Applied 11 Agu 2026. |

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

## Prompt di panel detail

Panel menampilkan prompt **hanya dari yang benar-benar ditulis pipeline** — tidak ada yang direkonstruksi. Cakupannya memang tidak rata, dan UI mengatakannya terus terang (`Not recorded …`) daripada menampilkan kotak kosong yang terlihat seperti bug.

| Sumber | Isi | Ditulis oleh |
|---|---|---|
| `jobs.input.prompt` | Prompt user apa adanya | motion-control, text/image-to-video, photo (kalau user mengisi) |
| `jobs.input.theme` | Seed yang dikembangkan LLM — **bukan** prompt final | Reels, Veo, storyboard |
| `job_steps.<step>.input.prompt` | Prompt final rakitan yang benar-benar diterima model | photo (`image_generation`) |
| `job_steps.style_anchor.output` | `styleAnchor` + `negativePrompt` | Reels/Veo |
| `job_steps.scene_breakdown.output.scenes` | Prompt + narasi per scene | Reels |

**Job sebelum 11 Agu 2026 tidak punya prompt** — `generate-video` dan `generate-photo` dulu tidak pernah menyimpannya, jadi tidak ada yang bisa ditampilkan surut.

**System instruction sengaja tidak disimpan.** Template-nya konstanta di [`lib/reels-pipeline/llm.ts`](../../lib/reels-pipeline/llm.ts); yang berubah tiap run cuma `styleAnchor` dan `maxWordsPerScene`, dan keduanya sudah tersimpan di step. Menyimpan teks utuhnya berarti menyalin konstanta yang sama ke tiap baris job tanpa menambah informasi apa pun.

> Kalau menambah route generasi baru: tulis prompt user ke `jobs.input.prompt`, dan kalau route merakit prompt akhir, tulis hasil rakitannya ke `input` step yang memanggil model. Panel otomatis menampilkannya — tidak perlu menyentuh `PromptSection`.

---

## Batas yang disengaja

| Batasan | Alasan | Kapan diperbaiki |
|---|---|---|
| **Read-only, tanpa tombol aksi** | Force-refund/force-fail butuh audit trail + guard idempotency biar tidak double-refund | Setelah tahu anomali mana yang benar-benar sering muncul |
| **Step detail cuma lengkap di Reels** | Route lain (photo, video, storyboard, motion-control) nulis 1–2 step; pipeline-nya memang pendek | Kalau panel terbukti buta di situ |
| **Scene paralel kolaps jadi 1 baris** | Tiap route punya `currentStepId: string \| null` tunggal, jadi 5 scene Seedance paralel semuanya jadi satu row `video_generation` | Butuh ubah kontrak step di semua route generate |
| **Step write di-`safe()`-wrap** | Kalau tulis `job_steps` sendiri gagal, kegagalannya tidak kelihatan di manapun | Butuh jalur log terpisah |
| **Pagination client-side** | API mengirim seluruh window (maks 200 newest-first) dalam satu payload, jadi UI cukup `slice` 25 per halaman — nol round trip tambahan dan tidak terganggu poll 5 detik. Label `(capped — narrow the window)` tetap muncul kalau kena batas 200 | Kalau 200 sudah tidak cukup, baru pindah ke keyset pagination di query |
| **Counts ikut filter status** | Chip dihitung dari hasil query, jadi kalau filter `status=failed` aktif chip Running jadi 0 | Kalau bikin bingung, pisahkan jadi count query sendiri |
| **Tanpa Sentry / log eksternal** | `jobs.error` + `job_steps.error` sudah menampung yang dibutuhkan | Kalau butuh stack trace atau alert push |

---

## Status verifikasi

Sudah lolos:

- ✅ `npm run test:monitoring-flags` — 18 assert, semua cabang anomali + exclusion
- ✅ `npm run lint` — bersih
- ✅ `npm run build` — ketiga route terbit
- ✅ **Migrasi `057` applied** ke `ybfmllqcvvexldsteuaw` (11 Agu 2026, lewat Supabase MCP — bukan `db:setup`, yang masih butuh `SUPABASE_ACCESS_TOKEN`/`DATABASE_URL` di `.env.local`). Kedua index terkonfirmasi ada di `pg_indexes`.
- ✅ **`npm run admin:probe-monitoring` → `probe-monitoring: ok`** terhadap DB live. Yang ikut terbukti benar:
  - Filter `.or()` di `getAdminMonitoring` (`status.in.(queued,running,recoverable),created_at.gte.<iso>`) — risiko terbesar, ternyata syntax-nya benar.
  - Embed `jobs(tool)` di `getAdminFailedStepAggregates` — FK `job_steps.job_id → jobs.id` dikenali PostgREST.
  - Bentuk kolom nyata: `credit_transactions.type` (`spend`/`refund`), `generation_requests.job_id`, `generation_predictions`.

Ulangi kapan saja:

```bash
npm run admin:probe-monitoring
npm run admin:probe-monitoring -- --window=168 --limit=100
```

[`scripts/probe-monitoring.ts`](../../scripts/probe-monitoring.ts) memanggil ketiga fungsi query layer dan print hasilnya. Read-only, tidak perlu login admin atau dev server.

### Angka anomali di data historis

Window 720 jam, 39 job: sekarang **semua nol**. **Tidak ada banjir false positive** — kekhawatiran utama saat panel ditulis tidak terbukti.

Awalnya ada satu `refund_missing`, dan itu **bug asli, bukan false positive**: job `6ba04f87` (`video_text2video`, 27 Jul 2026 23:15 WIB) di-cancel pre-commit, `spend 35` tanpa refund. Job kembarannya `0ee848ea` 16 menit kemudian ter-refund normal — di antara keduanya ada commit `7f8ec19` yang memperbaiki refund-on-cancel di `app/api/generate-video/route.ts`. Jadi panel benar menandai satu run yang memang kehilangan kredit sebelum fix-nya ada.

**Sudah dibereskan (11 Agu 2026):** 35 kredit dikembalikan lewat RPC `krakatoa_apply_credit_transaction` dengan idempotency key kanonik `refund:video_text2video:6ba04f87-…` — key yang sama yang seharusnya ditulis route, jadi aman kalau ter-eksekusi dua kali. Metadata-nya menyalin bentuk refund kembarannya plus field `backfill` supaya audit ke depan tahu baris ini ditulis manual, bukan oleh route. Saldo profil `a90ca00c` naik 374 → 409.

> Kalau nanti perlu koreksi serupa: tulis sebagai `type='refund'` dengan `job_id` terisi, **jangan** `adjustment`. Panel membandingkan spend vs refund per job, jadi `adjustment` tidak akan membersihkan flag-nya walau saldonya benar.

> Presedennya berguna: kalau `refund_missing` menyala di masa depan, treat sebagai bug nyata dulu, jangan langsung asumsikan classifier-nya salah.

### Yang ketahuan saat uji UI pertama (11 Agu 2026)

Panel **selalu kosong di browser**, di semua window — padahal probe lolos. Penyebabnya di `app/api/admin/monitoring/route.ts`: halaman tidak pernah mengirim `limit`, dan `Number(searchParams.get("limit"))` atas `null` menghasilkan **`0`**, yang lolos guard `Number.isFinite` dan diteruskan sebagai `.limit(0)` → nol baris. Efek sampingnya label `(capped — narrow the window)` ikut menyala, karena `capped` dihitung `jobs.length >= limit` dan `0 >= 0` itu `true` — dua gejala yang saling bertentangan (kepenuhan sekaligus kosong), dan itu yang membuka kasusnya.

Sudah diperbaiki dengan `Number(...) || undefined` untuk `window` **dan** `limit`. Pelajarannya: `probe-monitoring` menguji query layer, **bukan** parsing query string di route — jadi lolosnya probe tidak pernah berarti panelnya jalan di browser. Selalu buka UI-nya sekali.

### Sisa verifikasi: uji E2E di UI

| Skenario | Yang harus terlihat |
|---|---|
| ✅ Baseline window 24h / 30d | Sudah cocok dengan probe: 5 job di 24 jam; 39 job di 30 hari dengan semua chip anomali nol |
| Jalankan satu Reels Creator | Baris `running`, step berganti `style_anchor → scene_breakdown → tts_generation → whisper_transcription → video_generation → rendi_render → storage_upload` tanpa reload |
| Cancel di tengah jalan (sebelum scene pertama) | Status `cancelled`, ledger punya spend **dan** refund, **tanpa** flag `refund_missing` |
| Cancel setelah scene pertama selesai (API balas 409) | Detail menunjukkan `cancel_allowed: false`, badge `cancel locked`, **tanpa** flag merah — ini yang membuktikan exclusion-nya jalan |
| Paksa gagal (unset `RENDI_API_KEY` sementara) | Job `failed`, step `rendi_render` merah dengan pesan error, refund tercatat |
| Buka window 30 hari | Chip `Refund missing` harus `0`. Kalau menyala lagi, periksa job-nya manual — bisa bug refund nyata, bisa juga kode error terminal baru yang belum masuk `RECOVERABLE_TERMINAL_CODES` |

---

## Menambah anomali baru

1. Tambah nilai ke type `JobFlag` di `lib/admin-monitoring-flags.ts`.
2. Tulis aturannya di `classifyJobFlags()` — **input lewat parameter**, jangan baca DB atau `Date.now()` di dalam fungsi, itu yang bikin file ini tetap bisa di-self-check.
3. Tambah assert positif **dan** negatif di `adminMonitoringFlagsSelfCheck()`. Kasus negatif lebih penting: false positive membunuh kegunaan panel lebih cepat daripada false negative.
4. Tambah entry di `FLAG_LABEL` + `FLAG_HINT` dan satu `<Chip>` di `page.tsx`.
5. `counts.anomalies` otomatis ikut karena bertipe `Record<JobFlag, number>` — TypeScript akan menolak build sampai nilai barunya diinisialisasi.

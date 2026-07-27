# Cron jobs — Krakatoa

> Ringkasan tugas background yang jalan otomatis di server (tanpa user klik).

## Apa itu cron di app ini?

**Cron** = scheduler yang memanggil URL API tertentu secara berkala. Dipakai untuk hal yang tidak cocok di-request user: publish post terjadwal, bersihin storage, expire kredit, recovery generation stuck.

Semua endpoint cron ada di `app/api/cron/` dan dilindungi **opsional** oleh `CRON_SECRET` (lihat bawah).

---

## `CRON_SECRET` — password endpoint cron

Bukan token dari Vercel — **kamu buat sendiri** (string random panjang), lalu set di env.

| Tempat | Variable |
|--------|----------|
| Local | `.env.local` → `CRON_SECRET=...` |
| Vercel production | Project → Settings → Environment Variables |
| GitHub Actions (publisher) | Repo secrets → `CRON_SECRET` (harus **sama** dengan Vercel) |
| cron-job.org / curl manual | Header `Authorization: Bearer <CRON_SECRET>` |

**Aturan di code:**

- `CRON_SECRET` **ada** → request harus kirim `Authorization: Bearer <secret>`, else **401**
- `CRON_SECRET` **kosong** (biasanya local dev) → endpoint **terbuka** (tanpa auth)

Generate contoh:

```bash
openssl rand -hex 32
```

Setelah ubah env di Vercel → **redeploy**.

---

## Daftar cron (5 endpoint)

### 1. Publisher — `GET /api/cron`

**Untuk apa:** Post scheduler yang **jadwal sudah lewat** (`status = scheduled`) → upload ke **YouTube / TikTok** → `published` atau `failed`.

**User merasakan:** Video yang dijadwalkan benar-benar ter-upload; gagal auth/quota tercatat di post.

**Jadwal:** **Tidak** ada di `vercel.json`. Dipanggil dari luar:

| Trigger | Cadence | Config |
|---------|---------|--------|
| cron-job.org (utama) | ~1 menit | URL + Bearer `CRON_SECRET` |
| GitHub Actions | ~15 menit (backup) | `.github/workflows/publish-cron.yml` — secrets `CRON_TARGET_URL`, `CRON_SECRET` |

Code: `app/api/cron/route.ts`

---

### 2. Storage sweep — `GET /api/cron/storage-sweep`

**Untuk apa:** Hapus file video **temp** (`videos/temp/`) dan **orphan** di bucket yang sudah lebih dari threshold umur (default **24 jam**).

**User merasakan:** Storage tidak menumpuk file sisa generation (caption `.ass`, clip tidak terpakai).

**Jadwal Vercel:** setiap hari **03:00 UTC** (10:00 WIB) — lihat `vercel.json`

**Query params:**

| Param | Fungsi |
|-------|--------|
| `dryRun=1` | Laporan saja, tidak hapus |
| `minAgeHours=NN` | Override umur minimum (default 24) |

Code: `app/api/cron/storage-sweep/route.ts` · CLI alternatif: `npm run storage:list-orphans`

---

### 3. Credit expiry — `GET /api/cron/credit-expiry`

**Untuk apa:** Lot kredit yang `expires_at` sudah lewat → ledger `expiry` + kurangi saldo wallet.

**User merasakan:** Kredit bonus/paket habis masa berlaku sesuai aturan billing.

**Jadwal Vercel:** setiap hari **03:30 UTC** (10:30 WIB)

**Query:** `dryRun=1` → hitung saja, tidak mutate.

Code: `app/api/cron/credit-expiry/route.ts`

---

### 4. Creation expiry — `GET /api/cron/creation-expiry`

**Untuk apa:** Hapus `user_creations` + file storage yang melewati **retention** (config admin foto/video); soft-delete asset platform terkait.

**User merasakan:** History kreasi lama hilang sesuai policy retention.

**Jadwal Vercel:** setiap hari **04:00 UTC** (11:00 WIB)

**Query:** `dryRun=1` → preview, tidak hapus.

Code: `app/api/cron/creation-expiry/route.ts`

---

### 5. Generation reconcile — `GET /api/cron/generation-reconcile`

**Untuk apa:** Backstop kalau generate **mati** (Vercel timeout 300s, crash tanpa `catch`):

- Job tetap `running` > ~20 menit → refund (jika belum ada refund) + mark `failed` (`STALE_GENERATION`)
- Job `recoverable` dengan TTL habis → refund + purge folder `{userId}/resumable/{jobId}/`
- Sweep folder resumable untuk job terminal yang masih punya artifact
- `generation_requests` status `started` tapi lock expired → close sebagai failed

**User merasakan:** Cancel/timeout tidak membuat kredit “nyangkut” tanpa refund. Recovery window 24h default.

**Jadwal Vercel:** **setiap 30 menit** (`*/30 * * * *`)

Code: `app/api/cron/generation-reconcile/route.ts` · Plans: [`generation-cancel-hardening`](generation/generation-cancel-hardening-plan.md), [`pipeline-recovery`](generation/pipeline-recovery-plan.md)

---

## Ringkasan satu baris

| Endpoint | Fungsi singkat |
|----------|----------------|
| `/api/cron` | Publish post terjadwal (YouTube/TikTok) |
| `/api/cron/storage-sweep` | Hapus video temp/orphan |
| `/api/cron/credit-expiry` | Kredit kadaluarsa |
| `/api/cron/creation-expiry` | History kreasi expired |
| `/api/cron/generation-reconcile` | Refund job generation stuck |

---

## Jadwal di `vercel.json`

```json
storage-sweep         → 0 3 * * *    (harian 03:00 UTC)
credit-expiry         → 30 3 * * *   (harian 03:30 UTC)
creation-expiry       → 0 4 * * *    (harian 04:00 UTC)
generation-reconcile  → */30 * * * * (tiap 30 menit)
```

Publisher (`/api/cron`) sengaja **di luar** `vercel.json` karena plan Hobby membatasi cron Vercel; trigger eksternal lebih sering.

---

## Test manual (local / staging)

Dengan `CRON_SECRET` di `.env.local`:

```bash
export CRON_SECRET='your-secret'
export BASE='http://localhost:3000'

curl -s -H "Authorization: Bearer $CRON_SECRET" "$BASE/api/cron/generation-reconcile"
curl -s -H "Authorization: Bearer $CRON_SECRET" "$BASE/api/cron/storage-sweep?dryRun=1"
curl -s -H "Authorization: Bearer $CRON_SECRET" "$BASE/api/cron/credit-expiry?dryRun=1"
curl -s -H "Authorization: Bearer $CRON_SECRET" "$BASE/api/cron/creation-expiry?dryRun=1"
curl -s -H "Authorization: Bearer $CRON_SECRET" "$BASE/api/cron"
```

Tanpa `CRON_SECRET` di env, curl tanpa header juga jalan (dev only).

---

## Production checklist

1. Set `CRON_SECRET` di Vercel + redeploy
2. Samakan secret di GitHub Actions (`CRON_SECRET`, `CRON_TARGET_URL`) jika pakai scheduler publish
3. Konfigurasi cron-job.org untuk `/api/cron` jika dipakai sebagai trigger utama publisher
4. Pastikan cron Vercel di dashboard aktif (dari `vercel.json`)

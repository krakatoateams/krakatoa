# Ringkasan Santai: Cara Hitung Kredit (Pricing v2)

> Dokumen ini versi gampang dari `pricing-config-v2-plan.md`.
> Tujuannya biar tim non-teknis ngerti: kredit itu dihitung dari mana,
> angkanya datang dari mana, dan kenapa segitu.
> Catatan: ini masih tahap rencana/internal testing, belum ada pembayaran beneran.

---

## Inti banget (TL;DR)

- 1 alat AI (video/foto) itu makan **biaya provider** (dalam USD/dolar).
- Kita ubah biaya dolar itu jadi **kredit**.
- Aturan utamanya cuma satu kalimat:

> **Kredit = biaya provider (USD) × 90, lalu dibulatkan ke atas.**

Angka **90** itu bukan ngarang. Lihat bagian "Dari mana angka 90" di bawah.

---

## Asumsi dasar (anggapan kita sekarang)

- Rp100.000 = 500 kredit
- Rp50.000 = 250 kredit
- Jadi **1 kredit = Rp200**
- Kurs yang dipakai: **1 USD = Rp18.000**
- **Margin = 1.0** artinya belum ada untung/markup. Kita jual seharga modal dulu (buat tes internal).
- Tidak ada biaya tambahan "jaga-jaga", tidak ada biaya tersembunyi.
- Pembulatan cuma dilakukan **sekali di akhir**.

---

## Dari mana angka 90?

Gampang, ini cuma bagi-bagian:

```
90 = harga 1 dolar (Rp18.000) ÷ harga 1 kredit (Rp200)
90 = 18.000 ÷ 200
```

Artinya: **biaya $1 dari provider = 90 kredit.**

Jadi kalau suatu generate makan biaya provider $0,15, maka:

```
0,15 × 90 = 13,5 → dibulatkan ke atas → 14 kredit
```

"Dibulatkan ke atas" maksudnya 13,5 jadi 14 (tidak pernah turun jadi 13).
Ini supaya kita tidak rugi, tapi juga tidak dilebih-lebihkan.

---

## Dari mana harga provider (dolar) datang?

Harga dolarnya itu **harga resmi dari penyedia model AI** (lewat Replicate):
Seedance, Veo, GPT Image, Nano Banana, dll. Itu biaya yang Krakatoa bayar
beneran ke mereka tiap kali generate. Kita cuma menyalin harga itu, lalu
mengubahnya ke kredit pakai rumus di atas.

Harga awal yang dipakai:

| Alat | Pilihan | Harga provider |
|---|---|---|
| Video Seedance | 480p | $0,07 / detik |
| Video Seedance | 720p | $0,15 / detik |
| Video Veo | 720p | $0,05 / detik |
| Video Veo | 1080p | $0,08 / detik |
| Storyboard (gambar) | auto/biasa | $0,128 / gambar |
| Foto Produk | Standard (1K/2K) | $0,15 / gambar |
| Foto Produk | Ultra 4K | $0,30 / gambar |
| Foto Produk | Low (internal) | $0,035 / gambar |

Catatan: harga ini bisa berubah kalau provider ganti tarif. Nanti bisa diubah
dari panel admin.

---

## Aturan penting buat video (jangan salah hitung)

Untuk video, hitung **total dolar dulu** (harga per detik × jumlah detik),
baru diubah ke kredit, baru dibulatkan **sekali**.

Contoh Seedance 720p, durasi 15 detik:

```
$0,15 × 15 detik   = $2,25   (total biaya)
$2,25 × 90         = 202,5
dibulatkan ke atas = 203 kredit
```

Jangan dibulatkan per detik dulu (itu bikin lebih mahal tanpa alasan):

```
SALAH: 0,15 × 90 = 13,5 → 14 → × 15 = 210 kredit
```

Selisihnya kelihatan kecil (203 vs 210), tapi prinsipnya: bulatkan **sekali saja di akhir**.

---

## Contoh hasil akhir (gampang dilihat)

| Apa yang dibuat | Hitungan | Kredit |
|---|---|---|
| Storyboard (auto) | 0,128 × 90 | **12** |
| Seedance 480p, 15 detik | 0,07 × 15 × 90 | **95** |
| Seedance 720p, 15 detik | 0,15 × 15 × 90 | **203** |
| Veo 720p, 15 detik | 0,05 × 15 × 90 | **68** |
| Veo 1080p, 15 detik | 0,08 × 15 × 90 | **108** |
| Foto Produk Standard (1K) | 0,15 × 90 | **14** |
| Foto Produk Ultra 4K | 0,30 × 90 | **27** |

Semua sudah dibulatkan ke atas di langkah terakhir.

---

## Foto Produk: pilihan kualitas

Rencananya user bisa pilih kualitas, dan harganya ikut kualitas:

- **Standard** → 14 kredit
- **Ultra 4K** → 27 kredit
- (opsional internal) **Low** → sekitar 4 kredit

Kenapa cuma Standard & Ultra 4K dulu? Karena 1K dan 2K **harga providernya sama**
($0,15), jadi belum perlu dipisah. 2K disiapkan untuk nanti.

---

## Video: harga ikut resolusi

- Seedance 480p → tarif 480p
- Seedance 720p → tarif 720p
- Veo 720p → tarif 720p
- Veo 1080p → tarif 1080p

Makin tinggi resolusi → makin mahal per detik → makin banyak kredit. Wajar,
karena biaya providernya juga lebih mahal.

---

## Yang BELUM dihitung (sengaja, biar simpel dulu)

- Biaya suara/narasi (MiniMax) dan transkrip (Whisper) — kecil, belum ditagih terpisah.
- Biaya "otak" teks (LLM) — belum ditagih terpisah.
- Margin/untung — masih 1.0 (modal doang).
- Pembayaran / top-up / langganan — belum ada sama sekali.

Jadi untuk sekarang, "harga = biaya provider 1:1" itu maksudnya **biaya utama**
(video & gambar), belum termasuk biaya-biaya kecil pendukung.

---

## Hal yang perlu diingat tim

- Kalau provider naikin harga, kredit ikut naik (tinggal update angkanya).
- Kalau kurs USD/IDR berubah, semua harga kredit ikut berubah.
- Sebelum benar-benar dijual ke publik: **jangan lupa ganti margin** dari 1.0
  ke angka yang ada untungnya.
- Karena dibulatkan ke atas, kadang user "bayar" lebih sedikit dari biaya asli
  (kurang dari 1 kredit). Itu normal dan disengaja.
- Angka di sini adalah **perkiraan** biaya provider; bisa sedikit beda dengan tagihan asli.

---

## Mau detail teknisnya?

Baca dokumen lengkap di `docs/billing/pricing-config-v2-plan.md`.
Dokumen itu untuk tim teknis (skema database, resolver, rencana implementasi, dll).

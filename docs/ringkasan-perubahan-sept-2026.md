# Apa yang dikerjakan di Kelolako (11–14 September 2026)

Ringkasan ini untuk orang yang tidak perlu baca kode.

Titik awal: commit `ad9bce9` (pembaruan panduan teknis).  
Titik akhir: commit `e562bf6` (14 September 2026).

Dalam waktu sekitar empat hari, ada **206 commit** yang menyentuh **315 file**. Itu terdengar besar, tapi intinya bukan “fitur baru yang mencolok”. Yang dikerjakan hampir seluruhnya adalah **pemeriksaan kesehatan seluruh rumah**: kunci pintu, brankas, listrik, CCTV, kontrak sewa, dan beberapa perabotan yang goyang.

---

## Dalam satu kalimat

Tim mengaudit seluruh platform Kelolako, menutup celah keamanan, merapikan aturan uang/kredit, dan memastikan halaman publik jujur kepada pengguna.

---

## Kenapa pekerjaan ini dilakukan

Kelolako sudah punya banyak bagian yang saling terkait:

- login dan akun
- generate foto/video (pakai kredit)
- pembayaran
- file milik pengguna
- koneksi ke TikTok, YouTube, Instagram
- penjadwalan postingan
- panel admin
- halaman marketing dan syarat/ketentuan

Kalau satu bagian longgar, dampaknya bisa langsung terasa: kredit orang lain terpakai, file bocor, postingan terkirim dua kali, atau halaman depan menjanjikan sesuatu yang tidak sesuai kenyataan.

Jadi pekerjaan ini lebih mirip **audit rumah + perbaikan**, bukan pembangunan kamar baru.

---

## Yang paling penting bagi pengguna biasa

### 1. Login dan reset password jadi lebih aman

Sebelumnya ada beberapa celah yang membingungkan atau berbahaya:

- Setelah login, aplikasi kadang “lupa” siapa yang baru masuk.
- Link reset password bisa membuka sesi yang masih bisa dipakai ke halaman lain, padahal password belum diganti.
- Draft prompt/pengaturan orang yang belum login sempat ikut menempel di URL saat login Google. Itu berbahaya karena URL bisa tersimpan di riwayat browser atau log pihak ketiga.

Sekarang:

- Sesi login lebih stabil.
- Reset password dikunci: orang tidak bisa “numpang” ke dashboard atau API sebelum password benar-benar diganti.
- Draft tersimpan di browser (sessionStorage), bukan di URL.
- Aplikasi tidak membiarkan orang dialihkan ke situs luar lewat trik redirect.

### 2. Orang tidak bisa mengutak-atik milik orang lain

Banyak API internal memakai “kunci master” database. Itu wajar di sisi server, tapi berbahaya kalau aplikasi lupa mengecek: “apakah data ini milik pengguna yang sedang login?”

Sekarang pengecekan kepemilikan diperketat untuk:

- canvas dan editor
- skill milik pengguna
- postingan jadwal
- kreasi/foto/video
- klaim bonus selamat datang

Kalau seseorang mencoba mengedit atau mengambil milik orang lain, sistem menolak. Untuk beberapa kasus, jawabannya sengaja dibuat “tidak ditemukan” supaya orang luar tidak bisa menebak-nebak ID.

### 3. Kredit tidak dibayar dua kali, dan tidak dikembalikan sembarangan

Aturan uang di Kelolako sekarang lebih tegas:

- Kredit dipotong **sebelum** AI mulai bekerja.
- Kalau AI sudah mulai mengerjakan (sudah “commit” ke provider), kredit **tidak dikembalikan** hanya karena pengguna membatalkan belakangan.
- Kalau saldo tidak cukup, generate tidak dimulai. Tidak ada pekerjaan setengah jalan yang tetap ditagih.
- Bonus video selamat datang tidak bisa diklaim dua kali lewat race (dua klik bersamaan).
- Pembayaran DOKU hanya menambah kredit kalau **jumlah uang yang dibayar sama persis** dengan paket yang dibeli. Tidak bisa “bayar lebih kecil, dapat paket lebih besar”.

Artinya: sistem kredit jadi lebih adil dan lebih sulit disalahgunakan.

### 4. File pengguna tetap privat

Foto dan video pengguna tidak boleh jadi barang publik yang bisa ditebak URL-nya.

Yang diperbaiki:

- Sebelum file ditandatangani (dibuat link sementara), sistem memastikan path-nya persis milik pengguna itu.
- File foto tidak bisa dipublikasikan atau dikonversi oleh cron kalau bukan milik pemiliknya.
- File sementara untuk generate yang belum selesai tidak ikut terhapus oleh pembersihan harian.
- File yang sudah tidak terpakai tetap dibersihkan, tapi file yang masih hidup tidak boleh ikut kehapus.

Pengguna biasa mungkin tidak merasakan perubahan ini. Itu bagus: artinya file tetap muncul seperti biasa, hanya lebih aman di belakang layar.

### 5. Koneksi TikTok, YouTube, Instagram lebih kokoh

Kalau pengguna menghubungkan akun sosial, token-nya seperti kunci rumah. Kunci itu tidak boleh bocor di log error, dan tidak boleh “setengah tersimpan”.

Yang berubah:

- Error dari TikTok/YouTube/Instagram tidak lagi menampilkan token atau link file sementara.
- Kalau token TikTok gagal disimpan ulang, sistem berhenti dan minta reconnect, bukan pura-pura masih terhubung.
- Token YouTube yang lama tidak hilang hanya karena Google tidak mengirim token baru saat reconnect.
- Ada cron harian untuk memperpanjang token Instagram, supaya koneksi tidak tiba-tiba mati.
- YouTube tidak bisa menukar kode otorisasi tanpa sesi login yang sah.

### 6. Scheduler tidak “nakal” lagi

Penjadwal postingan sudah diaudit dari API sampai cron.

Yang diperbaiki supaya pengguna tidak kaget:

- Harus login dulu sebelum menjadwalkan.
- Postingan yang sudah diambil cron untuk dipublikasikan tidak bisa diubah di tengah jalan.
- Postingan TikTok yang gagal secara permanen tidak diulang terus-menerus.
- Kalau akun TikTok putus atau layanan sedang down, UI tidak mentok di “Loading…”. Pengguna diminta reconnect atau diberi tahu ada gangguan.
- Kalender lama `/calendar` tidak lagi menganggap “sudah login Kelolako” sama dengan “sudah terhubung ke YouTube”.
- Halaman kalender lama itu sendiri sudah diarahkan ke scheduler yang baru.

### 7. Halaman Skills tidak berkedip

Setelah audit, ada sedikit polesan tampilan:

- Daftar Skills menunggu katalog live selesai dimuat. Jadi skill yang sudah disembunyikan admin tidak sempat muncul sebentar lalu hilang.
- Video hero di dashboard menunggu file lokal benar-benar siap, supaya tidak error saat build.

---

## Yang paling penting bagi admin / operasional

### Panel admin lebih aman dan lebih jujur

- Admin terakhir tidak bisa “mencopot dirinya sendiri” sampai tidak ada admin tersisa.
- Pengaturan harga, model, tool, skill, dan paket kredit tersimpan dengan benar. Tombol reset tidak merusak data.
- Skill yang dimatikan admin tidak lolos ke pengguna.
- Generate kosong untuk keperluan internal dikunci, supaya tidak jadi jalan pintas yang mahal atau berbahaya.
- Dashboard admin tidak lagi menarik data tanpa batas. Ada batas jumlah baris supaya tidak berat atau bocor data berlebihan.

### Monitoring lebih berguna

Admin bisa melihat:

- siapa sedang generate apa
- di langkah pipeline mana pekerjaannya
- apakah ada pekerjaan macet, cancel yang tidak dihormati, atau refund yang hilang

Prompt pengguna ikut tersimpan di job (untuk investigasi), tapi **instruksi sistem AI tidak disimpan**.

### Log error tidak lagi “cerewet”

Dulu, error kadang menulis terlalu banyak: stack trace, URL file, token, atau data sensitif.

Sekarang log admin, cron, dan generate sudah disaring. Tim tetap bisa debug, tapi kunci dan file pengguna tidak ikut tercetak.

---

## Yang paling penting bagi keamanan situs

### Database dikunci lebih rapat

- Fungsi-fungsi khusus Kelolako di database hanya bisa dipanggil oleh server (service role), bukan oleh browser sembarangan.
- Aturan RLS lama yang terlalu longgar di tabel warisan sudah dibersihkan.
- Hubungan akun (`auth.users`) sudah diselaraskan dengan data produksi.

### Situs tidak “terbuka pintu belakang”

- Route setup database lewat HTTP sudah dimatikan.
- Cron harian tidak jalan kalau secret deployment belum dipasang. Lebih baik mati daripada terbuka.
- Secret server tidak boleh ikut ke bundle browser. Ada pemeriksaan otomatis supaya ini tidak lolos lagi.
- Header keamanan (CSP dan sejenisnya) dipasang di seluruh situs.
- Dependensi dan pengoptimal gambar sudah dikunci supaya tidak mudah disusupi.

### CI / quality gate

Setiap kali kode mau masuk, ada pemeriksaan otomatis yang **tidak butuh secret produksi**. Artinya komputer CI bisa menolak kode berbahaya tanpa harus memegang kunci rumah.

---

## Halaman depan dan legal jadi lebih jujur

Ini bagian yang paling kelihatan ke orang luar:

- Syarat & ketentuan dan privasi disesuaikan dengan kenyataan. Contoh: Instagram OAuth sudah ada, bukan “fitur masa depan”.
- Klaim yang tidak akurat dihapus, misalnya jumlah output statis atau masa berlaku file yang tidak sesuai pengaturan live.
- Aturan refund di halaman legal diselaraskan dengan aturan kredit yang sebenarnya: kalau AI sudah mulai kerja, kredit tidak otomatis kembali.
- Testimoni yang belum diverifikasi diberi label ilustrasi.
- Ada tautan publik untuk penghapusan data.
- Analytics dan layanan pihak ketiga (Vercel, YouTube embed, Cloudflare, CloudFront) disebutkan dengan lebih jujur.

Intinya: janji di halaman depan tidak boleh lebih besar dari yang benar-benar jalan di belakang.

---

## Apa yang tidak berubah (sengaja)

Beberapa hal **belum** dikerjakan, dan itu disengaja:

- Belum ada sistem langganan penuh.
- Penghapusan akun masih lewat dukungan manual, bukan tombol self-serve.
- Aplikasi terpasang (PWA) bisa di-install, tapi belum bisa dipakai offline.
- Beberapa halaman tool tetap bisa dibuka tanpa login (tampilan saja). Generate, upload, dan data pengguna tetap butuh akun.

---

## Kalau harus dijelaskan ke investor / klien

Boleh pakai versi pendek ini:

> Antara 11–14 September 2026, Kelolako menyelesaikan audit keamanan dan kualitas seluruh platform. Login, kepemilikan data, kredit, pembayaran, file, koneksi sosial, scheduler, admin, dan halaman publik semuanya diperiksa. Celah yang ketemu ditutup. Tidak ada fitur spektakuler yang ditambahkan; yang berubah adalah fondasi supaya produk lebih aman, lebih adil, dan lebih bisa dipercaya.

---

## Urutan kerja (kalau ingin tahu alurnya)

1. **11 September** — perbaikan generate video/foto/skill, lalu mulai audit login.
2. **12 September** — otorisasi, kredit, pembayaran, file, database, TikTok/YouTube/Instagram, scheduler.
3. **13 September** — panel admin, log, monitoring, header keamanan, CI, halaman login, marketing/legal.
4. **14 September** — polesan kecil: Skills tidak berkedip, hero video lebih stabil.

Audit seluruh repositori sudah ditandai **selesai**. Sisa pekerjaan setelah itu hanya follow-up yang sudah ikut ditutup: klaim bonus, pembersihan file, pembayaran DOKU, dan perpanjangan token Instagram.

---

## Catatan untuk tim teknis

Detail slice-per-slice, temuan, dan risiko yang diterima ada di `docs/agents/audit-state.md`.  
Cara mengulang audit berikutnya ada di `docs/agents/code-security-audit-runbook.md`.

File ini **bukan** pengganti dokumen audit itu. File ini hanya terjemahan bahasa manusia.

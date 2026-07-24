# Admin Config v2 — Ringkasan

> Versi gampang dari [`admin-config-v2-plan.md`](./admin-config-v2-plan.md).
> Status: **~90%** — UI di `/admin/config-v2`, legacy masih di `/admin/config`.

---

## Apa ini?

Satu panel admin untuk mengatur **apa yang user lihat & bayar**, dalam urutan produk:

```
Tool → Model → Mode → Harga (Credits + Replicate $)
```

Plus section **Pipeline** (langkah internal: LLM, TTS, Whisper, storyboard image, dll.).

---

## Sudah jalan

- Tree Video (semua model + motion control) & Photo (10 model)
- Mode Photo (image / product / character) — **tersimpan di DB**
- Default per mode — **eksklusif** (cuma satu model default per mode)
- Harga: admin edit **Credits**; Replicate $ untuk referensi + tombol Suggest
- Tool on/off + sidebar
- **Pipeline**: Reels Creator, Veo engine, Storyboard sheet + harga storyboard
- Storyboard **hybrid**: sheet di Photo pipeline, video di Video composer

---

## Belum / nanti

| Item | Prioritas |
|------|-----------|
| Mode Video persist (sekarang hilang saat refresh) | P0 |
| Cutover: ganti `/admin/config` lama | P0 |
| Model on/off per model | P1 |
| Edit Provider ID + parameter (butuh input_schema) | P1 |
| Rendi / infrastruktur | P2 |
| Billing global (margin, kurs) | Panel Adit — bukan di sini |

---

## File penting

- UI: `app/(app)/admin/config-v2/page.tsx`
- Tree: `lib/admin-config-tree.ts`
- Pipeline registry: `lib/admin-pipeline-config.ts`
- Photo features: `lib/creation-features.ts`
- Video catalog: `lib/video-models.ts`

---

## Urutan implementasi (agent)

1. **Cutover** — redirect, hapus legacy setelah parity
2. **Video composer DB** — mirror `feature_model_configs` untuk `reels`
3. **Model on/off** — sembunyikan model dari studio
4. **Provider editor** — schema-driven (blocked)
5. Polish — Rendi, tool IG/Schedule tanpa model tree

Detail lengkap + checklist parity: [`admin-config-v2-plan.md`](./admin-config-v2-plan.md).

OpenSpec: `openspec/changes/admin-config-v2-unified/`

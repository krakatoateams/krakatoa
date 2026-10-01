# Video Editor Design System Audit

## Audit Singkat: File & Elemen → Temuan → Keputusan

| File | Elemen / Kontrol | Temuan Audit | Keputusan & Solusi Design System |
|---|---|---|---|
| `EditorTopBar.tsx` | Pencil rename button, Open button, Save button, Title input | Kurang konsisten pada `focus-visible` styling; Save button memakai disabled opacity tanpa disabled cursor; input title belum memiliki ring fokus semantik. | Tambahkan `focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary`; perbaiki disabled state (`disabled:opacity-40 disabled:cursor-not-allowed`). |
| `EditorLibraryPicker.tsx` | Header close & refresh icon buttons, backdrop | Tombol aksi icon-only belum memiliki `focus-visible` ring semantik. | Tambahkan token fokus `focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary` dan pastikan kontras memadai. |
| `EditorSavedList.tsx` | Header actions, list item rename input, delete button | Delete button tidak memiliki focus ring bertema danger/error; rename input belum menggunakan border token focus; disabled state kurang jelas. | Gunakan `focus-visible:ring-1 focus-visible:ring-brand-primary` untuk rename/action umum, dan `focus-visible:ring-1 focus-visible:ring-error` untuk destructive delete. Pastikan disabled semantics lengkap. |
| `EditorWorkspace.tsx` | Add dropdown, Transport controls (Play/Pause, Skip, Step), Aspect toggles, Timeline duration & timecode inputs | Beragam icon-only control belum memiliki `focus-visible:ring` standar; input durasi dan timeline lack semantic border/focus; layer action buttons (eye, lock, trash) memerlukan focus indicator yang rapi dan tooltip/aria yang lengkap. | Selaraskan seluruh icon button dan interactive trigger dengan token Kelolako (`focus-visible:ring-1 focus-visible:ring-brand-primary`, destructive `focus-visible:ring-error`), pertahankan dark canvas matte dan density timeline yang justified. |

# CZ Studio Editor

Editor video lokal berbasis web, dipasang lewat `npm install -g cz-studio` dan dibuka dengan `cz`.
Spesifikasi lengkap: `docs/SPEC.md`. Fase F0 sampai F9 sudah dibangun; panduan user di `README.md`.

## Prinsip yang tidak boleh dilanggar

1. Lokal penuh: server hanya di `127.0.0.1`; footage, proyek, dan render tidak keluar dari komputer.
2. AI hanya lewat Claude Code milik user (`claude -p` + MCP `cz_*`). Tidak ada API key, tidak ada server AI.
3. Skill adalah template: dibaca Claude, jadi template + aset JSON deklaratif. Skill tidak diubah tanpa izin.
4. Semua dinamis sampai render: caption, aset, transisi, SFX disimpan sebagai data.
5. Pratinjau dan render memakai mesin komposisi yang sama.
6. Footage asli tidak diubah: potongan hanya titik in/out.

## Aturan kode

- Server adalah sumber kebenaran. Setiap perubahan proyek lewat `Op` di `packages/core` (`applyOp`),
  divalidasi dulu (`validateOp`), lalu masuk riwayat undo dengan sumbernya (`manual`, `claude`, `catatan`).
  Claude (F4) memakai jalur yang sama lewat alat MCP, tidak pernah menulis `project.cz.json` langsung.
- Waktu sequence dalam frame (bilangan bulat); in/out sumber dalam detik.
- Tulis `project.cz.json` secara atomik (tmp lalu rename). Jangan hapus atau timpa data tanpa cadangan.
- Tes untuk `packages/core` ditulis sebelum UI-nya: `npm test`.
- TypeScript hanya sintaks yang bisa di-strip (`erasableSyntaxOnly`): tanpa `enum`, tanpa parameter property.
  Impor relatif memakai ekstensi `.ts`.

## Perintah

- `npm install` lalu `npm run dev`: server di 4317 + Vite di 5173 (buka http://localhost:5173).
  Pengembangan butuh Node 23.6+ (menjalankan `.ts` langsung); paket hasil build jalan di Node 20+.
- `npm test`: tes `packages/core`.
- `npm run typecheck`: cek tipe seluruh workspace.
- `npm run build`: bundel server ke `dist/cli.js`, web ke `dist/web`, komposisi render ke `dist/render-bundle`
  (source map wajib ikut: renderer Remotion membacanya). Setelah itu `node dist/cli.js`.

## Struktur

- `packages/core`: skema proyek, validasi, operasi, riwayat undo/redo (patch Immer).
  `content.ts` op transkrip/potongan/aset/caption/scene/catatan; `analysis.ts` deteksi jeda, kata isian, caption;
  `skill.ts` format template + definisi aset deklaratif, token `$`, ekspansi preset.
- `apps/server`: CLI `cz`, server Fastify, simpan/autosave/cadangan.
  `transcribe.ts` whisper.cpp lokal; `claude.ts` jembatan `claude -p`; `mcp.ts` server MCP stdio (`cz mcp`);
  `tools.ts` alat `cz_*`; `skills.ts` pustaka skill di `<data>/skills/<id>/v<n>/`; `render.ts` antrean render.
- `apps/web`: UI React + Vite. Mode Media/Plan/Edit/Render; `Overlay.tsx` edit langsung di Player.
- `packages/composition`: komposisi Remotion, dipakai Player (pratinjau, proxy) dan render (file asli).
  Font bawaan harus ada di Windows dan Chrome headless supaya pratinjau = render.

## Keputusan yang sudah diambil

- Transkrip: whisper.cpp (`whisper-cli -ml 1 -sow -oj`), model bawaan `small`.
- Bahasa UI: Indonesia saja.
- Claude hanya mendapat alat `mcp__cz__*,Read,Glob,Grep` (tanpa Bash); skrip skill tidak dijalankan.
- Audio akhir: loudnorm −14 LUFS / TP −1 dBTP lewat ffmpeg setelah render Remotion.

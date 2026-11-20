# CZ Studio

Editor video lokal untuk konten vertikal. Impor video, potong jeda, timeline ala Premiere, plan per scene, pustaka aset dari skill editing, edit aset langsung di video, lalu render. Semua aksi AI dijalankan oleh Claude Code milikmu sendiri.

- Footage, proyek, dan hasil render tidak pernah keluar dari komputer.
- CZ tidak menyimpan API key. Pemakaian AI dihitung ke login Claude-mu.
- Footage asli tidak diubah: potongan hanya titik in/out.

## Pasang

Prasyarat:

1. Node.js 20 atau lebih baru.
2. ffmpeg dan ffprobe di PATH (Windows: `winget install Gyan.FFmpeg`).
3. Claude Code terpasang dan sudah login: jalankan `claude` sekali di terminal. Opsional: tanpa Claude, impor, potong manual, timeline, edit aset, dan render tetap jalan.

```
npm install -g cz-studio
cz models install
cz doctor
cz
```

`cz models install` mengunduh model transkrip lokal (whisper.cpp, model `small` ±490 MB) dan, di Windows, biner `whisper-cli`. Render pertama mengunduh Chrome Headless sekali (±130 MB).

## Perintah

| Perintah | Fungsi |
| --- | --- |
| `cz` | Buka beranda di browser |
| `cz open "<folder proyek>"` | Buka proyek |
| `cz new "<folder>" [--title "<judul>"] [--video "<file>"] [--skill <id>]` | Buat proyek |
| `cz skill add "<folder skill atau .zip>"` | Tambah skill editing |
| `cz render "<folder proyek>" [--preset 9:16\|1:1\|4:5\|16:9] [--codec h264\|h265\|prores]` | Render tanpa browser |
| `cz models install [--model base\|small\|medium]` | Pasang model transkrip |
| `cz doctor` | Cek Node, ffmpeg, Claude Code, model, port |
| `cz update` | Perbarui ke versi terbaru |

Opsi umum: `--port 4317`, `--no-open`, `--data "<folder data>"` (bawaan `%USERPROFILE%\.cz-studio`).

## Alur kerja

Empat tahap di bilah atas membaca dan menulis proyek yang sama.

1. **Bahan.** Seret video ke editor; pratinjau, gambar mini, dan transkrip per kata disiapkan di latar. Panel *Potong jeda*: tekan *Cari jeda*, tinjau (merah = jeda, kuning = kata pengisi, kata diulang, atau saran Claude), *Putar dengan potongan*, lalu *Potong sekarang*. Di tab *Transkrip*, menghapus kata ikut memotong video di bagian itu.
2. **Rencana.** *Buat rencana dengan Claude* membagi video per bagian dengan tiga pilihan tampilan. Pilih satu untuk memasang elemennya, tulis catatan (teks + hingga 6 gambar), lalu *Kerjakan catatan dengan Claude*.
3. **Sunting.** Seret folder atau .zip gaya edit ke panel kiri, tekan *Siapkan gaya dengan Claude*, lalu seret elemen ke pratinjau atau linimasa. Klik elemen di pratinjau untuk menggeser, mengubah ukuran/putaran, atau klik dua kali untuk mengetik.
4. **Ekspor.** Pilih bentuk layar, jenis file, kualitas, dan bagian yang diekspor. CZ memeriksa catatan yang belum selesai, file yang hilang, dan elemen yang keluar batas aman sebelum mengekspor. Hasil masuk folder `render/` proyek.

Panel Claude (pil di bilah atas) menampilkan antrean, log, dan frame yang dikirim ke Claude. Aktifkan *Tinjau dulu perubahan Claude* di Pengaturan supaya setiap perubahan Claude masuk sebagai usulan yang kamu Terima atau Tolak. Semua perubahan, dari kamu maupun Claude, bisa dibatalkan dengan Ctrl+Z.

## Pengembangan

```
npm install
npm run dev        # server :4317 + Vite :5173 (butuh Node 23.6+)
npm test           # tes packages/core
npm run typecheck
npm run build      # dist/cli.js, dist/web, dist/render-bundle
```

Spesifikasi: [docs/SPEC.md](docs/SPEC.md). Aturan kode: [CLAUDE.md](CLAUDE.md).

## Lisensi pihak ketiga

Render memakai [Remotion](https://remotion.dev/license): gratis untuk individu dan tim hingga 3 orang. Baca syaratnya sebelum membagikan CZ Studio ke pihak lain. Font dan SFX dari skill membawa lisensinya masing-masing.

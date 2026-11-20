# CZ Studio

Editor video lokal untuk konten vertikal. Impor video, potong jeda, timeline ala Premiere, plan per scene, pustaka aset dari skill editing, edit aset langsung di video, lalu render. Semua aksi AI dijalankan oleh Claude Code milikmu sendiri.

- Footage, proyek, dan hasil render tidak pernah keluar dari komputer.
- CZ tidak menyimpan API key. Pemakaian AI dihitung ke login Claude-mu.
- Footage asli tidak diubah: potongan hanya titik in/out.

## Pasang dari awal

Butuh koneksi internet sekali di awal (±440 MB) dan ±1 GB ruang kosong. Setelah itu CZ jalan tanpa internet, kecuali fitur AI.

**1. Pasang Node.js.** Unduh versi LTS dari [nodejs.org](https://nodejs.org), jalankan pemasangnya, klik *Next* sampai selesai. Cek di PowerShell atau Terminal:

```
node -v
```

Harus muncul `v20` atau lebih baru.

**2. Pasang CZ Studio.**

```
npm install -g cz-studio
```

**3. Pasang semua alatnya sekaligus.**

```
cz install
```

Satu perintah ini memasang ffmpeg + ffprobe, whisper-cli, model transkrip `small-q5_1`, mesin ekspor Chrome Headless, dan Claude Code bila belum ada. Alat yang sudah ada dilewati, jadi aman dijalankan ulang. Biasanya langkah ini sudah berjalan sendiri di langkah 2; bila belum, CZ juga menyiapkannya di latar saat pertama dibuka.

**4. Buka CZ.**

```
cz
```

Beranda terbuka di browser. Buat proyek, seret video, selesai.

**5. (Opsional) Hubungkan Claude untuk fitur AI.** Tekan *Masuk ke Claude* di beranda, lalu login di jendela yang terbuka. Butuh akun Claude berlangganan (Pro atau Max). Tanpa Claude, impor, potong jeda, sunting, dan ekspor tetap jalan.

Cek semuanya siap dengan `cz doctor`. Perbarui ke versi baru dengan `cz update`.

macOS/Linux: pasang ffmpeg dan whisper-cli lewat paket sistem dulu (`brew install ffmpeg whisper-cpp`), lalu ikuti langkah yang sama.

## Perintah

| Perintah | Fungsi |
| --- | --- |
| `cz` | Buka beranda di browser |
| `cz open "<folder proyek>"` | Buka proyek |
| `cz new "<folder>" [--title "<judul>"] [--video "<file>"] [--skill <id>]` | Buat proyek |
| `cz skill add "<folder skill atau .zip>"` | Tambah skill editing |
| `cz render "<folder proyek>" [--preset 9:16\|1:1\|4:5\|16:9] [--codec h264\|h265\|prores]` | Render tanpa browser |
| `cz install` | Pasang semua alat yang belum ada (sama dengan `cz setup`) |
| `cz models install [--model small-q5_1\|small\|medium\|base]` | Ganti atau tambah model transkrip |
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

## Lisensi pihak ketiga

Render memakai [Remotion](https://remotion.dev/license): gratis untuk individu dan tim hingga 3 orang. Baca syaratnya sebelum membagikan CZ Studio ke pihak lain. Font dan SFX dari skill membawa lisensinya masing-masing.

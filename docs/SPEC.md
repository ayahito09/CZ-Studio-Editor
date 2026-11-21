# Rancangan CZ Studio

Nov 20, 2026 · @Azmi

## Ringkasan

CZ Studio adalah editor video lokal berbasis web yang diinstal lewat terminal. Di dalamnya ada impor video, potong jeda, timeline lengkap ala Premiere, plan per scene, pustaka aset dari skill, editor aset langsung di video, dan render. Semua aksi AI dijalankan oleh Claude milik user sendiri yang sudah login.

Dokumen ini adalah spesifikasi untuk dibangun bertahap di Claude Code. Setiap bagian bisa diberikan langsung sebagai konteks tugas.

**Enam prinsip yang tidak boleh dilanggar:**

1. **Lokal penuh.** Server berjalan di `localhost`. Footage, proyek, dan hasil render tidak pernah keluar dari komputer user.
2. **AI hanya lewat Claude milik user.** Setiap permintaan AI dijalankan oleh Claude Code yang terpasang dan sudah login di komputer itu. CZ Studio tidak menyimpan API key dan tidak punya server AI sendiri.
3. **Skill adalah template.** Skill editing yang dimasukkan dibaca Claude, lalu diubah menjadi menu gaya dan pustaka aset yang bisa diterapkan per scene.
4. **Semua dinamis sampai render.** Caption, kartu, badge, transisi, dan SFX disimpan sebagai data, bukan piksel. Semuanya tetap bisa dipilih, digeser, dan diedit langsung di video kapan pun.
5. **Yang terlihat = yang dirender.** Pratinjau dan render memakai mesin komposisi yang sama, jadi tidak ada selisih antara editor dan file akhir.
6. **Footage asli tidak diubah.** Pemotongan bersifat non-destruktif (hanya titik in/out di timeline), dan tidak ada color grading kecuali skill dan user memintanya.

## Arsitektur

Browser hanya bicara ke server lokal. Server menjalankan Claude Code milik user dan memberinya alat khusus CZ lewat MCP, sehingga Claude mengubah proyek lewat perintah yang tervalidasi, bukan menyunting file mentah.

&#91;embedded content: arsitektur CZ Studio · 7 komponen\]

| Komponen | Tugas |
| --- | --- |
| Editor di browser | Semua UI: panel Media, Plan, Timeline, Player, Inspector, Aset, panel Claude |
| Server lokal CZ | Menyimpan proyek, autosave, undo/redo, menyajikan media, antrean tugas, jembatan Claude, server MCP |
| Claude Code milik user | Semua keputusan AI: membaca skill, membuat template dan aset, menyusun plan, merevisi dari catatan, memeriksa hasil render |
| Mesin komposisi | Satu kode komposisi video. Dipakai Player di browser untuk pratinjau dan Renderer di server untuk file akhir |
| Mesin media | ffmpeg untuk proxy, thumbnail, waveform, deteksi jeda; transkrip per kata secara lokal |
| Folder skill | Skill editing yang dimasukkan user; dibaca Claude, tidak diubah tanpa izin |
| Folder proyek | Sumber kebenaran proyek: `project.cz.json`, media asli, proxy, hasil render |

## Teknologi yang disarankan

Tumpukan teknologi dipilih supaya pratinjau dan render memakai kode yang sama, dan supaya Claude Code bisa membangunnya dalam satu bahasa (TypeScript).

| Lapisan | Pilihan | Alasan |
| --- | --- | --- |
| Runtime | Node.js 20 LTS atau lebih baru | Satu runtime untuk server, CLI, render |
| Server | Fastify + WebSocket (`ws`) | Ringan; WebSocket untuk progres render, log Claude, dan perubahan proyek secara langsung |
| Frontend | React + TypeScript + Vite; hasil build ikut dalam paket npm | User tidak perlu build sendiri |
| State dan undo | Zustand + Immer, perubahan dicatat sebagai *patch* | Undo/redo tak terbatas yang murah, riwayat per sumber (Manual, Claude, Catatan) |
| Mesin komposisi | Remotion: `@remotion/player` untuk pratinjau, `@remotion/renderer` untuk render | Komposisi React yang sama di editor dan file akhir; skill Clean Editing sudah memakai Remotion |
| Timeline | Komponen sendiri berbasis Canvas 2D (atau PixiJS bila berat) | Ribuan klip, waveform, dan zoom tetap mulus |
| Media | ffmpeg + ffprobe yang terpasang di komputer user | Proxy, thumbnail, waveform, deteksi jeda, ekspor audio |
| Transkrip | Model lokal: whisper.cpp atau sherpa-onnx (Parakeet untuk Inggris, Whisper untuk Indonesia) | Timestamp per kata tanpa mengirim audio ke internet |
| Jembatan AI | Claude Code CLI (`claude -p`) + server MCP CZ (`@modelcontextprotocol/sdk`, stdio) | Memakai login Claude user; Claude mengubah proyek lewat alat yang tervalidasi |
| Penyimpanan | `project.cz.json` + autosave + cadangan berkala | Mudah dibaca Claude dan manusia, mudah di-*diff* |
| Paket | npm, nama `cz-studio`, perintah `cz` | Instal dan perbarui dengan satu perintah |

## Instalasi dan perintah terminal

CZ Studio dipasang sekali lewat npm, lalu dibuka dengan `cz`. Setelah itu semuanya dikerjakan di browser.

**Prasyarat:** Node.js ≥ 20, ffmpeg di PATH, dan Claude Code terpasang serta sudah login (jalankan `claude` sekali).

```
npm install -g cz-studio
cz doctor
cz
```

| Perintah | Fungsi |
| --- | --- |
| `cz` | Menjalankan server dan membuka beranda CZ Studio di browser (daftar proyek dan skill) |
| `cz open "<folder proyek>"` | Membuka proyek tertentu langsung |
| `cz new "<folder>" [--video "<file>"] [--skill <id>]` | Membuat proyek dari terminal |
| `cz skill add "<folder skill atau .zip>"` | Memasukkan skill dari terminal (sama dengan tombol *Tambah skill* di aplikasi) |
| `cz doctor` | Mengecek Node, ffmpeg, ffprobe, Claude Code (`claude --version` dan status login), model transkrip, dan port |
| `cz models install` | Mengunduh model transkrip lokal sekali (bisa juga dari aplikasi) |
| `cz render "<folder proyek>" [--preset <id>]` | Render tanpa membuka browser |
| `cz update` | Memperbarui ke versi terbaru |

Opsi umum: `--port 4317`, `--no-open`, `--data "<folder data>"` (bawaan `%USERPROFILE%\.cz-studio`).

## Koneksi ke Claude milik user

Setiap aksi AI di CZ Studio menjalankan Claude Code yang terpasang di komputer itu, dengan login dan langganan user sendiri. Pemakaian dihitung ke akun Claude user tersebut, bukan ke akun lain.

### Status koneksi

Bilah atas selalu menampilkan pil Claude:

| Status | Cara dicek | Yang ditampilkan |
| --- | --- | --- |
| Terhubung | `claude --version` berhasil dan panggilan uji singkat berhasil | Pil hijau + versi |
| Belum login | Panggilan uji gagal karena autentikasi | Petunjuk: buka terminal, jalankan `claude`, login |
| Tidak terpasang | `claude` tidak ditemukan di PATH | Tautan petunjuk instalasi Claude Code |

Fitur non-AI (impor, potong manual, timeline, edit aset, render) tetap berjalan tanpa Claude.

### Cara memanggil

```
claude -p --output-format stream-json --verbose
       --mcp-config "<data>\cz-mcp.json"
       --allowedTools "mcp__cz__*,Read,Glob,Grep,Bash"
       --add-dir "<folder skill>" [--resume <session_id>]
```

- **Prompt dikirim lewat stdin**, direktori kerja = folder proyek.
- **Windows:** lokasi dicari dengan `where claude`. `claude.exe` dijalankan langsung; `claude.cmd` lewat shell dengan argumen dikutip. *Hentikan* memakai `taskkill /T /F`.
- **Sesi per proyek.** `session_id` disimpan dan dipakai lagi dengan `--resume`, jadi Claude ingat konteks proyek. Tombol *Sesi baru* memulai ulang.
- **Satu tugas Claude per proyek.** Tugas berikutnya masuk antrean yang terlihat di panel Claude.

### Alat MCP `cz_*`

Claude tidak menyunting `project.cz.json` langsung. Ia memakai alat berikut, yang divalidasi server dan dicatat di riwayat dengan sumber "Claude", jadi setiap perubahan bisa dibatalkan.

| Alat | Fungsi |
| --- | --- |
| `cz_get_project`, `cz_get_timeline`, `cz_get_transcript` | Membaca proyek, urutan klip, dan transkrip per kata |
| `cz_get_frame` | Mengambil gambar frame pada detik tertentu (pratinjau komposit) untuk diperiksa Claude |
| `cz_propose_cuts`, `cz_apply_cuts` | Mengusulkan dan menerapkan potongan jeda, kata isian, dan ulangan |
| `cz_set_scenes`, `cz_update_scene` | Membuat dan mengubah scene plan (batas, beat, opsi, pilihan) |
| `cz_list_assets`, `cz_add_asset`, `cz_update_asset`, `cz_remove_asset` | Menaruh dan mengubah aset di timeline |
| `cz_set_caption` | Mengubah kata, waktu, gaya, dan posisi caption |
| `cz_save_template`, `cz_save_asset_def` | Menyimpan template dan definisi aset hasil membaca skill |
| `cz_reply_note`, `cz_set_note_status` | Membalas dan menandai catatan user |
| `cz_render`, `cz_set_status` | Memulai render dan melaporkan kemajuan |

### Mode tinjau

Di Pengaturan ada pilihan *Tinjau dulu perubahan Claude*. Bila aktif, perubahan dari Claude masuk sebagai usulan berwarna di timeline dan Inspector, lalu user memilih Terima atau Tolak per perubahan atau sekaligus.

### Privasi

Audio dan video tidak dikirim ke Claude. Claude menerima teks (transkrip, plan, skill) dan hanya frame yang ia minta lewat `cz_get_frame`. Setiap frame yang dikirim tercatat di log panel Claude.

## Ruang kerja dan alur kerja

CZ Studio punya empat mode yang dipilih di bilah atas. Semuanya membaca dan menulis proyek yang sama, jadi user bisa bolak-balik kapan saja.

1. **Media**: impor video, buat proxy, transkrip, potong jeda.
2. **Plan**: pecah video menjadi scene per konteks, pilih gaya dari template skill, tulis catatan.
3. **Edit**: timeline lengkap dan editor aset langsung di video.
4. **Render**: preset, antrean, kemajuan, dan pemeriksaan hasil.

Alur yang disarankan: Media → Plan → Edit → Render. Claude bisa membantu di setiap mode lewat panel Claude.

&#91;embedded content: susunan mode Edit · 6 area\]

Panel kiri, Inspector, dan panel Claude bisa dilipat atau diubah lebarnya, dan susunannya disimpan per user. Mode Plan memakai susunan kanvas plan dari tab *Bedah fitur plan* (ponsel di kiri, ruang kerja scene di kanan, timeline scene di bawah).

## Impor video dan potong jeda

Video dimasukkan langsung di aplikasi. Jeda dipotong otomatis secara non-destruktif: file asli tetap utuh, yang berubah hanya titik in/out klip di timeline.

### Impor

- **Cara:** seret file atau folder ke panel Media, tombol *Impor*, atau `cz new --video`. Bisa banyak klip sekaligus.
- **Format:** MP4, MOV, MKV, WebM (H.264, HEVC, ProRes). Metadata dibaca dengan ffprobe: resolusi, fps, rotasi, durasi, kanal audio.
- **Proxy otomatis:** salinan 720p H.264 dengan keyframe rapat (GOP 15) untuk scrubbing yang mulus. Video dengan fps berubah-ubah (VFR, umum dari ponsel) diseragamkan di proxy agar sinkron. Render tetap memakai file asli.
- **Persiapan latar belakang:** thumbnail strip, waveform (data peak), dan transkrip per kata. Kemajuannya tampil di panel Media dan tidak menghalangi kerja.
- **Sequence:** pengaturan diambil dari klip pertama (mis. 1080×1920, 30 fps), dengan preset 9:16, 1:1, 4:5, dan 16:9.
- **Salin atau tautkan:** bawaannya media disalin ke folder proyek supaya proyek mudah dipindah. Opsi *Tautkan saja* untuk file besar.

### Transkrip

Transkrip per kata dibuat oleh model lokal (bahasa otomatis, atau dipilih Indonesia/Inggris). Waktu kata hasil perkiraan ditandai dan bisa digeser per frame. Transkrip menjadi dasar caption, potong kata, dan plan.

### Potong jeda

Panel *Potong jeda* menampilkan hasil deteksi sebelum diterapkan.

| Pengaturan | Bawaan | Keterangan |
| --- | --- | --- |
| Jeda minimum | 0,45 dtk | Celah lebih pendek tidak dipotong |
| Padding | 0,30 dtk per sisi | Napas sebelum dan sesudah kata tetap ada |
| Ambang suara | Otomatis dari noise floor | Bisa diatur manual dalam dB |
| Sambungan audio | Crossfade equal-power 20 ms di zero-crossing | Tidak ada klik di titik potong |

Cara kerjanya:

1. Wilayah jeda tampil **merah** di timeline dan dalam daftar. Setiap wilayah bisa diaktifkan atau dimatikan.
2. Kata isian ("eh", "em", "anu") dan kalimat yang diulang tampil **kuning** sebagai usulan. Usulan ini tidak dipotong otomatis.
3. *Putar dengan potongan* memutar hasil sebelum diterapkan; panel menampilkan durasi sebelum → sesudah dan jumlah potongan.
4. *Terapkan* memecah klip menjadi segmen dan menutup celahnya (ripple). Semua potongan bisa dibatalkan, dan setiap segmen tetap bisa di-trim ulang.
5. **Edit lewat teks:** menghapus kata di panel Transkrip ikut memotong video di bagian itu.
6. **Bantuan Claude:** *Usulkan potongan* meminta Claude membaca transkrip dan menandai ulangan, awal kalimat yang salah, dan bagian yang bertele-tele. Usulan masuk lewat `cz_propose_cuts` beserta alasannya.
7. **Pemeriksaan otomatis setelah diterapkan:** lonjakan sampel > 6 dB dalam 2 ms (klik), kata terpotong, dan suara ganda. Titik yang bermasalah ditandai di timeline.

## Timeline lengkap

Timeline CZ Studio bekerja seperti Premiere: banyak track, alat edit lengkap, akurat per frame, dengan pintasan yang sama. Bedanya, caption, aset, dan scene plan juga tampil sebagai klip yang bisa diedit di sini.

### Track

| Track | Isi | Catatan |
| --- | --- | --- |
| Scene | Penanda scene plan (warna beat) | Batas scene bisa diseret; menggeser batas ikut menghitung ulang transisi |
| V3 dan seterusnya | Aset: kartu, badge, mockup, B-roll, teks besar | Track bisa ditambah tanpa batas |
| V2 Caption | Blok caption; tiap kata tampil sebagai kotak kecil | Seret kata untuk mengubah waktunya |
| V1 Footage | Klip video hasil potong jeda | Thumbnail strip |
| A1 Suara asli | Audio terhubung dengan V1 | Waveform, gain, fade |
| A2 SFX, A3 Musik | Klip audio aset dan musik | Ducking otomatis di bawah suara asli |

Setiap track punya kunci, sembunyikan/bisukan, solo, target, nama, dan tinggi yang bisa diubah.

### Operasi klip

- Pindah, trim tepi, ripple trim, roll, slip, slide.
- Potong (razor) di titik klik atau di playhead; ripple delete; lift dan extract.
- Link/unlink audio, aktif/nonaktif klip, salin, tempel, duplikat (Alt + seret), kelompokkan.
- Snap ke playhead, tepi klip, penanda, batas kata, dan batas scene (tombol S).
- Seleksi kotak, Shift + klik, dan pilih semua klip di depan (alat A).
- Audio: gain klip, pegangan fade, keyframe volume, meter master.

### Navigasi dan pemutaran

Penggaris timecode, zoom dengan Ctrl + scroll, *fit* seluruh sequence, langkah per frame, titik in/out, putar berulang, dan shuttle J/K/L. Scrubbing memakai proxy dan cache frame agar tetap 60 fps.

### Pintasan (mengikuti Premiere)

| Tombol | Fungsi |
| --- | --- |
| V / C / B / N / Y / U / A | Pilih / Razor / Ripple edit / Rolling edit / Slip / Slide / Pilih track ke depan |
| Ctrl+K | Potong di playhead |
| Shift+Delete | Ripple delete |
| Q / W | Ripple trim awal / akhir ke playhead |
| I / O | Titik in / out |
| J / K / L | Mundur / berhenti / maju (tekan berulang untuk lebih cepat) |
| Spasi | Putar / jeda |
| ← / → | Mundur / maju satu frame |
| + / − / \\ | Perbesar / perkecil / muat seluruh sequence |
| M | Tambah penanda |
| S | Snap aktif/nonaktif |
| Ctrl+Z / Ctrl+Shift+Z | Batalkan / ulangi |

Semua pintasan bisa diubah di Pengaturan.

## Skill menjadi template dan pustaka aset

User memasukkan skill editing di aplikasi. Claude membacanya lalu menghasilkan dua hal: **template** (menu gaya, pengaturan, aturan) dan **pustaka aset** (caption, kartu, badge, transisi, SFX) yang bisa diterapkan ke setiap scene.

### Alur memasukkan skill

1. **Tambah skill.** Seret folder skill atau file `.zip` ke panel Skill, atau jalankan `cz skill add`. CZ menyalinnya ke `<data>\skills\<id>\v1\` dan mencatat lokasi asalnya untuk *Perbarui dari sumber*.
2. **Inventaris.** CZ membaca frontmatter `SKILL.md` lalu mendata isi folder: referensi, font, SFX, gambar, preset, skrip.
3. **Generate dengan Claude.** Claude membaca SKILL.md dan referensinya, lalu menyimpan hasilnya lewat `cz_save_template` dan `cz_save_asset_def`. Kemajuannya tampil per kategori.
4. **Tinjau.** Layar *Pratinjau template* menampilkan menu yang akan muncul, setiap aset dengan thumbnail beranimasi, dan peringatan (mis. aturan skill yang tidak bisa dipetakan, atau skrip yang butuh Python).
5. **Pakai.** Template aktif untuk proyek yang memilihnya. Skill juga tetap diberikan ke Claude (`--add-dir`) setiap kali Claude bekerja di proyek itu.
6. **Ubah kapan saja.** Lewat editor template (formulir + JSON), atau minta Claude: "buat kartu harga lebih bulat". Setiap perubahan membuat versi baru. Proyek mengunci versi yang dipakainya dan ditawari pembaruan.

### Yang dihasilkan Claude dari skill

| Bagian | Isi | Muncul di |
| --- | --- | --- |
| Token desain | Warna utama dan aksen, font, ukuran, radius, bayangan, grid, area aman | Semua aset dan pratinjau |
| Gaya caption | Huruf, kapital, ukuran, jarak baris, animasi masuk/keluar, efek kata aktif, gaya kata (tebal, serif, aksen) | Track caption, Inspector caption |
| Preset tata letak | Wajah, split, kartu bawah, B-roll, mockup, dan lainnya, beserta posisi footage | Menu Gaya dan Plan |
| Preset gaya | Kombinasi tata letak + caption + kamera + SFX | Tiga opsi per scene di Plan |
| Kontrol Kustom | Grup dan kontrol (pilihan, penggeser, sakelar) dengan nilai bawaan dan syarat berlaku | Tab Kustom di Plan dan Inspector |
| Definisi aset | Kartu, badge, teks besar, mockup UI, latar, overlay | Panel Aset |
| Transisi dan kamera | Transisi antar scene, push, zoom, ikuti wajah | Panel Aset dan Inspector |
| Peta SFX | Peran bunyi (woosh, tombol, ketik, …) ke file SFX skill | Track SFX dan aset |
| Aturan otomatis | Kapan aset dipicu naskah (objek disebut → kartu, angka → countdown), pemecahan scene, larangan | Aksi Claude *Terapkan aset sesuai naskah* |
| Aturan catatan | Kata kunci catatan → perubahan konkret | Tab Catatan di Plan |

### Format definisi aset

Aset ditulis sebagai JSON deklaratif yang tersusun dari elemen dasar (`rect`, `text`, `image`, `video`, `icon`, `shape`, `stack`, `list`, `mask`, `ui-chat`). Format ini aman: Claude tidak perlu menulis kode yang dijalankan, dan setiap aset tetap bisa diedit lewat parameter.

```json
{
  "id": "ce.kartu-ui", "name": "Kartu UI", "category": "kartu", "version": 1,
  "params": {
    "title": { "type": "text", "default": "Judul" },
    "lines": { "type": "list", "item": "text", "default": ["Baris satu"] },
    "accent": { "type": "color", "default": "$accent" },
    "width": { "type": "number", "min": 400, "max": 960, "default": 800, "unit": "px" }
  },
  "layout": { "anchor": "bottom-center", "x": 540, "y": 1520, "w": "$width", "safeArea": true },
  "tree": [
    { "type": "rect", "radius": 34, "fill": "#FFFFFF", "stroke": "#E6EBF2", "shadow": "soft" },
    { "type": "stack", "gap": 27, "padding": 48, "children": [
      { "type": "text", "bind": "title", "style": "cardTitle" },
      { "type": "list", "bind": "lines", "style": "cardLine" } ] }
  ],
  "in": { "preset": "blurRise", "frames": 15, "curve": "gentle" },
  "out": { "preset": "blurFade", "frames": 10 },
  "sfx": { "in": "tombol", "out": "kertas" },
  "trigger": "objek atau daftar disebut di naskah"
}
```

Nilai berawalan `$` merujuk token template, jadi mengganti warna aksen template mengubah semua aset sekaligus.

### Menerapkan aset ke scene

- Seret aset dari panel Aset ke Player (langsung di posisinya) atau ke timeline (di waktunya).
- Pilih preset gaya per scene di Plan; asetnya dipasang otomatis di scene itu.
- *Terapkan ke semua scene* untuk gaya caption, latar, atau SFX.
- Claude: *Terapkan aset sesuai naskah* membaca transkrip dan aturan otomatis, lalu memasang aset tepat di kata pemicunya. Hasilnya bisa ditinjau sebelum diterima.

## Aset dinamis dan editor langsung di video

Semua yang tampil di atas footage, baik buatan Claude maupun user, adalah **instans aset** yang disimpan sebagai data. Setiap instans bisa dipilih di Player dan diubah bebas sampai render: posisi, ukuran, teks, warna, waktu, maupun animasinya.

### Isi setiap instans aset

| Bagian | Isi |
| --- | --- |
| Sumber | Id definisi aset + versi template, atau "bebas" bila dibuat dari nol |
| Parameter | Nilai sesuai skema aset (judul, baris, warna, ikon, …) |
| Transform | x, y, skala, rotasi, opasitas, titik jangkar |
| Waktu | Mulai, durasi, track, terikat ke kata atau scene (ikut bergeser bila video dipotong) |
| Animasi | Masuk, keluar, kurva, keyframe posisi/skala/opasitas/rotasi |
| SFX | Bunyi saat masuk dan keluar, volume |
| Status | Terkunci (Claude tidak boleh mengubah), tersembunyi, terlepas dari template |

### Edit langsung di Player

- **Klik** untuk memilih: kotak batas dengan pegangan ukuran dan rotasi.
- **Seret** untuk memindah, **pegangan sudut** untuk mengubah ukuran (Shift = bebas rasio), **klik dua kali** pada teks untuk mengetik langsung.
- **Garis bantu snap:** tengah layar, batas area aman (atas 220, bawah 400, kiri/kanan 80 px), grid template, tepi aset lain, kotak wajah.
- Panah menggeser 1 px (Shift = 10 px), Alt + seret menduplikat, Ctrl+\[ / \] mengatur urutan lapisan, multi-pilih untuk meratakan dan mendistribusikan.
- **Peringatan langsung:** garis merah bila aset keluar area aman (termasuk bayangan dan glow) atau menutupi wajah.

### Edit caption

Caption disimpan per kata, jadi setiap bagiannya bisa diubah tanpa merusak sinkronisasi.

- Klik dua kali blok caption di Player untuk mengedit teks. Teks audio tidak berubah.
- Pilih satu kata untuk membuka toolbar mini: gaya kata (normal, tebal, serif, aksen), warna, pecah blok di sini, gabung dengan blok berikutnya.
- Seret blok untuk memindah posisinya, atau pilih preset posisi (dada, atas, bawah).
- Di track caption, seret tepi kotak kata untuk mengubah waktunya per frame.
- Inspector caption: huruf, tebal, ukuran, kapital, jarak baris, kata per baris, maksimum baris, animasi masuk/keluar, efek kata aktif.
- *Terapkan ke semua caption* menyalin gaya ke seluruh video; *Reset ke template* mengembalikan nilai skill.

### Inspector

Formulir Inspector dibangun otomatis dari skema parameter aset, ditambah bagian umum (transform, waktu, animasi, SFX, keyframe). Pilihan lainnya:

- *Simpan sebagai preset*: menyimpan aset yang sudah diubah ke template sebagai varian baru.
- *Terhubung ke template* (bawaan): bila template diperbarui, aset ikut berubah kecuali parameter yang sudah diubah user.
- *Lepas dari template*: aset tidak lagi ikut perubahan template.

Semua perubahan, baik dari user maupun Claude, masuk ke riwayat dan bisa dibatalkan. Bila user mengunci aset, Claude tidak bisa mengubahnya.

## Plan per scene

Mode Plan membawa semua fitur kanvas plan dari tab *Bedah fitur plan*, dengan satu perbedaan penting: plan tidak lagi terpisah dari video. Setiap scene adalah rentang waktu di timeline, dan setiap pilihan gaya langsung menjadi aset nyata di track.

- **Buat plan (Claude).** Claude membaca transkrip dan aturan pemecahan scene dari template, lalu memecah video per konteks. Setiap scene berisi beat, ringkasan konteks, alasan batas, dan tiga opsi dari preset gaya dengan tepat satu ★.
- **Memilih opsi** memasang aset scene itu di track (diberi tanda `sceneId`). Bila user sudah mengubah aset scene itu, CZ menanyakan apakah ubahan dipertahankan.
- **Tab scene** tetap enam: Gaya, Kustom, Teks, SFX, Catatan, Riwayat. Kontrol Kustom berasal dari template skill.
- **Catatan** bisa berisi teks dan hingga 6 gambar, terikat ke scene dan detik. Catatan yang dikenali langsung dipratinjau sebagai lapisan sementara; yang bertabrakan ditandai Konflik; sisanya diterjemahkan Claude.
- **Revisi sesuai catatan (Claude).** Claude memetakan catatan terbuka ke perubahan lewat alat `cz_*`, menandai catatan selesai, dan membalas bila ada yang tidak bisa dikerjakan.
- **Status scene:** draft, diubah, disetujui, dikunci. Scene terkunci tidak diubah oleh *Terapkan ke semua* maupun Claude.
- **Ringkasan perubahan** (pengganti laci *Plan → Final*): per scene, opsi, ubahan, dan status catatan. Isinya ikut menjadi daftar periksa sebelum render.

## Render

Render berjalan di dalam CZ Studio memakai mesin komposisi yang sama dengan Player, jadi file akhir persis seperti yang terlihat di editor.

### Pengaturan render

| Pengaturan | Pilihan | Bawaan |
| --- | --- | --- |
| Preset | Reels/TikTok/Shorts 1080×1920, Square 1080×1080, YouTube 1920×1080, kustom | Mengikuti sequence |
| fps | Asli, 24, 25, 30, 60 | Asli |
| Codec | H.264, HEVC, ProRes 422 (untuk diedit lagi) | H.264 |
| Kualitas | CRF atau bitrate target | CRF 18 |
| Audio | AAC 192k, normalisasi suara asli −14 LUFS, limiter −1 dBTP, SFX diduck di bawah suara | Aktif |
| Rentang | Seluruh sequence, titik in/out, scene terpilih | Seluruh sequence |
| Lokasi | Folder `render/` di proyek atau folder pilihan | `render/` |

### Antrean dan kemajuan

- Panel Render menampilkan antrean: kemajuan per frame, perkiraan sisa waktu, tombol jeda dan batal.
- Render bisa dijalankan sambil user tetap mengedit, karena render memakai snapshot proyek saat tombol ditekan.
- **Render scene** merender satu scene saja untuk dicek cepat (pengganti render revisi per scene di skill).
- Selesai: notifikasi, tombol *Buka file*, *Tampilkan di folder*, dan pemutar hasil.
- Render juga bisa dijalankan dari terminal: `cz render "<folder proyek>"`.

### Pemeriksaan sebelum dan sesudah render

- **Sebelum:** catatan yang masih terbuka atau konflik, aset di luar area aman, aset yang menutupi wajah, font yang hilang, dan media offline. User bisa lanjut atau memperbaiki dulu.
- **Sesudah (opsional, Claude):** *Periksa hasil* meminta Claude melihat frame tiap scene dan titik sambungan lewat `cz_get_frame`, lalu melaporkan masalah sebagai catatan di scene terkait.
- **Audio:** klik di sambungan, suara ganda, dan bagian di mana SFX menenggelamkan suara asli.

## Model data proyek

Satu file `project.cz.json` memuat seluruh keadaan proyek. Media, proxy, dan hasil render tinggal di subfolder. Waktu sequence disimpan dalam **frame** (bilangan bulat) supaya edit akurat per frame; titik in/out sumber disimpan dalam detik.

### Folder

| Lokasi | Isi |
| --- | --- |
| `<proyek>\project.cz.json` | Seluruh data proyek (skema di bawah) |
| `<proyek>\media\` | Video dan audio asli (atau tautan) |
| `<proyek>\proxy\`, `<proyek>\cache\` | Proxy 720p, thumbnail, waveform, frame cache |
| `<proyek>\render\` | Hasil render |
| `<proyek>\.cz\` | Riwayat undo, autosave tiap 30 dtk, cadangan harian, sesi Claude, log, gambar catatan |
| `%USERPROFILE%\Videos\CZ Studio\Skills\<id>\v<n>\` | Salinan skill, `cz-template.json`, `cz-assets\*.json`, `cz-component.js` |
| `%USERPROFILE%\Videos\CZ Studio\Aset\` | SFX dan font bawaan CZ |
| `%USERPROFILE%\Videos\CZ Studio\Proyek\<judul>\` | Folder proyek baru (bawaan) |
| `%USERPROFILE%\.cz-studio\` | `settings.json`, ffmpeg, whisper dan model transkrip, daftar proyek terakhir, `cz-mcp.json` |

### Skema `project.cz.json` (ringkas)

```json
{
  "version": 1, "id": "p_8f2c", "title": "Edit dengan Claude",
  "skill": { "id": "clean-editing", "version": 2 },
  "sequence": { "width": 1080, "height": 1920, "fps": 30, "durationFrames": 732 },
  "media": [ { "id": "m1", "path": "media/take1.mp4", "proxy": "proxy/m1.mp4",
               "duration": 41.2, "fps": 30, "width": 1080, "height": 1920 } ],
  "transcript": { "words": [ { "id": "w0", "mediaId": "m1", "text": "Edit",
                                "srcStart": 0.42, "srcEnd": 0.61, "estimated": false } ] },
  "tracks": [ { "id": "V1", "kind": "video", "name": "Footage", "locked": false, "hidden": false } ],
  "clips": [ { "id": "c1", "trackId": "V1", "mediaId": "m1", "srcIn": 0.12, "srcOut": 3.9,
              "start": 0, "linkId": "l1", "gainDb": 0 } ],
  "captions": [ { "id": "cap1", "trackId": "V2", "start": 4, "end": 92,
                 "words": [ { "wordId": "w0", "text": "Edit", "start": 4, "end": 10, "style": "normal" } ],
                 "style": "$caption.default", "position": { "preset": "bawah" } } ],
  "assets": [ { "id": "a1", "trackId": "V3", "defId": "ce.kartu-ui", "defVersion": 1, "sceneId": "s2",
               "start": 120, "duration": 90, "anchorWordId": "w14",
               "params": { "title": "Cara lama" }, "transform": { "x": 540, "y": 1520, "scale": 1 },
               "anim": { "in": "blurRise", "out": "blurFade" }, "keyframes": [], "locked": false } ],
  "scenes": [ { "id": "s2", "title": "Masalah lama", "beat": "Konteks", "start": 108, "end": 252,
                 "options": [ { "id": "A", "star": true, "presetId": "split-daftar" } ],
                 "choice": "A", "custom": {}, "status": "draft" } ],
  "cuts": [ { "id": "k1", "kind": "jeda", "mediaId": "m1", "srcStart": 3.9, "srcEnd": 4.6,
              "by": "auto", "state": "applied" } ],
  "notes": [], "markers": []
}
```

Aset dan caption yang ditandai `anchorWordId` ikut bergeser bila klip di depannya dipotong, sehingga tetap sinkron dengan kata yang memicunya.

## Roadmap pembangunan

Pembangunan dibagi menjadi sepuluh fase berurutan. Setiap fase menghasilkan aplikasi yang bisa dijalankan dan diuji sebelum lanjut ke fase berikutnya.

&#91;embedded content: roadmap CZ Studio · 10 fase\]

1. **F0 Fondasi.** Monorepo TypeScript (`apps/server`, `apps/web`, `packages/core` berisi skema + validasi, `packages/composition` berisi komposisi Remotion), perintah `cz`, buka/simpan proyek, autosave, undo/redo berbasis patch. *Selesai bila* `cz` membuka proyek kosong dan undo bekerja.
2. **F1 Media.** Impor seret-lepas, ffprobe, proxy, thumbnail, waveform, Player 9:16. *Selesai bila* video ponsel 1 menit bisa di-scrub mulus.
3. **F2 Timeline.** Track, klip, semua alat dan pintasan di bagian Timeline, snap, zoom. *Selesai bila* operasi dasar Premiere (potong, ripple delete, trim, roll, slip) berjalan dan bisa dibatalkan.
4. **F3 Transkrip dan potong jeda.** Model lokal, deteksi jeda dengan pengaturan, crossfade, edit lewat teks. *Selesai bila* jeda terpotong tanpa klik dan kata tidak terpotong.
5. **F4 Claude.** Deteksi status Claude, jembatan `claude -p`, server MCP dengan alat `cz_*`, panel Claude, mode tinjau. *Selesai bila* *Usulkan potongan* dari Claude muncul di timeline dan bisa diterima.
6. **F5 Skill.** Impor skill, generate template + aset oleh Claude, perender elemen dasar aset, panel Aset dengan thumbnail. *Selesai bila* skill Clean Editing menjadi menu gaya dan minimal 10 aset yang bisa dipasang.
7. **F6 Editor aset dan caption.** Manipulasi langsung di Player, Inspector otomatis, caption per kata, keyframe. *Selesai bila* setiap aset buatan Claude bisa diubah bebas lalu dibatalkan.
8. **F7 Plan.** Scene per konteks, tiga opsi, enam tab, catatan dengan gambar, revisi oleh Claude. *Selesai bila* satu video bisa direncanakan dan direvisi tanpa keluar dari aplikasi.
9. **F8 Render.** Render Remotion, antrean, preset, pemeriksaan sebelum/sesudah, `cz render`. *Selesai bila* frame hasil render sama dengan frame Player di titik yang sama.
10. **F9 Rilis.** Paket npm, `cz doctor`, `cz update`, panduan, uji di Windows bersih. *Selesai bila* komputer lain bisa memasang dan merender dengan satu perintah.

**Cara membangunnya di Claude Code:** simpan dokumen ini sebagai `docs/SPEC.md` di repositori, rangkum prinsip dan aturan pentingnya di `CLAUDE.md`, lalu kerjakan satu fase per sesi. Minta Claude Code menulis tes untuk `packages/core` (skema, operasi timeline, potong jeda) sebelum UI-nya.

## Keputusan terbuka dan risiko

| Hal | Risiko atau pertanyaan | Usulan |
| --- | --- | --- |
| Lisensi Remotion | Gratis untuk individu dan organisasi hingga 3 orang; tim 4+ orang wajib Company License ([remotion.dev/license](https://remotion.dev/license)). Bila CZ Studio dibagikan atau dijual ke orang lain, setiap pemakai ikut terikat lisensi ini | Aman untuk pemakaian pribadi. Sebelum distribusi, baca syarat Remotion untuk alat pembuat video, atau siapkan perender sendiri (Canvas + ffmpeg) sebagai cadangan |
| Transkrip bukan lewat Claude | Claude Code tidak bisa mendengar audio, jadi transkrip dibuat model lokal. Ini satu-satunya proses "AI" yang tidak lewat Claude | Model lokal untuk transkrip; semua keputusan editing tetap oleh Claude |
| Kuota Claude user | Aksi berat (generate template, plan video panjang) memakai kuota langganan user | Tampilkan perkiraan ukuran tugas sebelum dijalankan; aksi kecil dan terarah lewat alat MCP |
| Skrip skill (Python, Linux) | Skill Clean Editing memakai skrip Python dan perintah Linux yang belum tentu jalan di Windows | CZ mengambil alih transkrip, potong jeda, dan render. Skill dipakai sebagai sumber aturan, gaya, dan aset, bukan sebagai pipeline yang dijalankan |
| Kode aset buatan Claude | Komponen React buatan AI yang langsung dijalankan bisa berbahaya atau rusak | v1 hanya aset JSON deklaratif. Komponen kode kustom ditunda dan nanti berjalan di sandbox |
| Lisensi aset skill | Font dan SFX skill berasal dari berbagai sumber dengan lisensi campuran | Tampilkan sumber dan lisensi tiap file aset di panel Aset; beri peringatan sebelum render untuk publikasi komersial |
| Kinerja | Video panjang (> 10 menit) dan banyak aset bisa membuat Player dan timeline berat | Proxy, virtualisasi timeline, cache frame, dan render aset di Player hanya untuk rentang yang terlihat |
| ffmpeg | Pemasangan ffmpeg di Windows sering gagal di PATH | `cz doctor` memberi petunjuk; opsi unduh ffmpeg otomatis ke folder data |

Keputusan yang perlu diambil sebelum F0:

- [ ] Pemakaian CZ Studio: pribadi, tim sendiri, atau dibagikan ke publik (menentukan urusan lisensi Remotion).
- [ ] Bahasa UI: Indonesia saja atau Indonesia + Inggris.
- [ ] Model transkrip bawaan: whisper.cpp atau sherpa-onnx.

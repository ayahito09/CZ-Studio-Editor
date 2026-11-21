// Aset bawaan CZ: tiap aset adalah KOMPONEN KODE (packages/composition/src/assets) yang digerakkan mesin cz-motion.
// Di sini hanya katalognya: nama, isi yang bisa diubah user/Claude, ukuran kotak, dan durasi bawaan.
import type { AssetDef, ParamDef } from "./skill.ts";

const def = (d: Omit<AssetDef, "version" | "tree">): AssetDef => ({ ...d, version: 1, tree: [] });
/** Tema kartu UI (komponen membaca warna isi dari tema ini). */
const TEMA: ParamDef = { type: "select", options: ["terang", "gelap", "kaca", "biru"], default: "terang", label: "Tema" };

export const BUILTIN_ASSETS: AssetDef[] = [
  def({
    id: "cz.teks", component: "cz.teks", name: "Judul bergerak", category: "motion graphic", duration: 3,
    description: "Judul kinetik: kata masuk satu per satu (blur → tajam, naik, jatuh, sapu, atau diketik), kata aksen menyala lalu mengendap.",
    trigger: "kalimat kunci, hook, angka penting",
    params: {
      text: { type: "text", default: "Edit yang terasa premium", label: "Teks" },
      aksen: { type: "text", default: "premium", label: "Kata aksen" },
      gaya: { type: "select", options: ["blur", "naik", "jatuh", "sapu", "ketik"], default: "blur", label: "Gerakan" },
      ukuran: { type: "number", default: 92, min: 24, max: 300, label: "Ukuran" },
      warna: { type: "color", default: "#FFFFFF", label: "Warna" },
      aksenWarna: { type: "color", default: "#DCF90C", label: "Warna aksen" },
    },
    layout: { x: 540, y: 620, w: 980, h: 420 },
  }),
  def({
    id: "cz.chat", component: "cz.chat", name: "Mockup chat (diketik)", category: "mockup", duration: 7,
    description: "Jendela chat: pesan user diketik huruf demi huruf dengan kursor, dikirim, lalu balasan muncul setelah titik-titik mengetik.",
    trigger: "menyebut Claude, ChatGPT, AI, prompt, chat, DM",
    params: {
      judul: { type: "text", default: "Claude", label: "Nama aplikasi" },
      pesan: { type: "list", default: ["Saya: Bikinin hook buat video edit", "Claude: Siap! Coba ini: \"Editanmu bagus, tapi kenapa sepi?\""], label: "Pesan (Nama: isi; baris pertama = kamu)" },
      tema: { type: "select", options: ["terang", "gelap"], default: "terang", label: "Tema" },
      aksen: { type: "color", default: "#D97757", label: "Warna aksen" },
      kecepatan: { type: "number", default: 18, min: 4, max: 60, label: "Kecepatan ketik (huruf/detik)" },
    },
    layout: { x: 540, y: 780, w: 900, h: 940 },
  }),
  def({
    id: "cz.kartu", component: "cz.kartu", name: "Kartu poin", category: "motion graphic", duration: 4,
    description: "Kartu yang mendarat lembut, lalu judul, subjudul, dan tiap poin masuk bertahap dengan tanda yang tergambar.",
    trigger: "daftar langkah, tips, manfaat, perbandingan",
    params: {
      judul: { type: "text", default: "3 hal yang bikin editan rapi", label: "Judul" },
      sub: { type: "text", default: "Simpan biar nggak lupa", label: "Subjudul" },
      poin: { type: "list", default: ["Potong jeda", "Caption per kata", "Gerak kamera halus"], label: "Poin" },
      ikon: { type: "text", default: "✦", label: "Tanda poin" },
      tema: { type: "select", options: ["terang", "gelap", "kaca"], default: "terang", label: "Tema" },
      aksen: { type: "color", default: "#3683D6", label: "Warna aksen" },
    },
    layout: { x: 540, y: 760, w: 900, h: 620 },
  }),
  def({
    id: "cz.broll", component: "cz.broll", name: "B-roll", category: "b-roll", duration: 3,
    description: "Potongan video proyek sebagai B-roll: layar penuh, kartu melayang, di dalam ponsel, atau miring 3D, dengan zoom pelan yang terus bergerak.",
    trigger: "menyebut contoh, hasil, layar, produk, tempat",
    params: {
      media: { type: "media", label: "Video" },
      mulai: { type: "number", default: 0, min: 0, step: 0.1, unit: "detik", label: "Mulai dari detik" },
      bingkai: { type: "select", options: ["kartu", "penuh", "ponsel", "miring"], default: "kartu", label: "Bingkai" },
      label: { type: "text", default: "", label: "Label" },
      aksen: { type: "color", default: "#3683D6", label: "Warna aksen" },
    },
    layout: { x: 540, y: 960, w: 1080, h: 1920 },
  }),
  def({
    id: "cz.angka", component: "cz.angka", name: "Angka naik", category: "motion graphic", duration: 3,
    description: "Angka menghitung naik dengan digit bergulir, label masuk sesudahnya, garis aksen tergambar.",
    trigger: "angka, harga, persentase, jumlah",
    params: {
      nilai: { type: "number", default: 1000, label: "Angka" },
      awalan: { type: "text", default: "", label: "Awalan (mis. Rp)" },
      akhiran: { type: "text", default: "+", label: "Akhiran (mis. %)" },
      label: { type: "text", default: "pengikut baru", label: "Label" },
      warna: { type: "color", default: "#FFFFFF", label: "Warna" },
      aksen: { type: "color", default: "#DCF90C", label: "Warna aksen" },
    },
    layout: { x: 540, y: 700, w: 960, h: 420 },
  }),
  def({
    id: "cz.notif", component: "cz.notif", name: "Notifikasi", category: "mockup", duration: 3,
    description: "Notifikasi ponsel meluncur dari atas dengan pegas, ikon meletup, teks masuk bertahap, lalu terangkat keluar.",
    trigger: "pesan masuk, pengikut, pembayaran, pengingat",
    params: {
      aplikasi: { type: "text", default: "Instagram", label: "Aplikasi" },
      judul: { type: "text", default: "Pengikut baru", label: "Judul" },
      isi: { type: "text", default: "@kamu mulai mengikutimu", label: "Isi" },
      waktu: { type: "text", default: "sekarang", label: "Waktu" },
      aksen: { type: "color", default: "#E1306C", label: "Warna ikon" },
    },
    layout: { x: 540, y: 330, w: 960, h: 230 },
  }),
  // ---- Gaya editorial bersih (board Clean Editing): kartu UI putih, badge, ring, diagram, aksen kata, latar ----
  def({
    id: "cz.profil", component: "cz.profil", name: "Kartu profil", category: "kartu UI", duration: 5,
    description: "Kartu profil Instagram: avatar meletup, angka posts/followers bergulir, bio diketik, grid postingan muncul bertahap.",
    trigger: "menyebut profil, bio, akun, followers",
    params: {
      username: { type: "text", default: "kamu.edits", label: "Username" },
      nama: { type: "text", default: "Nama Kamu | Video Editor", label: "Nama" },
      bio: { type: "list", default: ["Edit video viral untuk bisnis", "1 juta+ views dari video buatanku"], label: "Bio (per baris)" },
      posts: { type: "number", default: 79, min: 0, label: "Posts" },
      followers: { type: "number", default: 40000, min: 0, label: "Followers" },
      following: { type: "number", default: 801, min: 0, label: "Following" },
      aksen: { type: "color", default: "#3683D6", label: "Warna aksen" },
      tema: TEMA,
    },
    layout: { x: 540, y: 840, w: 840, h: 1100 },
  }),
  def({
    id: "cz.harga", component: "cz.harga", name: "Kartu harga", category: "kartu UI", duration: 4,
    description: "Kartu produk putih: harga besar bergulir naik, catatan, lalu tombol ditekan.",
    trigger: "harga, biaya, diskon, produk, kursus",
    params: {
      produk: { type: "text", default: "Kelas Editing 2.0", label: "Produk" },
      sub: { type: "text", default: "Akses selamanya · semua materi", label: "Subjudul" },
      awalan: { type: "text", default: "Rp", label: "Awalan" },
      harga: { type: "number", default: 299000, min: 0, label: "Harga" },
      catatan: { type: "text", default: "sekali bayar · akses seumur hidup", label: "Catatan" },
      tombol: { type: "text", default: "Ambil sekarang", label: "Tombol" },
      aksen: { type: "color", default: "#3683D6", label: "Warna aksen" },
      tema: TEMA,
    },
    layout: { x: 540, y: 820, w: 840, h: 640 },
  }),
  def({
    id: "cz.browser", component: "cz.browser", name: "Jendela browser", category: "kartu UI", duration: 5,
    description: "Jendela browser: titik-titik jendela meletup, alamat diketik, isi berupa potongan video proyek yang zoom pelan.",
    trigger: "website, halaman, kursus online, dashboard, layar",
    params: {
      url: { type: "text", default: "kamu.com/kelas", label: "Alamat" },
      judul: { type: "text", default: "Personal branding", label: "Judul" },
      media: { type: "media", label: "Video isi" },
      mulai: { type: "number", default: 0, min: 0, step: 0.1, unit: "detik", label: "Mulai dari detik" },
      aksen: { type: "color", default: "#3683D6", label: "Warna aksen" },
      tema: TEMA,
    },
    layout: { x: 540, y: 760, w: 940, h: 640 },
  }),
  def({
    id: "cz.dokumen", component: "cz.dokumen", name: "Kartu dokumen", category: "kartu UI", duration: 5,
    description: "Kartu dokumen putih: judul berpenanda biru, lalu baris-baris naskah masuk satu per satu.",
    trigger: "naskah, script, catatan, dokumen, prompt panjang",
    params: {
      judul: { type: "text", default: "Naskah video", label: "Judul" },
      isi: { type: "list", default: ["Lima video terakhirku diedit penuh oleh Claude.", "Biayanya lebih murah, waktunya lebih cepat.", "Jadi, apakah editor video sudah tamat?"], label: "Baris" },
      aksen: { type: "color", default: "#3683D6", label: "Warna aksen" },
      tema: TEMA,
    },
    layout: { x: 540, y: 700, w: 900, h: 520 },
  }),
  def({
    id: "cz.carousel", component: "cz.carousel", name: "Carousel kartu", category: "kartu UI", duration: 6,
    description: "Deret kartu yang digeser: kursor menekan panah, kartu berikutnya meluncur ke tengah, titik halaman ikut berpindah.",
    trigger: "pilihan, contoh berurutan, beberapa produk/kursus",
    params: {
      kartu: { type: "list", default: ["Short film sinematik", "Animasi SaaS", "Iklan produk"], label: "Isi kartu" },
      aksen: { type: "color", default: "#3683D6", label: "Warna aksen" },
      tema: TEMA,
    },
    layout: { x: 540, y: 820, w: 1000, h: 760 },
  }),
  def({
    id: "cz.polaroid", component: "cz.polaroid", name: "Polaroid", category: "kartu UI", duration: 4,
    description: "Foto polaroid miring dari potongan video proyek, keterangan serif italic muncul dari blur.",
    trigger: "foto, kenangan, contoh hasil, portofolio",
    params: {
      media: { type: "media", label: "Video" },
      mulai: { type: "number", default: 0, min: 0, step: 0.1, unit: "detik", label: "Mulai dari detik" },
      keterangan: { type: "text", default: "momen ini", label: "Keterangan" },
      miring: { type: "number", default: -4, min: -20, max: 20, unit: "°", label: "Kemiringan" },
      aksen: { type: "color", default: "#3683D6", label: "Warna aksen" },
    },
    layout: { x: 540, y: 820, w: 620, h: 760 },
  }),
  def({
    id: "cz.komentar", component: "cz.komentar", name: "Bubble komentar", category: "kartu UI", duration: 4,
    description: "Komentar putih bertumpuk (avatar, nama, isi) yang masuk satu per satu.",
    trigger: "komentar, pertanyaan penonton, testimoni, DM",
    params: {
      pesan: { type: "list", default: ["Rina: Aku belum bisa After Effects 😅", "Dimas: Tapi pengen editan kayak gini"], label: "Komentar (Nama: isi)" },
      aksen: { type: "color", default: "#3683D6", label: "Warna aksen" },
      tema: TEMA,
    },
    layout: { x: 540, y: 520, w: 820, h: 420 },
  }),
  def({
    id: "cz.kolomkomentar", component: "cz.kolomkomentar", name: "Kolom komentar (CTA)", category: "CTA", duration: 4,
    description: "Kolom komentar: kata kunci diketik dengan kursor, lalu kursor menekan tombol kirim.",
    trigger: "ajakan komentar, ketik kata kunci, CTA",
    params: {
      teks: { type: "text", default: "brand", label: "Teks diketik" },
      tema: { type: "select", options: ["gelap", "terang"], default: "gelap", label: "Tema" },
      aksen: { type: "color", default: "#3683D6", label: "Warna aksen" },
    },
    layout: { x: 540, y: 1180, w: 820, h: 110 },
  }),
  def({
    id: "cz.youtube", component: "cz.youtube", name: "Kartu video YouTube", category: "CTA", duration: 5,
    description: "Kartu video: thumbnail dari potongan video proyek, tombol putar meletup, judul dan kanal masuk bertahap.",
    trigger: "video lengkap, tutorial, tonton juga, link di bio",
    params: {
      judul: { type: "text", default: "Cara membangun personal brand sebagai editor", label: "Judul" },
      kanal: { type: "text", default: "Kamu", label: "Kanal" },
      info: { type: "text", default: "2 jam lalu", label: "Info" },
      durasi: { type: "text", default: "10:15", label: "Durasi" },
      media: { type: "media", label: "Thumbnail (video)" },
      mulai: { type: "number", default: 0, min: 0, step: 0.1, unit: "detik", label: "Mulai dari detik" },
      aksen: { type: "color", default: "#3683D6", label: "Warna aksen" },
      tema: TEMA,
    },
    layout: { x: 540, y: 1180, w: 720, h: 560 },
  }),
  def({
    id: "cz.ikon", component: "cz.ikon", name: "Ikon aplikasi", category: "badge", duration: 3,
    description: "Deret ikon putih membulat yang meletup bergantian; isi angka saja menjadi halaman kalender.",
    trigger: "uang, waktu, grafik, aplikasi, tanggal, jumlah hari",
    params: {
      ikon: { type: "list", default: ["$", "⏳", "📈"], label: "Ikon (simbol/emoji; angka = kalender)" },
      bulan: { type: "text", default: "HARI", label: "Label kalender" },
      aksen: { type: "color", default: "#3683D6", label: "Warna ikon" },
    },
    layout: { x: 540, y: 1180, w: 600, h: 170 },
  }),
  def({
    id: "cz.kaca", component: "cz.kaca", name: "Kartu kaca", category: "kartu UI", duration: 4,
    description: "Kartu glassmorphism melayang dengan badge ikon di sudut; baris serif italic lalu kata besar tebal.",
    trigger: "pencapaian, status, pernyataan besar",
    params: {
      judul: { type: "text", default: "Kamu sedang", label: "Baris kecil (serif)" },
      sub: { type: "text", default: "Bertumbuh", label: "Kata besar" },
      ikon: { type: "text", default: "✓", label: "Ikon badge" },
      aksen: { type: "color", default: "#3683D6", label: "Warna badge" },
    },
    layout: { x: 540, y: 760, w: 680, h: 820 },
  }),
  def({
    id: "cz.diamond", component: "cz.diamond", name: "Badge nomor", category: "badge", duration: 3,
    description: "Badge diamond biru bernomor berputar mengunci, judul poin dan subjudul muncul dari blur.",
    trigger: "poin bernomor: pertama, kedua, langkah 1/2/3",
    params: {
      nomor: { type: "text", default: "1", label: "Nomor" },
      judul: { type: "text", default: "Jadi luar biasa", label: "Judul" },
      sub: { type: "text", default: "mengalahkan trik marketing apa pun", label: "Subjudul" },
      aksen: { type: "color", default: "#3683D6", label: "Warna badge" },
    },
    layout: { x: 540, y: 1180, w: 900, h: 170 },
  }),
  def({
    id: "cz.countdown", component: "cz.countdown", name: "Countdown", category: "badge", duration: 10,
    description: "Ring hitung mundur: angka turun dari N ke 0 dan ring menyusut sepanjang durasi elemen.",
    trigger: "janji waktu, dalam 60 detik, sisa waktu",
    params: {
      dari: { type: "number", default: 60, min: 1, label: "Mulai dari" },
      label: { type: "text", default: "detik", label: "Label" },
      aksen: { type: "color", default: "#E0262B", label: "Warna ring" },
    },
    layout: { x: 540, y: 1180, w: 260, h: 260 },
  }),
  def({
    id: "cz.progress", component: "cz.progress", name: "Progress ring", category: "badge", duration: 3,
    description: "Ring progres yang terisi sambil persentasenya bergulir naik.",
    trigger: "persentase, tingkat, progres, hasil",
    params: {
      persen: { type: "number", default: 75, min: 0, max: 100, unit: "%", label: "Persen" },
      label: { type: "text", default: "", label: "Label" },
      aksen: { type: "color", default: "#A855F7", label: "Warna ring" },
    },
    layout: { x: 540, y: 860, w: 300, h: 300 },
  }),
  def({
    id: "cz.mindmap", component: "cz.mindmap", name: "Mind-map", category: "diagram", duration: 4,
    description: "Pil pusat meletup, garis lengkung tergambar ke tiap cabang, lalu pil cabang masuk bergantian.",
    trigger: "nama, ide bercabang, pilihan, turunan",
    params: {
      pusat: { type: "text", default: "Alex", label: "Pusat" },
      cabang: { type: "list", default: ["alex.edits", "alex.mp4"], label: "Cabang" },
      aksen: { type: "color", default: "#E1306C", label: "Warna penanda" },
    },
    layout: { x: 540, y: 560, w: 900, h: 400 },
  }),
  def({
    id: "cz.alur", component: "cz.alur", name: "Alur langkah", category: "diagram", duration: 5,
    description: "Langkah bernomor dari atas ke bawah; garis penghubung tergambar sebelum langkah berikutnya masuk.",
    trigger: "langkah, proses, urutan, cara kerja",
    params: {
      langkah: { type: "list", default: ["Tulis naskah", "Rekam talking head", "Edit dengan Claude"], label: "Langkah" },
      aksen: { type: "color", default: "#3683D6", label: "Warna nomor" },
    },
    layout: { x: 540, y: 760, w: 820, h: 560 },
  }),
  def({
    id: "cz.radial", component: "cz.radial", name: "Radial titik", category: "diagram", duration: 3,
    description: "Garis tipis memancar dari pusat ke titik-titik kotak, pusatnya berdenyut ke warna aksen.",
    trigger: "pusat perhatian, inti, yang penting, jaringan",
    params: {
      jumlah: { type: "number", default: 14, min: 3, max: 32, label: "Jumlah titik" },
      warna: { type: "color", default: "#FFFFFF", label: "Warna garis" },
      aksen: { type: "color", default: "#E0785A", label: "Warna pusat" },
    },
    layout: { x: 540, y: 1040, w: 640, h: 640 },
  }),
  def({
    id: "cz.aksen", component: "cz.aksen", name: "Aksen kata", category: "aksen teks", duration: 3,
    description: "Satu kata diberi aksen: elips merah tergambar, pil lime miring, glow, garis bawah, titik aksen, atau kurung sudut.",
    trigger: "satu kata kunci per kalimat: never, forever, value, harga",
    params: {
      kata: { type: "text", default: "never", label: "Kata" },
      gaya: { type: "select", options: ["elips", "pil", "glow", "garis", "titik", "kurung"], default: "elips", label: "Aksen" },
      huruf: { type: "select", options: ["sans", "serif"], default: "sans", label: "Huruf" },
      ukuran: { type: "number", default: 96, min: 24, max: 300, label: "Ukuran" },
      warna: { type: "color", default: "#FFFFFF", label: "Warna teks" },
      aksen: { type: "color", default: "#E0262B", label: "Warna aksen" },
    },
    layout: { x: 540, y: 1100, w: 700, h: 220 },
  }),
  def({
    id: "cz.latar", component: "cz.latar", name: "Latar layar penuh", category: "latar", duration: 4,
    description: "Latar penuh: putih bergrid yang bergeser pelan, biru, hitam, biru elektrik, atau warna sendiri, dengan kata besar opsional.",
    trigger: "konsep, pernyataan satu kalimat, B-roll/split latar putih",
    params: {
      gaya: { type: "select", options: ["grid-putih", "biru", "hitam", "elektrik", "warna"], default: "grid-putih", label: "Latar" },
      teks: { type: "text", default: "", label: "Kata besar" },
      ukuran: { type: "number", default: 120, min: 24, max: 300, label: "Ukuran kata" },
      warna: { type: "color", default: "#2F6FD8", label: "Warna (gaya warna)" },
    },
    layout: { x: 540, y: 960, w: 1080, h: 1920 },
  }),
  def({
    id: "cz.blurbawah", component: "cz.blurbawah", name: "Area blur bawah", category: "latar", duration: 4,
    description: "Lapisan blur bergradasi di bagian bawah supaya caption dan elemen di bawah wajah tetap terbaca.",
    trigger: "caption atau elemen di bawah wajah",
    params: {
      kekuatan: { type: "number", default: 60, min: 0, max: 100, unit: "%", label: "Kekuatan" },
    },
    layout: { x: 540, y: 1440, w: 1080, h: 960 },
  }),
  def({
    id: "cz.balasclaude", component: "cz.balasclaude", name: "Kotak balas Claude", category: "kartu UI", duration: 4,
    description: "Kotak tulis chat Claude: prompt diketik dengan kursor, chip model, lalu tombol kirim ditekan.",
    trigger: "menyebut prompt, minta ke Claude/AI, mengetik perintah",
    params: {
      teks: { type: "text", default: "Bikinin hook 3 detik buat video ini", label: "Prompt diketik" },
      placeholder: { type: "text", default: "Balas ke Claude…", label: "Teks kosong" },
      model: { type: "text", default: "Claude", label: "Nama model" },
      tema: TEMA, aksen: { type: "color", default: "#D97757", label: "Warna aksen" },
    },
    layout: { x: 540, y: 1180, w: 760, h: 210 },
  }),
  def({
    id: "cz.bullet", component: "cz.bullet", name: "Bullet bintang", category: "diagram", duration: 4,
    description: "Daftar poin dengan bintang 4 sudut yang berputar meletup, teks tiap poin muncul dari blur.",
    trigger: "daftar, tips, manfaat, pertama-kedua-ketiga",
    params: {
      poin: { type: "list", default: ["Terlihat profesional", "Dikemas warna premium", "Siap tayang hari ini"], label: "Poin" },
      ukuran: { type: "number", default: 44, min: 20, max: 120, label: "Ukuran" },
      warna: { type: "color", default: "#FFFFFF", label: "Warna teks" },
      aksen: { type: "color", default: "#DCF90C", label: "Warna bintang" },
    },
    layout: { x: 540, y: 1180, w: 820, h: 300 },
  }),
  def({
    id: "cz.aplikasi", component: "cz.aplikasi", name: "Kartu aplikasi", category: "kartu UI", duration: 4,
    description: "Kartu aplikasi/alat: ikon meletup, nama, keterangan, rating, lalu tombol ditekan.",
    trigger: "menyebut nama aplikasi, alat, software, tools",
    params: {
      nama: { type: "text", default: "Claude", label: "Nama aplikasi" },
      sub: { type: "text", default: "Asisten AI untuk menulis & mengedit", label: "Keterangan" },
      ikon: { type: "text", default: "", label: "Ikon (kosong = huruf awal)" },
      rating: { type: "text", default: "4.9", label: "Rating" },
      tombol: { type: "text", default: "Coba", label: "Tombol" },
      tema: TEMA, aksen: { type: "color", default: "#D97757", label: "Warna ikon" },
    },
    layout: { x: 540, y: 1230, w: 860, h: 190 },
  }),
  def({
    id: "cz.checklist", component: "cz.checklist", name: "Checklist", category: "kartu UI", duration: 5,
    description: "Kartu daftar: tiap baris menyala lalu diberi tanda ✕ merah (masalah) atau ✓ hijau (beres).",
    trigger: "kesalahan, masalah, checklist, yang harus dihindari",
    params: {
      judul: { type: "text", default: "Hasil naskah", label: "Judul" },
      baris: { type: "list", default: ["Hook terlalu panjang", "Visual hilang", "Caption lupa"], label: "Baris" },
      tanda: { type: "select", options: ["salah", "benar"], default: "salah", label: "Tanda" },
      tema: TEMA, aksen: { type: "color", default: "#3683D6", label: "Warna aksen" },
    },
    layout: { x: 540, y: 760, w: 760, h: 420 },
  }),
  def({
    id: "cz.ulangprompt", component: "cz.ulangprompt", name: "Ulang prompt, hasil beda", category: "kartu UI", duration: 6,
    description: "Prompt yang sama diketik ulang (↻ ×n), lalu kartu-kartu hasil yang berbeda muncul berjajar.",
    trigger: "AI tidak konsisten, hasil beda-beda, generate ulang",
    params: {
      prompt: { type: "text", default: "Buatin naskah video 30 detik", label: "Prompt" },
      hasil: { type: "list", default: ["Hook lucu, gaya santai", "Hook data, gaya formal", "Hook cerita, gaya personal"], label: "Hasil" },
      tema: TEMA, aksen: { type: "color", default: "#D97757", label: "Warna aksen" },
    },
    layout: { x: 540, y: 760, w: 940, h: 560 },
  }),
  def({
    id: "cz.jam", component: "cz.jam", name: "Jam waktu", category: "badge", duration: 3,
    description: "Cincin jam yang terisi sambil angka waktu naik (mis. 3,0 jam).",
    trigger: "waktu terbuang, lama pengerjaan, jam, menit",
    params: {
      nilai: { type: "number", default: 3, min: 0, label: "Angka akhir" },
      satuan: { type: "text", default: "jam", label: "Satuan" },
      label: { type: "text", default: "habis buat ngerapiin", label: "Label" },
      warna: { type: "color", default: "#FFFFFF", label: "Warna teks" },
      aksen: { type: "color", default: "#3683D6", label: "Warna cincin" },
    },
    layout: { x: 540, y: 820, w: 440, h: 440 },
  }),
  def({
    id: "cz.videowall", component: "cz.videowall", name: "Video wall", category: "b-roll", duration: 4,
    description: "Dinding thumbnail vertikal yang zoom-out, kotak tengah memutar video proyek, judul besar muncul di tengah.",
    trigger: "jumlah besar, ratusan video, portofolio, banyak klien",
    params: {
      judul: { type: "text", default: "100+ video", label: "Judul" },
      kartu: { type: "list", default: ["Reels", "Iklan", "Podcast", "Tutorial"], label: "Label kotak" },
      media: { type: "media", label: "Video kotak tengah" },
      mulai: { type: "number", default: 0, min: 0, step: 0.1, unit: "detik", label: "Mulai dari detik" },
      latar: { type: "select", options: ["hitam", "putih"], default: "hitam", label: "Latar" },
      aksen: { type: "color", default: "#3683D6", label: "Warna kotak" },
    },
    layout: { x: 540, y: 960, w: 1080, h: 1920 },
  }),
  def({
    id: "cz.split", component: "cz.split", name: "Panel split", category: "latar", duration: 5,
    description: "Panel putih/biru bergrid turun dari atas sampai separuh layar, judul dan baris serif muncul di dalamnya; wajah tetap di bawah.",
    trigger: "menjelaskan konsep sambil tetap terlihat wajah",
    params: {
      judul: { type: "text", default: "Satu ide per video", label: "Judul" },
      sub: { type: "text", default: "biar penonton nggak bingung", label: "Baris serif" },
      gaya: { type: "select", options: ["putih", "biru"], default: "putih", label: "Panel" },
      ukuran: { type: "number", default: 72, min: 24, max: 200, label: "Ukuran judul" },
    },
    layout: { x: 540, y: 480, w: 1080, h: 960 },
  }),
  def({
    id: "cz.sebelumsesudah", component: "cz.sebelumsesudah", name: "Sebelum / sesudah", category: "b-roll", duration: 4,
    description: "Dua kartu video berdampingan: sebelum (pudar keabuan) → panah tergambar → sesudah (berbingkai aksen).",
    trigger: "perbandingan, hasil edit, transformasi, before after",
    params: {
      kiri: { type: "text", default: "sebelum", label: "Label kiri" },
      kanan: { type: "text", default: "sesudah", label: "Label kanan" },
      media: { type: "media", label: "Video" },
      mulai: { type: "number", default: 0, min: 0, step: 0.1, unit: "detik", label: "Detik sebelum" },
      mulaiSesudah: { type: "number", default: 0, min: 0, step: 0.1, unit: "detik", label: "Detik sesudah" },
      aksen: { type: "color", default: "#DCF90C", label: "Warna bingkai" },
    },
    layout: { x: 540, y: 820, w: 960, h: 680 },
  }),
  def({
    id: "cz.tumpuk", component: "cz.tumpuk", name: "Kartu bertumpuk", category: "kartu UI", duration: 5,
    description: "Kartu testimoni/kutipan yang jatuh bertumpuk miring bergantian, lengkap dengan avatar dan bintang.",
    trigger: "testimoni, ulasan, bukti sosial, kata klien",
    params: {
      kartu: { type: "list", default: ["Rina: Closing klien pertama dalam seminggu!", "Dimas: Editanku jadi kelihatan mahal.", "Sari: Dapat 3 klien tetap bulan ini."], label: "Kartu (Nama: isi)" },
      tema: TEMA, aksen: { type: "color", default: "#3683D6", label: "Warna aksen" },
    },
    layout: { x: 540, y: 820, w: 900, h: 700 },
  }),
  def({
    id: "cz.pikiran", component: "cz.pikiran", name: "Gelembung pikiran", category: "dekorasi", duration: 3,
    description: "Gelembung pikiran putih yang meletup bertahap (dua bulatan kecil lalu awan teks), melayang pelan.",
    trigger: "isi kepala penonton, keraguan, pertanyaan dalam hati",
    params: {
      teks: { type: "text", default: "kok mahal ya?", label: "Teks" },
      arah: { type: "select", options: ["kanan", "kiri"], default: "kanan", label: "Ekor ke" },
      ukuran: { type: "number", default: 44, min: 20, max: 120, label: "Ukuran teks" },
      tema: TEMA,
    },
    layout: { x: 640, y: 560, w: 560, h: 280 },
  }),
  def({
    id: "cz.dekor", component: "cz.dekor", name: "Dekorasi", category: "dekorasi", duration: 3,
    description: "Hiasan bergerak: bentuk X lime, partikel pixel berkedip, bintang berkilau, atau gelembung doodle tergambar.",
    trigger: "aksen visual ringan, momen seru, mengisi ruang kosong",
    params: {
      gaya: { type: "select", options: ["x", "pixel", "sparkle", "doodle"], default: "x", label: "Bentuk" },
      jumlah: { type: "number", default: 3, min: 1, max: 40, label: "Jumlah" },
      aksen: { type: "color", default: "#DCF90C", label: "Warna" },
    },
    layout: { x: 540, y: 700, w: 900, h: 500 },
  }),
  def({
    id: "cz.artifak", component: "cz.artifak", name: "Kartu artifak AI", category: "kartu UI", duration: 6,
    description: "Aplikasi buatan AI: judul, tab, kolom tema diketik, tombol Generate ditekan, lalu hasil keluar satu per satu.",
    trigger: "bikin tool/aplikasi sendiri pakai AI, artifact, generator",
    params: {
      label: { type: "text", default: "Studio Naskah", label: "Label" },
      judul: { type: "text", default: "Ide, Naskah & Caption", label: "Judul" },
      tab: { type: "list", default: ["Ide Konten", "Naskah", "Caption"], label: "Tab" },
      isian: { type: "text", default: "bikin tool naskah sendiri", label: "Isian diketik" },
      tema: TEMA,
      hasil: { type: "list", default: ["Naskah 10 menit jadi 30 detik", "Tool naskah buatan sendiri, 4 langkah", "Simpan biar nggak nulis dari nol ✦"], label: "Hasil" },
      aksen: { type: "color", default: "#3683D6", label: "Warna aksen" },
    },
    layout: { x: 540, y: 800, w: 760, h: 640 },
  }),
];

/** Komposisi skill yang bisa dipasang sebagai aset: id diawali "Aset" (mis. <Composition id="AsetKartuHarga" …>). */
export const SKILL_ASSET = /^aset/i;
export const skillAssetId = (compositionId: string) => `skill:${compositionId}`;

/** Definisi aset untuk komposisi skill: isi yang bisa diubah dibaca dari defaultProps komposisinya. */
export function skillAssetDef(compositionId: string, defaults: Record<string, unknown>, durationInFrames: number, fps: number, seq: { width: number; height: number }): AssetDef {
  const params: Record<string, ParamDef> = {};
  for (const [k, v] of Object.entries(defaults)) {
    if (typeof v === "number") params[k] = { type: "number", default: v };
    else if (typeof v === "boolean") params[k] = { type: "bool", default: v };
    else if (typeof v === "string") params[k] = { type: /^#[0-9a-f]{3,8}$/i.test(v) ? "color" : k.toLowerCase().includes("media") ? "media" : "text", default: v };
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) params[k] = { type: "list", default: v };
  }
  const name = compositionId.replace(SKILL_ASSET, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").trim() || compositionId;
  return {
    id: skillAssetId(compositionId), component: skillAssetId(compositionId), name, category: "gaya edit", version: 1, params, tree: [],
    layout: { x: seq.width / 2, y: seq.height / 2, w: seq.width, h: seq.height },
    duration: Math.max(1, durationInFrames) / Math.max(1, fps),
  };
}

/** Penempatan cepat elemen di area aman 9:16 (atas 220 px, bawah 400 px @1920): pusat Y kotak setinggi boxH × scale. */
export type Placement = "atas" | "tengah" | "bawah";
export function placementY(where: Placement, boxH: number, scale: number, seqH: number): number {
  const k = seqH / 1920, half = (boxH * scale) / 2;
  // kotak yang lebih tinggi dari area aman (mis. layar penuh) tetap di tengah
  if (where === "tengah" || boxH * scale > seqH - 620 * k) return Math.round(seqH / 2);
  return Math.round(where === "atas" ? 220 * k + half : seqH - 400 * k - half);
}

/** Skala supaya kotak boxW×boxH memenuhi layar (sisi 80 px, area aman atas 220/bawah 400 @1920), maksimal 2,5×. */
export function fullScale(boxW: number, boxH: number, seq: { width: number; height: number }): number {
  const k = seq.height / 1920;
  return Math.round(Math.min(2.5, (seq.width - 160 * (seq.width / 1080)) / boxW, (seq.height - 620 * k) / boxH) * 100) / 100;
}

/** Kotak aset di koordinat sequence (titik tengah = transform.x/y, rotasi diabaikan). */
export interface Box { x0: number; y0: number; x1: number; y1: number }
export function assetBox(t: { x: number; y: number; scale: number }, w: number, h: number): Box {
  const hw = (w * t.scale) / 2, hh = (h * t.scale) / 2;
  return { x0: t.x - hw, y0: t.y - hh, x1: t.x + hw, y1: t.y + hh };
}
const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const overlap = (a: Box, b: Box) => area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });

/** Kotak wajah (ternormalisasi 0..1 terhadap frame media) dipetakan ke sequence: footage mengisi layar (cover). */
export function faceToSeq(face: { x: number; y: number; w: number; h: number }, media: { width: number; height: number }, seq: { width: number; height: number }): Box {
  const s = Math.max(seq.width / media.width, seq.height / media.height);
  const ox = (seq.width - media.width * s) / 2, oy = (seq.height - media.height * s) / 2;
  return { x0: ox + face.x * media.width * s, y0: oy + face.y * media.height * s, x1: ox + (face.x + face.w) * media.width * s, y1: oy + (face.y + face.h) * media.height * s };
}

/** Masalah penempatan elemen: keluar area aman 9:16 (sisi 80, atas 220, bawah 400 @1080×1920) dan menutupi wajah.
 *  Elemen layar penuh (≥ 90% lebar dan tinggi) sengaja menutupi semuanya, jadi tidak diperiksa. */
export function placementIssues(box: Box, seq: { width: number; height: number }, face: Box | null): { full: boolean; faceCover: number; issues: string[] } {
  const kx = seq.width / 1080, ky = seq.height / 1920;
  const full = box.x1 - box.x0 >= seq.width * 0.9 && box.y1 - box.y0 >= seq.height * 0.9;
  const issues: string[] = [];
  if (full) return { full, faceCover: 0, issues };
  const safe = { x0: 80 * kx, y0: 220 * ky, x1: seq.width - 80 * kx, y1: seq.height - 400 * ky };
  const out = [box.x0 < safe.x0 - 1 && "kiri", box.x1 > safe.x1 + 1 && "kanan", box.y0 < safe.y0 - 1 && "atas", box.y1 > safe.y1 + 1 && "bawah"].filter(Boolean);
  if (out.length) issues.push(`keluar area aman di sisi ${out.join(", ")} (area aman x ${Math.round(safe.x0)}-${Math.round(safe.x1)}, y ${Math.round(safe.y0)}-${Math.round(safe.y1)})`);
  const faceCover = face && area(face) > 0 ? overlap(box, face) / area(face) : 0;
  if (faceCover > 0.15) issues.push(`menutupi ${Math.round(faceCover * 100)}% wajah (wajah x ${Math.round(face!.x0)}-${Math.round(face!.x1)}, y ${Math.round(face!.y0)}-${Math.round(face!.y1)})`);
  return { full, faceCover, issues };
}

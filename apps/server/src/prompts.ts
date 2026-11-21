// Prompt aksi Claude di CZ. Disusun di server supaya UI cukup mengirim jenis aksi.
// Editing hanya lewat kode: elemen digambar komposisi Remotion skill di atas mesin gerak wajib "cz-motion";
// renderer CZ sendiri (scene tanpa skill) hanya menerima data gerak scene (kamera, transisi) dan caption.
import { CURVES, TRANSITIONS, type Project } from "@cz/core";

/** Mesin gerak wajib untuk setiap komposisi (disediakan CZ sebagai modul "cz-motion", satu salinan dengan renderer CZ). */
export const MOTION_ENGINE = `Mesin gerak WAJIB: impor dari "cz-motion" (disediakan CZ; jangan menyalin atau menulis ulang kurva/easing sendiri). Build ditolak bila tidak ada impor "cz-motion".
API utama:
- Kurva EASE_PRO: move (.85,0,.15,1) kamera/perpindahan; moveSoft; enter (.5,0,0,1) elemen besar masuk; enterSnap (.16,1,.3,1) kata/chip/kartu kecil; exit (.7,0,.84,0) keluar, berakhir di kecepatan puncak; exitHard; drift (tahanan hidup); linear hanya untuk drift/opasitas. aeEase(outInfluence%, inInfluence%) = cara berpikir After Effects. SPRING_PRO {morph, pop, settle}; springEase(cfg, dur). curve(nama) menerjemahkan nama kurva (${CURVES.join(", ")}). tempo(fps, k)(frameDesain@30) = frame nyata.
- Tween: prog, tw, twc (warna), path (banyak titik), ip (interpolate ter-clamp), rand/noise1 deterministik (tanpa Math.random).
- Keyframe: K = {f, ease?, ...prop}; sample(keys, frame) (ease = kurva segmen yang TIBA di key itu); shift.
- Elemen: <Move keys anchor="center"|"flow" blurK smear float> (x, y, scale, sx, sy, rot, rx, ry, opacity, blur, w, h, radius, bg, color; blur arah gerak dari kecepatan otomatis). Resep: enter(at, {dir, dist, dur, blur, scale}) = follow-through (opasitas selesai 30%, blur hilang 65%, posisi 100%, skala menetap terakhir dengan overshoot kecil); snapIn; pop (spring); exit(at, {dir, dist, dur, hard}); holdDrift.
- Waktu: chain(beats, start, 0.25) tumpang tindih 20-40%; stagger, staggerCenter; handoff (velocity matching); onBeat; readFrames(teks) lama tampil minimum.
- Kamera: <CameraRig keys moves drift shake extra dof raster> kamera look-at (cx, cy, zoom, rot, rx, ry); moves = CamMove[] {at, dur, x, y, zoom, rot, ease} ADITIF (yang tumpang tindih dijumlahkan, kamera tidak berhenti); portalKeys, whipKeys, punch (benturan saja), DepthBlur, springFollow (follow-cam), camState/camSpeed.
- Transisi: <Stage keys> + collapseOut/emergeIn, zoomOutThrough/zoomInThrough; BlurSwap, SoftWipe, RibbonSwoosh, PixelDissolve, GlitchFlash, Flash, ImpactFrame, ShrinkToCard, LiquidRipple, Comet.
- Teks: BlurIn, RiseTilt, Converge, Emerge, WipeReveal, WordWave, DropIn, SwapLine, Smear, TrackIn, BlobToWord, SelectReplace, Decode, Scramble, Odometer, SlotRoll, WheelPicker, WordIn, StackLines, TypeLine, WordRise, HighlightWord, UnderlineDraw, TypeField; measure/caretX/layoutLine (lebar teks nyata), useFontsReady.
- Elemen pendukung: MorphBox, MacCursor + pressScale, ClickRing, RingDraw, Particles, Orbit, Glow, MeshBg, DotGrid, Phone, EndCard, InlineSlot, PixelSparkle/PixelReveal/Pixelate/PixelDust/PixelGather.
- Aset bawaan CZ (modul "cz-assets", fondasi semua aset): ChatMockup (chat: pesan diketik di kotak tulis + kursor, tombol kirim ditekan, titik-titik mengetik, balasan mengalir per kata, gulir otomatis), BRoll (video proyek penuh/kartu/ponsel/miring 3D + zoom pelan), KineticTitle (judul kinetik: blur/naik/jatuh/sapu/ketik + kata aksen), PointCard (kartu judul + poin bertahap), CountUp (angka bergulir naik + label), Notification (notifikasi pegas dari atas). Semuanya menerima { params, durationInFrames, fps, width, height, words, mediaSrc, font }; params = isi + warna (lihat nama param di katalog cz_list_assets: text/aksen/gaya/warna/aksenWarna, judul/pesan/tema/aksen/kecepatan, judul/sub/poin/ikon/tema/aksen, media/mulai/bingkai/label/aksen, nilai/awalan/akhiran/label/warna/aksen, aplikasi/judul/isi/waktu/aksen). Skillorial bersih (katalog cz.*, param lihat cz_list_assets): ProfileCard (profil IG), PriceCard (harga bergulir + tombol), BrowserCard (browser + video), DocCard (dokumen/naskah), Carousel (kartu digeser kursor), Polaroid, CommentBubble (komentar), CommentInput (kolom komentar diketik + kirim, CTA), YouTubeCard, AppIcons (ikon app/kalender), GlassCard (kaca), DiamondBadge (badge nomor), CountdownRing, ProgressRing, MindMap, FlowSteps (alur langkah), RadialDots, WordAccent (aksen kata: elips/pil/glow/garis/titik/kurung), Backdrop (latar grid putih/biru/hitam + kata besar), BottomBlur (area blur bawah). Life (bungkus elemen apa pun: masuk follow-through, melayang, keluar) dan Stagger (anak masuk bertahap).
- Motion blur: JANGAN membungkus dengan <MotionBlur>; CZ memasang motion blur shutter sungguhan di render final untuk seluruh video. Move dan CameraRig otomatis mematikan blur palsu di dalamnya.
Aturan gerak wajib (8):
1. Kurva per peran dari EASE_PRO/SPRING_PRO; tidak ada linear kecuali drift/opasitas; tidak ada easing karangan.
2. Follow-through: opasitas memimpin, blur menyusul, posisi lalu skala menetap paling akhir (pakai enter/snapIn/pop/exit atau sample dengan key per properti).
3. Gerak tidak pernah berhenti: beat dirangkai dengan chain/overlap, elemen kecil stagger 2-3 f, satu gerak besar per ketukan; elemen tiba DI onset kata pemicu.
4. Kamera lewat CameraRig dengan moves aditif + drift yang selalu jalan; punch hanya untuk benturan.
5. Keluar lebih cepat dari masuk dan berakhir di kecepatan puncak (exit/exitHard); potong atau hand-off di frame terakhirnya.
6. Pindah tata letak/scene lewat transisi mesin (Stage + resep, BlurSwap, dll.), bukan potong keras kecuali skill memintanya.
7. Caption per kata mengikuti words: tiap kata masuk di onset ucapannya (blur → tajam, follow-through), kata aksen mengendap dari warna aksen, frasa keluar dengan blur; semua teks memakai komponen teks mesin atau Move.
8. Tempo dari tempo(fps, k) (durasi ditulis @30 fps), dan setiap gerak besar/elemen/blok teks punya SFX sesuai aturan SFX skill.`;

export const ACTIONS = ["ask", "cuts", "plan", "revise", "auto-assets", "check-render", "generate-skill", "edit-skill", "auto-style", "generate-component"] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABEL: Record<Action, string> = {
  ask: "Pertanyaan", cuts: "Usulkan potongan", plan: "Buat rencana", revise: "Kerjakan catatan",
  "auto-assets": "Pasang elemen sesuai ucapan", "check-render": "Periksa hasil", "generate-skill": "Siapkan skill", "edit-skill": "Ubah skill", "auto-style": "Tata gaya otomatis",
  "generate-component": "Tulis mesin skill",
};

/** Kontrak komposisi yang ditulis Claude untuk skill tanpa kode (dipakai Player dan render CZ). */
const COMPONENT_CONTRACT = (sfxRoles: string[]) => `Kontrak komposisi CZ (wajib):
- Entry remotion/src/index.ts: registerRoot(Root); Root berisi <Composition id="Scene" component={Scene} durationInFrames={90} fps={30} width={1080} height={1920} defaultProps={...} />. Boleh lebih dari satu id (mis. Scene, Hook, BRoll) bila skill punya tata letak yang benar-benar berbeda.
- Impor HANYA dari "react", "remotion", "cz-motion" (mesin gerak wajib), "cz-assets" (aset bawaan CZ, lihat di bawah), dan file relatif sendiri. Tanpa paket npm lain, tanpa fetch/jaringan, tanpa getInputProps. Kode harus deterministik per frame (pakai useCurrentFrame, interpolate, spring, Easing; jangan Math.random tanpa seed, jangan Date).
- Satu komponen menggambar SATU scene (atau satu potongan scene) dari awal sampai akhir Sequence-nya. useVideoConfig().durationInFrames = panjang potongan itu. Rancang di acuan lebar 1080 (k = width / 1080).
- Props yang diisi CZ: src (URL footage), a dan b (detik sumber awal/akhir), words [{w, s, e}] (kata, detik relatif awal potongan), fps, width, height, voiceExternal (true: suara bicara diputar CZ, footage harus muted), seed, faces? ([[t, x, y, w, h, skor]] ternormalisasi 0..1, t relatif awal potongan), subject? dan subjectA? (video WebM ber-alpha berisi orang saja, untuk teks di belakang kepala: putar dengan OffthreadVideo transparent, startFrom = round(subjectA*fps)), adjust? (lihat Layer).
- Footage: <OffthreadVideo src={src} startFrom={Math.round(a * fps)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />. Jangan mengubah warna footage kecuali skill memintanya.
- Props milik skill (diisi Claude per scene): style { kunci: id } untuk setiap kategori gaya skill (caption, tata letak, kartu, kamera, transisi, warna, sfx, …), keyword, text, dan isi khusus lain (judul kartu, daftar, chat, dll.). Setiap kombinasi gaya harus tampil persis seperti aturan skill (warna, font, ukuran, posisi, kurva dan durasi animasi, area aman).
- Tulis remotion/cz-styles.json: [{ "label": "Caption", "key": "caption", "ids": ["…", "…"] }, …] untuk setiap kunci di style, berisi semua id yang didukung komponen. Id pertama = bawaan.
- Tulis remotion/cz-controls.json untuk menu Kustom di CZ: [{ "group": "Kamera", "controls": [{ "key": "camAmt", "label": "Kekuatan", "type": "seg" | "range" | "switch", "options": [{ "value": "push", "label": "Push", "art": "<svg…/>" }] (seg), "min", "max", "step", "unit" (range), "default": …, "when": { "key": "camera", "in" | "not": […] }, "hideReason": "…" }] }]. Nilai pilihan user datang di props.custom[key] (objek; kunci yang tidak ada = pakai default). Komponen WAJIB membaca props.custom dan memakai default yang sama dengan JSON. "art" opsional (SVG kecil 64x64 sebagai ilustrasi pilihan).
- Setiap elemen yang terlihat (caption, kartu, badge, panel, judul, ilustrasi; footage dan latar penuh boleh dilewati) dibungkus Layer supaya user bisa menggeser/mengubah ukurannya di CZ:
  const Layer: React.FC<{ id: string; adjust?: Record<string, { dx?: number; dy?: number; scale?: number; ox?: number; oy?: number; hidden?: boolean }> | null; k: number; children: React.ReactNode }> = ({ id, adjust, k, children }) => {
    const a = adjust?.[id];
    return <div data-cz-layer={id} style={!a ? { display: "contents" } : { position: "absolute", inset: 0, display: a.hidden ? "none" : undefined, transform: \`translate(\${(a.dx ?? 0) * k}px, \${(a.dy ?? 0) * k}px) scale(\${a.scale ?? 1})\`, transformOrigin: \`\${(a.ox ?? 540) * k}px \${(a.oy ?? 960) * k}px\` }}>{children}</div>;
  };
  Pakai id lapisan yang stabil dan bermakna (caption, card, badge, title, …).
- File: staticFile("x") = remotion/public/x di versi skill. File lain di folder skill: staticFile("../../<path relatif folder skill>"). SFX bawaan CZ: staticFile("../../__cz/sfx/<peran>.wav") dengan peran ${sfxRoles.join(", ")}. Font bawaan CZ: staticFile("../../__cz/fonts/Inter.ttf"), "../../__cz/fonts/Poppins-SemiBold.ttf", "../../__cz/fonts/InstrumentSerif-Regular.ttf"; muat dengan FontFace + delayRender/continueRender. Font dari folder skill juga boleh.
- SFX diputar komponen sendiri: <Sequence from={frame}><Audio src={…} volume={…} /></Sequence> pada event visual sesuai aturan SFX skill (props sfx boleh menimpa).
- Caption per kata mengikuti words (tampil saat s ≤ t), sesuai gaya caption skill.
- Tidak ada elemen statis: setiap elemen yang terlihat (teks, caption, kartu, badge, ikon, panel, ilustrasi) punya gerak masuk dan keluar dari mesin, dan elemen di dalam kartu masuk bertahap. Elemen dibuat sebagai komponen React (div/SVG/teks), bukan gambar diam.
- Aset yang bisa dipasang user di timeline: setiap elemen skill yang berdiri sendiri (kartu, mockup chat/aplikasi/browser, badge, ilustrasi, B-roll berbingkai, teks besar) juga didaftarkan sebagai komposisi ber-id "Aset…" (mis. <Composition id="AsetKartuHarga" component={AsetKartuHarga} durationInFrames={90} fps={30} width={1080} height={1920} defaultProps={{ judul: "Pro", harga: "Rp99rb" }} />). defaultProps = isi bawaan yang bisa diubah user (teks, angka, warna #hex, daftar teks; nama prop berisi "media" = id video proyek). Komponen menerima isi itu sebagai props + durationInFrames, fps, width, height (kotak 1080×1920, gambar di posisi sendiri dengan area aman), words [{w, s, e}] (kata yang diucapkan selama aset tampil) dan mediaSrc (URL video bila ada prop media). Komponen mengatur masuk, gerak isi (ketikan sungguhan, gulir, angka bergulir, garis tergambar), dan keluarnya sendiri dengan mesin.
- SISTEM ASET (wajib): setiap elemen skill dibangun dari aset bawaan "cz-assets" supaya hidup. Elemen sejenis chat/DM/prompt AI → ChatMockup; B-roll/contoh/hasil/layar → BRoll; judul/hook/kalimat kunci → KineticTitle; daftar/tips/langkah → PointCard; angka/harga/persen → CountUp; notifikasi/pesan masuk → Notification. Beri warna, font (prop font), tema, dan isi persis dari skill; bila skill meminta tampilan yang berbeda, bungkus atau tambahkan lapisan di sekitarnya (latar, bingkai, aksen) tanpa membuang geraknya. Kartu UI, badge, ring, mind-map/alur, aksen kata, kolom komentar, kartu YouTube, dan latar bergrid → komponen skillorial bersih di atas. Elemen khas skill yang tidak punya padanan (panel split, ilustrasi) digambar sendiri dari div/SVG lalu dibungkus Life + Stagger, dengan isi yang juga bergerak (garis tergambar, angka bergulir, teks dari komponen teks mesin). Build ditolak bila file yang mendaftarkan komposisi "Aset…" tidak mengimpor "cz-assets" atau "cz-motion".
${MOTION_ENGINE}`;

export const componentPrompt = (dir: string, version: number, sfxRoles: string[], text: string) => `Skill editing milik user ada di folder ${dir} (versi baru ${version}, salinan; skill asli tidak diubah). Skill ini belum membawa kode. Tugasmu: menulis komposisi Remotion (React) yang menggambar video PERSIS seperti yang dijelaskan skill, supaya CZ bisa memakainya untuk pratinjau dan render dengan hasil semaksimal menjalankan skill langsung.
Langkah:
1. Glob semua file di folder skill. Baca SKILL.md sampai baris terakhir (bertahap dengan offset/limit) dan setiap file yang dirujuknya. Catat semua tata letak, gaya caption, elemen (kartu, badge, panel, ilustrasi), kamera, transisi, warna, font, aturan animasi (kurva, durasi), area aman, dan aturan SFX, beserta nilai pastinya.
2. Ikuti "Aset skill mengikuti isi video" di bawah. Petakan setiap elemen skill ke aset bawaan "cz-assets" (lihat SISTEM ASET); yang tidak punya padanan dibuat sendiri dengan Life + Stagger. Rancang props style (kategori → id) yang mencakup SEMUA pilihan itu. Jangan menambah gaya karangan sendiri; bila skill memberi nilai pasti, pakai nilai itu. Kurva dan durasi animasi skill dipetakan ke mesin "cz-motion" (aeEase/Easing untuk bezier pasti dari skill, tempo untuk durasinya).
3. Tulis kodenya dengan cz_write_skill_file (pecah per file: tokens, Caption, elemen, Scene, index). Lalu cz_build_skill_component dan perbaiki sampai berhasil.
4. Bila proyek punya transkrip: buat rencana singkat dengan cz_set_scenes bila belum ada, pasang komposisi ke dua atau tiga scene dengan cz_set_scene_skill (gaya berbeda), pasang dua atau tiga aset termasuk satu B-roll dengan cz_add_asset, periksa dengan cz_get_frame, lalu perbaiki kode sampai tampilan dan geraknya sesuai skill.
5. Laporkan kemajuan dengan cz_set_status, dan akhiri dengan ringkasan: gaya apa saja yang didukung, dan aturan skill yang tidak bisa dibuat beserta alasannya.
${ASSETS_FROM_VIDEO}
${COMPONENT_CONTRACT(sfxRoles)}
Jangan mengubah file di luar remotion/. ${text}`;

/** Aset skill dibuat dari ISI video ini: elemen yang dibutuhkan ucapannya, termasuk semua gaya B-roll skill. */
export const ASSETS_FROM_VIDEO = `Aset skill mengikuti isi video (wajib):
- Sebelum menulis kode, baca cz_get_transcript dan cz_list_assets (media: diTimeline=false = klip calon B-roll; lihat isinya dengan cz_get_media_frames). Catat apa yang dibicarakan: alat/aplikasi yang disebut, angka, langkah, contoh, hasil, perbandingan, ajakan.
- PAKAI YANG SUDAH ADA DULU: untuk tiap kebutuhan isi, cocokkan dengan aset di cz_list_assets (komposisi "Aset…" skill yang sudah ada, lalu aset bawaan cz.*) sebelum membuat apa pun. Aset cocok bila jenis elemennya sama dengan yang dibutuhkan ucapan dan isinya bisa diganti lewat props/params (teks, angka, daftar, warna, media). Pakai aset itu dan ubah isinya, jangan menulis komposisi baru. Buat aset baru HANYA bila tidak ada aset yang cocok dengan isi video (jenis elemen atau tampilan yang dibutuhkan memang belum ada), dan sebutkan alasannya singkat di ringkasan akhir.
- Untuk setiap elemen skill yang dibutuhkan isi itu dan tidak punya aset yang cocok (kartu, mockup chat/aplikasi/browser, badge, angka, daftar, ilustrasi, teks besar, CTA), buat komposisi "Aset…" yang HIDUP dari aset bawaan "cz-assets" atau Life/Stagger, berwarna, berfont, dan bertata letak persis skill. Isi di dalamnya ikut bergerak: teks diketik/masuk per kata, angka bergulir, poin bertahap, garis dan lingkaran tergambar, kursor bergerak lalu menekan.
- B-roll WAJIB: setiap gaya B-roll skill yang belum punya aset dijadikan komposisi "Aset…" juga (mis. AsetBrollPenuh, AsetBrollKartu, AsetBrollBrowser, AsetBrollIlustrasi). B-roll footage dibangun dari BRoll dengan prop media (id video) dan mulai (detik sumber); B-roll motion graphic (layar aplikasi, browser, ilustrasi, diagram) digambar sendiri dan dihidupkan dengan Life/Stagger/komponen teks mesin.
- defaultProps diisi contoh dari video ini (kalimat, angka, nama alat yang benar-benar diucapkan) supaya pratinjau di panel Elemen langsung relevan. Isi tiap pemasangan tetap diatur lewat params saat dipasang.`;

/** Pemasangan aset dan B-roll mengikuti ucapan, dari awal sampai akhir video. */
export const ASSET_PLACEMENT = `Pemasangan aset sesuai isi video (wajib, dari awal sampai akhir):
- Aset yang sudah ada didahulukan: panggil cz_list_assets sebelum memasang, pilih aset yang paling cocok dengan isi kalimat dan atur isinya lewat params. Aset baru hanya dibuat bila tidak ada yang cocok dengan isi video.
- Baca transkrip per kalimat dan tentukan untuk tiap kalimat: wajah saja, elemen, atau B-roll. Elemen tiba DI kata pemicunya (start = frame kata itu, anchorWordId = id kata), durasinya sampai frasa selesai + 0,3-0,6 dtk (minimal 1,5 dtk). Satu elemen besar per kalimat, jeda minimal 1 dtk antar elemen.
- Isi aset diambil dari ucapan, bukan contoh karangan: judul = inti kalimat (singkat, kata aksen = kata kuncinya), angka = angka yang diucapkan, poin = hal yang disebut, chat = prompt/percakapan yang dibahas, notifikasi = kejadian yang disebut.
- B-roll WAJIB ada: kalimat yang menyebut contoh, hasil, produk, tempat, layar, proses, atau sesuatu yang bisa diperlihatkan menjadi B-roll. Urutan pilihan: (1) klip lain di proyek (media diTimeline=false), periksa isinya dengan cz_get_media_frames lalu pilih detik mulai yang paling cocok dengan ucapan; (2) B-roll gaya skill (komposisi "Aset…" B-roll, layar, ilustrasi); (3) aset cz.broll dari footage utama di detik lain yang memperlihatkan hal relevan. Bingkai berganti-ganti (penuh, kartu, ponsel, miring) sesuai aturan skill. Targetkan B-roll 20-35% durasi, maksimal 4 dtk per potongan; hook dan CTA tetap menampilkan wajah.
- Elemen bawaan hanyalah pondasi: setiap elemen DISESUAIKAN dengan video asli, bukan dipasang dengan nilai bawaan. Sebelum memasang, lihat frame footage di kata itu (cz_get_frame / cz_get_media_frames) lalu atur: warna (param aksen/warna) diambil dari palet footage atau skill, tema kartu (terang/gelap/kaca/biru) yang kontras dengan latar di belakangnya, ukuran (transform.scale) dan posisi (transform.x/y) yang tidak menutupi wajah dan muat di area aman (atas 220 px, bawah 400 px @1920), bentuk dan gaya (param gaya/bingkai/bentuk/latar) sesuai suasana kalimat, serta gerak masuk/keluar (anim) dan SFX yang sesuai energi ucapan. Variasikan antar elemen; jangan semua elemen berukuran, berwarna, dan berposisi sama. Penempatan: atas, tengah, atau bawah area aman; B-roll = cz.latar grid-putih dulu lalu elemen di tengahnya; layar penuh = cz.latar (biru/hitam/elektrik/warna dari footage) lalu elemen di tengah dengan transform.scale sampai memenuhi lebar (sisi 80 px), atau aset yang memang layar penuh (cz.videowall, cz.split, cz.latar dengan kata besar).
- Ritme: ada elemen atau B-roll setiap 3-6 detik, tidak ada dua gerak besar bersamaan, elemen tidak menutupi wajah lama-lama dan tidak masuk area caption.
- Pasang dengan cz_add_asset (cz_list_assets untuk id dan isi), atau lewat props komposisi scene bila skill menggambar elemen itu di dalam scene. Setelah selesai, periksa beberapa titik dengan cz_get_frame.`;

/** Ubah komposisi skill yang sudah ada (versi baru; versi lama tetap utuh). */
export const editComponentPrompt = (dir: string, version: number, sfxRoles: string[], text: string) => `Ubah komposisi Remotion skill di ${dir}/remotion (versi baru ${version}, salinan) sesuai permintaan user di bawah.
1. Baca kodenya dulu (Glob ${dir}/remotion/src lalu Read) dan bagian SKILL.md yang relevan.
2. Ubah seperlunya dengan cz_write_skill_file, lalu cz_build_skill_component sampai berhasil. Pertahankan id komposisi dan props yang sudah dipakai proyek. Bila permintaan butuh elemen baru, cek dulu komposisi "Aset…" yang sudah ada di remotion/src dan aset bawaan cz-assets; pakai atau ubah propsnya, dan tulis komposisi "Aset…" baru hanya bila tidak ada yang cocok.
3. Bila proyek punya scene yang digambar komposisi ini, periksa satu atau dua frame dengan cz_get_frame.
${COMPONENT_CONTRACT(sfxRoles)}
Permintaan: ${text}`;

/** Proyek tanpa komposisi skill: renderer CZ menggambar footage + caption per kata, dengan kamera dan transisi dari data scene. */
const NATIVE_STYLE = `Proyek ini tidak memakai komposisi skill, jadi tampilan digambar renderer CZ (mesin gerak "cz-motion" yang sama): footage, caption per kata (masuk di onset tiap kata, blur → tajam), kamera aditif, dan transisi scene. Elemen grafis dipasang sebagai aset bergerak (kode, bukan gambar): cz_list_assets lalu cz_add_asset di frame kata pemicunya, mis. cz.chat (mockup chat yang benar-benar diketik) saat menyebut AI/prompt/chat, cz.broll saat menyebut contoh atau hasil, cz.angka untuk angka penting, cz.kartu untuk daftar/tips, cz.teks untuk kalimat kunci, cz.notif untuk pesan/pengikut. Maksimal satu elemen besar per kalimat, jangan menutupi wajah lama-lama, dan beri jeda antar elemen.
- Kamera dan transisi diatur per scene lewat cz_set_scenes / cz_update_scene: camera {moves [{at, dur, x, y, zoom, rot, ease}], shake, drift} dan transition {kind ${TRANSITIONS.join("|")}, frames}. Kamera SELALU masuk, tahan, lalu keluar: isi hold dan out di setiap gerak (out kembali ke bingkai awal) dan akhiri scene di bingkai awal; jangan menumpuk zoom sampai scene berakhir. Sesuaikan dengan isi: gerak jatuh di kalimat atau kata yang ditekankan, condong ke wajah, dan bervariasi (dorong, geser menyisir, diam) bukan zoom terus. Mulai dari cz_auto_camera lalu rapikan bila perlu. Dorong pelan ke wajah (zoom 1.04-1.15, ease move/moveSoft, 24-60 f) di kalimat penting, punch singkat (zoom 1.15-1.22, 5-8 f, enterSnap) hanya di kata benturan dan maksimal satu per 10 detik, mulai gerak berikutnya di 55-75% gerak sebelumnya. Transisi: blur 12 f bawaan antar bagian, whip/zoom 8-10 f untuk energi tinggi (maks satu per 6 detik), flash maks satu per video, cut bila ritmenya cepat.
- Caption: cz_set_caption (generate bila belum ada, lalu update style.in = springRise (bawaan: pegas naik)|blurRise|blurFade|fade|slideUp|scaleIn|pop|wipe, style.out, style.activeEffect = pil (bawaan: pil di belakang kata yang diucapkan)|garis|glow|warna|skala|tidak, style.activeColor = warna sorotan yang cocok dengan footage dan gaya kata: tebal untuk angka/hasil, serif untuk kata rasa, aksen untuk satu kata kunci per kalimat). Pilih style.layout per blok sesuai isi: kata (bawaan), dua-tingkat (kalimat + kata kunci besar), subtitle-italic (kalimat kecil + kata rasa besar bercahaya), satu-kata (ketukan cepat/hook), poster (kata raksasa untuk payoff); dan style.keyAccent untuk kata kunci: serif|tebal|elips (negatif: never, jangan)|pil (label/sorakan)|glow (klimaks)|titik (penutup kalimat)|scramble (nama produk)|tanpa. Variasikan, jangan semua blok sama.
- Elemen bawaan lengkap (lihat cz_list_assets): kartu UI (cz.profil, cz.harga, cz.browser, cz.dokumen, cz.carousel, cz.polaroid, cz.komentar, cz.kaca), badge (cz.diamond untuk poin bernomor, cz.countdown untuk janji waktu, cz.progress untuk persen, cz.ikon untuk uang/waktu/tanggal), diagram (cz.mindmap, cz.alur, cz.radial), aksen (cz.aksen), CTA (cz.kolomkomentar, cz.youtube), latar (cz.latar grid putih/biru + kata besar, cz.blurbawah di balik caption saat elemen di bawah wajah). Isi param dengan kata-kata dari ucapan, atur anim.in/out dan sfx.in tiap elemen.
${ASSET_PLACEMENT}`;

/** Skill yang membawa komposisi Remotion sendiri: scene digambar komponen skill, skrip skill dijalankan lewat CZ. */
export const componentGuide = (dir: string) => `Skill proyek ini membawa komposisi Remotion sendiri (kode di ${dir}/remotion/src, file publik di ${dir}/remotion/public). CZ memakainya apa adanya untuk pratinjau dan render, jadi hasilnya sama dengan menjalankan skill langsung.
- Baca SKILL.md sampai habis, tipe props komponen (mis. remotion/src/clean/types.ts), Root.tsx (id komposisi), dan references/ yang dirujuk SKILL.md. Ikuti aturan SKILL.md, bukan nilai lama yang dinyatakan tidak berlaku.
- Jalankan skrip Python skill yang diwajibkan alurnya dengan cz_run_skill_script (bukan Bash), mis. analisis wajah + matte subjek per media: scripts/ce_analyze.py dengan args ["{media:ID}", "{data:ID}", "--matte", "--models", "{models}"]. Hasil di {data:ID} (faces.json, subject.webm) otomatis dipakai komponen. Skrip lain (aturan sambungan, pemilihan SFX) boleh dijalankan dengan file masukan yang kamu tulis di {work}; baca hasilnya dengan Read. Transkrip dan potong jeda sudah dikerjakan CZ.
- Gambar SETIAP scene dengan cz_set_scene_skill (component = id komposisi per scene, mis. CleanScene; props = style id dari katalog skill, keyword, text, transIn/transOut, prevLayout = tata letak scene sebelumnya, camFrom, chat, illus, sfx, dll). CZ mengisi src, a, b, words, fps, ukuran, faces, subject, dan sfxLib. Jangan memakai caption CZ untuk scene yang digambar skill (komposisi menggambar caption-nya sendiri).
- Periksa beberapa frame dengan cz_get_frame setelah scene selesai, lalu perbaiki props bila tampilannya tidak sesuai aturan skill.
${ASSET_PLACEMENT}`;

/** Sumber elemen saat Claude menata video: "ada" = hanya elemen yang sudah ada, "skill" = dibuat dari skill. */
export type Source = "ada" | "skill";
export const SOURCE_ACTIONS = ["plan", "auto-style", "auto-assets"];
export const SOURCE_RULE: Record<Source, string> = {
  ada: `MODE ELEMEN YANG SUDAH ADA (pilihan user): mulai dari cz_list_assets dan cz_get_transcript, cocokkan isi video dengan elemen yang sudah ada (komposisi "Aset…" skill, lalu aset bawaan cz.*), lalu pasang dan ubah isinya (teks, angka, daftar, media), tambah subtitle, gerak, kamera, transisi, SFX. JANGAN membaca SKILL.md panjang dan JANGAN menulis atau mengubah kode skill (cz_write_skill_file, cz_build_skill_component). Bagian yang tidak punya elemen cocok: pakai yang paling dekat atau biarkan wajah saja, lalu sebut bagian itu di ringkasan akhir supaya user bisa menjalankan mode "Dari skill".`,
  skill: `MODE DARI SKILL (pilihan user): baca skill proyek dan buat penataan sesuai aturannya. Tetap cek elemen yang sudah ada di cz_list_assets lebih dulu dan pakai bila cocok dengan isi video; elemen baru hanya dibuat berdasarkan skill bila tidak ada yang cocok.`,
};

/** Aturan wajib setiap edit Claude (tombol mana pun atau perintah chat): lihat video, periksa elemen, sesuaikan; tidak menaruh asal. */
export const LOOK_FIRST = `ATURAN WAJIB SETIAP EDIT (berlaku juga untuk perintah chat yang mengubah video):
1. Lihat dulu videonya sebelum menaruh atau mengubah elemen, subtitle, atau scene: cz_get_frame di titik yang akan diubah (dan B-roll dengan cz_get_media_frames). Catat di mana wajah, mata, dan mulut berada, apa latarnya (terang/gelap, warna dominan), dan di mana subtitle tampil. cz_add_asset dan cz_update_asset menolak elemen yang belum dilihat videonya atau yang menutupi wajah.
2. Periksa elemen yang sudah ada di rentang itu (cz_get_project / cz_get_timeline): jangan menumpuk dua elemen besar, jangan menabrak subtitle, beri jeda dari elemen sebelumnya.
3. Sesuaikan elemen dengan isi video, jangan pakai nilai bawaan begitu saja: ukuran (transform.scale) sesuai ruang kosong di sekitar wajah, posisi (transform.x/y) di area kosong dalam area aman (atas 220, bawah 400, sisi 80 px @1080×1920) dan tidak menutupi wajah kecuali layar penuh/B-roll yang disengaja, warna dan tema yang kontras dengan latar footage dan senada dengan paletnya, isi/teks dari kata yang diucapkan, gerak dan SFX sesuai energi kalimat.
4. Setelah memasang atau mengubah, lihat lagi frame-nya dengan cz_get_frame. Bila ada yang menutupi wajah, keluar area aman, bertabrakan, atau tidak terbaca, perbaiki dengan cz_update_asset sebelum lanjut. Hasil cz_add_asset/cz_update_asset memuat kotak elemen dan wajah untuk dicek.`;
const LOOK_ACTIONS: Action[] = ["ask", "plan", "revise", "auto-assets", "auto-style", "check-render"];

export function buildPrompt(action: Action, text: string, p: Project | null, skill?: { id: string; version: number; dir: string; component?: boolean }): string {
  const base = basePrompt(action, text, p, skill);
  return LOOK_ACTIONS.includes(action) ? `${base}

${LOOK_FIRST}` : base;
}

function basePrompt(action: Action, text: string, p: Project | null, skill?: { id: string; version: number; dir: string; component?: boolean }): string {
  // Jalur kode: scene digambar komposisi skill (mesin "cz-motion"). Memasang elemen = mengisi props komposisi per scene.
  if (skill?.component && (action === "auto-style" || action === "plan" || action === "auto-assets")) return `Tata video ini sesuai skill proyek. Jeda sudah dipotong dan transkrip tersedia; jangan ubah potongan.
1. Baca cz_get_project dan cz_get_transcript.
2. ${p?.scenes.length && action === "auto-assets" ? "Pakai rencana bagian yang sudah ada" : "Buat rencana per bagian dengan cz_set_scenes: dipecah per konteks isi (aturan pemecahan scene di SKILL.md), start/end di batas kata, menutup seluruh durasi tanpa celah"}.
3. ${action === "plan" ? "Isi tiap bagian" : "Kerjakan bagian demi bagian dari awal video"} dengan cz_set_scene_skill; elemen (kartu, mockup, badge, ilustrasi, teks besar) dipasang tepat di kata pemicunya menurut aturan skill, lewat props komposisi scene atau sebagai aset bergerak (cz_list_assets lalu cz_add_asset: komposisi "Aset…" skill atau aset bawaan cz.*). Laporkan tiap bagian yang selesai dengan cz_set_status (progress: bagian selesai / jumlah bagian).
${componentGuide(skill.dir)}
Akhiri dengan ringkasan satu paragraf untuk user. ${text}`;
  switch (action) {
    case "ask": return text;
    case "cuts": return `Baca transkrip dengan cz_get_transcript dan cz_get_timeline. Tandai ulangan, awal kalimat yang salah lalu diulang, dan bagian yang bertele-tele.
Usulkan lewat cz_propose_cuts (detik sumber, alasan singkat per potongan). Jangan menerapkan potongan; user yang meninjau.
Potong pada batas kata supaya tidak ada kata yang terbelah. ${text}`;
    case "plan": return `Buat scene plan untuk video ini.
1. Baca cz_get_project dan cz_get_transcript.
2. Pecah video per konteks (bukan per durasi tetap). Tiap scene: title, beat (Hook/Konteks/Isi/Bukti/CTA/…), summary, reason (alasan batas), start/end frame di batas kata, dan gerak scene (camera, transition).
3. Simpan dengan cz_set_scenes. Scene harus menutup seluruh durasi tanpa celah.
${NATIVE_STYLE}
${text}`;
    case "revise": return `Kerjakan catatan user yang masih terbuka (lihat openNotes di cz_get_project).
Untuk tiap catatan: petakan ke perubahan konkret lewat alat cz_* (props komposisi scene, kamera/transisi scene, caption), lalu tandai selesai dengan cz_set_note_status.
Bila tidak bisa dikerjakan atau bertabrakan dengan catatan lain, balas dengan cz_reply_note dan tandai konflik. ${text}`;
    case "auto-assets":
    case "auto-style": return `Tata video ini. Jeda sudah dipotong dan subtitle sudah dibuat; jangan ubah potongan.
1. Baca cz_get_project, cz_get_transcript, dan cz_get_timeline.
2. Buat rencana per bagian dengan cz_set_scenes: dipecah per konteks, start/end di batas kata, menutup seluruh durasi, masing-masing dengan camera dan transition yang mengikuti isi ucapan.
3. Kerjakan semuanya dari isi ucapan: subtitle (buat bila belum ada; gaya kata, gaya subtitle, aksen kata kunci, animasi masuk/keluar) dengan cz_set_caption; elemen dan motion graphic bergerak di kata pemicunya (cz_list_assets, cz_add_asset) lengkap dengan gerak masuk/keluar dan efek suara; kamera dan transisi tiap bagian.
4. Laporkan tiap bagian dengan cz_set_status (progress: bagian selesai / jumlah bagian), lalu akhiri dengan ringkasan satu paragraf.
${NATIVE_STYLE}
${text}`;
    case "check-render": return `Periksa hasil video: ambil frame di tengah tiap scene dan di sekitar titik sambungan (cz_get_frame, seperlunya, maksimal 12 frame).
Cek caption terbaca, elemen tidak keluar area aman atau menutupi wajah, gerak tidak berhenti mendadak, dan tidak ada frame hitam. Laporkan masalah sebagai catatan dengan cz_add_note di scene terkait. ${text}`;
    // Menyiapkan skill = menulis komposisi kode (tidak ada lagi template/aset JSON).
    case "generate-skill":
    case "generate-component": return componentPrompt(skill?.dir ?? "", skill?.version ?? 0, [], text);
    case "edit-skill": return editComponentPrompt(skill?.dir ?? "", skill?.version ?? 0, [], text);
  }
}

/** Perkiraan ukuran tugas untuk ditampilkan sebelum dijalankan (kuota Claude milik user). */
export function estimate(action: Action, p: Project | null): string {
  const words = p?.transcript.words.length ?? 0;
  if (action === "generate-skill" || action === "generate-component") return "besar (Claude membaca seluruh panduan gaya lalu menulis mesin skill dalam kode)";
  if (action === "ask") return "kecil";
  if (action === "auto-style") return words > 1500 ? "besar (videonya panjang)" : "sedang";
  if (action === "check-render") return "sedang (Claude melihat sampai 12 gambar dari videomu)";
  return words > 1500 ? "besar (videonya panjang)" : words > 400 ? "sedang" : "kecil";
}

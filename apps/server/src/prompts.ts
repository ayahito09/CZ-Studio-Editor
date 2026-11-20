// Prompt aksi Claude di CZ. Disusun di server supaya UI cukup mengirim jenis aksi.
import { ELEMENT_PROPS_HELP, type Project } from "@cz/core";

export const ACTIONS = ["ask", "cuts", "plan", "revise", "auto-assets", "check-render", "generate-skill", "edit-skill", "auto-style"] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABEL: Record<Action, string> = {
  ask: "Pertanyaan", cuts: "Usulkan potongan", plan: "Buat rencana", revise: "Kerjakan catatan",
  "auto-assets": "Pasang elemen sesuai ucapan", "check-render": "Periksa hasil", "generate-skill": "Siapkan gaya edit", "edit-skill": "Ubah gaya edit", "auto-style": "Tata gaya otomatis",
};

export function buildPrompt(action: Action, text: string, p: Project | null, skill?: { id: string; version: number; dir: string }): string {
  switch (action) {
    case "ask": return text;
    case "cuts": return `Baca transkrip dengan cz_get_transcript dan cz_get_timeline. Tandai ulangan, awal kalimat yang salah lalu diulang, dan bagian yang bertele-tele.
Usulkan lewat cz_propose_cuts (detik sumber, alasan singkat per potongan). Jangan menerapkan potongan; user yang meninjau.
Potong pada batas kata supaya tidak ada kata yang terbelah. ${text}`;
    case "plan": return `Buat scene plan untuk video ini.
1. Baca cz_get_project, cz_get_transcript, dan cz_list_assets (preset gaya + rules.scenes dari template).
2. Pecah video per konteks (bukan per durasi tetap). Tiap scene: title, beat (Hook/Konteks/Isi/Bukti/CTA/…), summary, reason (alasan batas), start/end frame di batas kata.
3. Beri tiga opsi (id A, B, C) dari preset gaya template dengan tepat satu star:true dan why singkat.
4. Simpan dengan cz_set_scenes. Scene harus menutup seluruh durasi tanpa celah.
${text}`;
    case "revise": return `Kerjakan catatan user yang masih terbuka (lihat openNotes di cz_get_project).
Untuk tiap catatan: petakan ke perubahan konkret lewat alat cz_* (scene, aset, caption), lalu tandai selesai dengan cz_set_note_status.
Bila tidak bisa dikerjakan atau bertabrakan dengan catatan lain, balas dengan cz_reply_note dan tandai konflik. ${text}`;
    case "auto-assets": return `Terapkan aset sesuai naskah: baca cz_list_assets (aturan rules.auto dan trigger tiap aset) dan cz_get_transcript.
Pasang aset dengan cz_add_asset tepat di kata pemicunya (anchorWordId = id kata, start = frame kata). Hindari menumpuk aset di waktu yang sama dan hormati rules.forbid. ${text}`;
    case "auto-style": return `Tata video ini sesuai gaya edit proyek. Jeda sudah dipotong dan subtitle sudah dibuat; jangan ubah potongan.
1. Baca cz_get_project, cz_get_transcript, dan cz_list_assets (preset gaya, rules.scenes, rules.auto, rules.forbid).
2. Buat rencana per bagian dengan cz_set_scenes: dipecah per konteks, start/end di batas kata, menutup seluruh durasi, tiga opsi (A, B, C) dari preset dengan tepat satu star:true dan why singkat.
3. Untuk setiap bagian, pasang opsi ★ dengan cz_update_scene (choose = id opsi ★).
4. Pasang elemen sesuai ucapan menurut rules.auto dan trigger tiap aset dengan cz_add_asset (anchorWordId = kata pemicu). Jangan menumpuk elemen di waktu yang sama dan hormati rules.forbid.
5. Akhiri dengan ringkasan satu paragraf untuk user. ${text}`;
    case "check-render": return `Periksa hasil video: ambil frame di tengah tiap scene dan di sekitar titik sambungan (cz_get_frame, seperlunya, maksimal 12 frame).
Cek caption terbaca, aset tidak keluar area aman atau menutupi wajah, dan tidak ada frame hitam. Laporkan masalah sebagai catatan dengan cz_add_note di scene terkait. ${text}`;
    case "generate-skill": return `Baca skill editing di folder ${skill?.dir} (SKILL.md dan referensinya). Ubah menjadi template CZ dan pustaka aset:
1. cz_save_template: token desain (warna utama/aksen, font, radius, bayangan, area aman), gaya caption, textStyles, preset gaya (kombinasi tata letak + caption + kamera + aset) yang dipakai sebagai opsi per scene, kontrol Kustom, peta SFX (peran → path file di folder skill), aturan otomatis, aturan pemecahan scene, aturan catatan, dan warnings untuk aturan yang tidak bisa dipetakan.
2. cz_save_asset_def untuk minimal 10 aset (kartu, badge, teks besar, mockup, latar, overlay, transisi, …), JSON deklaratif dari elemen dasar. Isi source/license bila diketahui.
Aset harus meniru tampilan yang dijelaskan skill, bukan kotak polos: ambil warna, font, radius, bayangan, dan tata letak dari skill lewat token template ($colors.accent, dst.), beri tiap aset ukuran (w/h), fill, radius, shadow/stroke, teks dengan size/weight/color yang nyata, dan param bawaan (default) yang terisi supaya pratinjaunya langsung terlihat. Susun beberapa elemen bertumpuk (mis. kartu + judul + ikon + garis aksen) untuk aset yang kompleks. Pakai hanya properti yang dikenal renderer. ${ELEMENT_PROPS_HELP}
Bila cz_save_asset_def menjawab "Tidak tersimpan", perbaiki definisinya sesuai pesan lalu simpan ulang; jangan lanjut sebelum semua aset tersimpan.
Jangan mengubah file skill. Jangan menjalankan skrip skill. ${text}`;
    case "edit-skill": return `Ubah template skill di ${skill?.dir} sesuai permintaan berikut, lalu simpan ulang dengan cz_save_template / cz_save_asset_def (versi baru ${skill?.version}). Baca dulu cz-template.json dan cz-assets/*.json di folder itu.
${ELEMENT_PROPS_HELP}
Permintaan: ${text}`;
  }
}

/** Perkiraan ukuran tugas untuk ditampilkan sebelum dijalankan (kuota Claude milik user). */
export function estimate(action: Action, p: Project | null): string {
  const words = p?.transcript.words.length ?? 0;
  if (action === "generate-skill") return "besar (Claude membaca seluruh panduan gaya lalu membuat elemennya)";
  if (action === "ask") return "kecil";
  if (action === "auto-style") return words > 1500 ? "besar (videonya panjang)" : "sedang";
  if (action === "check-render") return "sedang (Claude melihat sampai 12 gambar dari videomu)";
  return words > 1500 ? "besar (videonya panjang)" : words > 400 ? "sedang" : "kecil";
}

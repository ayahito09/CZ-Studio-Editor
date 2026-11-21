// Alat MCP cz_* untuk Claude. Setiap perubahan lewat Op yang sama dengan UI (validasi + riwayat sumber "claude").
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assetBox, BUILTIN_ASSETS, buildCaptions, cameraFromContent, CURVES, faceToSeq, instantiate, placementIssues, placementY, SKILL_ASSET, skillAssetDef, skillAssetId, TRANSITIONS, wordFrames,
  type AssetInstance, type Box, type Op, type Project,
} from "@cz/core";
import { derived, mediaFile, run } from "./media.ts";
import { stillFrame, renderQueue } from "./render.ts";
import type { Session } from "./session.ts";
import { buildReport, writeSkillFile } from "./skillCode.ts";
import { runSkillScript, skillCompositionIds } from "./skillScripts.ts";
import { detectFaces } from "./faces.ts";
import { skillDataDir, skillMedia, versionDir } from "./skills.ts";

/** Data gerak scene untuk renderer CZ sendiri (scene tanpa komposisi skill). */
const SCENE_MOTION = `camera = mesin kamera aditif {moves: [{at, dur (frame relatif awal scene), x, y (px), zoom (pengali, 1.15 = dorong 15%), rot, ease, hold (frame bertahan di puncak), out (frame kembali ke posisi semula; WAJIB diisi supaya zoom tidak menumpuk dan scene berakhir di bingkai awal)}], shake: [{at, dur, amp}], drift (bawaan true: napas zoom halus, kamera tidak pernah diam)}; gerak yang tumpang tindih dijumlahkan, jadi mulai gerak berikutnya di 55-75% gerak sebelumnya. transition = transisi MASUK scene ini {kind: ${TRANSITIONS.join("|")}, frames}. ease: ${CURVES.join("|")}.`;

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type Args = Record<string, unknown>;
interface Tool { name: string; description: string; inputSchema: Record<string, unknown>; run: (s: Session, a: Args) => Promise<Content[] | string> }

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const S = { type: "string" }, N = { type: "number" }, I = { type: "integer" }, O = { type: "object" }, B = { type: "boolean" };
const arr = (items: unknown) => ({ type: "array", items });
const json = (v: unknown) => JSON.stringify(v);

// ---------- Penempatan elemen: lihat video dulu, jangan menutupi wajah, tetap di area aman ----------
/** Frame sequence yang sudah dilihat Claude (cz_get_frame) per sesi, dengan waktu dilihat. */
const viewed = new WeakMap<Session, Map<number, number>>();
const LOOK_FRESH_MS = 30 * 60_000;

/** Kotak wajah di sequence pada frame f: dari faces.json hasil analisis skill (bila ada) untuk klip video yang tampil. */
async function faceAt(s: Session, f: number): Promise<Box | null> {
  const p = s.history.project;
  const clip = p.clips.find((c) => c.trackId === "V1" && f >= c.start && f < c.start + Math.round((c.srcOut - c.srcIn) * p.sequence.fps));
  const media = clip && p.media.find((m) => m.id === clip.mediaId);
  if (!clip || !media) return null;
  const faces = (await skillMedia(s.folder, [media.id]))[media.id]?.faces as number[][] | undefined;
  if (!faces?.length) return null;
  const t = clip.srcIn + (f - clip.start) / p.sequence.fps;
  const near = faces.filter((x) => Array.isArray(x) && Math.abs(x[0] - t) <= 0.6).sort((a, b) => Math.abs(a[0] - t) - Math.abs(b[0] - t))[0];
  return near ? faceToSeq({ x: near[1], y: near[2], w: near[3], h: near[4] }, media, p.sequence) : null;
}

/** Mesin kamera CZ: kamera dari isi ucapan di rentang frame sequence mana pun (scene atau bukan), `at` relatif awal rentang. */
async function cameraEngine(s: Session) {
  let p = s.history.project;
  // Mesin wajah CZ: pastikan setiap video punya hasil deteksi (dibuat sekali, lalu dipakai ulang).
  await Promise.all(p.media.filter((m) => m.width > 0).map((m) => detectFaces(s.folder, m).catch(() => false)));
  p = s.history.project;
  const fps = p.sequence.fps, wf = wordFrames(p);
  const faceData = await skillMedia(s.folder, p.media.map((m) => m.id));
  /** Pusat wajah (selisih px dari tengah sequence) pada frame sequence f; null bila tidak ada data. */
  const faceCenter = (f: number) => {
    const clip = p.clips.find((c) => c.trackId === "V1" && f >= c.start && f < c.start + Math.round((c.srcOut - c.srcIn) * fps));
    const media = clip && p.media.find((m) => m.id === clip.mediaId);
    const list = media && (faceData[media.id]?.faces as number[][] | undefined);
    if (!clip || !media || !list?.length) return null;
    const t = clip.srcIn + (f - clip.start) / fps;
    let near = list[0];
    for (const x of list) if (Array.isArray(x) && Math.abs(x[0] - t) < Math.abs(near[0] - t)) near = x;
    if (Math.abs(near[0] - t) > 0.6) return null;
    const b = faceToSeq({ x: near[1], y: near[2], w: near[3], h: near[4] }, media, p.sequence);
    return { x: (b.x0 + b.x1) / 2 - p.sequence.width / 2, y: (b.y0 + b.y1) / 2 - p.sequence.height / 2 };
  };
  const marked = new Set(p.captions.flatMap((c) => c.words.filter((w) => w.style !== "normal" && w.wordId).map((w) => w.wordId as string)));
  return (start: number, end: number) => {
    const words = p.transcript.words.flatMap((w) => { const f = wf.get(w.id); return f && f.start >= start && f.start < end ? [{ start: f.start - start, end: Math.min(f.end, end) - start, emphasis: marked.has(w.id) }] : []; });
    return cameraFromContent({ duration: end - start, fps, words, faceAt: (f) => faceCenter(start + f) });
  };
}

/** Kamera tiap scene dari isi ucapannya: dorong ke wajah di kata yang ditekankan, tahan, lalu keluar. Scene skill dilewati (kameranya milik skill). */
export async function autoCameraOp(s: Session, ids?: string[]): Promise<Op | string> {
  const cam = await cameraEngine(s);
  const ops: Op[] = s.history.project.scenes
    .filter((sc) => !sc.skill && !(ids?.length && !ids.includes(sc.id)))
    .map((sc) => ({ type: "updateScene", id: sc.id, changes: { camera: cam(sc.start, sc.end) } }));
  return ops.length ? { type: "batch", label: "Kamera sesuai isi video", ops } : "Tidak ada scene yang bisa diatur (scene skill memakai kameranya sendiri)";
}

/** Kamera dasar proyek di rentang frame yang diberi (tanpa rencana): isi rentang diganti hasil mesin, di luarnya dibiarkan. */
export async function autoBaseCameraOp(s: Session, ranges: [number, number][]): Promise<Op | string> {
  const cam = await cameraEngine(s);
  const old = s.history.project.camera;
  const inside = (f: number) => ranges.some(([a, b]) => f >= a && f < b);
  const moves = (old?.moves ?? []).filter((m) => !inside(m.at));
  const shake = (old?.shake ?? []).filter((x) => !inside(x.at));
  for (const [a, b] of ranges) if (b > a) moves.push(...(cam(a, b).moves ?? []).map((m) => ({ ...m, at: m.at + a })));
  return { type: "setCamera", camera: { ...old, moves: moves.sort((x, y) => x.at - y.at), shake, drift: old?.drift ?? true } };
}

/** Periksa penempatan aset sebelum dipasang/diubah: harus sudah melihat video di rentangnya, tidak menutupi wajah, tetap di area aman.
 *  Mengembalikan alasan penolakan, atau catatan (boleh kosong) yang ditempel ke hasil. */
async function checkPlacement(s: Session, a: Pick<AssetInstance, "defId" | "start" | "duration" | "transform">, coverFace: boolean): Promise<{ reject?: string; note: string }> {
  const p = s.history.project, fps = p.sequence.fps;
  const def = BUILTIN_ASSETS.find((d) => d.id === a.defId);
  const w = typeof def?.layout.w === "number" ? def.layout.w : p.sequence.width, h = typeof def?.layout.h === "number" ? def.layout.h : p.sequence.height;
  const seen = [...(viewed.get(s) ?? new Map()).entries()].filter(([f, at]) => Date.now() - at < LOOK_FRESH_MS && f >= a.start - fps && f <= a.start + a.duration).map(([f]) => f);
  if (!seen.length) {
    const look = Math.min(p.sequence.durationFrames - 1, a.start + Math.round(fps / 2));
    return { reject: `Ditolak: lihat dulu videonya di rentang elemen ini dengan cz_get_frame (mis. frame ${look}), lalu tentukan ukuran, posisi, warna, dan tema yang cocok: wajah tidak boleh tertutup, elemen di area aman (atas 220, bawah 400, sisi 80 px @1080×1920).`, note: "" };
  }
  const box = assetBox(a.transform, w, h);
  const face = await faceAt(s, a.start + Math.min(a.duration - 1, fps));
  const r = placementIssues(box, p.sequence, face);
  const where = `Kotak elemen: x ${Math.round(box.x0)}-${Math.round(box.x1)}, y ${Math.round(box.y0)}-${Math.round(box.y1)}.`;
  if (r.faceCover > 0.15 && !coverFace) {
    const up = placementY("atas", h, a.transform.scale, p.sequence.height), down = placementY("bawah", h, a.transform.scale, p.sequence.height);
    return { reject: `Ditolak: elemen ${r.issues.find((x) => x.includes("wajah"))}. ${where} Geser (mis. y ${up} di atas atau y ${down} di bawah), perkecil transform.scale, atau jadikan layar penuh/B-roll. Bila memang sengaja menutupi wajah, kirim tutupWajah: true.`, note: "" };
  }
  const faceNote = face ? `Wajah: x ${Math.round(face.x0)}-${Math.round(face.x1)}, y ${Math.round(face.y0)}-${Math.round(face.y1)}.` : "Data wajah belum ada: pastikan dari frame yang kamu lihat bahwa elemen tidak menutupi wajah.";
  const warn = r.issues.filter((x) => !x.includes("wajah"));
  return { note: ` ${where} ${r.full ? "Layar penuh." : faceNote}${warn.length ? ` Perhatian: ${warn.join("; ")}. Perbaiki dengan cz_update_asset.` : ""}` };
}

/** Ringkas supaya hemat token: hanya yang dibutuhkan untuk mengambil keputusan editing. */
function projectSummary(p: Project) {
  return {
    title: p.title, sequence: p.sequence, skill: p.skill,
    media: p.media.map((m) => ({ id: m.id, name: m.name, duration: m.duration, hasAudio: m.hasAudio })),
    tracks: p.tracks.map((t) => `${t.id}:${t.name}${t.locked ? " (terkunci)" : ""}`),
    counts: { clips: p.clips.length, words: p.transcript.words.length, captions: p.captions.length, assets: p.assets.length, cuts: p.cuts.length },
    scenes: p.scenes,
    openNotes: p.notes.filter((n) => n.status !== "selesai"),
    markers: p.markers,
  };
}

function transcriptText(p: Project, from = 0, to = Infinity) {
  const frames = wordFrames(p);
  const lines: string[] = [];
  for (const w of p.transcript.words) {
    const f = frames.get(w.id);
    if (f && (f.start < from || f.start > to)) continue;
    lines.push(`${w.id} ${f ? `f${f.start}-${f.end}` : "(terpotong)"} src ${w.mediaId}@${w.srcStart.toFixed(2)}-${w.srcEnd.toFixed(2)} ${w.text}`);
  }
  return lines.length ? `fps ${p.sequence.fps}. Baris: id frame-sequence sumber teks\n` + lines.join("\n") : "Transkrip kosong. Minta user menjalankan Transkrip di mode Media.";
}

export const TOOLS: Tool[] = [
  {
    name: "cz_get_project", description: "Ringkasan proyek: sequence (fps, ukuran, durasi frame), media, track, scene, catatan terbuka, penanda.",
    inputSchema: obj({}), run: async (s) => json(projectSummary(s.history.project)),
  },
  {
    name: "cz_get_timeline", description: "Klip, aset (instans lengkap), caption, dan potongan di timeline. Opsional rentang frame.",
    inputSchema: obj({ from: I, to: I }),
    run: async (s, a) => {
      const p = s.history.project;
      const from = Number(a.from ?? 0), to = Number(a.to ?? Infinity);
      const inRange = (x: number, y: number) => y > from && x < to;
      return json({
        fps: p.sequence.fps,
        clips: p.clips.filter((c) => inRange(c.start, c.start + Math.round((c.srcOut - c.srcIn) * p.sequence.fps))).map((c) => ({ id: c.id, track: c.trackId, media: c.mediaId, start: c.start, srcIn: c.srcIn, srcOut: c.srcOut, enabled: c.enabled })),
        assets: p.assets.filter((x) => inRange(x.start, x.start + x.duration)),
        captions: p.captions.filter((c) => inRange(c.start, c.end)).map((c) => ({ id: c.id, start: c.start, end: c.end, text: c.words.map((w) => w.text).join(" "), position: c.position, style: c.style })),
        cuts: p.cuts.map((c) => ({ id: c.id, kind: c.kind, state: c.state, mediaId: c.mediaId, srcStart: c.srcStart, srcEnd: c.srcEnd, reason: c.reason })),
      });
    },
  },
  {
    name: "cz_get_transcript", description: "Transkrip per kata dengan frame sequence (kata yang sudah dipotong ditandai). Opsional rentang frame.",
    inputSchema: obj({ from: I, to: I }), run: async (s, a) => transcriptText(s.history.project, Number(a.from ?? 0), Number(a.to ?? Infinity)),
  },
  {
    name: "cz_get_frame", description: "Gambar komposit (footage + caption + aset) pada frame sequence tertentu. Pakai seperlunya; setiap frame tercatat di log user.",
    inputSchema: obj({ frame: I }, ["frame"]),
    run: async (s, a) => {
      const f = Math.max(0, Math.round(Number(a.frame)));
      if (!viewed.has(s)) viewed.set(s, new Map());
      viewed.get(s)!.set(f, Date.now());
      s.claude.log("frame", `Claude melihat gambar di detik ${(f / s.history.project.sequence.fps).toFixed(1)}`);
      const out = await stillFrame(s.folder, s.history.project, await s.library(), f, join(s.folder, "cache", "claude-frame.jpg"));
      return [{ type: "image", data: (await readFile(out)).toString("base64"), mimeType: "image/jpeg" }];
    },
  },
  {
    name: "cz_get_media_frames", description: "Lihat isi video proyek mana pun (footage utama atau klip B-roll yang diimpor, termasuk yang belum ada di timeline) pada detik sumber tertentu, untuk memilih potongan B-roll yang cocok dengan ucapan. times: maksimal 6 detik sumber. Pakai seperlunya; tercatat di log user.",
    inputSchema: obj({ mediaId: S, times: arr(N) }, ["mediaId", "times"]),
    run: async (s, a) => {
      const m = s.history.project.media.find((x) => x.id === a.mediaId);
      if (!m) return `Ditolak: media ${String(a.mediaId)} tidak ada. Lihat cz_list_assets (media).`;
      const times = (Array.isArray(a.times) ? a.times.map(Number) : []).filter((t) => Number.isFinite(t) && t >= 0 && t <= m.duration).slice(0, 6);
      if (!times.length) return `Ditolak: times harus detik 0-${m.duration.toFixed(1)}`;
      s.claude.log("frame", `Claude melihat ${times.length} gambar dari ${m.name}`);
      const src = existsSync(derived(s.folder, m).proxy) ? derived(s.folder, m).proxy : mediaFile(s.folder, m);
      const out: Content[] = [];
      for (const [i, t] of times.entries()) {
        const f = join(s.folder, "cache", `claude-media-${i}.jpg`);
        await mkdir(dirname(f), { recursive: true });
        await run("ffmpeg", ["-y", "-ss", t.toFixed(2), "-i", src, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "5", f]);
        out.push({ type: "text", text: `${m.name} @ ${t.toFixed(1)} dtk` }, { type: "image", data: (await readFile(f)).toString("base64"), mimeType: "image/jpeg" });
      }
      return out;
    },
  },
  {
    name: "cz_propose_cuts", description: "Usulkan potongan (ulangan, awal kalimat salah, bagian bertele-tele) dalam detik sumber, beserta alasan. Muncul kuning di timeline; user yang menerima.",
    inputSchema: obj({ cuts: arr(obj({ mediaId: S, srcStart: N, srcEnd: N, reason: S, kind: { type: "string", enum: ["claude", "isian", "ulangan"] } }, ["mediaId", "srcStart", "srcEnd", "reason"])) }, ["cuts"]),
    run: async (s, a) => {
      const cuts = (a.cuts as Args[]).map((c) => ({ ...c, kind: c.kind ?? "claude", by: "claude" }));
      const err = s.apply({ type: "addCuts", cuts } as Op, "claude");
      return err ? `Ditolak: ${err}` : `${cuts.length} potongan diusulkan. User meninjaunya di panel Potong jeda.`;
    },
  },
  {
    name: "cz_apply_cuts", description: "Terapkan potongan (id dari cz_get_timeline). Ripple: celah ditutup; caption dan aset terikat kata ikut bergeser.",
    inputSchema: obj({ cutIds: arr(S) }, ["cutIds"]),
    run: async (s, a) => {
      if (s.review()) return s.propose({ type: "applyCuts", cutIds: a.cutIds as string[] });
      const problems = await s.applyCuts(a.cutIds as string[], "claude");
      return problems.length ? `Diterapkan. Periksa: ${problems.map((x) => x.detail).join("; ")}` : "Diterapkan tanpa masalah.";
    },
  },
  {
    name: "cz_set_scenes", description: `Ganti seluruh scene plan. Tiap scene: title, beat, summary, reason (alasan batas), start/end (frame di batas kata), dan opsional ${SCENE_MOTION}`,
    inputSchema: obj({ scenes: arr(obj({ title: S, beat: S, summary: S, reason: S, start: I, end: I, camera: O, transition: O }, ["title", "start", "end"])) }, ["scenes"]),
    run: async (s, a) => s.claudeOp({ type: "setScenes", scenes: a.scenes as never }),
  },
  {
    name: "cz_update_scene", description: `Ubah satu scene: changes = {title, beat, summary, reason, start, end, status, camera, transition}. ${SCENE_MOTION}`,
    inputSchema: obj({ id: S, changes: O }, ["id", "changes"]),
    run: async (s, a) => {
      if (!a.changes || !Object.keys(a.changes as object).length) return "Tidak ada perubahan";
      return s.claudeOp({ type: "updateScene", id: String(a.id), changes: a.changes as never });
    },
  },
  {
    name: "cz_auto_camera", description: "Atur kamera scene (tanpa skill) mengikuti isi ucapan: tiap gerak masuk, tahan, lalu keluar ke bingkai awal, condong ke posisi wajah saat itu (mesin wajah CZ mendeteksinya otomatis), dan jatuh di kata yang ditekankan. ids kosong = semua scene. Boleh dipanggil sebelum menyetel kamera sendiri.",
    inputSchema: obj({ ids: arr(S) }),
    run: async (s, a) => {
      const r = await autoCameraOp(s, Array.isArray(a.ids) ? a.ids.map(String) : undefined);
      return typeof r === "string" ? r : s.claudeOp(r);
    },
  },
  {
    name: "cz_list_assets", description: "Aset bergerak yang bisa dipasang (semuanya kode, digerakkan mesin cz-motion): bawaan CZ (judul kinetik, mockup chat yang diketik, kartu poin, B-roll, angka naik, notifikasi) beserta isi yang bisa diubah, dan komposisi \"Aset…\" milik skill proyek.",
    inputSchema: obj({}),
    run: async (s) => {
      const lib = await s.library();
      const skillIds = lib?.component ? (await skillCompositionIds(versionDir(lib.id, lib.version))).filter((id) => SKILL_ASSET.test(id)) : [];
      return json({
        bawaan: BUILTIN_ASSETS.map((d) => ({ id: d.id, name: d.name, description: d.description, trigger: d.trigger, durationSec: d.duration, params: d.params })),
        skill: skillIds.map((id) => ({ id: skillAssetId(id), komposisi: id, params: "props komposisi ini (lihat defaultProps-nya di kode skill)" })),
        // diTimeline=false: klip yang diimpor tapi belum dipakai = calon B-roll (lihat isinya dengan cz_get_media_frames).
        media: s.history.project.media.map((m) => ({ id: m.id, name: m.name, duration: m.duration, diTimeline: s.history.project.clips.some((c) => c.mediaId === m.id) })),
      });
    },
  },
  {
    name: "cz_add_asset", description: "Pasang aset bergerak di timeline: defId dari cz_list_assets (cz.* atau skill:Aset…), start (frame, di kata pemicu), duration (frame), params (isi), transform {x, y, scale, rotation, opacity} opsional (koordinat sequence, titik tengah kotak aset), anchorWordId (aset ikut bergeser bila dipotong), sceneId, anim {in, out} (fade|blurRise|blurFade|pop|slideUp|slideDown|slideLeft|slideRight|scaleIn|wipe|null), sfx {in, out} (peran efek suara). B-roll: params.media = id video proyek, params.mulai = detik sumber. Wajib melihat video dulu dengan cz_get_frame di rentang elemen; pemasangan ditolak bila belum, atau bila elemen menutupi wajah (kecuali layar penuh/B-roll atau tutupWajah: true). Hasil memuat kotak elemen dan wajah untuk dicek ulang.",
    inputSchema: obj({ defId: S, start: I, duration: I, params: O, transform: O, sceneId: S, anchorWordId: S, anim: O, sfx: O, tutupWajah: B }, ["defId", "start"]),
    run: async (s, a) => {
      const p = s.history.project;
      const id = String(a.defId);
      let def = BUILTIN_ASSETS.find((d) => d.id === id);
      if (!def && id.startsWith("skill:")) {
        const lib = await s.library();
        const ids = lib?.component ? await skillCompositionIds(versionDir(lib.id, lib.version)) : [];
        if (!ids.includes(id.slice(6))) return `Ditolak: komposisi ${id.slice(6)} tidak ada di skill. Lihat cz_list_assets.`;
        def = skillAssetDef(id.slice(6), {}, 3 * p.sequence.fps, p.sequence.fps, p.sequence);
      }
      if (!def) return `Ditolak: aset ${id} tidak ada. Lihat cz_list_assets.`;
      const base = instantiate(def, {}, { start: Number(a.start), fps: p.sequence.fps, seq: p.sequence });
      const placed = { defId: base.defId ?? null, start: base.start, duration: a.duration ? Number(a.duration) : base.duration!, transform: { ...base.transform!, ...(a.transform as object ?? {}) } };
      const chk = await checkPlacement(s, placed, a.tutupWajah === true);
      if (chk.reject) return chk.reject;
      const res = s.claudeOp({ type: "addAssets", assets: [{
        ...base, ...(a.duration ? { duration: Number(a.duration) } : {}), params: (a.params as Args) ?? {},
        ...(a.transform ? { transform: { ...base.transform!, ...(a.transform as object) } } : {}),
        ...(a.sceneId ? { sceneId: String(a.sceneId) } : {}), ...(a.anchorWordId ? { anchorWordId: String(a.anchorWordId) } : {}),
        ...(a.anim ? { anim: { ...base.anim!, ...(a.anim as object) } } : {}), ...(a.sfx ? { sfx: { ...base.sfx!, ...(a.sfx as object) } } : {}),
      }] });
      return res.startsWith("Ditolak") ? res : res + chk.note;
    },
  },
  {
    name: "cz_update_asset", description: "Ubah instans aset: params (isi), transform, start, duration, anim {in, out}, keyframes [{frame, x,y,scale,rotation,opacity, ease}], sfx, hidden. Aset terkunci user ditolak.",
    inputSchema: obj({ id: S, changes: O, tutupWajah: B }, ["id", "changes"]),
    run: async (s, a) => {
      const cur = s.history.project.assets.find((x) => x.id === a.id);
      const ch = (a.changes ?? {}) as Partial<AssetInstance>;
      // perubahan letak/ukuran/waktu diperiksa ulang seperti saat memasang
      if (cur && (ch.transform || ch.start !== undefined || ch.duration !== undefined)) {
        const chk = await checkPlacement(s, { defId: cur.defId, start: ch.start ?? cur.start, duration: ch.duration ?? cur.duration, transform: { ...cur.transform, ...ch.transform } }, a.tutupWajah === true);
        if (chk.reject) return chk.reject;
        const res = s.claudeOp({ type: "updateAsset", id: String(a.id), changes: a.changes as never });
        return res.startsWith("Ditolak") ? res : res + chk.note;
      }
      return s.claudeOp({ type: "updateAsset", id: String(a.id), changes: a.changes as never });
    },
  },
  {
    name: "cz_remove_asset", description: "Hapus instans aset.", inputSchema: obj({ ids: arr(S) }, ["ids"]),
    run: async (s, a) => s.claudeOp({ type: "removeAssets", ids: a.ids as string[] }),
  },
  {
    name: "cz_set_caption", description: "Caption. action=generate (dari transkrip, maxWords per blok), update (id, changes: style/position/words/start/end; style.layout = kata|dua-tingkat|subtitle-italic|satu-kata|poster, style.keyAccent = serif|tebal|elips|pil|glow|titik|scramble|tanpa untuk kata kunci blok = kata pertama bergaya, selain itu kata terpanjang), split (id, index kata), merge (id dengan blok berikutnya).",
    inputSchema: obj({ action: { type: "string", enum: ["generate", "update", "split", "merge"] }, id: S, changes: O, index: I, maxWords: I }, ["action"]),
    run: async (s, a) => {
      const p = s.history.project;
      if (a.action === "generate") return s.claudeOp({ type: "setCaptions", captions: buildCaptions(p, Number(a.maxWords ?? 4)) });
      if (a.action === "update") return s.claudeOp({ type: "updateCaption", id: String(a.id), changes: a.changes as never });
      if (a.action === "split") return s.claudeOp({ type: "splitCaption", id: String(a.id), index: Number(a.index) });
      return s.claudeOp({ type: "mergeCaption", id: String(a.id) });
    },
  },
  {
    name: "cz_reply_note", description: "Balas catatan user (mis. menjelaskan apa yang diubah atau kenapa tidak bisa).",
    inputSchema: obj({ id: S, text: S }, ["id", "text"]),
    run: async (s, a) => { const e = s.apply({ type: "replyNote", id: String(a.id), by: "claude", text: String(a.text) }, "claude"); return e ? `Ditolak: ${e}` : "Terkirim."; },
  },
  {
    name: "cz_add_note", description: "Tambah catatan di scene/frame (mis. masalah yang ditemukan saat memeriksa hasil).",
    inputSchema: obj({ sceneId: S, frame: I, text: S }, ["frame", "text"]),
    run: async (s, a) => { const e = s.apply({ type: "addNote", note: { sceneId: (a.sceneId as string) ?? null, frame: Number(a.frame), text: `[Claude] ${String(a.text)}` } }, "claude"); return e ? `Ditolak: ${e}` : "Catatan ditambahkan."; },
  },
  {
    name: "cz_set_note_status", description: "Tandai catatan: terbuka, selesai, konflik.",
    inputSchema: obj({ id: S, status: { type: "string", enum: ["terbuka", "selesai", "konflik"] } }, ["id", "status"]),
    run: async (s, a) => s.claudeOp({ type: "updateNote", id: String(a.id), changes: { status: a.status as never } }),
  },
  {
    name: "cz_render", description: "Mulai render (default seluruh sequence, H.264). range: all | scene (sceneId).",
    inputSchema: obj({ range: { type: "string", enum: ["all", "scene"] }, sceneId: S }),
    run: async (s, a) => {
      const p = s.history.project;
      const job = renderQueue.enqueue(s.folder, p, await s.library(), {
        width: p.sequence.width, height: p.sequence.height, fps: p.sequence.fps, codec: "h264", crf: 18, normalize: true,
        range: a.range === "scene" ? "scene" : "all", sceneId: a.sceneId as string | undefined,
      });
      return `Render ${job.id} masuk antrean. Kemajuan tampil di mode Render.`;
    },
  },
  {
    name: "cz_set_scene_skill",
    description: "Gambar satu scene dengan komposisi Remotion milik skill (mis. CleanScene). component = id <Composition> skill; props = props komponen itu persis seperti tipe di kode skill (style, keyword, text, transIn, transOut, prevLayout, camFrom, chat, illus, sfx, dll). CZ mengisi sendiri: src, a, b, words (dari transkrip), fps, width, height, voiceExternal, seed, sfxLib, faces dan subject (bila skrip analisis sudah dijalankan). Scene yang melewati potongan dirender per potongan. Bila komponen skill mendukung props adjust (lihat tipenya), props.adjust {lapisan: {dx, dy, scale, ox, oy, hidden}} berisi geseran elemen dari user: pertahankan saat mengubah props lain. component null = kembali ke tampilan CZ biasa.",
    inputSchema: obj({ id: S, component: { type: ["string", "null"] }, props: O }, ["id", "component"]),
    run: async (s, a) => {
      const lib = await s.library();
      if (a.component === null) return s.claudeOp({ type: "updateScene", id: String(a.id), changes: { skill: null } });
      if (!lib?.component) return `Ditolak: skill proyek ini belum punya komposisi Remotion yang terkompilasi.${lib?.warnings.length ? ` Peringatan: ${lib.warnings.join("; ")}` : ""}`;
      const ids = await skillCompositionIds(versionDir(lib.id, lib.version));
      if (ids.length && !ids.includes(String(a.component))) return `Ditolak: komposisi ${String(a.component)} tidak ada. Pilihan: ${ids.join(", ")}`;
      return s.claudeOp({ type: "updateScene", id: String(a.id), changes: { skill: { component: String(a.component), props: (a.props ?? {}) as Record<string, unknown> } } });
    },
  },
  {
    name: "cz_run_skill_script",
    description: "Jalankan skrip Python milik skill (path relatif folder skill, mis. scripts/ce_analyze.py) dengan Python user. Argumen boleh memakai {media:ID} (file video asli), {proxy:ID}, {data:ID} (folder hasil analisis media itu; faces.json dan subject.webm di sini otomatis dipakai komposisi skill), {work} (folder kerja proyek, juga cwd), {skill} (folder skill), {models} (model yunet.onnx dan u2net_human_seg.onnx dari cz install). Contoh analisis wajah + matte: script scripts/ce_analyze.py, args [\"{media:m1}\", \"{data:m1}\", \"--matte\", \"--models\", \"{models}\"]. Bisa lama (menit); keluaran 8000 karakter terakhir dikembalikan. Hasil berkas dibaca dengan Read.",
    inputSchema: obj({ script: S, args: arr(S) }, ["script"]),
    run: async (s, a) => {
      const lib = await s.library();
      if (!lib) return "Ditolak: proyek belum memakai skill";
      const args = Array.isArray(a.args) ? a.args.map(String).slice(0, 60) : [];
      s.claude.log("info", `Menjalankan skrip skill ${String(a.script)}`);
      const r = await runSkillScript({ folder: s.folder, project: s.history.project, skill: lib, script: String(a.script), args,
        onLine: (l) => { s.claudeNote = { text: l, at: Date.now() }; } });
      s.reloadLibrary();
      const data = s.history.project.media.map((m) => `${m.id}: ${skillDataDir(s.folder, m.id)}`).join("\n");
      return `${r.code === 0 ? "Selesai" : `Gagal (kode ${r.code})`}. Folder kerja: ${r.work}\nFolder data media:\n${data}\n--- keluaran ---\n${r.output}`;
    },
  },
  {
    name: "cz_write_skill_file",
    description: "Hanya saat tugas menulis komposisi skill: tulis satu file kode di versi skill baru (path relatif folder skill, harus di remotion/, mis. remotion/src/index.ts, remotion/src/Scene.tsx, remotion/cz-styles.json). Menimpa file yang ada. Setelah selesai menulis, panggil cz_build_skill_component.",
    inputSchema: obj({ path: S, content: S }, ["path", "content"]),
    run: async (s, a) => {
      if (!s.codeTarget) return "Ditolak: tidak ada tugas penulisan komposisi skill yang berjalan";
      const rel = await writeSkillFile(s.codeTarget, String(a.path), String(a.content));
      return `Tersimpan: ${rel}`;
    },
  },
  {
    name: "cz_build_skill_component",
    description: "Kompilasi komposisi skill yang sedang ditulis (esbuild). Mengembalikan galat dengan file:baris bila gagal; perbaiki lalu panggil lagi sampai berhasil.",
    inputSchema: obj({}),
    run: async (s) => {
      if (!s.codeTarget) return "Ditolak: tidak ada tugas penulisan komposisi skill yang berjalan";
      const r = await buildReport(s.codeTarget);
      s.reloadLibrary();
      return r.text;
    },
  },
  {
    name: "cz_set_status", description: "Laporkan kemajuan tugas panjang ke user (tampil di panel Claude dan bilah kemajuan). progress: 0..1 dari seluruh tugas.",
    inputSchema: obj({ text: S, progress: N }, ["text"]),
    run: async (s, a) => {
      const pr = Number(a.progress);
      s.claudeNote = { text: String(a.text), progress: a.progress === undefined || !Number.isFinite(pr) ? undefined : Math.max(0, Math.min(1, pr)), at: Date.now() };
      s.claude.log("info", `${String(a.text)}${a.progress !== undefined ? ` (${Math.round(Number(a.progress) * 100)}%)` : ""}`); return "ok"; },
  },
];

export const toolList = () => TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

export async function callTool(s: Session, name: string, args: Args) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { content: [{ type: "text", text: `Alat tidak dikenal: ${name}` }], isError: true };
  try {
    const r = await t.run(s, args);
    const content = typeof r === "string" ? [{ type: "text", text: r }] : r;
    return { content, isError: typeof r === "string" && r.startsWith("Ditolak") };
  } catch (e) {
    return { content: [{ type: "text", text: (e as Error).message }], isError: true };
  }
}


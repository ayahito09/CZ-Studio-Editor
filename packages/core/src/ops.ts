import { enablePatches, produceWithPatches, type Patch } from "immer";
import { FPS_CHOICES, type Clip, type Media, type Project, type Track } from "./project.ts";
import { syncAutoFx } from "./transitions.ts";
import {
  anchorSnapshot, claudeBlocked, CONTENT_SERVER_ONLY, contentEnd, reanchor, rescaleContent, runContent, validateContentOp, type ContentOp,
} from "./content.ts";
import {
  addClips, clipEnd, deleteClips, deleteRange, getClip, moveClips, newId, OpError, recomputeDuration, rescaleFps,
  rollEdit, slideClip, slipClip, splitAt, trimClip, withLinked, type NewClip,
} from "./timeline.ts";

enablePatches();

// Satu-satunya jalan untuk mengubah proyek. UI, Claude (F4) dan catatan memakai Op yang sama.
type ClipChanges = Partial<Pick<Clip, "enabled" | "gainDb" | "fadeIn" | "fadeOut">>;
export type Op =
  | { type: "setTitle"; title: string }
  | { type: "setSequence"; width: number; height: number; fps: number }
  | { type: "updateTrack"; trackId: string; changes: Partial<Pick<Track, "name" | "locked" | "hidden" | "muted" | "solo">> }
  | { type: "addMedia"; media: Media; place: boolean }
  | { type: "removeMedia"; mediaId: string }
  | { type: "addClips"; clips: NewClip[] }
  | { type: "moveClips"; clipIds: string[]; delta: number; trackShift?: number }
  | { type: "trimClip"; clipId: string; edge: "in" | "out"; delta: number; ripple: boolean }
  | { type: "rollEdit"; clipId: string; delta: number }
  | { type: "slipClip"; clipId: string; delta: number }
  | { type: "slideClip"; clipId: string; delta: number }
  | { type: "split"; frame: number; clipIds?: string[] }
  | { type: "deleteClips"; clipIds: string[]; ripple: boolean }
  | { type: "deleteRange"; start: number; end: number; ripple: boolean }
  | { type: "setClips"; clipIds: string[]; changes: ClipChanges }
  | { type: "link"; clipIds: string[] }
  | { type: "unlink"; clipIds: string[] }
  | { type: "addMarker"; frame: number; label?: string }
  | { type: "updateMarker"; id: string; frame?: number; label?: string }
  | { type: "removeMarker"; id: string }
  | ContentOp
  | { type: "batch"; label: string; ops: Op[] };

/** Op yang hanya boleh dibuat server (mis. addMedia menunjuk file di disk). */
export const SERVER_ONLY_OPS = new Set(["addMedia", ...CONTENT_SERVER_ONLY]);
const hasServerOnly = (op: unknown): boolean =>
  isObj(op) && (SERVER_ONLY_OPS.has(String(op.type)) || (op.type === "batch" && Array.isArray(op.ops) && op.ops.some(hasServerOnly)));
export const isServerOnly = hasServerOnly;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min = -1e9, max = 1e9) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const isIds = (v: unknown) => Array.isArray(v) && v.length > 0 && v.length <= 10000 && v.every((x) => typeof x === "string");
const isStr = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** Memeriksa bentuk Op dari luar (HTTP, MCP). null berarti sah. Masalah isi (klip terkunci, dll.) dilaporkan saat diterapkan. */
export function validateOp(op: unknown, project: Project): string | null {
  if (!isObj(op)) return "op bukan objek";
  switch (op.type) {
    case "setTitle":
      return isStr(op.title, 200) ? null : "judul harus 1-200 karakter";
    case "setSequence":
      if (!isInt(op.width, 16, 8192) || !isInt(op.height, 16, 8192)) return "ukuran sequence harus 16-8192 px";
      return isInt(op.fps, 1, 240) ? null : "fps harus 1-240";
    case "updateTrack": {
      if (!project.tracks.some((x) => x.id === op.trackId)) return `track ${String(op.trackId)} tidak ada`;
      if (!isObj(op.changes) || Object.keys(op.changes).length === 0) return "changes kosong";
      for (const [k, v] of Object.entries(op.changes)) {
        if (k === "name") { if (!isStr(v, 60)) return "nama track harus 1-60 karakter"; }
        else if (k === "locked" || k === "hidden" || k === "muted" || k === "solo") { if (typeof v !== "boolean") return `${k} harus true/false`; }
        else return `field track tidak dikenal: ${k}`;
      }
      return null;
    }
    case "addMedia": {
      const m = op.media;
      if (!isObj(m) || !isStr(m.id, 40) || !isStr(m.name, 300) || !isStr(m.path, 2000) || !isStr(m.proxy, 2000)) return "media tidak sah";
      if (!(isNum(m.duration) && (m.duration as number) > 0) || !isInt(m.width, 1, 16384) || !isInt(m.height, 1, 16384) || !(isNum(m.fps) && (m.fps as number) > 0)) return "metadata media tidak sah";
      if (typeof m.linked !== "boolean" || typeof m.hasAudio !== "boolean") return "media tidak sah";
      if (project.media.some((x) => x.id === m.id)) return `media ${String(m.id)} sudah ada`;
      return typeof op.place === "boolean" ? null : "place harus true/false";
    }
    case "removeMedia":
      return project.media.some((m) => m.id === op.mediaId) ? null : "media tidak ada";
    case "addClips":
      if (!Array.isArray(op.clips) || op.clips.length === 0 || op.clips.length > 2000) return "clips kosong";
      for (const c of op.clips) {
        if (!isObj(c) || typeof c.trackId !== "string" || typeof c.mediaId !== "string" || !isNum(c.srcIn) || !isNum(c.srcOut) || !isInt(c.start, 0)) return "klip baru tidak sah";
        if (c.link !== undefined && typeof c.link !== "string") return "link harus teks";
      }
      return null;
    case "moveClips":
      if (!isIds(op.clipIds) || !isInt(op.delta)) return "moveClips butuh clipIds dan delta (frame)";
      return op.trackShift === undefined || isInt(op.trackShift, -10, 10) ? null : "trackShift tidak sah";
    case "trimClip":
      if (typeof op.clipId !== "string" || (op.edge !== "in" && op.edge !== "out") || !isInt(op.delta) || typeof op.ripple !== "boolean") return "trimClip tidak sah";
      return null;
    case "rollEdit": case "slipClip": case "slideClip":
      return typeof op.clipId === "string" && isInt(op.delta) ? null : `${op.type} butuh clipId dan delta`;
    case "split":
      if (!isInt(op.frame, 1)) return "frame potong tidak sah";
      return op.clipIds === undefined || isIds(op.clipIds) ? null : "clipIds tidak sah";
    case "deleteClips":
      return isIds(op.clipIds) && typeof op.ripple === "boolean" ? null : "deleteClips tidak sah";
    case "deleteRange":
      return isInt(op.start, 0) && isInt(op.end, 0) && typeof op.ripple === "boolean" ? null : "deleteRange tidak sah";
    case "setClips": {
      if (!isIds(op.clipIds) || !isObj(op.changes) || !Object.keys(op.changes).length) return "setClips tidak sah";
      for (const [k, v] of Object.entries(op.changes)) {
        if (k === "enabled") { if (typeof v !== "boolean") return "enabled harus true/false"; }
        else if (k === "gainDb") { if (!isNum(v) || (v as number) < -60 || (v as number) > 24) return "gain harus -60 sampai 24 dB"; }
        else if (k === "fadeIn" || k === "fadeOut") { if (!isInt(v, 0, 100000)) return `${k} harus frame >= 0`; }
        else return `field klip tidak dikenal: ${k}`;
      }
      return null;
    }
    case "link": case "unlink":
      return isIds(op.clipIds) ? null : `${op.type} butuh clipIds`;
    case "addMarker":
      if (!isInt(op.frame, 0)) return "frame penanda tidak sah";
      return op.label === undefined || (typeof op.label === "string" && op.label.length <= 200) ? null : "label terlalu panjang";
    case "updateMarker":
      if (!project.markers.some((m) => m.id === op.id)) return "penanda tidak ada";
      if (op.frame !== undefined && !isInt(op.frame, 0)) return "frame penanda tidak sah";
      return op.label === undefined || (typeof op.label === "string" && op.label.length <= 200) ? null : "label terlalu panjang";
    case "removeMarker":
      return project.markers.some((m) => m.id === op.id) ? null : "penanda tidak ada";
    case "batch": {
      if (!isStr(op.label, 80) || !Array.isArray(op.ops) || op.ops.length === 0 || op.ops.length > 500) return "batch butuh label dan 1-500 op";
      for (const inner of op.ops) {
        if (isObj(inner) && inner.type === "batch") return "batch tidak boleh bersarang";
        const err = validateOp(inner, project);
        if (err) return err;
      }
      return null;
    }
    default: {
      const r = validateContentOp(op, project);
      return r === undefined ? `op tidak dikenal: ${String(op.type)}` : r;
    }
  }
}

export { claudeBlocked };

const n = (ids: string[]) => (ids.length === 1 ? "klip" : `${ids.length} klip`);

export function describeOp(op: Op): string {
  switch (op.type) {
    case "setTitle": return "Ubah judul";
    case "setSequence": return "Ubah ukuran video";
    case "updateTrack": {
      const [k, v] = Object.entries(op.changes)[0] ?? [];
      if (k === "locked") return v ? "Kunci jalur" : "Buka kunci jalur";
      if (k === "hidden") return v ? "Sembunyikan jalur" : "Tampilkan jalur";
      if (k === "muted") return v ? "Bisukan jalur" : "Bunyikan jalur";
      if (k === "solo") return v ? "Dengar jalur ini saja" : "Dengar semua jalur";
      return "Ganti nama jalur";
    }
    case "addMedia": return `Impor ${op.media.name}`;
    case "removeMedia": return "Hapus media";
    case "addClips": return `Tempel ${n(op.clips.map(() => ""))}`;
    case "moveClips": return `Pindah ${n(op.clipIds)}`;
    case "trimClip": return op.ripple ? "Pangkas dan rapatkan" : "Pangkas klip";
    case "rollEdit": return "Geser sambungan";
    case "slipClip": return "Geser isi klip";
    case "slideClip": return "Geser klip";
    case "split": return "Potong klip";
    case "deleteClips": return op.ripple ? `Hapus dan rapatkan ${n(op.clipIds)}` : `Hapus ${n(op.clipIds)}`;
    case "deleteRange": return op.ripple ? "Hapus bagian bertanda" : "Kosongkan bagian bertanda";
    case "setClips": {
      const k = Object.keys(op.changes)[0];
      if (k === "enabled") return op.changes.enabled ? "Aktifkan klip" : "Nonaktifkan klip";
      if (k === "gainDb") return "Ubah volume";
      return "Ubah suara muncul/hilang perlahan";
    }
    case "link": return "Gabungkan gambar dan suara";
    case "unlink": return "Pisahkan gambar dan suara";
    case "addMarker": return "Tambah penanda";
    case "updateMarker": return "Ubah penanda";
    case "removeMarker": return "Hapus penanda";
    case "batch": return op.label;
    case "setTranscript": return `Transkrip ${op.words.length} kata`;
    case "updateWord": return "Ubah kata transkrip";
    case "addCuts": return op.apply ? "Potong lewat teks" : `Usulan ${op.cuts.length} potongan`;
    case "setCutState": return op.state === "rejected" ? "Tolak potongan" : "Aktifkan potongan";
    case "applyCuts": return `Terapkan ${op.cutIds.length} potongan`;
    case "addAssets": return op.assets.length === 1 ? "Tambah elemen" : `Tambah ${op.assets.length} elemen`;
    case "updateAsset": return "Ubah elemen";
    case "removeAssets": return op.ids.length === 1 ? "Hapus elemen" : `Hapus ${op.ids.length} elemen`;
    case "reorderAsset": return "Ubah urutan tumpukan";
    case "setCaptions": return "Buat subtitle";
    case "updateCaption": return "Ubah subtitle";
    case "splitCaption": return "Pecah subtitle";
    case "mergeCaption": return "Gabung subtitle";
    case "removeCaptions": return "Hapus subtitle";
    case "setScenes": return `Rencana ${op.scenes.length} bagian`;
    case "updateScene": return op.changes.choice !== undefined ? "Pilih gaya bagian" : op.changes.status ? `Bagian ${op.changes.status}` : "Ubah bagian";
    case "addNote": return "Tambah catatan";
    case "updateNote": return op.changes.status ? `Catatan ${op.changes.status}` : "Ubah catatan";
    case "replyNote": return "Balas catatan";
    case "removeNote": return "Hapus catatan";
    case "setSkill": return op.skill ? "Ganti skill" : "Lepas skill";
    case "setCamera": return "Atur kamera";
    case "setSafe": return "Atur area aman";
    case "setTransitions": return "Atur transisi";
  }
}

function rescale(d: Project, fps: number) {
  const k = fps / d.sequence.fps;
  rescaleFps(d, fps);
  if (k !== 1) rescaleContent(d, k);
}

const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);
const nearestFps = (f: number) => FPS_CHOICES.reduce((a, b) => (Math.abs(b - f) < Math.abs(a - f) ? b : a));

function run(d: Project, op: Op) {
  switch (op.type) {
    case "setTitle": d.title = op.title.trim(); break;
    case "setSequence":
      rescale(d, op.fps);
      d.sequence.width = op.width; d.sequence.height = op.height;
      break;
    case "updateTrack": Object.assign(d.tracks.find((t) => t.id === op.trackId)!, op.changes); break;
    case "addMedia": {
      const m = op.media;
      if (d.clips.length === 0 && d.media.length === 0) {
        // Sequence mengikuti klip pertama (SPEC: Impor).
        d.sequence.width = even(m.width); d.sequence.height = even(m.height);
        rescale(d, nearestFps(m.fps));
      }
      d.media.push(m);
      if (op.place) {
        const fps = d.sequence.fps;
        const at = Math.max(0, ...d.clips.filter((c) => c.trackId === "V1" || c.trackId === "A1").map((c) => clipEnd(c, fps)));
        addClips(d, [
          { trackId: "V1", mediaId: m.id, srcIn: 0, srcOut: m.duration, start: at, link: "x" },
          { trackId: "A1", mediaId: m.id, srcIn: 0, srcOut: m.duration, start: at, link: "x" },
        ]);
      }
      break;
    }
    case "removeMedia":
      d.clips = d.clips.filter((c) => c.mediaId !== op.mediaId);
      d.media = d.media.filter((m) => m.id !== op.mediaId);
      break;
    case "addClips": addClips(d, op.clips); break;
    case "moveClips": moveClips(d, op.clipIds, op.delta, op.trackShift ?? 0); break;
    case "trimClip": trimClip(d, op.clipId, op.edge, op.delta, op.ripple); break;
    case "rollEdit": rollEdit(d, op.clipId, op.delta); break;
    case "slipClip": slipClip(d, op.clipId, op.delta); break;
    case "slideClip": slideClip(d, op.clipId, op.delta); break;
    case "split": if (!splitAt(d, op.frame, op.clipIds)) throw new OpError("tidak ada klip di titik itu"); break;
    case "deleteClips": deleteClips(d, op.clipIds, op.ripple); break;
    case "deleteRange": deleteRange(d, op.start, op.end, op.ripple); break;
    case "setClips":
      for (const c of op.clipIds.map((id) => getClip(d, id))) Object.assign(c, op.changes);
      break;
    case "link": {
      const clips = op.clipIds.map((id) => getClip(d, id));
      if (clips.length < 2) throw new OpError("pilih minimal dua klip untuk di-link");
      const id = newId(d.clips.flatMap((c) => (c.linkId ? [c.linkId] : [])), "l");
      for (const c of clips) c.linkId = id;
      break;
    }
    case "unlink":
      for (const c of withLinked(d, op.clipIds)) c.linkId = null;
      break;
    case "addMarker":
      d.markers.push({ id: newId(d.markers.map((m) => m.id), "mk"), frame: op.frame, label: op.label ?? "" });
      break;
    case "updateMarker": {
      const m = d.markers.find((x) => x.id === op.id)!;
      if (op.frame !== undefined) m.frame = op.frame;
      if (op.label !== undefined) m.label = op.label;
      break;
    }
    case "removeMarker": d.markers = d.markers.filter((m) => m.id !== op.id); break;
    case "batch": for (const inner of op.ops) run(d, inner); break;
    default: if (!runContent(d, op)) throw new OpError("op tidak dikenal");
  }
  recomputeDuration(d);
  d.sequence.durationFrames = Math.max(d.sequence.durationFrames, contentEnd(d));
}

/** Op harus sudah lolos validateOp. Melempar OpError bila tidak bisa dikerjakan (track terkunci, dll.). */
export function applyOp(project: Project, op: Op): readonly [Project, Patch[], Patch[]] {
  const anchors = anchorSnapshot(project);
  return produceWithPatches(project, (d) => { run(d as Project, op); reanchor(d as Project, anchors); if ((d as Project).autoFx) syncAutoFx(d as Project); });
}

export { OpError };

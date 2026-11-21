// Skema project.cz.json (docs/SPEC.md, "Model data proyek").
// Bagian yang belum dipakai fase ini disimpan apa adanya sebagai unknown[] dan diberi tipe di fasenya.
import type { SafeEdges } from "./safeEdges.ts";

export const PROJECT_VERSION = 1;

export type TrackKind = "scene" | "video" | "caption" | "audio";

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  locked: boolean;
  hidden: boolean;
  muted: boolean;
  /** Audio: bila ada track solo, hanya track solo yang berbunyi. */
  solo?: boolean;
}

export interface Sequence {
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
}

export interface Media {
  id: string;
  /** Tidak diisi = video. "image" = foto untuk slot elemen (tidak masuk timeline, tanpa proxy/audio). */
  kind?: "video" | "image";
  name: string;
  /** Relatif ke folder proyek (disalin) atau absolut (ditautkan). */
  path: string;
  linked: boolean;
  /** proxy/<id>.mp4, dibuat di latar belakang; render memakai path asli. */
  proxy: string;
  duration: number;
  fps: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export interface Clip {
  id: string;
  trackId: string;
  mediaId: string;
  /** Detik di file sumber. */
  srcIn: number;
  srcOut: number;
  /** Frame di sequence. */
  start: number;
  linkId: string | null;
  gainDb: number;
  enabled: boolean;
  /** Fade audio dalam frame. */
  fadeIn: number;
  fadeOut: number;
}

export interface Marker { id: string; frame: number; label: string; }

/** Kata hasil transkrip lokal; waktu dalam detik di file sumber. */
export interface Word { id: string; mediaId: string; text: string; srcStart: number; srcEnd: number; estimated: boolean; }

export type CutKind = "jeda" | "isian" | "ulangan" | "teks" | "claude";
export type CutState = "proposed" | "applied" | "rejected";
/** Potongan non-destruktif: rentang sumber yang dibuang dari timeline saat diterapkan. */
export interface Cut {
  id: string; kind: CutKind; mediaId: string; srcStart: number; srcEnd: number;
  by: "auto" | "claude" | "manual"; state: CutState; reason?: string;
}

export type WordStyle = "normal" | "tebal" | "serif" | "aksen";
export interface CaptionWord { wordId: string | null; text: string; start: number; end: number; style: WordStyle; color?: string; }
export interface Caption {
  id: string; trackId: string; start: number; end: number; words: CaptionWord[];
  /** Ubahan gaya di atas gaya caption template. */
  style: Record<string, unknown>;
  position: { preset: "atas" | "dada" | "bawah"; x?: number; y?: number };
}

/** Kurva mesin gerak CZ. Disimpan sebagai nama; diterjemahkan di packages/composition/src/motion (curve()). */
export const CURVES = ["move", "moveSoft", "enter", "enterSnap", "exit", "exitHard", "drift", "linear", "gentle", "gentleOut", "spring", "pop"] as const;
export type CurveName = (typeof CURVES)[number];
/** Transisi masuk scene: separuh di ekor scene sebelumnya, separuh di kepala scene ini (durasi video tetap). */
export const TRANSITIONS = ["cut", "blur", "whip", "zoom", "flash", "collapse"] as const;
export type TransitionKind = (typeof TRANSITIONS)[number];

export interface Transform { x: number; y: number; scale: number; rotation: number; opacity: number; }
/** Frame relatif terhadap awal aset. ease = kurva segmen yang TIBA di key ini (seperti kurva masuk After Effects). */
export interface Keyframe { frame: number; x?: number; y?: number; scale?: number; rotation?: number; opacity?: number; ease?: CurveName }

/** Gerak kamera aditif (frame relatif awal scene): delta dengan kurvanya sendiri; gerak yang tumpang tindih dijumlahkan,
 *  jadi kamera tidak berhenti di antara dua gerakan. x/y piksel dunia, zoom pengali di akhir gerak (1.15 = dorong 15%). */
export interface CameraMove {
  at: number; dur: number; x?: number; y?: number; zoom?: number; rot?: number; ease?: CurveName;
  /** Frame bertahan di puncak, lalu gerak KELUAR (kembali ke posisi sebelum gerak) selama `out` frame. Tanpa `out`, gerak menetap seterusnya. */
  hold?: number; out?: number;
}
export interface CameraShake { at: number; dur?: number; amp?: number }
/** from/to: zoom dasar lama (opsional). Drift halus selalu jalan kecuali drift: false. */
export interface SceneCamera { from?: number; to?: number; moves?: CameraMove[]; shake?: CameraShake[]; drift?: boolean }
export interface SceneTransition { kind: TransitionKind; frames: number }
/** at = frame sequence tempat potongan berikutnya mulai. */
export interface BaseTransition extends SceneTransition {
  at: number;
  /** Peran SFX di sambungan: tidak diisi = bunyi bawaan jenisnya, null = tanpa bunyi. */
  sfx?: string | null;
  /** Dipasang mesin CZ (bukan user): boleh dihitung ulang saat sambungan berubah. */
  auto?: boolean;
}
export interface AssetInstance {
  id: string; trackId: string;
  /** null = aset bebas (dibuat dari nol, bukan dari definisi template). */
  defId: string | null; defVersion: number;
  sceneId: string | null;
  start: number; duration: number;
  anchorWordId: string | null;
  params: Record<string, unknown>;
  transform: Transform;
  anim: { in: string | null; out: string | null };
  keyframes: Keyframe[];
  sfx: { in: string | null; out: string | null; volume: number };
  locked: boolean; hidden: boolean; detached: boolean;
  /** Diubah setelah dipasang (dari preset scene); dipakai untuk bertanya sebelum ditimpa. */
  edited: boolean;
}

export interface SceneOption { id: string; star: boolean; presetId: string; why?: string; }
export type SceneStatus = "draft" | "diubah" | "disetujui" | "dikunci";
export interface Scene {
  id: string; title: string; beat: string; summary: string; reason: string;
  start: number; end: number;
  options: SceneOption[]; choice: string | null;
  custom: Record<string, unknown>;
  /** Gerak kamera footage selama scene (mesin kamera aditif CZ). */
  camera: SceneCamera | null;
  /** Transisi masuk scene ini dari scene sebelumnya. */
  transition?: SceneTransition | null;
  status: SceneStatus;
  /** Scene digambar komponen Remotion milik skill (id komposisi + props JSON); footage dan caption CZ disembunyikan di rentangnya. */
  skill?: SceneSkill | null;
}
export interface SceneSkill { component: string; props: Record<string, unknown> }

export interface NoteReply { by: "claude" | "user"; text: string; at: number; }
export type NoteStatus = "terbuka" | "selesai" | "konflik";
export interface Note {
  id: string; sceneId: string | null; frame: number; text: string;
  /** Path relatif ke folder proyek (.cz/notes/...). */
  images: string[];
  status: NoteStatus; replies: NoteReply[];
}

export interface Project {
  version: number;
  id: string;
  title: string;
  skill: { id: string; version: number } | null;
  sequence: Sequence;
  media: Media[];
  transcript: { words: Word[] };
  tracks: Track[];
  clips: Clip[];
  captions: Caption[];
  assets: AssetInstance[];
  scenes: Scene[];
  /** Kamera dasar, tidak terikat rencana: frame `at` relatif awal sequence. Dipakai di rentang yang scene-nya (bila ada) tidak punya kamera sendiri. */
  camera?: SceneCamera | null;
  /** Pelindung area aman dasar (seluruh video), tidak terikat rencana. Scene yang punya `custom.safe` sendiri menimpanya. */
  safe?: SafeEdges | null;
  /** Transisi di sambungan potongan, tidak terikat rencana. Transisi milik scene (bila ada) menang di batasnya. */
  transitions?: BaseTransition[];
  /** true: mesin CZ memasang transisi + SFX otomatis di tiap sambungan footage (proyek baru). */
  autoFx?: boolean;
  cuts: Cut[];
  notes: Note[];
  markers: Marker[];
}

/** Thumbnail strip: satu tile tiap `interval` detik, maksimal 120 tile. Dipakai server dan UI. */
export function thumbPlan(m: Pick<Media, "duration" | "width" | "height">) {
  const interval = Math.max(1, m.duration / 120);
  const count = Math.max(1, Math.ceil(m.duration / interval));
  const tileH = 72;
  const tileW = Math.max(2, Math.round((tileH * m.width) / m.height / 2) * 2);
  return { interval, count, tileW, tileH };
}

/** Puncak waveform per detik. */
export const PEAKS_PER_SEC = 100;

export const SEQUENCE_PRESETS = [
  { id: "9:16", label: "9:16 Reels / TikTok", width: 1080, height: 1920 },
  { id: "1:1", label: "1:1 Kotak", width: 1080, height: 1080 },
  { id: "4:5", label: "4:5 Feed Instagram", width: 1080, height: 1350 },
  { id: "16:9", label: "16:9 YouTube", width: 1920, height: 1080 },
] as const;

export const FPS_CHOICES = [24, 25, 30, 50, 60] as const;

const track = (id: string, kind: TrackKind, name: string): Track => ({
  id, kind, name, locked: false, hidden: false, muted: false,
});

export function createProject(title: string, id = "p_" + Math.random().toString(36).slice(2, 8)): Project {
  return {
    version: PROJECT_VERSION,
    id,
    title,
    skill: null,
    sequence: { width: 1080, height: 1920, fps: 30, durationFrames: 0 },
    media: [],
    transcript: { words: [] },
    tracks: [
      track("S", "scene", "Bagian"),
      track("V3", "video", "Elemen"),
      track("V2", "caption", "Subtitle"),
      track("V1", "video", "Video"),
      track("A1", "audio", "Suara asli"),
      track("A2", "audio", "Efek suara"),
      track("A3", "audio", "Musik"),
    ],
    clips: [], captions: [], assets: [], scenes: [], cuts: [], notes: [], markers: [],
    autoFx: true,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const ARRAYS = ["media", "tracks", "clips", "captions", "assets", "scenes", "cuts", "notes", "markers"] as const;
const KINDS: TrackKind[] = ["scene", "video", "caption", "audio"];

/** Mengembalikan daftar masalah; kosong berarti proyek sah. */
export function validateProject(p: unknown): string[] {
  if (!isObj(p)) return ["proyek bukan objek JSON"];
  const errs: string[] = [];
  if (p.version !== PROJECT_VERSION) errs.push(`versi ${String(p.version)} tidak dikenal (harus ${PROJECT_VERSION})`);
  if (typeof p.id !== "string" || !p.id) errs.push("id kosong");
  if (typeof p.title !== "string") errs.push("title bukan teks");
  const s = p.sequence;
  if (!isObj(s) || !isInt(s.width, 16, 8192) || !isInt(s.height, 16, 8192) || !isInt(s.fps, 1, 240) || !isInt(s.durationFrames, 0, 1e9)) {
    errs.push("sequence tidak sah");
  }
  for (const k of ARRAYS) if (!Array.isArray(p[k])) errs.push(`${k} bukan daftar`);
  if (!isObj(p.transcript) || !Array.isArray(p.transcript.words)) errs.push("transcript.words bukan daftar");
  if (Array.isArray(p.tracks)) {
    const ids = new Set<string>();
    for (const t of p.tracks) {
      if (!isObj(t) || typeof t.id !== "string" || typeof t.name !== "string" || !KINDS.includes(t.kind as TrackKind)
        || typeof t.locked !== "boolean" || typeof t.hidden !== "boolean" || typeof t.muted !== "boolean") {
        errs.push(`track tidak sah: ${JSON.stringify(t)}`);
      } else if (ids.has(t.id)) errs.push(`id track ganda: ${t.id}`);
      else ids.add(t.id);
    }
  }
  if (Array.isArray(p.media) && Array.isArray(p.clips) && Array.isArray(p.tracks)) {
    const mediaIds = new Set(p.media.map((m) => (isObj(m) ? m.id : null)));
    const trackIds = new Set(p.tracks.map((t) => (isObj(t) ? t.id : null)));
    for (const m of p.media) {
      if (!isObj(m) || typeof m.id !== "string" || typeof m.path !== "string" || typeof m.duration !== "number") errs.push(`media tidak sah: ${JSON.stringify(m)}`);
    }
    for (const c of p.clips) {
      if (!isObj(c) || typeof c.id !== "string" || !mediaIds.has(c.mediaId) || !trackIds.has(c.trackId)
        || typeof c.srcIn !== "number" || typeof c.srcOut !== "number" || !(c.srcOut > c.srcIn) || !isInt(c.start, 0, 1e9)) {
        errs.push(`klip tidak sah: ${JSON.stringify(c)}`);
      }
    }
  }
  return errs;
}

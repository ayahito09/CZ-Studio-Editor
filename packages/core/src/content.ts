// Op untuk transkrip, potongan, aset, caption, scene, dan catatan (F3–F7).
// Bentuk dicek di validateContentOp; isi dijalankan di runContent di atas draft Immer.
import { wordFrames } from "./analysis.ts";
import {
  CURVES, TRANSITIONS,
  type AssetInstance, type Caption, type CaptionWord, type Cut, type CutKind, type CurveName, type Keyframe, type Note, type NoteStatus, type Project,
  type Scene, type SceneStatus, type Transform, type TransitionKind,
} from "./project.ts";
import type { NewAsset } from "./skill.ts";
import { clipEnd, deleteRange, newId, OpError } from "./timeline.ts";

type NewWord = { text: string; srcStart: number; srcEnd: number; estimated?: boolean };
type NewCut = { kind: CutKind; mediaId: string; srcStart: number; srcEnd: number; by?: Cut["by"]; reason?: string };
type AssetChanges = Partial<Omit<AssetInstance, "id" | "defId" | "defVersion" | "edited" | "transform" | "sfx">>
  & { transform?: Partial<Transform>; sfx?: Partial<AssetInstance["sfx"]> };
/** id boleh diisi untuk mempertahankan scene lama (aset tetap terikat); tanpa id = scene baru. */
type NewScene = Partial<Scene> & { title: string; start: number; end: number };

export type ContentOp =
  | { type: "setTranscript"; mediaId: string; words: NewWord[] }
  | { type: "updateWord"; id: string; text?: string; srcStart?: number; srcEnd?: number }
  | { type: "addCuts"; cuts: NewCut[]; replaceKinds?: CutKind[]; apply?: boolean }
  | { type: "setCutState"; cutIds: string[]; state: "proposed" | "rejected" }
  | { type: "applyCuts"; cutIds: string[] }
  | { type: "addAssets"; assets: NewAsset[] }
  | { type: "updateAsset"; id: string; changes: AssetChanges }
  | { type: "removeAssets"; ids: string[] }
  | { type: "reorderAsset"; id: string; dir: 1 | -1 }
  | { type: "setCaptions"; captions: Omit<Caption, "id">[] }
  | { type: "updateCaption"; id: string; changes: Partial<Pick<Caption, "start" | "end" | "style" | "position" | "words">> }
  | { type: "splitCaption"; id: string; index: number }
  | { type: "mergeCaption"; id: string }
  | { type: "removeCaptions"; ids: string[] }
  | { type: "setScenes"; scenes: NewScene[] }
  | { type: "updateScene"; id: string; changes: Partial<Omit<Scene, "id">> }
  | { type: "addNote"; note: { sceneId: string | null; frame: number; text: string; images?: string[] } }
  | { type: "updateNote"; id: string; changes: { text?: string; status?: NoteStatus; frame?: number; images?: string[] } }
  | { type: "replyNote"; id: string; by: "claude" | "user"; text: string }
  | { type: "removeNote"; id: string }
  | { type: "setSkill"; skill: { id: string; version: number } | null };

export const CONTENT_SERVER_ONLY = ["setTranscript", "setSkill"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min = -1e9, max = 1e9) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown, max: number, empty = false) => typeof v === "string" && (empty || v.trim().length > 0) && v.length <= max;
const isIds = (v: unknown) => Array.isArray(v) && v.length > 0 && v.length <= 10000 && v.every((x) => typeof x === "string");
const size = (v: unknown) => JSON.stringify(v ?? null).length;
const CUT_KINDS: CutKind[] = ["jeda", "isian", "ulangan", "teks", "claude"];
const SCENE_STATUS: SceneStatus[] = ["draft", "diubah", "disetujui", "dikunci"];
const NOTE_STATUS: NoteStatus[] = ["terbuka", "selesai", "konflik"];
const POS = ["atas", "dada", "bawah"];
const STYLES = ["normal", "tebal", "serif", "aksen"];

function checkTransform(t: unknown): string | null {
  if (!isObj(t)) return "transform bukan objek";
  for (const [k, v] of Object.entries(t)) {
    if (!["x", "y", "scale", "rotation", "opacity"].includes(k)) return `field transform tidak dikenal: ${k}`;
    if (!isNum(v)) return `transform.${k} harus angka`;
  }
  if (t.scale !== undefined && !((t.scale as number) > 0 && (t.scale as number) <= 20)) return "skala harus 0-20";
  if (t.opacity !== undefined && !((t.opacity as number) >= 0 && (t.opacity as number) <= 1)) return "opasitas harus 0-1";
  return null;
}
const checkEase = (v: unknown) => v === undefined || CURVES.includes(v as CurveName) ? null : `kurva harus ${CURVES.join("/")}`;
function checkKeyframes(k: unknown): string | null {
  if (!Array.isArray(k) || k.length > 200) return "keyframes harus daftar (maks 200)";
  for (const f of k) {
    if (!isObj(f) || !isInt(f.frame, 0)) return "keyframe butuh frame ≥ 0";
    const err = checkEase(f.ease) ?? checkTransform(Object.fromEntries(Object.entries(f).filter(([key]) => key !== "frame" && key !== "ease")));
    if (err) return err;
  }
  return null;
}
function checkCamera(c: unknown): string | null {
  if (c === null) return null;
  if (!isObj(c)) return "camera harus objek";
  for (const k of ["from", "to"]) if (c[k] !== undefined && !(isNum(c[k]) && (c[k] as number) > 0.1 && (c[k] as number) <= 5)) return `camera.${k} harus 0.1-5`;
  if (c.drift !== undefined && typeof c.drift !== "boolean") return "camera.drift harus true/false";
  if (c.moves !== undefined) {
    if (!Array.isArray(c.moves) || c.moves.length > 60) return "camera.moves maks 60";
    for (const m of c.moves) {
      if (!isObj(m) || !isInt(m.at, 0) || !isInt(m.dur, 1, 3600)) return "gerak kamera butuh at ≥ 0 dan dur ≥ 1 (frame)";
      for (const k of ["x", "y", "rot"]) if (m[k] !== undefined && !(isNum(m[k]) && Math.abs(m[k] as number) <= 10_000)) return `gerak kamera ${k} tidak sah`;
      if (m.zoom !== undefined && !(isNum(m.zoom) && (m.zoom as number) > 0.1 && (m.zoom as number) <= 5)) return "zoom gerak kamera harus 0.1-5";
      const e = checkEase(m.ease); if (e) return e;
      if (m.hold !== undefined && !isInt(m.hold, 0, 3600)) return "hold gerak kamera harus 0-3600 frame";
      if (m.out !== undefined && !isInt(m.out, 1, 3600)) return "out gerak kamera harus 1-3600 frame";
      for (const k of Object.keys(m)) if (!["at", "dur", "x", "y", "zoom", "rot", "ease", "hold", "out"].includes(k)) return `field gerak kamera tidak dikenal: ${k}`;
    }
  }
  if (c.shake !== undefined) {
    if (!Array.isArray(c.shake) || c.shake.length > 30) return "camera.shake maks 30";
    for (const s of c.shake) if (!isObj(s) || !isInt(s.at, 0) || (s.dur !== undefined && !isInt(s.dur, 1, 120)) || (s.amp !== undefined && !(isNum(s.amp) && (s.amp as number) >= 0 && (s.amp as number) <= 60))) return "shake butuh at, dur 1-120, amp 0-60";
  }
  for (const k of Object.keys(c)) if (!["from", "to", "moves", "shake", "drift"].includes(k)) return `field camera tidak dikenal: ${k}`;
  return null;
}
function checkTransition(t: unknown): string | null {
  if (t === null) return null;
  if (!isObj(t) || !TRANSITIONS.includes(t.kind as TransitionKind) || !isInt(t.frames, 0, 120)) return `transition butuh kind ${TRANSITIONS.join("/")} dan frames 0-120`;
  for (const k of Object.keys(t)) if (!["kind", "frames"].includes(k)) return `field transition tidak dikenal: ${k}`;
  return null;
}
function checkAssetFields(a: Record<string, unknown>, p: Project, partial: boolean): string | null {
  for (const [k, v] of Object.entries(a)) {
    switch (k) {
      case "start": if (!isInt(v, 0)) return "start harus frame ≥ 0"; break;
      case "duration": if (!isInt(v, 1)) return "duration harus frame ≥ 1"; break;
      case "trackId": if (!p.tracks.some((t) => t.id === v && t.kind === "video")) return `track ${String(v)} bukan track video`; break;
      case "defId": if (v !== null && !isStr(v, 80)) return "defId tidak sah"; break;
      case "defVersion": if (!isInt(v, 0)) return "defVersion tidak sah"; break;
      case "sceneId": case "anchorWordId": if (v !== null && !isStr(v, 40)) return `${k} tidak sah`; break;
      case "params": if (!isObj(v) || size(v) > 50_000) return "params harus objek (maks 50 KB)"; break;
      case "transform": { const e = checkTransform(v); if (e) return e; break; }
      case "keyframes": { const e = checkKeyframes(v); if (e) return e; break; }
      case "anim": if (!isObj(v) || Object.values(v).some((x) => x !== null && !isStr(x, 40))) return "anim harus {in, out}"; break;
      case "sfx": if (!isObj(v) || (v.volume !== undefined && !(isNum(v.volume) && (v.volume as number) >= 0 && (v.volume as number) <= 4))) return "sfx tidak sah"; break;
      case "locked": case "hidden": case "detached": if (typeof v !== "boolean") return `${k} harus true/false`; break;
      case "edited": if (partial) return "edited diatur otomatis"; break;
      default: return `field aset tidak dikenal: ${k}`;
    }
  }
  return null;
}
function checkCaptionWords(ws: unknown): string | null {
  if (!Array.isArray(ws) || ws.length === 0 || ws.length > 60) return "words caption harus 1-60 kata";
  for (const w of ws) {
    if (!isObj(w) || !isStr(w.text, 80) || !isInt(w.start, 0) || !isInt(w.end, 1) || (w.end as number) <= (w.start as number)) return "kata caption butuh text, start < end";
    if (w.style !== undefined && !STYLES.includes(w.style as string)) return `gaya kata harus ${STYLES.join("/")}`;
  }
  return null;
}
function checkCaption(c: unknown, partial: boolean): string | null {
  if (!isObj(c)) return "caption bukan objek";
  if (!partial || c.words !== undefined) { const e = checkCaptionWords(c.words); if (e) return e; }
  if (c.style !== undefined && (!isObj(c.style) || size(c.style) > 5000)) return "style caption harus objek";
  if (c.position !== undefined && (!isObj(c.position) || !POS.includes(c.position.preset as string))) return `posisi caption harus ${POS.join("/")}`;
  if (c.start !== undefined && !isInt(c.start, 0)) return "start caption tidak sah";
  if (c.end !== undefined && !isInt(c.end, 1)) return "end caption tidak sah";
  return null;
}
function checkScene(s: unknown, partial: boolean): string | null {
  if (!isObj(s)) return "scene bukan objek";
  if (!partial && !isStr(s.title, 120)) return "judul scene 1-120 karakter";
  if (partial && s.title !== undefined && !isStr(s.title, 120)) return "judul scene 1-120 karakter";
  for (const k of ["start", "end"]) if ((!partial || s[k] !== undefined) && !isInt(s[k], 0)) return `${k} scene harus frame ≥ 0`;
  for (const k of ["beat", "summary", "reason"]) if (s[k] !== undefined && !isStr(s[k], 2000, true)) return `${k} scene terlalu panjang`;
  if (s.options !== undefined) {
    if (!Array.isArray(s.options) || s.options.length > 6) return "options scene maks 6";
    for (const o of s.options) if (!isObj(o) || !isStr(o.id, 10) || !isStr(o.presetId, 80) || typeof o.star !== "boolean") return "opsi butuh id, presetId, star";
    if (s.options.length && s.options.filter((o) => (o as { star: boolean }).star).length !== 1) return "tepat satu opsi harus diberi ★";
  }
  if (s.choice !== undefined && s.choice !== null && !isStr(s.choice, 10)) return "choice tidak sah";
  if (s.custom !== undefined && (!isObj(s.custom) || size(s.custom) > 10_000)) return "custom harus objek";
  if (s.camera !== undefined) { const e = checkCamera(s.camera); if (e) return e; }
  if (s.transition !== undefined) { const e = checkTransition(s.transition); if (e) return e; }
  if (s.status !== undefined && !SCENE_STATUS.includes(s.status as SceneStatus)) return `status scene harus ${SCENE_STATUS.join("/")}`;
  if (s.skill !== undefined && s.skill !== null) {
    if (!isObj(s.skill) || typeof s.skill.component !== "string" || !/^[A-Za-z_][\w-]{0,79}$/.test(s.skill.component)) return "skill scene butuh component (id komposisi)";
    if (!isObj(s.skill.props) || size(s.skill.props) > 200_000) return "props skill harus objek (maks 200 KB)";
    for (const k of Object.keys(s.skill)) if (!["component", "props"].includes(k)) return `field skill scene tidak dikenal: ${k}`;
  }
  if (s.id !== undefined && (partial || !isStr(s.id, 40))) return "id scene tidak sah";
  for (const k of Object.keys(s)) if (!["id", "title", "beat", "summary", "reason", "start", "end", "options", "choice", "custom", "camera", "transition", "status", "skill"].includes(k)) return `field scene tidak dikenal: ${k}`;
  return null;
}
const checkImages = (v: unknown) => v === undefined || (Array.isArray(v) && v.length <= 6 && v.every((x) => isStr(x, 300) && !String(x).includes("..")));

export function validateContentOp(op: Record<string, unknown>, p: Project): string | null | undefined {
  switch (op.type) {
    case "setTranscript":
      if (!p.media.some((m) => m.id === op.mediaId)) return "media tidak ada";
      if (!Array.isArray(op.words) || op.words.length > 200_000) return "words harus daftar";
      for (const w of op.words) if (!isObj(w) || !isStr(w.text, 200) || !isNum(w.srcStart) || !isNum(w.srcEnd) || (w.srcEnd as number) < (w.srcStart as number)) return "kata tidak sah";
      return null;
    case "updateWord":
      if (!p.transcript.words.some((w) => w.id === op.id)) return "kata tidak ada";
      if (op.text !== undefined && !isStr(op.text, 200)) return "teks kata tidak sah";
      if ((op.srcStart !== undefined && !isNum(op.srcStart)) || (op.srcEnd !== undefined && !isNum(op.srcEnd))) return "waktu kata harus angka";
      return null;
    case "addCuts":
      if (!Array.isArray(op.cuts) || op.cuts.length > 5000) return "cuts harus daftar";
      for (const c of op.cuts) {
        if (!isObj(c) || !CUT_KINDS.includes(c.kind as CutKind) || !p.media.some((m) => m.id === c.mediaId)) return "potongan butuh kind dan mediaId yang ada";
        if (!isNum(c.srcStart) || !isNum(c.srcEnd) || (c.srcEnd as number) <= (c.srcStart as number)) return "potongan butuh srcStart < srcEnd";
        if (c.reason !== undefined && !isStr(c.reason, 500, true)) return "alasan terlalu panjang";
      }
      if (op.replaceKinds !== undefined && (!Array.isArray(op.replaceKinds) || op.replaceKinds.some((k) => !CUT_KINDS.includes(k)))) return "replaceKinds tidak sah";
      return op.apply === undefined || typeof op.apply === "boolean" ? null : "apply harus true/false";
    case "setCutState":
      return isIds(op.cutIds) && (op.state === "proposed" || op.state === "rejected") ? null : "setCutState tidak sah";
    case "applyCuts":
      return isIds(op.cutIds) ? null : "applyCuts butuh cutIds";
    case "addAssets":
      if (!Array.isArray(op.assets) || !op.assets.length || op.assets.length > 500) return "assets harus 1-500";
      for (const a of op.assets) {
        if (!isObj(a) || !isInt(a.start, 0) || !isInt(a.duration, 1)) return "aset baru butuh start dan duration (frame)";
        const e = checkAssetFields(a, p, false);
        if (e) return e;
      }
      return null;
    case "updateAsset":
      if (!p.assets.some((a) => a.id === op.id)) return `aset ${String(op.id)} tidak ada`;
      if (!isObj(op.changes) || !Object.keys(op.changes).length) return "changes kosong";
      return checkAssetFields(op.changes, p, true);
    case "removeAssets":
      return isIds(op.ids) ? null : "removeAssets butuh ids";
    case "reorderAsset":
      return p.assets.some((a) => a.id === op.id) && (op.dir === 1 || op.dir === -1) ? null : "reorderAsset tidak sah";
    case "setCaptions":
      if (!Array.isArray(op.captions) || op.captions.length > 20_000) return "captions harus daftar";
      for (const c of op.captions) { const e = checkCaption(c, false); if (e) return e; }
      return null;
    case "updateCaption":
      if (!p.captions.some((c) => c.id === op.id)) return "caption tidak ada";
      if (!isObj(op.changes) || !Object.keys(op.changes).length) return "changes kosong";
      for (const k of Object.keys(op.changes)) if (!["start", "end", "style", "position", "words"].includes(k)) return `field caption tidak dikenal: ${k}`;
      return checkCaption(op.changes, true);
    case "splitCaption":
      return p.captions.some((c) => c.id === op.id) && isInt(op.index, 1) ? null : "splitCaption tidak sah";
    case "mergeCaption":
      return p.captions.some((c) => c.id === op.id) ? null : "caption tidak ada";
    case "removeCaptions":
      return isIds(op.ids) ? null : "removeCaptions butuh ids";
    case "setScenes":
      if (!Array.isArray(op.scenes) || op.scenes.length > 300) return "scenes maks 300";
      for (const s of op.scenes) { const e = checkScene(s, false); if (e) return e; }
      return null;
    case "updateScene":
      if (!p.scenes.some((s) => s.id === op.id)) return `scene ${String(op.id)} tidak ada`;
      if (!isObj(op.changes) || !Object.keys(op.changes).length) return "changes kosong";
      return checkScene(op.changes, true);
    case "addNote": {
      const n = op.note;
      if (!isObj(n) || !isStr(n.text, 4000, true) || !isInt(n.frame, 0)) return "catatan butuh text dan frame";
      if (n.sceneId !== null && !p.scenes.some((s) => s.id === n.sceneId)) return "scene catatan tidak ada";
      return checkImages(n.images) ? null : "gambar catatan maks 6";
    }
    case "updateNote": {
      if (!p.notes.some((n) => n.id === op.id)) return "catatan tidak ada";
      const c = op.changes;
      if (!isObj(c) || !Object.keys(c).length) return "changes kosong";
      if (c.text !== undefined && !isStr(c.text, 4000, true)) return "teks catatan terlalu panjang";
      if (c.status !== undefined && !NOTE_STATUS.includes(c.status as NoteStatus)) return `status catatan harus ${NOTE_STATUS.join("/")}`;
      if (c.frame !== undefined && !isInt(c.frame, 0)) return "frame catatan tidak sah";
      return checkImages(c.images) ? null : "gambar catatan maks 6";
    }
    case "replyNote":
      if (!p.notes.some((n) => n.id === op.id)) return "catatan tidak ada";
      return (op.by === "claude" || op.by === "user") && isStr(op.text, 4000) ? null : "balasan butuh by dan text";
    case "removeNote":
      return p.notes.some((n) => n.id === op.id) ? null : "catatan tidak ada";
    case "setSkill":
      return op.skill === null || (isObj(op.skill) && isStr(op.skill.id, 80) && isInt(op.skill.version, 1)) ? null : "skill tidak sah";
    default:
      return undefined;
  }
}

/** Claude tidak boleh mengubah aset terkunci atau scene yang dikunci (SPEC: Status). */
export function claudeBlocked(op: Record<string, unknown>, p: Project): string | null {
  const lockedAsset = (id: unknown) => p.assets.find((a) => a.id === id)?.locked;
  const lockedScene = (id: unknown) => p.scenes.find((s) => s.id === id)?.status === "dikunci";
  switch (op.type) {
    case "updateAsset": case "reorderAsset": if (lockedAsset(op.id)) return `aset ${String(op.id)} dikunci user`; break;
    case "removeAssets": if ((op.ids as string[]).some(lockedAsset)) return "ada aset yang dikunci user"; break;
    case "updateScene": if (lockedScene(op.id)) return `scene ${String(op.id)} dikunci user`; break;
    case "setScenes": if (p.scenes.some((s) => s.status === "dikunci")) return "ada scene yang dikunci; ubah per scene saja"; break;
    case "addAssets": if ((op.assets as NewAsset[]).some((a) => a.sceneId && lockedScene(a.sceneId))) return "scene tujuan dikunci user"; break;
    case "batch": for (const inner of op.ops as Record<string, unknown>[]) { const e = claudeBlocked(inner, p); if (e) return e; } break;
  }
  return null;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const DEFAULT_TRANSFORM: Transform = { x: 540, y: 960, scale: 1, rotation: 0, opacity: 1 };

function applyCuts(d: Project, cutIds: string[]) {
  const fps = d.sequence.fps;
  const cuts = cutIds.map((id) => d.cuts.find((c) => c.id === id) ?? (() => { throw new OpError(`potongan ${id} tidak ada`); })())
    .filter((c) => c.state !== "applied");
  const ranges: [number, number][] = [];
  for (const cut of cuts) {
    for (const c of d.clips) {
      if (c.mediaId !== cut.mediaId) continue;
      const a = Math.max(cut.srcStart, c.srcIn), b = Math.min(cut.srcEnd, c.srcOut);
      if (b <= a) continue;
      const s = c.start + Math.round((a - c.srcIn) * fps), e = c.start + Math.round((b - c.srcIn) * fps);
      if (e > s && !ranges.some(([x, y]) => x === s && y === e)) ranges.push([s, e]);
    }
    cut.state = "applied";
  }
  // Dari belakang supaya posisi rentang sebelumnya tidak bergeser.
  ranges.sort((x, y) => y[0] - x[0]);
  for (const [s, e] of ranges) {
    deleteRange(d, s, e, true);
    // Fade 1 frame di sambungan audio: titik potong ada di wilayah sunyi (padding), jadi tidak ada kata yang hilang.
    for (const c of d.clips) {
      if (d.tracks.find((t) => t.id === c.trackId)?.kind !== "audio") continue;
      if (clipEnd(c, fps) === s) c.fadeOut = Math.max(c.fadeOut, 1);
      if (c.start === s) c.fadeIn = Math.max(c.fadeIn, 1);
    }
  }
}

function newAsset(d: Project, a: NewAsset, id: string): AssetInstance {
  return {
    id, trackId: a.trackId ?? "V3", defId: a.defId ?? null, defVersion: a.defVersion ?? 0, sceneId: a.sceneId ?? null,
    start: a.start, duration: a.duration, anchorWordId: a.anchorWordId ?? null, params: a.params ?? {},
    transform: { ...DEFAULT_TRANSFORM, x: d.sequence.width / 2, y: d.sequence.height / 2, ...(a.transform ?? {}) },
    anim: a.anim ?? { in: null, out: null }, keyframes: a.keyframes ?? [],
    sfx: { in: null, out: null, volume: 1, ...(a.sfx ?? {}) },
    locked: a.locked ?? false, hidden: a.hidden ?? false, detached: a.detached ?? false, edited: false,
  };
}

const findOr = <T extends { id: string }>(xs: T[], id: string, what: string): T => {
  const x = xs.find((y) => y.id === id);
  if (!x) throw new OpError(`${what} ${id} tidak ada`);
  return x;
};

function sceneFrom(s: NewScene, id: string): Scene {
  return {
    id, title: s.title.trim(), beat: s.beat ?? "", summary: s.summary ?? "", reason: s.reason ?? "",
    start: s.start, end: Math.max(s.start + 1, s.end), options: s.options ?? [], choice: s.choice ?? s.options?.find((o) => o.star)?.id ?? null,
    custom: s.custom ?? {}, camera: s.camera ?? null, status: s.status ?? "draft", ...(s.skill ? { skill: s.skill } : {}),
    ...(s.transition ? { transition: s.transition } : {}),
  };
}

const captionBounds = (c: Caption) => { c.start = Math.min(...c.words.map((w) => w.start)); c.end = Math.max(...c.words.map((w) => w.end)); };

/** Mengembalikan false bila op bukan op konten. */
export function runContent(d: Project, op: ContentOp): boolean {
  switch (op.type) {
    case "setTranscript": {
      d.transcript.words = d.transcript.words.filter((w) => w.mediaId !== op.mediaId);
      let n = Number(newId(d.transcript.words.map((w) => w.id), "w").slice(1));
      for (const w of op.words) {
        const s = r3(w.srcStart);
        d.transcript.words.push({ id: "w" + n++, mediaId: op.mediaId, text: w.text, srcStart: s, srcEnd: Math.max(s + 0.02, r3(w.srcEnd)), estimated: !!w.estimated });
      }
      return true;
    }
    case "updateWord": {
      const w = findOr(d.transcript.words, op.id, "kata");
      if (op.text !== undefined) w.text = op.text;
      if (op.srcStart !== undefined) w.srcStart = r3(Math.max(0, op.srcStart));
      if (op.srcEnd !== undefined) w.srcEnd = r3(op.srcEnd);
      if (w.srcEnd <= w.srcStart) throw new OpError("akhir kata harus setelah awalnya");
      w.estimated = false;
      return true;
    }
    case "addCuts": {
      if (op.replaceKinds) d.cuts = d.cuts.filter((c) => c.state === "applied" || !op.replaceKinds!.includes(c.kind));
      const ids: string[] = [];
      for (const c of op.cuts) {
        const id = newId(d.cuts.map((x) => x.id), "k");
        d.cuts.push({ id, kind: c.kind, mediaId: c.mediaId, srcStart: r3(c.srcStart), srcEnd: r3(c.srcEnd), by: c.by ?? "manual", state: "proposed", ...(c.reason ? { reason: c.reason } : {}) });
        ids.push(id);
      }
      if (op.apply && ids.length) applyCuts(d, ids);
      return true;
    }
    case "setCutState":
      for (const id of op.cutIds) {
        const c = findOr(d.cuts, id, "potongan");
        if (c.state === "applied") throw new OpError("potongan yang sudah diterapkan hanya bisa dibatalkan dengan Ctrl+Z");
        c.state = op.state;
      }
      return true;
    case "applyCuts": applyCuts(d, op.cutIds); return true;
    case "addAssets":
      for (const a of op.assets) d.assets.push(newAsset(d, a, newId(d.assets.map((x) => x.id), "a")));
      return true;
    case "updateAsset": {
      const a = findOr(d.assets, op.id, "aset");
      const { transform, sfx, ...rest } = op.changes;
      Object.assign(a, rest);
      if (transform) Object.assign(a.transform, transform);
      if (sfx) Object.assign(a.sfx, sfx);
      if (Object.keys(op.changes).some((k) => k !== "locked" && k !== "hidden")) a.edited = true;
      return true;
    }
    case "removeAssets": {
      const ids = new Set(op.ids);
      d.assets = d.assets.filter((a) => !ids.has(a.id));
      return true;
    }
    case "reorderAsset": {
      const i = d.assets.findIndex((a) => a.id === op.id), j = i + op.dir;
      if (j >= 0 && j < d.assets.length) [d.assets[i], d.assets[j]] = [d.assets[j], d.assets[i]];
      return true;
    }
    case "setCaptions": {
      d.captions = op.captions.map((c, i) => ({
        id: "cap" + (i + 1), trackId: c.trackId ?? "V2", start: c.start, end: c.end,
        words: c.words.map((w) => ({ ...w, style: w.style ?? "normal" })), style: c.style ?? {}, position: c.position ?? { preset: "bawah" },
      }));
      for (const c of d.captions) if (c.words.length) captionBounds(c);
      return true;
    }
    case "updateCaption": {
      const c = findOr(d.captions, op.id, "caption");
      const { words, ...rest } = op.changes;
      Object.assign(c, rest);
      if (words) { c.words = words.map((w) => ({ ...w, style: w.style ?? "normal" })); captionBounds(c); }
      if (c.end <= c.start) throw new OpError("akhir caption harus setelah awalnya");
      return true;
    }
    case "splitCaption": {
      const i = d.captions.findIndex((c) => c.id === op.id);
      const c = d.captions[i];
      if (op.index >= c.words.length) throw new OpError("pilih kata di tengah blok");
      const right: Caption = { ...c, id: newId(d.captions.map((x) => x.id), "cap"), words: c.words.slice(op.index), style: { ...c.style }, position: { ...c.position } };
      c.words = c.words.slice(0, op.index);
      captionBounds(c); captionBounds(right);
      d.captions.splice(i + 1, 0, right);
      return true;
    }
    case "mergeCaption": {
      const sorted = [...d.captions].sort((a, b) => a.start - b.start);
      const k = sorted.findIndex((c) => c.id === op.id);
      const next = sorted[k + 1];
      if (!next) throw new OpError("tidak ada blok berikutnya");
      const c = sorted[k];
      c.words = [...c.words, ...next.words];
      captionBounds(c);
      d.captions = d.captions.filter((x) => x.id !== next.id);
      return true;
    }
    case "removeCaptions": {
      const ids = new Set(op.ids);
      d.captions = d.captions.filter((c) => !ids.has(c.id));
      return true;
    }
    case "setScenes": {
      const old = new Set(d.scenes.map((s) => s.id));
      const used = new Set<string>();
      const keep = op.scenes.map((s) => (s.id && /^s\d+$/.test(s.id) && !used.has(s.id) ? (used.add(s.id), s.id) : null));
      const all = [...d.scenes.map((s) => s.id), ...used];
      d.scenes = op.scenes.map((s, i) => { const id = keep[i] ?? newId(all, "s"); all.push(id); return sceneFrom(s, id); });
      const now = new Set(d.scenes.map((s) => s.id));
      // Aset dari scene yang hilang tetap ada, tapi tidak lagi terikat ke scene.
      for (const a of d.assets) if (a.sceneId && old.has(a.sceneId) && !now.has(a.sceneId)) a.sceneId = null;
      return true;
    }
    case "updateScene": {
      const s = findOr(d.scenes, op.id, "scene");
      Object.assign(s, op.changes);
      if (s.end <= s.start) throw new OpError("akhir scene harus setelah awalnya");
      if (op.changes.options && s.choice && !s.options.some((o) => o.id === s.choice)) s.choice = s.options.find((o) => o.star)?.id ?? null;
      return true;
    }
    case "addNote":
      d.notes.push({ id: newId(d.notes.map((n) => n.id), "n"), sceneId: op.note.sceneId, frame: op.note.frame, text: op.note.text, images: op.note.images ?? [], status: "terbuka", replies: [] });
      return true;
    case "updateNote": Object.assign(findOr(d.notes, op.id, "catatan"), op.changes); return true;
    case "replyNote": findOr(d.notes, op.id, "catatan").replies.push({ by: op.by, text: op.text, at: Date.now() }); return true;
    case "removeNote": d.notes = d.notes.filter((n) => n.id !== op.id); return true;
    case "setSkill": d.skill = op.skill; return true;
  }
  return false;
}

/** Frame kata yang dirujuk aset/caption sebelum op dijalankan. */
export function anchorSnapshot(p: Project) {
  const ids = new Set<string>();
  for (const a of p.assets) if (a.anchorWordId) ids.add(a.anchorWordId);
  for (const c of p.captions) for (const w of c.words) if (w.wordId) ids.add(w.wordId);
  return ids.size ? { fps: p.sequence.fps, frames: wordFrames(p, ids) } : null;
}

/** Aset dan caption yang terikat kata ikut bergeser bila klip di depannya dipotong. Kata yang terbuang dihapus dari caption. */
export function reanchor(d: Project, snap: ReturnType<typeof anchorSnapshot>) {
  // Ganti fps sudah diskalakan rescaleContent; jangan digeser dua kali.
  if (!snap || snap.fps !== d.sequence.fps) return;
  const before = snap.frames;
  const after = wordFrames(d, new Set(before.keys()));
  for (const a of d.assets) {
    const b = a.anchorWordId ? before.get(a.anchorWordId) : undefined, n = a.anchorWordId ? after.get(a.anchorWordId) : undefined;
    if (b && n && n.start !== b.start) a.start = Math.max(0, a.start + n.start - b.start);
  }
  let emptied = false;
  for (const c of d.captions) {
    let changed = false;
    const kept: CaptionWord[] = [];
    for (const w of c.words) {
      const b = w.wordId ? before.get(w.wordId) : undefined, n = w.wordId ? after.get(w.wordId) : undefined;
      if (b && !n) { changed = true; continue; }
      if (b && n && n.start !== b.start) { const dlt = n.start - b.start; w.start = Math.max(0, w.start + dlt); w.end = Math.max(w.start + 1, w.end + dlt); changed = true; }
      kept.push(w);
    }
    if (changed) { c.words = kept; if (kept.length) captionBounds(c); else emptied = true; }
  }
  if (emptied) d.captions = d.captions.filter((c) => c.words.length);
}

/** Skala waktu konten saat fps sequence berubah. */
export function rescaleContent(p: Project, k: number) {
  const r = (x: number) => Math.round(x * k);
  for (const a of p.assets) { a.start = r(a.start); a.duration = Math.max(1, r(a.duration)); for (const f of a.keyframes as Keyframe[]) f.frame = r(f.frame); }
  for (const c of p.captions) { for (const w of c.words) { w.start = r(w.start); w.end = Math.max(w.start + 1, r(w.end)); } captionBounds(c); }
  for (const s of p.scenes) { s.start = r(s.start); s.end = Math.max(s.start + 1, r(s.end)); }
  for (const n of p.notes as Note[]) n.frame = r(n.frame);
}

export const contentEnd = (p: Project) => Math.max(0, ...p.assets.map((a) => a.start + a.duration), ...p.captions.map((c) => c.end));

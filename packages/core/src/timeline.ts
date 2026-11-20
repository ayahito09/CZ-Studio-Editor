// Operasi timeline ala Premiere di atas draft Immer. Semua waktu sequence dalam frame,
// waktu sumber dalam detik. Fungsi melempar OpError untuk permintaan yang tidak bisa dikerjakan.
import type { Clip, Project } from "./project.ts";

export class OpError extends Error {}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export const clipLen = (c: Clip, fps: number) => Math.max(1, Math.round((c.srcOut - c.srcIn) * fps));
export const clipEnd = (c: Clip, fps: number) => c.start + clipLen(c, fps);

export function recomputeDuration(p: Project) {
  const fps = p.sequence.fps;
  p.sequence.durationFrames = p.clips.reduce((m, c) => Math.max(m, clipEnd(c, fps)), 0);
}

/** Id baru berurutan (c1, c2, ...), deterministik supaya redo menghasilkan id yang sama. */
export function newId(existing: Iterable<string>, prefix: string): string {
  let max = 0;
  for (const id of existing) {
    if (id.startsWith(prefix)) { const n = Number(id.slice(prefix.length)); if (Number.isInteger(n) && n > max) max = n; }
  }
  return prefix + (max + 1);
}
const nextClipId = (p: Project) => newId(p.clips.map((c) => c.id), "c");
const nextLinkId = (p: Project) => newId(p.clips.flatMap((c) => (c.linkId ? [c.linkId] : [])), "l");

export function getClip(p: Project, id: string): Clip {
  const c = p.clips.find((x) => x.id === id);
  if (!c) throw new OpError(`klip ${id} tidak ada`);
  return c;
}

function assertUnlocked(p: Project, c: Clip) {
  const t = p.tracks.find((x) => x.id === c.trackId);
  if (t?.locked) throw new OpError(`track ${t.name} terkunci`);
}

const mediaDuration = (p: Project, c: Clip) => p.media.find((m) => m.id === c.mediaId)?.duration ?? c.srcOut;

/** Klip beserta pasangan link-nya (audio/video yang terhubung). */
export function withLinked(p: Project, ids: string[]): Clip[] {
  const base = ids.map((id) => getClip(p, id));
  const links = new Set(base.flatMap((c) => (c.linkId ? [c.linkId] : [])));
  const out = new Map(base.map((c) => [c.id, c]));
  for (const c of p.clips) if (c.linkId && links.has(c.linkId)) out.set(c.id, c);
  return [...out.values()];
}

const onTrack = (p: Project, trackId: string, except: Set<string> = new Set()) =>
  p.clips.filter((c) => c.trackId === trackId && !except.has(c.id)).sort((a, b) => a.start - b.start);

/** Mengosongkan rentang [s, e) di track: klip dipotong, dipendekkan, atau dihapus (overwrite / lift). */
export function clearRange(p: Project, trackId: string, s: number, e: number, except: Set<string> = new Set()) {
  const fps = p.sequence.fps;
  for (const c of onTrack(p, trackId, except)) {
    const end = clipEnd(c, fps);
    if (end <= s || c.start >= e) continue;
    if (c.start >= s && end <= e) {
      p.clips.splice(p.clips.indexOf(c), 1);
    } else if (c.start < s && end > e) {
      const right: Clip = { ...c, id: nextClipId(p), linkId: null, srcIn: r6(c.srcIn + (e - c.start) / fps), start: e };
      c.srcOut = r6(c.srcIn + (s - c.start) / fps);
      p.clips.push(right);
    } else if (c.start < s) {
      c.srcOut = r6(c.srcIn + (s - c.start) / fps);
    } else {
      c.srcIn = r6(c.srcIn + (e - c.start) / fps);
      c.start = e;
    }
  }
}

/** Menggeser semua klip yang mulai di atau setelah `from` pada track tersebut. */
function shiftAfter(p: Project, trackIds: Iterable<string>, from: number, delta: number, except: Set<string> = new Set()) {
  const ids = new Set(trackIds);
  for (const c of p.clips) if (ids.has(c.trackId) && !except.has(c.id) && c.start >= from) c.start = Math.max(0, c.start + delta);
}

export interface NewClip {
  trackId: string; mediaId: string; srcIn: number; srcOut: number; start: number;
  /** Klip dengan `link` yang sama dalam satu permintaan menjadi satu grup link. */
  link?: string; gainDb?: number; enabled?: boolean; fadeIn?: number; fadeOut?: number;
}

/** Menaruh klip baru dengan mode overwrite (tempel, duplikat, impor). */
export function addClips(p: Project, clips: NewClip[]): string[] {
  const fps = p.sequence.fps;
  const linkMap = new Map<string, string>();
  const ids: string[] = [];
  for (const n of clips) {
    const track = p.tracks.find((t) => t.id === n.trackId);
    if (!track || (track.kind !== "video" && track.kind !== "audio")) throw new OpError(`track ${n.trackId} tidak bisa diisi klip`);
    if (track.locked) throw new OpError(`track ${track.name} terkunci`);
    const media = p.media.find((m) => m.id === n.mediaId);
    if (!media) throw new OpError(`media ${n.mediaId} tidak ada`);
    if (track.kind === "audio" && !media.hasAudio) continue;
    const srcIn = Math.max(0, n.srcIn), srcOut = Math.min(media.duration, n.srcOut);
    if (!(srcOut - srcIn >= 1 / fps)) throw new OpError("klip lebih pendek dari 1 frame");
    let linkId: string | null = null;
    if (n.link) {
      linkId = linkMap.get(n.link) ?? null;
      if (!linkId) { linkId = nextLinkId(p); linkMap.set(n.link, linkId); }
    }
    const c: Clip = {
      id: nextClipId(p), trackId: n.trackId, mediaId: n.mediaId, srcIn: r6(srcIn), srcOut: r6(srcOut),
      start: Math.max(0, Math.round(n.start)), linkId, gainDb: n.gainDb ?? 0, enabled: n.enabled ?? true,
      fadeIn: n.fadeIn ?? 0, fadeOut: n.fadeOut ?? 0,
    };
    clearRange(p, c.trackId, c.start, clipEnd(c, fps));
    p.clips.push(c);
    ids.push(c.id);
  }
  // Link berisi satu klip saja (mis. media tanpa audio) tidak berguna.
  for (const id of linkMap.values()) {
    const members = p.clips.filter((c) => c.linkId === id);
    if (members.length < 2) for (const c of members) c.linkId = null;
  }
  return ids;
}

/** Pindah (overwrite di tujuan). trackShift: langkah ke track sejenis menurut urutan tampilan (-1 = ke atas). */
export function moveClips(p: Project, ids: string[], delta: number, trackShift = 0) {
  const fps = p.sequence.fps;
  const group = withLinked(p, ids);
  group.forEach((c) => assertUnlocked(p, c));
  const minStart = Math.min(...group.map((c) => c.start));
  delta = Math.max(delta, -minStart);

  const lead = getClip(p, ids[0]);
  const leadKind = p.tracks.find((t) => t.id === lead.trackId)!.kind;
  const sameKind = p.tracks.filter((t) => t.kind === leadKind);
  const targets = new Map<string, string>();
  for (const c of group) {
    const idx = sameKind.findIndex((t) => t.id === c.trackId);
    if (trackShift && idx >= 0 && ids.includes(c.id)) {
      const t = sameKind[idx + trackShift];
      if (!t) throw new OpError("tidak ada track di arah itu");
      if (t.locked) throw new OpError(`track ${t.name} terkunci`);
      targets.set(c.id, t.id);
    } else targets.set(c.id, c.trackId);
  }
  if (delta === 0 && [...targets].every(([id, t]) => getClip(p, id).trackId === t)) return;
  const moving = new Set(group.map((c) => c.id));
  for (const c of group) {
    c.start += delta;
    c.trackId = targets.get(c.id)!;
    clearRange(p, c.trackId, c.start, clipEnd(c, fps), moving);
  }
}

/** Trim tepi. ripple=false: dibatasi tetangga; ripple=true: klip setelahnya ikut bergeser. */
export function trimClip(p: Project, id: string, edge: "in" | "out", delta: number, ripple: boolean) {
  const fps = p.sequence.fps;
  const group = withLinked(p, [id]);
  group.forEach((c) => assertUnlocked(p, c));
  let lo = -Infinity, hi = Infinity;
  for (const c of group) {
    const len = clipLen(c, fps);
    const neighbours = onTrack(p, c.trackId, new Set(group.map((x) => x.id)));
    if (edge === "in") {
      lo = Math.max(lo, Math.ceil(-c.srcIn * fps - 1e-6)); // tidak sebelum awal file
      hi = Math.min(hi, len - 1);
      if (!ripple) {
        const prevEnd = Math.max(0, ...neighbours.filter((n) => n.start < c.start).map((n) => clipEnd(n, fps)));
        lo = Math.max(lo, prevEnd - c.start);
      }
    } else {
      hi = Math.min(hi, Math.floor((mediaDuration(p, c) - c.srcOut) * fps + 1e-6));
      lo = Math.max(lo, 1 - len);
      if (!ripple) {
        const nextStart = Math.min(Infinity, ...neighbours.filter((n) => n.start >= clipEnd(c, fps)).map((n) => n.start));
        hi = Math.min(hi, nextStart - clipEnd(c, fps));
      }
    }
  }
  const d = Math.max(lo, Math.min(hi, Math.round(delta)));
  if (!d) return;
  const tracks = new Set(group.map((c) => c.trackId));
  const except = new Set(group.map((c) => c.id));
  for (const c of group) {
    const oldEnd = clipEnd(c, fps);
    if (edge === "in") {
      c.srcIn = r6(c.srcIn + d / fps);
      if (!ripple) c.start += d;
    } else c.srcOut = r6(c.srcOut + d / fps);
    if (ripple && c === group[0]) shiftAfter(p, tracks, oldEnd, edge === "in" ? -d : d, except);
  }
}

const adjacentNext = (p: Project, c: Clip) => onTrack(p, c.trackId).find((n) => n.start === clipEnd(c, p.sequence.fps) && n.id !== c.id);
const adjacentPrev = (p: Project, c: Clip) => onTrack(p, c.trackId).find((n) => clipEnd(n, p.sequence.fps) === c.start && n.id !== c.id);

/** Rolling edit: menggeser titik potong antara klip ini dan klip tepat setelahnya. */
export function rollEdit(p: Project, leftId: string, delta: number) {
  const fps = p.sequence.fps;
  const pairs = withLinked(p, [leftId]).map((l) => [l, adjacentNext(p, l)] as const).filter((x): x is readonly [Clip, Clip] => !!x[1]);
  if (!pairs.length) throw new OpError("tidak ada klip yang bersambung di kanan");
  let lo = -Infinity, hi = Infinity;
  for (const [l, r] of pairs) {
    assertUnlocked(p, l); assertUnlocked(p, r);
    hi = Math.min(hi, Math.floor((mediaDuration(p, l) - l.srcOut) * fps + 1e-6), clipLen(r, fps) - 1);
    lo = Math.max(lo, 1 - clipLen(l, fps), Math.ceil(-r.srcIn * fps - 1e-6));
  }
  const d = Math.max(lo, Math.min(hi, Math.round(delta)));
  for (const [l, r] of pairs) {
    l.srcOut = r6(l.srcOut + d / fps);
    r.srcIn = r6(r.srcIn + d / fps);
    r.start += d;
  }
}

/** Slip: isi klip bergeser di dalam sumber, posisi dan panjang tetap. */
export function slipClip(p: Project, id: string, delta: number) {
  const fps = p.sequence.fps;
  const group = withLinked(p, [id]);
  let lo = -Infinity, hi = Infinity;
  for (const c of group) {
    assertUnlocked(p, c);
    lo = Math.max(lo, Math.ceil(-c.srcIn * fps - 1e-6));
    hi = Math.min(hi, Math.floor((mediaDuration(p, c) - c.srcOut) * fps + 1e-6));
  }
  const d = Math.max(lo, Math.min(hi, Math.round(delta)));
  for (const c of group) { c.srcIn = r6(c.srcIn + d / fps); c.srcOut = r6(c.srcOut + d / fps); }
}

/** Slide: klip bergeser, tetangga kiri memanjang/memendek, tetangga kanan menyesuaikan. */
export function slideClip(p: Project, id: string, delta: number) {
  const fps = p.sequence.fps;
  const items = withLinked(p, [id]).map((c) => ({ c, prev: adjacentPrev(p, c), next: adjacentNext(p, c) }));
  let lo = -Infinity, hi = Infinity;
  for (const { c, prev, next } of items) {
    assertUnlocked(p, c);
    if (prev) { lo = Math.max(lo, 1 - clipLen(prev, fps)); hi = Math.min(hi, Math.floor((mediaDuration(p, prev) - prev.srcOut) * fps + 1e-6)); }
    else lo = Math.max(lo, -c.start);
    if (next) { hi = Math.min(hi, clipLen(next, fps) - 1); lo = Math.max(lo, Math.ceil(-next.srcIn * fps - 1e-6)); }
  }
  const d = Math.max(lo, Math.min(hi, Math.round(delta)));
  if (!d) return;
  for (const { c, prev, next } of items) {
    if (prev) prev.srcOut = r6(prev.srcOut + d / fps);
    if (next) { next.srcIn = r6(next.srcIn + d / fps); next.start += d; }
    c.start += d;
  }
}

/** Razor. Tanpa ids: semua klip di bawah frame pada track yang tidak terkunci. */
export function splitAt(p: Project, frame: number, ids?: string[]) {
  const fps = p.sequence.fps;
  const locked = new Set(p.tracks.filter((t) => t.locked).map((t) => t.id));
  const targets = (ids ? withLinked(p, ids) : p.clips.filter((c) => !locked.has(c.trackId)))
    .filter((c) => c.start < frame && clipEnd(c, fps) > frame);
  if (ids) targets.forEach((c) => assertUnlocked(p, c));
  const newLinks = new Map<string, string>();
  let nextLink = Number(nextLinkId(p).slice(1));
  for (const c of targets) {
    let linkId: string | null = null;
    if (c.linkId) {
      linkId = newLinks.get(c.linkId) ?? null;
      if (!linkId) { linkId = "l" + nextLink++; newLinks.set(c.linkId, linkId); }
    }
    const cut = r6(c.srcIn + (frame - c.start) / fps);
    p.clips.push({ ...c, id: nextClipId(p), srcIn: cut, start: frame, linkId, fadeIn: 0 });
    c.srcOut = cut;
    c.fadeOut = 0;
  }
  return targets.length;
}

/** Hapus klip (lift) atau ripple delete (celah ditutup pada track yang sama). */
export function deleteClips(p: Project, ids: string[], ripple: boolean) {
  const fps = p.sequence.fps;
  const group = withLinked(p, ids);
  group.forEach((c) => assertUnlocked(p, c));
  const removed = group.map((c) => ({ trackId: c.trackId, start: c.start, len: clipLen(c, fps) }));
  for (const c of group) p.clips.splice(p.clips.indexOf(c), 1);
  if (!ripple) return;
  // Dari belakang ke depan supaya pergeseran tidak saling mengganggu.
  removed.sort((a, b) => b.start - a.start);
  for (const r of removed) shiftAfter(p, [r.trackId], r.start + r.len, -r.len);
}

/** Lift (ripple=false) atau extract (ripple=true) rentang in/out di semua track yang tidak terkunci. */
export function deleteRange(p: Project, s: number, e: number, ripple: boolean) {
  if (!(e > s)) throw new OpError("titik out harus setelah titik in");
  const tracks = p.tracks.filter((t) => !t.locked && (t.kind === "video" || t.kind === "audio")).map((t) => t.id);
  for (const t of tracks) clearRange(p, t, s, e);
  if (ripple) shiftAfter(p, tracks, e, -(e - s));
}

/** Mengubah fps sequence: posisi klip ikut diskalakan supaya tetap di detik yang sama. */
export function rescaleFps(p: Project, newFps: number) {
  const old = p.sequence.fps;
  if (old === newFps) return;
  for (const c of p.clips) c.start = Math.round((c.start * newFps) / old);
  for (const m of p.markers) m.frame = Math.round((m.frame * newFps) / old);
  p.sequence.fps = newFps;
}

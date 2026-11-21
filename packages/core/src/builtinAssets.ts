// Helper aset yang dipakai bersama (aset skill, penempatan di area aman). Katalog elemen bawaan CZ TIDAK ada di paket publik:
// elemen datang dari paket lokal milik developer (<pustaka>/Paket/<id>/pack.json + pack.js), lihat apps/server/src/packs.ts.
import type { AssetDef, ParamDef } from "./skill.ts";

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
    id: skillAssetId(compositionId), component: skillAssetId(compositionId), name, category: "skill", version: 1, params, tree: [],
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

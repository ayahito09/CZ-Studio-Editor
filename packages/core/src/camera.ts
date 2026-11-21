// Kamera yang mengikuti isi ucapan: dorong halus ke arah wajah di kata penting, tahan, lalu KELUAR kembali ke bingkai awal.
// Tiap gerak punya masuk, tahan, dan keluar, jadi kamera tidak pernah menumpuk zoom terus dan tiap scene berakhir netral.
import type { CameraMove, SceneCamera } from "./project.ts";

export interface CamWord { start: number; end: number; emphasis: boolean }
export interface CamInput {
  /** Panjang scene (frame) dan fps. */
  duration: number; fps: number;
  /** Kata di scene, frame relatif awal scene. emphasis = kata yang ditekankan (aksen caption atau kata kunci). */
  words: CamWord[];
  /** Pusat wajah sebagai selisih piksel dari tengah bingkai (+x kanan, +y bawah); null = tidak diketahui. */
  face?: { x: number; y: number } | null;
  /** Pusat wajah pada frame tertentu (relatif awal scene), dari mesin wajah CZ; mengalahkan `face`. */
  faceAt?: (f: number) => { x: number; y: number } | null;
}

const clampPx = (v: number, m: number) => Math.max(-m, Math.min(m, v));

/** Gerak kamera dari isi scene. Pure: input sama, hasil sama. */
export function cameraFromContent(o: CamInput): SceneCamera {
  const { fps, duration } = o;
  const inDur = Math.round(0.8 * fps), outDur = Math.round(0.8 * fps), lead = Math.round(0.3 * fps);
  const edge = Math.round(0.35 * fps), gap = Math.round(1.2 * fps);
  // Titik tekan: kata beremphasis; bila tidak ada dan scene cukup panjang, satu dorong di sekitar 35% scene.
  let marks = o.words.filter((w) => w.emphasis);
  if (!marks.length && duration >= 2.5 * fps) {
    const t = Math.round(duration * 0.35);
    marks = [o.words.find((w) => w.end >= t) ?? { start: t, end: t + fps, emphasis: true }];
  }
  const moves: CameraMove[] = [];
  let free = edge; // frame paling awal untuk gerak berikutnya (gerak sebelumnya sudah kembali)
  marks.forEach((w, i) => {
    const at = Math.max(free, w.start - lead);
    const hold = Math.max(Math.round(0.25 * fps), w.end - (at + inDur)) + Math.round(0.15 * fps);
    const total = inDur + hold + outDur;
    if (at + total > duration - edge) return; // tidak muat: scene harus berakhir di bingkai awal
    const kind = i % 3; // dorong ke wajah, geser menyisir, dorong dalam
    const fc = o.faceAt?.(at + inDur) ?? o.face; // wajah saat kamera sampai di puncak
    const fx = fc?.x ?? 0, fy = fc?.y ?? 0;
    const m: CameraMove = { at, dur: inDur, hold, out: outDur, ease: "move" };
    if (kind === 1) { m.zoom = 1.04; m.x = (i % 2 ? -1 : 1) * 26; }
    else { m.zoom = kind === 0 ? 1.07 : 1.12; m.x = clampPx(fx * 0.3, 48); m.y = clampPx(fy * 0.3, 48); }
    moves.push(m);
    free = at + total + gap;
  });
  return { moves, drift: true };
}

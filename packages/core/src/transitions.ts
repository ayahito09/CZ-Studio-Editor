// Transisi dan SFX di sambungan potongan tanpa rencana dan tanpa Claude: mesin CZ memasangnya otomatis di tiap sambungan footage,
// user bisa mengganti jenis atau bunyinya (jadi entri milik user, tidak ditimpa mesin), atau mematikannya ("Potong" + tanpa bunyi).
import type { BaseTransition, Project, TransitionKind } from "./project.ts";
import { clipEnd } from "./timeline.ts";

/** Peran SFX bawaan CZ (disintesis ffmpeg saat cz install); nama sama dengan SFX di server. */
export const BUILTIN_SFX_ROLES = ["woosh", "woosh-besar", "riser", "impak", "tombol", "klik", "ketik", "kunci", "kilau", "notif", "kertas", "shutter", "glitch"] as const;

/** Bunyi bawaan tiap jenis transisi (dipakai bila entri tidak menentukan sfx). */
export const TRANS_SFX: Record<string, string> = { blur: "woosh", collapse: "woosh", whip: "woosh-besar", zoom: "woosh-besar", flash: "impak" };

/** Bunyi masuk bawaan untuk aset yang baru dipasang (aset bawaan CZ saja). */
const ASSET_SFX: Record<string, string> = { "cz.notif": "notif", "cz.chat": "ketik", "cz.ikon": "kilau", "cz.angka": "tombol", "cz.countdown": "tombol" };
export const defaultAssetSfx = (defId: string | null): string | null => (defId?.startsWith("cz.") ? ASSET_SFX[defId] ?? "woosh" : null);

/** Bunyi yang benar-benar diputar di sambungan: sfx milik entri bila diatur (null = diam), kalau tidak bunyi bawaan jenisnya. */
export const transSfxRole = (t: { kind: TransitionKind; sfx?: string | null }): string | null => (t.sfx !== undefined ? t.sfx : TRANS_SFX[t.kind] ?? null);

const AUTO_CYCLE: TransitionKind[] = ["blur", "whip", "blur", "zoom"];
const transFrames = (fps: number) => Math.max(2, Math.round(0.35 * fps));

/** Mesin CZ: transisi pendek (±0,35 dtk) di sambungan `joins` (frame sequence), jenis bergilir, jarak antar-transisi ≥ 2 dtk
 *  (juga terhadap `taken`, sambungan yang sudah punya entri) supaya tidak ramai. Pure: input sama, hasil sama. */
export function autoTransitions(joins: number[], fps: number, taken: number[] = []): BaseTransition[] {
  const out: BaseTransition[] = [];
  const gap = Math.round(2 * fps);
  const used = [...taken];
  for (const at of [...joins].sort((a, b) => a - b)) {
    if (at <= 0 || used.some((u) => Math.abs(u - at) < gap)) continue;
    out.push({ at, kind: AUTO_CYCLE[out.length % AUTO_CYCLE.length], frames: transFrames(fps) });
    used.push(at);
  }
  return out;
}

/** Frame tempat potongan V1 menyambung ke potongan sebelumnya (tanpa celah). */
export function videoJoins(p: Pick<Project, "clips" | "sequence">): number[] {
  const v1 = p.clips.filter((c) => c.trackId === "V1" && c.enabled);
  const ends = new Set(v1.map((c) => clipEnd(c, p.sequence.fps)));
  return [...new Set(v1.map((c) => c.start))].filter((f) => f > 0 && ends.has(f)).sort((a, b) => a - b);
}

/** Ganti entri milik user di `joins`: jenis `kind` (jenis "cut" disimpan sebagai entri "Potong" supaya mesin tidak memasang ulang). */
export function setTransitionsAt(cur: BaseTransition[] | undefined, joins: number[], kind: TransitionKind, fps: number): BaseTransition[] {
  const keep = (cur ?? []).filter((t) => !joins.includes(t.at));
  const old = new Map((cur ?? []).map((t) => [t.at, t]));
  return [...keep, ...joins.filter((at) => at > 0).map((at) => {
    const sfx = old.get(at)?.sfx;
    return { at, kind, frames: kind === "cut" ? 0 : transFrames(fps), ...(sfx !== undefined ? { sfx } : {}) };
  })].sort((a, b) => a.at - b.at);
}

/** Menjaga transisi + SFX otomatis tetap sesuai sambungan footage saat ini (dipanggil dari applyOp bila project.autoFx).
 *  Entri milik user dipertahankan selama sambungannya masih ada; sisanya dipasang mesin. Idempotent. */
export function syncAutoFx(d: Project) {
  const joins = videoJoins(d);
  const user = (d.transitions ?? []).filter((t) => !t.auto && joins.includes(t.at));
  const auto = autoTransitions(joins.filter((f) => !user.some((t) => t.at === f)), d.sequence.fps, user.map((t) => t.at)).map((t) => ({ ...t, auto: true }));
  const next = [...user.map((t) => ({ ...t })), ...auto].sort((a, b) => a.at - b.at);
  if (JSON.stringify(next) !== JSON.stringify(d.transitions ?? [])) d.transitions = next;
}

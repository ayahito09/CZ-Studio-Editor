// Analisis murni untuk potong jeda, transkrip, dan caption. Tidak menyentuh disk; mudah dites.
import type { Caption, CaptionWord, Cut, CutKind, Project, Word } from "./project.ts";

export interface SilenceOptions {
  /** Celah lebih pendek tidak dipotong (detik). */
  minGap: number;
  /** Napas yang disisakan sebelum dan sesudah kata (detik). */
  padding: number;
  /** null = otomatis dari noise floor. */
  thresholdDb: number | null;
}
export const DEFAULT_SILENCE: SilenceOptions = { minGap: 0.45, padding: 0.3, thresholdDb: null };

/** Ambang otomatis: noise floor (persentil 10) + 12 dB, dijaga di -60…-28 dBFS. */
export function autoThreshold(envDb: ArrayLike<number>): number {
  const xs = Array.from(envDb).filter((x) => x > -99).sort((a, b) => a - b);
  if (!xs.length) return -45;
  return Math.max(-60, Math.min(-28, xs[Math.floor(xs.length * 0.1)] + 12));
}

/**
 * Wilayah yang dibuang (detik sumber, sudah dikurangi padding).
 * envDb: level RMS dBFS per jendela, `rate` jendela per detik.
 */
export function detectSilences(envDb: ArrayLike<number>, rate: number, duration: number, opts: SilenceOptions = DEFAULT_SILENCE) {
  const thr = opts.thresholdDb ?? autoThreshold(envDb);
  const out: { srcStart: number; srcEnd: number }[] = [];
  const minCut = 0.05;
  let i = 0;
  while (i < envDb.length) {
    if (envDb[i] >= thr) { i++; continue; }
    let j = i;
    while (j < envDb.length && envDb[j] < thr) j++;
    const gs = i / rate, ge = Math.min(duration, j / rate);
    if (ge - gs >= opts.minGap) {
      // Di awal/akhir file tidak ada kata di sisi luar, jadi padding hanya di sisi kata.
      const s = i === 0 ? 0 : gs + opts.padding;
      const e = j >= envDb.length ? duration : ge - opts.padding;
      if (e - s >= minCut) out.push({ srcStart: round3(s), srcEnd: round3(e) });
    }
    i = j;
  }
  return { threshold: thr, regions: out };
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
export const normWord = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const FILLERS = new Set(["eh", "ehm", "em", "emm", "hmm", "hm", "anu", "eee", "ee", "uh", "um", "uhm", "umm", "ah", "erm"]);

/** Usulan kata isian dan ulangan (kuning). Tidak pernah dipotong otomatis. */
export function suggestFillers(words: Word[]): { kind: CutKind; mediaId: string; srcStart: number; srcEnd: number; reason: string }[] {
  const out: { kind: CutKind; mediaId: string; srcStart: number; srcEnd: number; reason: string }[] = [];
  const ws = [...words].sort((a, b) => (a.mediaId === b.mediaId ? a.srcStart - b.srcStart : a.mediaId < b.mediaId ? -1 : 1));
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i], n = normWord(w.text);
    if (FILLERS.has(n)) { out.push({ kind: "isian", mediaId: w.mediaId, srcStart: w.srcStart, srcEnd: w.srcEnd, reason: `kata isian "${w.text.trim()}"` }); continue; }
    const next = ws[i + 1];
    if (next && next.mediaId === w.mediaId && n && normWord(next.text) === n) {
      out.push({ kind: "ulangan", mediaId: w.mediaId, srcStart: w.srcStart, srcEnd: next.srcStart, reason: `kata diulang "${w.text.trim()}"` });
      continue;
    }
    // Dua kata yang diulang: "kita bisa kita bisa".
    const [b, c, d] = [ws[i + 1], ws[i + 2], ws[i + 3]];
    if (b && c && d && [b, c, d].every((x) => x.mediaId === w.mediaId) && n && n === normWord(c.text) && normWord(b.text) === normWord(d.text)) {
      out.push({ kind: "ulangan", mediaId: w.mediaId, srcStart: w.srcStart, srcEnd: c.srcStart, reason: `frasa diulang "${w.text.trim()} ${b.text.trim()}"` });
      i++;
    }
  }
  return out;
}

export interface CutProblem { cutId: string; kind: "kata-terpotong" | "klik"; at: number; detail: string }

/** Pemeriksaan setelah potong: kata yang terbelah potongan, dan lonjakan level > 6 dB di sambungan. */
export function checkCuts(cuts: Cut[], words: Word[], env?: { mediaId: string; db: ArrayLike<number>; rate: number }[]): CutProblem[] {
  const out: CutProblem[] = [];
  for (const c of cuts) {
    for (const w of words) {
      if (w.mediaId !== c.mediaId) continue;
      const overlaps = w.srcStart < c.srcEnd && w.srcEnd > c.srcStart;
      const inside = w.srcStart >= c.srcStart - 1e-3 && w.srcEnd <= c.srcEnd + 1e-3;
      if (overlaps && !inside) out.push({ cutId: c.id, kind: "kata-terpotong", at: c.srcStart, detail: `kata "${w.text.trim()}" terpotong` });
    }
    const e = env?.find((x) => x.mediaId === c.mediaId);
    if (e) {
      const before = e.db[Math.max(0, Math.floor(c.srcStart * e.rate) - 1)] ?? -100;
      const after = e.db[Math.min(e.db.length - 1, Math.ceil(c.srcEnd * e.rate))] ?? -100;
      if (Math.abs(before - after) > 6 && Math.max(before, after) > autoThreshold(e.db)) {
        out.push({ cutId: c.id, kind: "klik", at: c.srcStart, detail: `lonjakan ${Math.abs(before - after).toFixed(1)} dB di sambungan` });
      }
    }
  }
  return out;
}

/** Detik sumber → frame sequence lewat klip footage (V1, lalu audio). null bila bagian itu sudah dipotong. */
export function srcToSeq(p: Project, mediaId: string, sec: number): number | null {
  const fps = p.sequence.fps;
  const clips = p.clips.filter((c) => c.mediaId === mediaId && c.enabled && c.srcIn <= sec + 1e-6 && c.srcOut > sec);
  const c = clips.find((x) => x.trackId === "V1") ?? clips[0];
  return c ? c.start + Math.round((sec - c.srcIn) * fps) : null;
}

/** Frame sequence tiap kata yang masih terlihat. */
export function wordFrames(p: Project, ids?: Set<string>): Map<string, { start: number; end: number }> {
  const out = new Map<string, { start: number; end: number }>();
  for (const w of p.transcript.words) {
    if (ids && !ids.has(w.id)) continue;
    const s = srcToSeq(p, w.mediaId, w.srcStart);
    if (s === null) continue;
    const e = srcToSeq(p, w.mediaId, Math.max(w.srcStart, w.srcEnd - 1e-3));
    out.set(w.id, { start: s, end: Math.max(s + 1, (e ?? s) + 1) });
  }
  return out;
}

/** Caption per blok dari transkrip: pecah di tanda baca akhir, jeda > 0,6 dtk, atau batas jumlah kata. */
export function buildCaptions(p: Project, maxWords = 4): Omit<Caption, "id">[] {
  const fps = p.sequence.fps;
  const frames = wordFrames(p);
  const visible = p.transcript.words.filter((w) => frames.has(w.id))
    .map((w) => ({ w, ...frames.get(w.id)! })).sort((a, b) => a.start - b.start);
  const out: Omit<Caption, "id">[] = [];
  let cur: CaptionWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ trackId: "V2", start: cur[0].start, end: cur.at(-1)!.end, words: cur, style: {}, position: { preset: "bawah" } });
    cur = [];
  };
  for (let i = 0; i < visible.length; i++) {
    const v = visible[i];
    const prev = cur.at(-1);
    if (prev && (v.start - prev.end > 0.6 * fps || cur.length >= maxWords)) flush();
    cur.push({ wordId: v.w.id, text: v.w.text.trim(), start: v.start, end: v.end, style: "normal" });
    if (/[.!?…]$/.test(v.w.text.trim())) flush();
  }
  flush();
  // Blok berurutan tidak saling tumpang.
  for (let i = 0; i + 1 < out.length; i++) out[i].end = Math.min(out[i].end, out[i + 1].start);
  return out.filter((c) => c.end > c.start);
}

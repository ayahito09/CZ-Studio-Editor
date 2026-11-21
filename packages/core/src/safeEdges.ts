// Pelindung area aman atas/bawah (di bawah teks dan elemen): gradasi gelap, blur, atau kontras. Disimpan di scene.custom.safe.
export type EdgeMode = "mati" | "gelap" | "blur" | "kontras" | "gelap+blur";
export interface Edge { mode: EdgeMode; /** 0..1 */ strength: number; /** tinggi pelindung, 0.05..0.5 dari tinggi bingkai */ size: number }
export interface SafeEdges { top?: Edge; bottom?: Edge }
export const EDGE_MODES: { id: EdgeMode; label: string }[] = [
  { id: "mati", label: "Mati" }, { id: "gelap", label: "Gelap" }, { id: "blur", label: "Blur" }, { id: "kontras", label: "Kontras" }, { id: "gelap+blur", label: "Gelap + blur" },
];
/** Bawaan: tinggi mengikuti area aman 9:16 (atas 220, bawah 400 dari 1920). */
export const EDGE_DEFAULT: Record<"top" | "bottom", Edge> = {
  top: { mode: "mati", strength: 0.5, size: 0.14 }, bottom: { mode: "mati", strength: 0.5, size: 0.24 },
};
/** Mesin CZ: pelindung gelap + blur setinggi area aman 9:16 di atas dan bawah. */
export const EDGE_AUTO: Required<SafeEdges> = {
  top: { mode: "gelap+blur", strength: 0.5, size: EDGE_DEFAULT.top.size }, bottom: { mode: "gelap+blur", strength: 0.5, size: EDGE_DEFAULT.bottom.size },
};
const clamp =(v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export function safeEdgesOf(custom: unknown): Record<"top" | "bottom", Edge> {
  const raw = (custom && typeof custom === "object" ? (custom as Record<string, unknown>).safe : null) as Record<string, Record<string, unknown>> | null;
  const one = (k: "top" | "bottom"): Edge => {
    const r = raw?.[k], d = EDGE_DEFAULT[k];
    return { mode: EDGE_MODES.some((m) => m.id === r?.mode) ? (r!.mode as EdgeMode) : d.mode, strength: clamp(r?.strength, 0, 1, d.strength), size: clamp(r?.size, 0.05, 0.5, d.size) };
  };
  return { top: one("top"), bottom: one("bottom") };
}

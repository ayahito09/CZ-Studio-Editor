// Mesin gerak wajib CZ (dari kit zahran-ui-motion, MIT; lihat LICENSE-zahran-ui-motion.txt).
// Dipakai renderer CZ sendiri (caption, aset, kamera, transisi, motion blur) dan disediakan ke komponen skill
// sebagai modul "cz-motion", supaya semua editan memakai kurva, follow-through, dan kamera yang sama.
import { Easing } from "remotion";
import { EASE_PRO, SPRING_PRO, type Ease } from "./curves.ts";
import { springEase } from "./Move.tsx";

export * from "./curves.ts";
export * from "./keyed.ts";
export * from "./timeline.ts";
export * from "./CameraRig.tsx";
export * from "./Move.tsx";
export * from "./MotionBlur.tsx";
export * from "./Transitions.tsx";
export * from "./Type.tsx";
export * from "./Elements.tsx";
export * from "./flow.ts";
export * from "./Pixels.tsx";
export * from "./TextFx.tsx";
export * from "./Field.tsx";
export * from "./TextPro.tsx";

/** Font UI lokal (tanpa Google Fonts: CZ lokal penuh). */
export const FONT = {
  ui: `Inter, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`,
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;

/** Nama kurva yang boleh disimpan di proyek (daftarnya di core: CURVES), diterjemahkan ke fungsi easing mesin. */
export { CURVES, type CurveName } from "@cz/core";
/** Kurva lembut "blur → tajam" (Clean Editing): masuk ease-in-out halus, keluar ease-in lembut. */
const GENTLE: Ease = Easing.bezier(0.42, 0, 0.18, 1);
const GENTLE_OUT: Ease = Easing.bezier(0.45, 0, 0.75, 0.6);
export const curve = (name: string | null | undefined, fallback: Ease = EASE_PRO.enter): Ease => {
  switch (name) {
    case "move": case "moveSoft": case "enter": case "enterSnap": case "exit": case "exitHard": case "drift": case "linear":
      return EASE_PRO[name];
    case "gentle": return GENTLE;
    case "gentleOut": return GENTLE_OUT;
    case "spring": return springEase(SPRING_PRO.morph, 14);
    case "pop": return springEase(SPRING_PRO.pop, 12);
    // nama lama renderer CZ
    case "snappy": return EASE_PRO.enterSnap;
    case "bounce": return springEase(SPRING_PRO.pop, 12);
    default: return fallback;
  }
};

/** TEMPO: durasi ditulis sebagai frame desain @30 fps, diskalakan ke fps nyata × k (k < 1 = lebih cepat, > 1 = lebih tenang). */
export const tempo = (fps: number, k = 1) => (n: number) => (n <= 0 ? 0 : Math.max(1, Math.round((n * fps * k) / 30)));

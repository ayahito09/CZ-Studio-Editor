// Renderer CZ sendiri di atas mesin gerak wajib (./motion): kamera aditif yang tidak pernah berhenti, transisi scene,
// pose masuk/keluar aset dan kata caption dengan follow-through, dan masker frame bergerak untuk motion blur render.
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, Html5Audio, Sequence, useCurrentFrame } from "remotion";
import { skillSegments, type AssetDef, type Project, type Scene } from "@cz/core";
import {
  CameraRig, EASE_PRO, camState, clamp01, curve, enter, exit, lerp, pop, tempo, type CamMove, type CamOpts, type K, type Shake,
} from "./motion/index.ts";

/* ---------------- kamera ---------------- */

/** Opsi kamera mesin untuk satu scene, dalam frame sequence absolut. */
export function camOptsOf(sc: Scene, fps: number): CamOpts {
  const c = sc.camera;
  const keys: K[] = [];
  if (c && (c.from !== undefined || c.to !== undefined)) {
    keys.push({ f: sc.start, zoom: c.from ?? 1 }, { f: sc.end, zoom: c.to ?? c.from ?? 1, ease: EASE_PRO.moveSoft });
  }
  const moves: CamMove[] = (c?.moves ?? []).map((m) => ({ ...m, at: sc.start + m.at, ease: curve(m.ease, EASE_PRO.move) }));
  const shake: Shake[] = (c?.shake ?? []).map((s) => ({ ...s, at: sc.start + s.at }));
  return { keys, moves, shake, drift: {}, fps };
}

/** Drift dasar: napas zoom ±1,2% berperiode 14 dtk dari waktu GLOBAL, jadi sama di kedua sisi potongan dan tidak membesar terus. */
export const driftZoom = (f: number, fps: number) => 1 + 0.024 * (0.5 - 0.5 * Math.cos((2 * Math.PI * f) / (14 * fps)));

/** Footage di bawah kamera mesin: key/gerak aditif/shake per scene + drift + warisan posisi dari scene sebelumnya. */
export function Camera({ project, children }: { project: Project; children: ReactNode }) {
  const f = useCurrentFrame();
  const fps = project.sequence.fps;
  const T = tempo(fps);
  const scenes = project.scenes;
  const i = scenes.findIndex((s) => f >= s.start && f < s.end);
  const sc = i >= 0 ? scenes[i] : null;
  const o = sc ? camOptsOf(sc, fps) : { fps };
  const drift = !sc || sc.camera?.drift !== false;
  // Kamera mewarisi posisi akhir scene sebelumnya lalu kembali ke posisinya sendiri (EASE_PRO.move), kecuali ada transisi besar.
  const prev = i > 0 ? scenes[i - 1] : null;
  const carry = prev && sc && (!sc.transition || sc.transition.kind === "cut" || sc.transition.kind === "blur");
  const a = carry ? camState(prev.end - 1, camOptsOf(prev, fps)) : null;
  const b = carry ? camState(sc.start, o) : null;
  const dur = T(16);
  const extra = (fr: number) => {
    const z = drift ? driftZoom(fr, fps) : 1;
    if (!a || !b || !sc) return { zoom: z };
    const e = 1 - EASE_PRO.move(clamp01((fr - sc.start) / dur));
    return { zoom: z * Math.pow(a.zoom / b.zoom, e), cx: (a.cx - b.cx) * e, cy: (a.cy - b.cy) * e, rot: (a.rot - b.rot) * e };
  };
  return <CameraRig {...o} extra={extra} raster={1}>{children}</CameraRig>;
}

/* ---------------- transisi scene ---------------- */

/** Gaya lapisan visual saat transisi: paruh pertama di ekor scene sebelumnya (keluar, berakhir di kecepatan puncak),
 *  paruh kedua di kepala scene berikutnya (masuk, mendarat lembut). Scene yang digambar skill memakai transisinya sendiri. */
export function transitionAt(project: Project, f: number): { style: CSSProperties; flash: number } {
  const k = project.sequence.width / 1080;
  for (let i = 1; i < project.scenes.length; i++) {
    const s = project.scenes[i], prev = project.scenes[i - 1];
    const t = s.transition;
    if (!t || t.kind === "cut" || t.frames < 2 || s.skill || prev.skill) continue;
    const half = Math.floor(t.frames / 2), rest = t.frames - half, b = s.start;
    if (f >= b - half && f < b) {
      const p = (t.kind === "zoom" ? EASE_PRO.exitHard : EASE_PRO.exit)(clamp01((f - (b - half) + 1) / half));
      switch (t.kind) {
        case "blur": return { style: { filter: `blur(${24 * k * p}px)` }, flash: 0 };
        case "whip": return { style: { transform: `translateX(${-540 * k * p}px)`, filter: `blur(${36 * k * p}px)` }, flash: 0 };
        case "zoom": return { style: { transform: `scale(${1 + 1.2 * p})`, filter: `blur(${14 * k * p}px)` }, flash: 0 };
        case "collapse": return { style: { transform: `scale(${1 - 0.3 * p})`, filter: `blur(${10 * k * p}px)`, opacity: 1 - Math.max(0, p - 0.8) * 5 }, flash: 0 };
        case "flash": return { style: {}, flash: p };
      }
    }
    if (f >= b && f < b + rest) {
      const p = clamp01((f - b + 1) / rest), q = 1 - EASE_PRO.enterSnap(p);
      switch (t.kind) {
        case "blur": return { style: { filter: `blur(${24 * k * (1 - EASE_PRO.enter(p))}px)` }, flash: 0 };
        case "whip": return { style: { transform: `translateX(${540 * k * q}px)`, filter: `blur(${36 * k * q}px)` }, flash: 0 };
        case "zoom": return { style: { transform: `scale(${1 - 0.12 * q})`, filter: `blur(${12 * k * q}px)` }, flash: 0 };
        case "collapse": return { style: { transform: `scale(${1 - 0.4 * q})`, filter: `blur(${12 * k * q}px)`, opacity: Math.min(1, p * 4) }, flash: 0 };
        case "flash": return { style: {}, flash: 1 - EASE_PRO.exit(p) };
      }
    }
  }
  return { style: {}, flash: 0 };
}

/** Wajib SFX di setiap gerak besar: transisi scene memakai SFX bawaan CZ (bila ada pustaka skill sebagai sumber berkas). */
const TRANS_SFX: Record<string, string> = { blur: "woosh", collapse: "woosh", whip: "woosh-besar", zoom: "woosh-besar", flash: "impak" };
export function TransitionSfx({ project, base }: { project: Project; base: string | null }) {
  if (!base || project.tracks.find((t) => t.id === "A2")?.muted) return null;
  const fps = project.sequence.fps;
  return (
    <>
      {project.scenes.map((s, i) => {
        const t = s.transition, prev = project.scenes[i - 1];
        const role = t && t.frames >= 2 ? TRANS_SFX[t.kind] : undefined;
        if (!role || !prev || s.skill || prev.skill) return null;
        // puncak woosh jatuh di tengah transisi
        const from = Math.max(0, s.start - Math.floor(t!.frames / 2) - Math.round(fps * 0.12));
        return (
          <Sequence key={s.id} from={from} durationInFrames={fps * 2} layout="none">
            <Html5Audio src={`${base}__cz/sfx/${role}.wav`} volume={0.6} />
          </Sequence>
        );
      })}
    </>
  );
}

/** Lapisan transisi. Frame dibaca DI DALAM lapisan (bukan dari induknya) supaya tiap sampel motion blur mendapat
 *  waktunya sendiri: whip/zoom tersapu sepanjang jalurnya. */
export function TransitionLayer({ project, children }: { project: Project; children: ReactNode }) {
  const t = transitionAt(project, useCurrentFrame());
  return (
    <>
      <AbsoluteFill style={t.style}>{children}</AbsoluteFill>
      {t.flash > 0.01 && <AbsoluteFill style={{ background: "#fff", opacity: 0.9 * t.flash, pointerEvents: "none" }} />}
    </>
  );
}

/* ---------------- aset ---------------- */

type Dir = "up" | "down" | "left" | "right" | "none";
const PRESET_DIR: Record<string, { dir: Dir; dist: number; blur: number; scale?: number }> = {
  fade: { dir: "none", dist: 0, blur: 0, scale: 1 },
  blurRise: { dir: "up", dist: 40, blur: 16 },
  blurFade: { dir: "none", dist: 0, blur: 14, scale: 1 },
  scaleIn: { dir: "none", dist: 0, blur: 8, scale: 0.85 },
  slideUp: { dir: "up", dist: 120, blur: 12 },
  slideDown: { dir: "down", dist: 120, blur: 12 },
  slideLeft: { dir: "left", dist: 160, blur: 12 },
  slideRight: { dir: "right", dist: 160, blur: 12 },
  wipe: { dir: "none", dist: 0, blur: 0, scale: 1 },
};

/** Key masuk/keluar aset dari preset (mesin: opasitas dulu, blur menyusul, posisi lalu skala menetap terakhir;
 *  keluar berakselerasi dan berakhir di kecepatan puncak). Durasi dalam frame nyata. */
export function assetKeys(inP: string | null, outP: string | null, duration: number, inF: number, outF: number, curveName?: string): K[] {
  const keys: K[] = [];
  if (inP === "pop") keys.push(...pop(0, { dur: inF }));
  else if (inP && PRESET_DIR[inP]) {
    const d = PRESET_DIR[inP];
    keys.push(...enter(0, { dir: d.dir, dist: d.dist, dur: inF, blur: d.blur, scale: d.scale ?? 0.92, ease: curve(curveName, EASE_PRO.enter) }));
  }
  if (outP) {
    const d = PRESET_DIR[outP] ?? { dir: "none" as Dir, dist: 0, blur: 0, scale: 0.9 };
    keys.push(...exit(Math.max(0, duration - outF), { dir: d.dir, dist: d.dist || 0, dur: Math.min(outF, duration), scale: outP === "pop" ? 0.5 : d.scale ?? 0.9 }));
  }
  return keys;
}

/** Wipe tidak punya padanan gerak: dibuka dengan clip-path mengikuti kurva yang sama. */
export function wipeClip(inP: string | null, outP: string | null, frame: number, duration: number, inF: number, outF: number) {
  let c = 0;
  if (inP === "wipe" && frame < inF) c = 100 * (1 - EASE_PRO.enter(clamp01(frame / inF)));
  if (outP === "wipe" && frame > duration - outF) c = Math.max(c, 100 * EASE_PRO.exit(clamp01((frame - (duration - outF)) / outF)));
  return c > 0.1 ? `inset(0 ${c}% 0 0)` : undefined;
}

/** Elemen anak aset masuk bertahap (stagger 3 f) setelah kartunya mulai mendarat: gerak tidak berhenti di antara elemen. */
export function staggerStyle(frame: number, index: number, inF: number): CSSProperties {
  const at = Math.round(inF * 0.35) + index * 3;
  const t = clamp01((frame - at) / 10);
  if (t >= 1) return {};
  const op = clamp01(t / 0.4), bl = EASE_PRO.enterSnap(clamp01(t / 0.7)), y = EASE_PRO.enterSnap(t);
  return { opacity: op, transform: `translateY(${lerp(18, 0, y)}px)`, filter: bl < 1 ? `blur(${lerp(8, 0, bl)}px)` : undefined };
}

/* ---------------- kata caption ---------------- */

/** Pose kata caption di onset ucapannya (Clean: opasitas dari bayangan 25% selesai 55%, blur 7→0 selesai 90%, posisi menetap terakhir). */
export function wordPose(preset: string, age: number, d: number): { opacity: number; transform?: string; filter?: string } {
  if (age < 0) return { opacity: 0 };
  if (!preset || preset === "none") return { opacity: 1 };
  if (preset === "springRise") {
    // bawaan subtitle: naik + membesar dengan pegas (sedikit memantul), blur → tajam, miring halus lalu tegak
    const sp = curve("spring")(clamp01(age / (d + 6))), fade = curve("gentle")(clamp01(age / (d * 0.5))), bl = curve("gentle")(clamp01(age / (d * 0.8)));
    const blur = 8 * (1 - bl);
    return { opacity: fade, transform: `translateY(${0.32 * (1 - sp)}em) scale(${lerp(0.78, 1, sp)}) rotate(${-4 * (1 - sp)}deg)`, filter: blur > 0.2 ? `blur(${blur}px)` : undefined };
  }
  const g = curve("gentle");
  const pOp = g(clamp01(age / (d * 0.55))), pBl = g(clamp01(age / (d * 0.9))), pY = g(clamp01(age / d));
  const D: Record<string, { x?: number; y?: number; blur?: number; scale?: number }> = {
    blurRise: { y: 8, blur: 7 }, blurFade: { blur: 7 }, fade: {}, wipe: {}, slideUp: { y: 14, blur: 5 }, slideDown: { y: -14, blur: 5 },
    slideLeft: { x: 14, blur: 5 }, slideRight: { x: -14, blur: 5 }, scaleIn: { scale: 0.85, blur: 5 }, pop: { scale: 0.6, blur: 4 },
  };
  const h = D[preset] ?? D.blurRise;
  const s = h.scale === undefined ? 1 : lerp(h.scale, 1, preset === "pop" ? curve("pop")(clamp01(age / (d + 4))) : pY);
  const blur = (h.blur ?? 0) * (1 - pBl);
  return {
    opacity: h.blur || h.y || h.x || h.scale ? 0.25 + 0.75 * pOp : pOp,
    transform: `translate(${(h.x ?? 0) * (1 - pY)}px, ${(h.y ?? 0) * (1 - pY)}px) scale(${s})`,
    filter: blur > 0.2 ? `blur(${blur}px)` : undefined,
  };
}

/* ---------------- motion blur render ---------------- */

/** Frame yang benar-benar bergerak cepat (masuk/keluar aset, keyframe, gerak kamera, transisi, scene skill).
 *  Motion blur render hanya menambah sampel di frame ini, jadi biaya render tidak naik di bagian yang diam. */
export function motionMask(project: Project, defs: Map<string, AssetDef>): Uint8Array {
  const n = project.sequence.durationFrames + 2;
  const m = new Uint8Array(n);
  const mark = (a: number, b: number) => { for (let f = Math.max(0, Math.floor(a)); f <= Math.min(n - 1, Math.ceil(b)); f++) m[f] = 1; };
  const T = tempo(project.sequence.fps);
  for (const a of project.assets) {
    if (a.hidden) continue;
    const d = a.defId ? defs.get(a.defId) : undefined;
    // Aset kode bergerak dari dalam komponennya (ketikan, gulir, angka): seluruh rentangnya dianggap bergerak.
    if (d?.component) { mark(a.start, a.start + a.duration); continue; }
    if (a.anim.in) mark(a.start, a.start + (d?.in?.frames ?? T(16)) + 4);
    if (a.anim.out) mark(a.start + a.duration - (d?.out?.frames ?? T(10)) - 1, a.start + a.duration);
    if (a.keyframes.length > 1) mark(a.start + Math.min(...a.keyframes.map((k) => k.frame)), a.start + Math.max(...a.keyframes.map((k) => k.frame)));
  }
  project.scenes.forEach((s, i) => {
    for (const mv of s.camera?.moves ?? []) mark(s.start + mv.at, s.start + mv.at + mv.dur);
    for (const sh of s.camera?.shake ?? []) mark(s.start + sh.at, s.start + sh.at + (sh.dur ?? 8));
    if (i > 0) mark(s.start - 1, s.start + T(16)); // warisan kamera
    if (s.transition && s.transition.kind !== "cut") mark(s.start - s.transition.frames, s.start + s.transition.frames);
  });
  // Gerak di dalam komponen skill tidak diketahui CZ: seluruh rentangnya dianggap bergerak.
  for (const s of skillSegments(project)) mark(s.from, s.from + s.durationInFrames);
  return m;
}

export const useMotionMask = (project: Project, defs: Map<string, AssetDef>, on: boolean) =>
  useMemo(() => (on ? motionMask(project, defs) : null), [on, project.assets, project.scenes, project.clips, project.transcript, project.sequence, defs]);

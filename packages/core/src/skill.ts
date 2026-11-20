// Template dan definisi aset hasil membaca skill (SPEC: "Skill menjadi template dan pustaka aset").
// Semuanya JSON deklaratif: Claude tidak menulis kode yang dijalankan.
import type { AssetInstance, Scene, Transform } from "./project.ts";

export type ParamType = "text" | "list" | "color" | "number" | "bool" | "select" | "image" | "icon";
export interface ParamDef {
  type: ParamType; default?: unknown; label?: string;
  min?: number; max?: number; step?: number; unit?: string;
  options?: string[]; item?: "text";
}

export const ELEMENT_TYPES = ["rect", "text", "image", "video", "icon", "shape", "stack", "list", "mask", "ui-chat"] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];
/** Elemen dasar. Nilai string berawalan `$` dirujuk ke parameter aset lalu token template. */
export interface Element {
  type: ElementType;
  bind?: string;
  children?: Element[];
  [prop: string]: unknown;
}

export interface Anim { preset: string; frames?: number; curve?: string }
export interface AssetDef {
  id: string; name: string; category: string; version: number;
  description?: string;
  params: Record<string, ParamDef>;
  layout: { anchor?: string; x?: number | string; y?: number | string; w?: number | string; h?: number | string; safeArea?: boolean };
  tree: Element[];
  in?: Anim; out?: Anim;
  sfx?: { in?: string; out?: string };
  /** Durasi bawaan dalam detik. */
  duration?: number;
  trigger?: string;
  source?: string; license?: string;
}

export interface TextStyle { font?: string; size?: number; weight?: number; color?: string; lineHeight?: number; uppercase?: boolean; letterSpacing?: number; italic?: boolean }
export interface CaptionStyle extends TextStyle {
  accent?: string; activeColor?: string; activeEffect?: "warna" | "skala" | "latar" | "tidak";
  wordsPerLine?: number; maxLines?: number; in?: string; out?: string;
  stroke?: string; shadow?: string; background?: string;
}
export interface PresetAsset { defId: string; at?: "awal" | "tengah" | "akhir" | number; duration?: number; params?: Record<string, unknown> }
export interface StylePreset {
  id: string; name: string; description?: string; layout?: string;
  caption?: Partial<CaptionStyle>; camera?: { from: number; to: number };
  assets?: PresetAsset[];
}
export interface Control {
  id: string; group?: string; label: string; type: "select" | "slider" | "toggle";
  options?: string[]; min?: number; max?: number; default?: unknown; appliesTo?: string;
}
export interface Template {
  id: string; name: string; version: number;
  tokens: Record<string, unknown>;
  textStyles?: Record<string, TextStyle>;
  caption: CaptionStyle;
  stylePresets: StylePreset[];
  controls?: Control[];
  /** Peran bunyi → path file relatif ke folder skill. */
  sfx?: Record<string, string>;
  rules?: { auto?: string[]; scenes?: string; notes?: string[]; forbid?: string[] };
  warnings?: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 200) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const PARAM_TYPES: ParamType[] = ["text", "list", "color", "number", "bool", "select", "image", "icon"];
export const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;

function checkTree(els: unknown, path: string, errs: string[], depth = 0) {
  if (!Array.isArray(els)) { errs.push(`${path} bukan daftar`); return; }
  if (depth > 8) { errs.push(`${path} terlalu dalam`); return; }
  els.forEach((el, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(el) || !ELEMENT_TYPES.includes(el.type as ElementType)) { errs.push(`${p}: type harus salah satu ${ELEMENT_TYPES.join(", ")}`); return; }
    if (el.bind !== undefined && typeof el.bind !== "string") errs.push(`${p}.bind harus teks`);
    if (el.children !== undefined) checkTree(el.children, p + ".children", errs, depth + 1);
  });
}

export function validateAssetDef(d: unknown): string[] {
  if (!isObj(d)) return ["definisi aset bukan objek"];
  const errs: string[] = [];
  if (!isStr(d.id, 80) || !SAFE_ID.test(String(d.id))) errs.push("id harus huruf kecil/angka/titik/strip, mis. ce.kartu-ui");
  if (!isStr(d.name)) errs.push("name kosong");
  if (!isStr(d.category, 40)) errs.push("category kosong");
  if (!Number.isInteger(d.version) || (d.version as number) < 1) errs.push("version harus bilangan bulat ≥ 1");
  if (!isObj(d.params)) errs.push("params bukan objek");
  else for (const [k, p] of Object.entries(d.params)) {
    if (!isObj(p) || !PARAM_TYPES.includes(p.type as ParamType)) errs.push(`param ${k}: type harus salah satu ${PARAM_TYPES.join(", ")}`);
  }
  if (!isObj(d.layout)) errs.push("layout bukan objek");
  checkTree(d.tree, "tree", errs);
  if (JSON.stringify(d).length > 100_000) errs.push("definisi aset terlalu besar (maks 100 KB)");
  return errs;
}

export function validateTemplate(t: unknown): string[] {
  if (!isObj(t)) return ["template bukan objek"];
  const errs: string[] = [];
  if (!isStr(t.id, 80) || !SAFE_ID.test(String(t.id))) errs.push("id template tidak sah");
  if (!isStr(t.name)) errs.push("name kosong");
  if (!isObj(t.tokens)) errs.push("tokens bukan objek");
  if (!isObj(t.caption)) errs.push("caption bukan objek");
  if (!Array.isArray(t.stylePresets)) errs.push("stylePresets bukan daftar");
  else t.stylePresets.forEach((p, i) => {
    if (!isObj(p) || !isStr(p.id, 80) || !isStr(p.name)) errs.push(`stylePresets[${i}] butuh id dan name`);
    else if (p.assets !== undefined && (!Array.isArray(p.assets) || p.assets.some((a) => !isObj(a) || !isStr(a.defId, 80)))) errs.push(`stylePresets[${i}].assets tidak sah`);
  });
  if (t.controls !== undefined && !Array.isArray(t.controls)) errs.push("controls bukan daftar");
  if (t.sfx !== undefined && (!isObj(t.sfx) || Object.values(t.sfx).some((v) => typeof v !== "string" || v.includes("..")))) errs.push("sfx harus peta peran → path di dalam folder skill");
  if (JSON.stringify(t).length > 300_000) errs.push("template terlalu besar (maks 300 KB)");
  return errs;
}

function dig(obj: unknown, path: string): unknown {
  let v: unknown = obj;
  for (const k of path.split(".")) { if (!isObj(v)) return undefined; v = v[k]; }
  return v;
}

/** `$nama` → parameter aset, lalu token template (boleh bertitik: `$colors.accent`). Selain itu apa adanya. */
export function resolveValue(v: unknown, params: Record<string, unknown>, tokens: Record<string, unknown>, depth = 0): unknown {
  if (typeof v !== "string" || !v.startsWith("$") || depth > 4) return v;
  const key = v.slice(1);
  const hit = key in params ? params[key] : dig(tokens, key) ?? dig(tokens, "colors." + key);
  return hit === undefined ? v : resolveValue(hit, params, tokens, depth + 1);
}

/** Nilai parameter lengkap: bawaan definisi ditimpa nilai instans. */
export function paramValues(def: AssetDef | undefined, params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (def) for (const [k, p] of Object.entries(def.params)) out[k] = p.default;
  return { ...out, ...params };
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export type NewAsset = Partial<Omit<AssetInstance, "id">> & { start: number; duration: number };

/** Instans baru dari definisi: posisi dari layout, animasi dan SFX dari definisi. */
export function instantiate(def: AssetDef, tokens: Record<string, unknown>, at: { start: number; fps: number; seq: { width: number; height: number } }, extra: Partial<NewAsset> = {}): NewAsset {
  const params = paramValues(def, {});
  const transform: Transform = {
    x: num(resolveValue(def.layout.x, params, tokens), at.seq.width / 2),
    y: num(resolveValue(def.layout.y, params, tokens), at.seq.height / 2),
    scale: 1, rotation: 0, opacity: 1,
  };
  return {
    defId: def.id, defVersion: def.version, start: at.start,
    duration: Math.max(1, Math.round((def.duration ?? 3) * at.fps)),
    params: {}, transform,
    anim: { in: def.in?.preset ?? null, out: def.out?.preset ?? null },
    sfx: { in: def.sfx?.in ?? null, out: def.sfx?.out ?? null, volume: 1 },
    ...extra,
  };
}

/** Aset yang dipasang saat opsi gaya dipilih untuk scene. Definisi yang tidak ada dilewati. */
export function expandPreset(template: Template, defs: Map<string, AssetDef>, scene: Pick<Scene, "id" | "start" | "end">, presetId: string, fps: number, seq: { width: number; height: number }): NewAsset[] {
  const preset = template.stylePresets.find((p) => p.id === presetId);
  if (!preset) return [];
  const len = Math.max(1, scene.end - scene.start);
  const out: NewAsset[] = [];
  for (const pa of preset.assets ?? []) {
    const def = defs.get(pa.defId);
    if (!def) continue;
    const base = instantiate(def, template.tokens, { start: scene.start, fps, seq });
    const dur = Math.min(len, pa.duration ? Math.round(pa.duration * fps) : base.duration);
    const offset = pa.at === "akhir" ? len - dur : pa.at === "tengah" ? Math.round((len - dur) / 2) : typeof pa.at === "number" ? Math.round(pa.at * fps) : 0;
    out.push({ ...base, start: scene.start + Math.max(0, Math.min(len - 1, offset)), duration: dur, sceneId: scene.id, params: { ...(pa.params ?? {}) } });
  }
  return out;
}

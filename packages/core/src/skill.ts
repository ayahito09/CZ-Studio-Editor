// Definisi aset: isi yang bisa diubah (params) + cara menggambar. Aset baru selalu berupa KODE (component):
// komponen bawaan CZ ("cz.*", packages/composition/src/assets) atau komposisi skill ("skill:<Id>"), digerakkan mesin
// cz-motion. Pohon elemen deklaratif (tree) hanya dibaca untuk proyek/skill lama.
import type { AssetInstance, Scene, Transform } from "./project.ts";

/** media = id video proyek (b-roll). */
export type ParamType = "text" | "list" | "color" | "number" | "bool" | "select" | "image" | "icon" | "media";
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
  /** Komponen kode yang menggambar aset ("cz.chat", "skill:AsetKartu"). Bila ada, tree diabaikan. */
  component?: string;
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
  accent?: string; activeColor?: string; activeEffect?: "pil" | "garis" | "glow" | "warna" | "skala" | "latar" | "tidak";
  wordsPerLine?: number; maxLines?: number; in?: string; out?: string;
  stroke?: string; shadow?: string; background?: string;
  /** Gaya subtitle (tata letak blok caption), lihat CAPTION_LAYOUTS. Kosong = kata per kata. */
  layout?: CaptionLayout;
  /** Aksen kata kunci blok, lihat KEY_ACCENTS. Kosong = mengikuti gaya per kata (tebal/serif/aksen). */
  keyAccent?: KeyAccent;
}
/** Gaya subtitle (board Clean Editing, tab Caption). */
export const CAPTION_LAYOUTS = [
  { id: "kata", label: "Kata per kata" }, { id: "dua-tingkat", label: "Dua tingkat" }, { id: "subtitle-italic", label: "Subtitle italic" },
  { id: "satu-kata", label: "Satu kata" }, { id: "poster", label: "Poster kecil-besar" },
] as const;
export type CaptionLayout = (typeof CAPTION_LAYOUTS)[number]["id"];
/** Aksen kata kunci (board Clean Editing, tab Aksen teks). */
export const KEY_ACCENTS = [
  { id: "serif", label: "Serif italic" }, { id: "tebal", label: "Tebal" }, { id: "elips", label: "Elips merah" }, { id: "pil", label: "Pil miring" },
  { id: "glow", label: "Glow aksen" }, { id: "titik", label: "Titik aksen" }, { id: "scramble", label: "Scramble" }, { id: "tanpa", label: "Tanpa aksen" },
] as const;
export type KeyAccent = (typeof KEY_ACCENTS)[number]["id"];
/** Kata kunci satu blok caption: kata pertama yang diberi gaya (tebal/serif/aksen), selain itu kata terpanjang. -1 bila kosong. */
export function keyWordIndex(words: { text: string; style: string }[]): number {
  const marked = words.findIndex((w) => w.style !== "normal");
  if (marked >= 0) return marked;
  let best = -1, len = 0;
  words.forEach((w, i) => { const n = w.text.replace(/[^\p{L}\p{N}]/gu, "").length; if (n > len) { best = i; len = n; } });
  return best;
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
  /** Semua elemen yang disebut skill (id aset yang akan dipakai, nama, lokasi di skill). Definisinya dibuat saat sebuah video membutuhkannya. */
  catalog?: CatalogItem[];
}
export interface CatalogItem { id: string; name: string; source?: string; trigger?: string }

/** Elemen katalog yang belum punya definisi aset: dibuat Claude hanya bila video membutuhkannya. */
export const missingAssets = (t: Template, defIds: Iterable<string>): CatalogItem[] => {
  const have = new Set(defIds);
  return (t.catalog ?? []).filter((c) => !have.has(c.id));
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 200) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const PARAM_TYPES: ParamType[] = ["text", "list", "color", "number", "bool", "select", "image", "icon", "media"];
export const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;

/** Properti yang dikenali renderer (packages/composition). Selain ini diabaikan diam-diam, jadi elemennya tampil polos. */
const BOX_PROPS = ["type", "bind", "children", "x", "y", "w", "h", "opacity", "radius", "fill", "stroke", "strokeWidth", "shadow", "padding", "rotate", "blur", "align"];
const TEXT_PROPS = ["style", "font", "size", "weight", "color", "lineHeight", "uppercase"];
const EXTRA_PROPS: Record<ElementType, string[]> = {
  rect: [], mask: [], stack: ["direction", "gap", "alignItems", "justify"],
  text: [...TEXT_PROPS, "text"], list: [...TEXT_PROPS, "items", "marker", "gap"],
  image: ["src", "fit"], video: ["src"], icon: ["size", "color", "d", "char"],
  shape: ["kind"], "ui-chat": [...TEXT_PROPS, "accent"],
};
/** Daftar properti per elemen, dipakai di prompt dan deskripsi alat supaya Claude tidak menebak. */
export const ELEMENT_PROPS_HELP = `Properti elemen (selain ini diabaikan renderer dan elemen tampil polos): semua elemen: x, y, w, h (px; x/y membuatnya absolut), fill (warna latar), radius, stroke + strokeWidth, shadow (soft|hard|glow|CSS), padding, opacity, rotate, blur, align, bind (nama param). rect/mask/stack: children; rect tanpa w/h di akar = latar penuh aset. stack: direction (row|column), gap, alignItems, justify. text: text atau bind, style (nama textStyles), font, size, weight, color, lineHeight, uppercase. list: items atau bind, marker, gap, + properti teks. image/video: src atau bind, fit. icon: d (path SVG berawalan M, atau emoji/teks) / char, size, color. shape: kind (circle|rect|line|arrow), w, h, fill, stroke, strokeWidth, radius. ui-chat: bind (daftar pesan {from,text}), accent. Warna/angka boleh '$param' atau '$token' (mis. $colors.accent).`;

function visible(el: Record<string, unknown>): boolean {
  const has = (k: string) => el[k] !== undefined && el[k] !== "" && el[k] !== "none";
  const own = ((): boolean => {
    switch (el.type) {
      case "rect": case "mask": case "stack": return has("fill") || has("stroke");
      case "text": return has("text") || has("bind");
      case "list": return has("items") || has("bind");
      case "image": case "video": return has("src") || has("bind");
      case "icon": return true;
      case "shape": return has("fill") || has("stroke");
      default: return has("bind");
    }
  })();
  return own || (Array.isArray(el.children) && el.children.some((c) => isObj(c) && visible(c)));
}

function checkTree(els: unknown, path: string, errs: string[], depth = 0) {
  if (!Array.isArray(els)) { errs.push(`${path} bukan daftar`); return; }
  if (depth > 8) { errs.push(`${path} terlalu dalam`); return; }
  els.forEach((el, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(el) || !ELEMENT_TYPES.includes(el.type as ElementType)) { errs.push(`${p}: type harus salah satu ${ELEMENT_TYPES.join(", ")}`); return; }
    if (el.bind !== undefined && typeof el.bind !== "string") errs.push(`${p}.bind harus teks`);
    const ok = [...BOX_PROPS, ...EXTRA_PROPS[el.type as ElementType]];
    const bad = Object.keys(el).filter((k) => !ok.includes(k));
    if (bad.length) errs.push(`${p} (${el.type}): properti tidak dikenal ${bad.join(", ")}; yang dikenal: ${ok.join(", ")}`);
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
  if (d.component !== undefined && !(typeof d.component === "string" && /^(cz\.[a-z0-9-]+|skill:[A-Za-z_][\w-]{0,79})$/.test(d.component))) errs.push("component harus cz.<nama> atau skill:<IdKomposisi>");
  checkTree(d.tree, "tree", errs);
  if (!d.component && Array.isArray(d.tree) && !errs.length && !d.tree.some((e) => isObj(e) && visible(e))) errs.push("tree tidak menampilkan apa pun: beri fill/stroke pada rect, text/bind pada text, dst.");
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
  if (t.catalog !== undefined && (!Array.isArray(t.catalog) || t.catalog.some((c) => !isObj(c) || !isStr(c.id, 80) || !SAFE_ID.test(String(c.id)) || !isStr(c.name)))) errs.push("catalog harus daftar {id, name, source}");
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

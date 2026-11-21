// Kontrol kustom yang dideklarasikan skill (remotion/cz-controls.json). CZ hanya menggambar menunya;
// nilainya disimpan sebagai data di scene.skill.props.custom dan dibaca komponen skill saat pratinjau dan render.

export type ControlValue = string | number | boolean;
export interface ControlOption { value: ControlValue; label: string; /** SVG kecil (teks) sebagai ilustrasi pilihan. */ art?: string }
export interface ControlWhen { key: string; in?: ControlValue[]; not?: ControlValue[] }
export interface SkillControl {
  key: string; label: string; type: "seg" | "range" | "switch";
  options: ControlOption[]; min: number; max: number; step: number; unit: string;
  default: ControlValue; when?: ControlWhen; hideReason?: string;
}
export interface SkillControlGroup { group: string; controls: SkillControl[] }

const isVal = (x: unknown): x is ControlValue => ["string", "number", "boolean"].includes(typeof x);
const str = (x: unknown) => (typeof x === "string" ? x : "");
const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);

/** Merapikan JSON dari skill: entri yang rusak dibuang, bukan membuat menu gagal. */
export function normalizeControls(raw: unknown): SkillControlGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: SkillControlGroup[] = [];
  for (const g of raw as Record<string, unknown>[]) {
    if (!g || typeof g !== "object" || !Array.isArray(g.controls)) continue;
    const controls: SkillControl[] = [];
    for (const c of g.controls as Record<string, unknown>[]) {
      const key = str(c?.key), type = c?.type;
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || (type !== "seg" && type !== "range" && type !== "switch")) continue;
      const options: ControlOption[] = type === "switch"
        ? [{ value: false, label: "Mati" }, { value: true, label: "Aktif" }]
        : Array.isArray(c.options)
          ? (c.options as Record<string, unknown>[]).filter((o) => o && isVal(o.value)).map((o) => ({ value: o.value as ControlValue, label: str(o.label) || String(o.value), ...(typeof o.art === "string" ? { art: o.art } : {}) }))
          : [];
      const min = num(c.min, 0), max = Math.max(min, num(c.max, 100));
      if (type === "seg" && options.length < 2) continue;
      const fallback: ControlValue = type === "range" ? min : type === "switch" ? false : options[0].value;
      const def = isVal(c.default) ? c.default : fallback;
      const w = c.when as Record<string, unknown> | undefined;
      const when: ControlWhen | undefined = w && str(w.key) ? { key: str(w.key), ...(Array.isArray(w.in) ? { in: w.in.filter(isVal) } : {}), ...(Array.isArray(w.not) ? { not: w.not.filter(isVal) } : {}) } : undefined;
      controls.push({ key, label: str(c.label) || key, type, options, min, max, step: num(c.step, 1) || 1, unit: str(c.unit), default: def, ...(when ? { when } : {}), ...(str(c.hideReason) ? { hideReason: str(c.hideReason) } : {}) });
    }
    if (controls.length) out.push({ group: str(g.group) || "Lainnya", controls });
  }
  return out;
}

/** Nilai efektif: bawaan skill ditimpa nilai yang disimpan di scene. */
export function controlValues(groups: SkillControlGroup[], custom: unknown): Record<string, ControlValue> {
  const saved = custom && typeof custom === "object" ? (custom as Record<string, unknown>) : {};
  const v: Record<string, ControlValue> = {};
  for (const g of groups) for (const c of g.controls) v[c.key] = isVal(saved[c.key]) ? (saved[c.key] as ControlValue) : c.default;
  return v;
}

export function controlVisible(c: SkillControl, values: Record<string, ControlValue>): boolean {
  if (!c.when) return true;
  const cur = values[c.when.key];
  if (c.when.in && !c.when.in.includes(cur)) return false;
  if (c.when.not && c.when.not.includes(cur)) return false;
  return true;
}

/** Hanya nilai yang beda dari bawaan yang disimpan. Mengembalikan null bila semuanya bawaan. */
export function nextCustom(groups: SkillControlGroup[], custom: unknown, key: string, value: ControlValue): Record<string, ControlValue> | null {
  const saved = { ...(custom && typeof custom === "object" ? (custom as Record<string, ControlValue>) : {}) };
  const c = groups.flatMap((g) => g.controls).find((x) => x.key === key);
  if (c && String(c.default) === String(value)) delete saved[key]; else saved[key] = value;
  return Object.keys(saved).length ? saved : null;
}

// Komposisi Remotion yang ditulis Claude untuk skill tanpa kode: disimpan di versi skill baru (skill asli tidak diubah),
// lalu dikompilasi dan dipakai mesin yang sama dengan skill yang membawa komposisinya sendiri.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { buildComponent, COMPONENT_FILE, entryOf, versionDir } from "./skills.ts";

export interface CodeTarget { id: string; version: number }

const ALLOWED = /\.(ts|tsx|json|css|svg)$/i;
const MAX = 400_000;

/** Tulis satu file di remotion/ versi target (atomik). Path keluar folder atau ekstensi lain ditolak. */
export async function writeSkillFile(t: CodeTarget, rel: string, content: string): Promise<string> {
  const norm = rel.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!norm.startsWith("remotion/") || norm.split("/").includes("..")) throw new Error("Path harus di dalam remotion/ (mis. remotion/src/Scene.tsx)");
  if (!ALLOWED.test(norm)) throw new Error("Hanya .ts, .tsx, .json, .css, .svg");
  if (content.length > MAX) throw new Error("File terlalu besar (maks 400 KB); pecah ke beberapa file");
  const base = versionDir(t.id, t.version);
  const f = join(base, norm);
  if (!f.startsWith(join(base, "remotion") + sep)) throw new Error("Path di luar remotion/");
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f + ".tmp", content);
  await rename(f + ".tmp", f);
  await rm(join(base, COMPONENT_FILE), { force: true }); // kode berubah: kompilasi lama tidak berlaku
  return relative(base, f).replaceAll("\\", "/");
}

/** Mesin gerak wajib: komposisi yang ditulis Claude harus mengimpor "cz-motion" (kurva, follow-through, kamera, transisi CZ)
 *  atau "cz-assets" (aset bawaan CZ yang dibangun di atas mesin itu). */
export const usesMotionEngine = (sources: string[]) => sources.some((s) => /\bfrom\s*["']cz-(motion|assets)["']|\brequire\(\s*["']cz-(motion|assets)["']\s*\)/.test(s));

/** Komposisi "Aset…" yang komponennya statis: file yang mendaftarkan aset harus mengimpor mesin/aset bawaan. */
export function staticAssetFiles(files: { name: string; src: string }[]): string[] {
  const assetComps = new Set(files.flatMap((f) => [...f.src.matchAll(/<Composition[\s\S]{0,200}?\bid=["'](aset[\w-]*)["'][\s\S]{0,200}?\bcomponent=\{(\w+)\}/gi)].map((m) => m[2])));
  return files.filter((f) => [...assetComps].some((c) => new RegExp(`\\b(const|function)\\s+${c}\\b`).test(f.src)) && !usesMotionEngine([f.src])).map((f) => f.name);
}

async function sourcesOf(dir: string): Promise<{ name: string; src: string }[]> {
  const out: { name: string; src: string }[] = [];
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") await walk(p); }
      else if (/\.(ts|tsx)$/.test(e.name)) out.push({ name: relative(dir, p).replaceAll("\\", "/"), src: await readFile(p, "utf8") });
    }
  };
  await walk(join(dir, "remotion", "src"));
  return out;
}

/** Kompilasi; galat esbuild diringkas supaya Claude bisa memperbaikinya. */
export async function buildReport(t: CodeTarget): Promise<{ ok: boolean; text: string }> {
  const dir = versionDir(t.id, t.version);
  if (!entryOf(dir)) return { ok: false, text: "Belum ada remotion/src/index.ts(x). Tulis dulu file itu (registerRoot + <Composition>)." };
  const files = await sourcesOf(dir);
  if (!usesMotionEngine(files.map((f) => f.src))) {
    return { ok: false, text: 'Ditolak: mesin gerak wajib belum dipakai. Impor kurva, Move/enter/exit/pop, CameraRig, dan komponen teks dari "cz-motion" (lihat kontrak), bukan easing atau animasi buatan sendiri.' };
  }
  const still = staticAssetFiles(files);
  if (still.length) {
    return { ok: false, text: `Ditolak: aset di ${still.join(", ")} belum hidup. Bangun dari aset bawaan "cz-assets" (ChatMockup, BRoll, KineticTitle, PointCard, CountUp, Notification) atau bungkus dengan Life/Stagger dan Move/komponen teks dari "cz-motion".` };
  }
  try {
    const out = await buildComponent(t.id, t.version);
    const size = out ? (await stat(out)).size : 0;
    return { ok: !!out, text: `Kompilasi berhasil (${Math.round(size / 1024)} KB).` };
  } catch (e) {
    const errs = (e as { errors?: { text: string; location?: { file: string; line: number; lineText: string } | null }[] }).errors;
    const lines = errs?.length
      ? errs.slice(0, 20).map((x) => x.location ? `${x.location.file}:${x.location.line}: ${x.text}\n    ${x.location.lineText.trim()}` : x.text)
      : [(e as Error).message];
    return { ok: false, text: `Kompilasi gagal:\n${lines.join("\n")}` };
  }
}

export const hasComponent = (id: string, v: number) => existsSync(join(versionDir(id, v), COMPONENT_FILE)) || !!entryOf(versionDir(id, v));

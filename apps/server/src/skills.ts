// Skill editing milik user: disalin ke <data>/skills/<id>/v<n>/, dibaca Claude, tidak pernah diubah.
// Hasil generate Claude disimpan di sampingnya: v<n>/cz-template.json dan v<n>/cz-assets/*.json.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { SAFE_ID, validateAssetDef, validateTemplate, type AssetDef, type Template } from "@cz/core";
import { config } from "./config.ts";

export interface SkillMeta { id: string; name: string; description: string; source: string; versions: number[]; addedAt: number }
export interface Inventory { refs: string[]; fonts: string[]; sfx: string[]; images: string[]; presets: string[]; scripts: string[]; other: string[] }

export const skillsDir = () => join(config.dataDir, "skills");
export const versionDir = (id: string, v: number) => join(skillsDir(), id, "v" + v);
const metaFile = (id: string) => join(skillsDir(), id, "meta.json");
const GEN_TEMPLATE = "cz-template.json";
const GEN_ASSETS = "cz-assets";

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "skill";

/** Frontmatter YAML sederhana (key: value) di awal SKILL.md. */
export function frontmatter(md: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  const out: Record<string, string> = {};
  if (m) for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

async function findSkillRoot(dir: string): Promise<string | null> {
  if (existsSync(join(dir, "SKILL.md"))) return dir;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory() && existsSync(join(dir, e.name, "SKILL.md"))) return join(dir, e.name);
  }
  return null;
}

export async function listSkills(): Promise<(SkillMeta & { generated: Record<number, boolean> })[]> {
  if (!existsSync(skillsDir())) return [];
  const out = [];
  for (const e of await readdir(skillsDir(), { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    try {
      const meta = JSON.parse(await readFile(metaFile(e.name), "utf8")) as SkillMeta;
      out.push({ ...meta, generated: Object.fromEntries(meta.versions.map((v) => [v, existsSync(join(versionDir(meta.id, v), GEN_TEMPLATE))])) });
    } catch { /* folder bukan skill CZ */ }
  }
  return out.sort((a, b) => b.addedAt - a.addedAt);
}

export async function getMeta(id: string): Promise<SkillMeta> {
  if (!SAFE_ID.test(id)) throw new Error("id skill tidak sah");
  try { return JSON.parse(await readFile(metaFile(id), "utf8")); }
  catch { throw new Error(`Skill ${id} tidak ada`); }
}

/** Tambah skill dari folder atau .zip. Bila id sama sudah ada, menjadi versi baru (Perbarui dari sumber). */
export async function addSkill(src: string, sourceLabel?: string): Promise<SkillMeta> {
  src = resolve(src.trim().replace(/^"|"$/g, ""));
  if (!isAbsolute(src) || !existsSync(src)) throw new Error("Folder atau file skill tidak ditemukan");
  let from = src, tmp: string | null = null;
  try {
    if (extname(src).toLowerCase() === ".zip") {
      tmp = await mkdtemp(join(tmpdir(), "cz-skill-"));
      const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
      const r = spawnSync(tar, ["-xf", src, "-C", tmp], { windowsHide: true });
      if (r.status !== 0) throw new Error("Zip skill tidak bisa dibuka");
      from = tmp;
    } else if (!(await stat(src)).isDirectory()) throw new Error("Pilih folder skill atau file .zip");
    const root = await findSkillRoot(from);
    if (!root) throw new Error("SKILL.md tidak ditemukan di folder itu");
    const fm = frontmatter(await readFile(join(root, "SKILL.md"), "utf8"));
    const id = slug(fm.name || basename(root));
    let meta: SkillMeta;
    try { meta = await getMeta(id); } catch { meta = { id, name: fm.name || basename(root), description: fm.description ?? "", source: src, versions: [], addedAt: Date.now() }; }
    const v = Math.max(0, ...meta.versions) + 1;
    const dest = versionDir(id, v);
    await mkdir(dest, { recursive: true });
    await cp(root, dest, { recursive: true, filter: (p) => !p.split(sep).includes(".git") && !p.split(sep).includes("node_modules") });
    meta = { ...meta, name: fm.name || meta.name, description: fm.description ?? meta.description, source: sourceLabel ?? src, versions: [...meta.versions, v] };
    await writeFile(metaFile(id), JSON.stringify(meta, null, 2));
    return meta;
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  }
}

/** Versi baru untuk perubahan template oleh Claude: salinan versi lama, proyek tetap terkunci ke versinya. */
export async function forkVersion(id: string, from: number): Promise<number> {
  const meta = await getMeta(id);
  const v = Math.max(...meta.versions) + 1;
  await cp(versionDir(id, from), versionDir(id, v), { recursive: true });
  meta.versions.push(v);
  await writeFile(metaFile(id), JSON.stringify(meta, null, 2));
  return v;
}

async function walk(dir: string, base = dir, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== GEN_ASSETS && out.length < 5000) await walk(p, base, out); }
    else if (e.name !== GEN_TEMPLATE) out.push(relative(base, p).replaceAll("\\", "/"));
  }
  return out;
}

export async function inventory(id: string, v: number): Promise<Inventory> {
  const inv: Inventory = { refs: [], fonts: [], sfx: [], images: [], presets: [], scripts: [], other: [] };
  const kinds: [keyof Inventory, RegExp][] = [
    ["refs", /\.(md|txt)$/i], ["fonts", /\.(ttf|otf|woff2?)$/i], ["sfx", /\.(mp3|wav|m4a|ogg|aac|flac)$/i],
    ["images", /\.(png|jpe?g|svg|webp|gif)$/i], ["presets", /\.(json|ya?ml)$/i], ["scripts", /\.(py|sh|js|mjs|ts|ps1|bat)$/i],
  ];
  for (const f of await walk(versionDir(id, v))) (inv[kinds.find(([, re]) => re.test(f))?.[0] ?? "other"]).push(f);
  return inv;
}

export interface Library { id: string; version: number; name: string; template: Template | null; assets: AssetDef[]; warnings: string[] }

export async function loadLibrary(id: string, v: number): Promise<Library> {
  const meta = await getMeta(id);
  if (!meta.versions.includes(v)) throw new Error(`Skill ${id} tidak punya versi ${v}`);
  const dir = versionDir(id, v);
  const warnings: string[] = [];
  let template: Template | null = null;
  try {
    const t = JSON.parse(await readFile(join(dir, GEN_TEMPLATE), "utf8"));
    const errs = validateTemplate(t);
    if (errs.length) warnings.push(`template: ${errs.join("; ")}`); else template = t;
  } catch { /* belum di-generate */ }
  const assets: AssetDef[] = [];
  if (existsSync(join(dir, GEN_ASSETS))) {
    for (const f of (await readdir(join(dir, GEN_ASSETS))).filter((x) => x.endsWith(".json")).sort()) {
      try {
        const d = JSON.parse(await readFile(join(dir, GEN_ASSETS, f), "utf8"));
        const errs = validateAssetDef(d);
        if (errs.length) warnings.push(`${f}: ${errs.join("; ")}`); else assets.push(d);
      } catch { warnings.push(`${f}: bukan JSON yang sah`); }
    }
  }
  if (template?.warnings) warnings.push(...template.warnings);
  const inv = await inventory(id, v);
  if (inv.scripts.length) warnings.push(`${inv.scripts.length} skrip di skill tidak dijalankan CZ (transkrip, potong jeda, dan render diambil alih CZ)`);
  return { id, version: v, name: meta.name, template, assets, warnings };
}

/** Disimpan atomik setelah lolos validasi. Mengembalikan daftar masalah (kosong = tersimpan). */
export async function saveTemplate(id: string, v: number, t: unknown): Promise<string[]> {
  const errs = validateTemplate(t);
  if (errs.length) return errs;
  const f = join(versionDir(id, v), GEN_TEMPLATE);
  await writeFile(f + ".tmp", JSON.stringify(t, null, 2));
  await rename(f + ".tmp", f);
  return [];
}

export async function saveAssetDef(id: string, v: number, d: unknown): Promise<string[]> {
  const errs = validateAssetDef(d);
  if (errs.length) return errs;
  const dir = join(versionDir(id, v), GEN_ASSETS);
  await mkdir(dir, { recursive: true });
  const f = join(dir, `${(d as AssetDef).id}.json`);
  await writeFile(f + ".tmp", JSON.stringify(d, null, 2));
  await rename(f + ".tmp", f);
  return [];
}

/** Path file di dalam folder versi skill; menolak keluar folder. */
export function skillFile(id: string, v: number, rel: string): string {
  if (!SAFE_ID.test(id) || !Number.isInteger(v)) throw new Error("tidak sah");
  const base = versionDir(id, v);
  const p = resolve(base, rel);
  if (!p.startsWith(base + sep)) throw new Error("path di luar folder skill");
  return p;
}

// Skill editing milik user: disalin ke <data>/skills/<id>/v<n>/, dibaca Claude, tidak pernah diubah.
// Hasil generate Claude disimpan di sampingnya: v<n>/cz-template.json dan v<n>/cz-assets/*.json.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { normalizeControls, SAFE_ID, validateAssetDef, validateTemplate, type AssetDef, type Element as El, type SkillControlGroup, type Template } from "@cz/core";
import { BUILTIN_PREFIX, FONTS, SFX, fontFile, sfxFile } from "./builtin.ts";
import { libraryPath } from "./config.ts";
import { listPacks } from "./packs.ts";

export interface SkillMeta { id: string; name: string; description: string; source: string; versions: number[]; addedAt: number; /** Folder asal skill (untuk node_modules saat mengompilasi komponen). */ root?: string }
export interface Inventory { refs: string[]; fonts: string[]; sfx: string[]; images: string[]; presets: string[]; scripts: string[]; other: string[] }

export const skillsDir = () => libraryPath("skills");
export const versionDir = (id: string, v: number) => join(skillsDir(), id, "v" + v);
const metaFile = (id: string) => join(skillsDir(), id, "meta.json");
const GEN_TEMPLATE = "cz-template.json";
const GEN_ASSETS = "cz-assets";
/** Komposisi Remotion milik skill, dikompilasi CZ menjadi satu modul ESM (react/remotion diambil dari CZ saat dimuat). */
export const COMPONENT_FILE = "cz-component.js";
const ENTRIES = ["remotion/src/index.ts", "remotion/src/index.tsx", "src/index.ts", "src/index.tsx"];

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

/** Semua folder yang berisi SKILL.md (sampai 5 tingkat). Plugin/zip bersarang seperti skills/<nama>/SKILL.md ikut terbaca. */
async function findSkillRoots(dir: string, depth = 5): Promise<string[]> {
  if (existsSync(join(dir, "SKILL.md"))) return [dir];
  if (depth <= 0) return [];
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory() && ![".git", "node_modules", "__MACOSX"].includes(e.name)) out.push(...(await findSkillRoots(join(dir, e.name), depth - 1)));
  }
  return out;
}

/** Zip dengan nama lain: .skill (paket skill) dan .plugin (plugin Claude). */
export const isArchive = (name: string) => [".zip", ".skill", ".plugin"].includes(extname(name).toLowerCase());

export async function listSkills(): Promise<(SkillMeta & { generated: Record<number, boolean> })[]> {
  if (!existsSync(skillsDir())) return [];
  const out = [];
  for (const e of await readdir(skillsDir(), { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    try {
      const meta = JSON.parse(await readFile(metaFile(e.name), "utf8")) as SkillMeta;
      // Siap = punya komposisi kode (mesin skill). Template JSON lama tidak dihitung lagi.
      out.push({ ...meta, generated: Object.fromEntries(meta.versions.map((v) => [v, !!entryOf(versionDir(meta.id, v))])) });
    } catch { /* folder bukan skill CZ */ }
  }
  return out.sort((a, b) => b.addedAt - a.addedAt);
}

export async function getMeta(id: string): Promise<SkillMeta> {
  if (!SAFE_ID.test(id)) throw new Error("id skill tidak sah");
  try { return JSON.parse(await readFile(metaFile(id), "utf8")); }
  catch { throw new Error(`Skill ${id} tidak ada`); }
}

/** Tambah skill dari folder, .zip, .skill, atau .plugin. Satu paket plugin boleh berisi beberapa skill: semuanya dipasang, yang pertama dikembalikan. Bila id sama sudah ada, menjadi versi baru. */
export async function addSkill(src: string, sourceLabel?: string): Promise<SkillMeta> {
  src = resolve(src.trim().replace(/^"|"$/g, ""));
  if (!isAbsolute(src) || !existsSync(src)) throw new Error("Folder atau file skill tidak ditemukan");
  let from = src, tmp: string | null = null;
  try {
    if (isArchive(src)) {
      tmp = await mkdtemp(join(tmpdir(), "cz-skill-"));
      const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
      const r = spawnSync(tar, ["-xf", src, "-C", tmp], { windowsHide: true });
      if (r.status !== 0) throw new Error("Zip skill tidak bisa dibuka");
      from = tmp;
    } else if (extname(src).toLowerCase() === ".md") {
      // Satu file panduan saja: dibungkus jadi folder skill bernama sesuai file (bila frontmatter tidak punya name).
      tmp = await mkdtemp(join(tmpdir(), "cz-skill-"));
      await mkdir(join(tmp, slug(basename(src, extname(src)))), { recursive: true });
      await cp(src, join(tmp, slug(basename(src, extname(src))), "SKILL.md"));
      from = tmp;
    } else if (!(await stat(src)).isDirectory()) throw new Error("Pilih folder skill, file .zip, .skill, .plugin, atau .md");
    const roots = await findSkillRoots(from);
    if (!roots.length) throw new Error("SKILL.md tidak ditemukan di sana (dicari sampai 5 tingkat folder)");
    const metas: SkillMeta[] = [];
    for (const root of roots) metas.push(await installRoot(root, src, sourceLabel));
    return metas[0];
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  }
}

async function installRoot(root: string, src: string, sourceLabel?: string): Promise<SkillMeta> {
  const fm = frontmatter(await readFile(join(root, "SKILL.md"), "utf8"));
  const id = slug(fm.name || basename(root));
  let meta: SkillMeta;
  try { meta = await getMeta(id); } catch { meta = { id, name: fm.name || basename(root), description: fm.description ?? "", source: src, versions: [], addedAt: Date.now() }; }
  const v = Math.max(0, ...meta.versions) + 1;
  const dest = versionDir(id, v);
  await mkdir(dest, { recursive: true });
  await cp(root, dest, { recursive: true, filter: (p) => !p.split(sep).includes(".git") && !p.split(sep).includes("node_modules") });
  // Folder asli disimpan hanya bila bukan folder sementara (zip), supaya node_modules-nya bisa dipakai saat kompilasi.
  const keepRoot = !relative(tmpdir(), root).match(/^cz-skill-/);
  meta = { ...meta, name: fm.name || meta.name, description: fm.description ?? meta.description, source: sourceLabel ?? src, versions: [...meta.versions, v], ...(keepRoot ? { root } : {}) };
  await writeFile(metaFile(id), JSON.stringify(meta, null, 2));
  await buildComponent(id, v, root).catch(() => { /* dilaporkan loadLibrary */ });
  return meta;
}

export const entryOf = (dir: string) => ENTRIES.map((e) => join(dir, e)).find((f) => existsSync(f));

/** Kompilasi komposisi skill (bila ada) ke v<n>/cz-component.js. Paket npm skill dicari di node_modules folder asal. */
export async function buildComponent(id: string, v: number, root?: string): Promise<string | null> {
  const dir = versionDir(id, v);
  const entry = entryOf(dir);
  if (!entry) return null;
  const { build } = await import("esbuild");
  const nodePaths = [root, (await getMeta(id).catch(() => null))?.root].filter((x): x is string => !!x)
    .flatMap((r) => [join(r, "remotion", "node_modules"), join(r, "node_modules")]).filter((d) => existsSync(d));
  const out = join(dir, COMPONENT_FILE);
  const hasPack = (await listPacks()).length > 0;
  await build({
    entryPoints: [entry], outfile: out + ".tmp", absWorkingDir: dir, bundle: true, format: "esm", platform: "browser", target: "es2022",
    jsx: "automatic", nodePaths, logLevel: "silent", legalComments: "none", minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{
      name: "cz-shared",
      // Satu salinan react/remotion (milik CZ) untuk skill dan editor; tanpa ini konteks Remotion terpecah.
      setup(b) {
        // "cz-assets" datang dari paket elemen lokal (milik developer); tanpa paket, build gagal dengan pesan yang bisa ditindaklanjuti Claude.
        b.onResolve({ filter: /^cz-assets(\/.*)?$/ }, (a) => (hasPack
          ? { path: a.path, namespace: "cz-shared" }
          : { errors: [{ text: 'Modul "cz-assets" tidak tersedia di instalasi ini. Bangun elemen dari "cz-motion" (Move, TypeLine, BlurIn, …) dan div/SVG sendiri.' }] }));
        b.onResolve({ filter: /^(react|react-dom|remotion|cz-motion)(\/.*)?$/ }, (a) => ({ path: a.path, namespace: "cz-shared" }));
        b.onLoad({ filter: /.*/, namespace: "cz-shared" }, (a) => ({
          contents: `const m = globalThis.__czShared && globalThis.__czShared[${JSON.stringify(a.path)}]; if (!m) throw new Error("CZ tidak menyediakan ${a.path}"); module.exports = m;`,
          loader: "js",
        }));
      },
    }],
  });
  await rename(out + ".tmp", out);
  return out;
}

/** Peta SFX skill (public/sfx/lib.json versi 4): peran → file relatif public/. Klip auto:false hanya dipakai bila dipilih. */
async function sfxLibOf(dir: string): Promise<Record<string, string[]> | null> {
  try {
    const d = JSON.parse(await readFile(join(dir, "remotion", "public", "sfx", "lib.json"), "utf8")) as { version?: number; clips?: { role: string; file: string; auto?: boolean }[] };
    if (!d.clips || (d.version ?? 0) < 4) return null;
    const lib: Record<string, string[]> = {};
    for (const c of d.clips) if (c.auto !== false) (lib[c.role] ??= []).push("sfx/" + c.file);
    // Nama peran lama yang masih dipanggil kode komposisi (sama dengan ALIAS di scripts/sfxlib.py skill).
    for (const [old, now] of Object.entries({ pop: "tombol", swipe: "kertas", coret: "garis", lingkar: "garis", teks: "tombol", perkusi: "kunci" })) if (lib[now] && !lib[old]) lib[old] = lib[now];
    return lib;
  } catch { return null; }
}

/** Versi baru untuk perubahan template oleh Claude: salinan versi lama, proyek tetap terkunci ke versinya. */
export async function forkVersion(id: string, from: number): Promise<number> {
  const meta = await getMeta(id);
  const v = Math.max(...meta.versions) + 1;
  await cp(versionDir(id, from), versionDir(id, v), { recursive: true });
  await rm(join(versionDir(id, v), COMPONENT_FILE), { force: true }); // dikompilasi ulang dari kode versi baru
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

export interface Library {
  id: string; version: number; name: string; template: Template | null; assets: AssetDef[]; warnings: string[];
  /** Komposisi Remotion skill: file modul + folder public, relatif ke folder versi; null = skill hanya template. */
  component: { file: string; publicDir: string; sfxLib: Record<string, string[]> | null } | null;
  /** Kelompok id gaya dari tabel SKILL.md (satu baris tabel = satu kelompok pilihan), untuk Inspector scene skill. */
  styleOptions: { label: string; ids: string[] }[];
  /** Kontrol kustom per scene dari remotion/cz-controls.json (menu Kustom di CZ). */
  controls: SkillControlGroup[];
}

/** Baris tabel markdown "| Label | id-a★, id-b (keterangan), ... |" yang berisi daftar id kebab-case. */
export function styleOptionsOf(md: string): { label: string; ids: string[] }[] {
  const out: { label: string; ids: string[] }[] = [];
  for (const line of md.split(/\r?\n/)) {
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const ids = cells[1].replace(/\([^)]*\)/g, "").split(",").map((x) => x.replace(/[★*`]/g, "").trim()).filter((x) => /^[a-z]+(-[a-z0-9]+)+$/.test(x));
    if (ids.length >= 2) out.push({ label: cells[0], ids });
  }
  return out;
}

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
  if (template) {
    // Peta SFX boleh menunjuk folder (satu klip diambil) atau file; yang tidak ada diganti SFX bawaan CZ, atau dilewati supaya render tidak gagal 404.
    const sfx: Record<string, string> = {};
    for (const [role, p] of Object.entries(template.sfx ?? {})) {
      try {
        const abs = join(dir, p);
        if ((await stat(abs)).isFile()) sfx[role] = p;
        else {
          const clip = (await readdir(abs)).filter((x) => /\.(wav|mp3|m4a|ogg|aac|flac)$/i.test(x)).sort()[0];
          if (clip) sfx[role] = p.replace(/\/?$/, "/") + clip;
        }
      } catch { /* file tidak ada */ }
    }
    for (const role of Object.keys(SFX)) if (!(role in sfx) && existsSync(sfxFile(role))) sfx[role] = `${BUILTIN_PREFIX}sfx/${role}.wav`;
    const lost = Object.keys(template.sfx ?? {}).filter((r) => !(r in sfx));
    if (lost.length) warnings.push(`SFX tidak ada di folder skill, dilewati: ${lost.join(", ")}`);
    template = { ...template, sfx };
  }
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
  // Aturan: aset yang filenya tidak ada di skill tidak ditambahkan dan tidak dibuat, juga tidak lewat preset gaya.
  const has = (rel: string) => existsSync(join(dir, rel));
  const local = (x: unknown): x is string => typeof x === "string" && x !== "" && !x.startsWith("$") && !/^(https?:|data:|blob:|\/)/.test(x);
  const lacking = (els: El[]): string[] => els.flatMap((e) => [...((e.type === "image" || e.type === "video") && local(e.src) && !has(e.src) ? [e.src] : []), ...lacking(e.children ?? [])]);
  const dropped = new Set<string>();
  const ready = assets.filter((a) => {
    const miss = [...lacking(a.tree), ...Object.values(a.params).filter((p) => p.type === "image" && local(p.default) && !has(p.default)).map((p) => String(p.default))];
    if (miss.length) { dropped.add(a.id); warnings.push(`Aset "${a.name}" dilewati, file tidak ada di skill: ${miss.join(", ")}`); }
    return !miss.length;
  });
  if (template && dropped.size) template = { ...template, stylePresets: template.stylePresets.map((p) => (p.assets ? { ...p, assets: p.assets.filter((x) => !dropped.has(x.defId)) } : p)) };
  const fonts = template?.tokens.fontFiles as Record<string, string> | undefined;
  if (template && fonts) {
    const keep = Object.fromEntries(Object.entries(fonts).filter(([, p]) => has(p)));
    const gone = Object.keys(fonts).filter((f) => !(f in keep));
    if (gone.length) { warnings.push(`Font tidak ada di skill, dilewati: ${gone.join(", ")}`); template = { ...template, tokens: { ...template.tokens, fontFiles: keep } }; }
  }
  if (template) {
    // Font bawaan CZ untuk keluarga yang dipakai template tetapi filenya tidak dibawa skill.
    const used = Object.values((template.tokens.fonts ?? {}) as Record<string, unknown>).filter((x): x is string => typeof x === "string");
    const ff = { ...((template.tokens.fontFiles ?? {}) as Record<string, string>) };
    for (const fam of used) if (!(fam in ff) && fam in FONTS && existsSync(fontFile(fam))) ff[fam] = `${BUILTIN_PREFIX}fonts/${FONTS[fam][0]}`;
    template = { ...template, tokens: { ...template.tokens, fontFiles: ff } };
  }
  if (template?.warnings) warnings.push(...template.warnings);
  let component: Library["component"] = null;
  const entry = entryOf(dir);
  if (entry) {
    if (!existsSync(join(dir, COMPONENT_FILE))) await buildComponent(id, v).catch((e) => warnings.push(`Komposisi skill gagal dikompilasi: ${(e as Error).message.split("\n").slice(0, 3).join(" ")}. Jalankan npm install di folder remotion skill lalu pasang ulang skill.`));
    if (existsSync(join(dir, COMPONENT_FILE))) {
      const pub = relative(dir, join(dirname(entry), "..", "public")).replaceAll("\\", "/");
      component = { file: COMPONENT_FILE, publicDir: pub, sfxLib: await sfxLibOf(dir) };
      warnings.push("Skill ini membawa kode (komposisi Remotion) yang dijalankan di editor dan saat render. Pasang hanya skill yang kamu percaya.");
    }
  }
  // Katalog gaya: remotion/cz-styles.json (ditulis Claude untuk komposisi buatannya) atau tabel di SKILL.md.
  let styleOptions: Library["styleOptions"] = [];
  if (component) {
    try {
      const j = JSON.parse(await readFile(join(dir, "remotion", "cz-styles.json"), "utf8")) as { label?: unknown; ids?: unknown }[];
      styleOptions = j.filter((x) => typeof x.label === "string" && Array.isArray(x.ids)).map((x) => ({ label: x.label as string, ids: (x.ids as unknown[]).map(String) }));
    } catch { styleOptions = styleOptionsOf(await readFile(join(dir, "SKILL.md"), "utf8").catch(() => "")); }
  }
  let controls: SkillControlGroup[] = [];
  if (component) controls = normalizeControls(JSON.parse(await readFile(join(dir, "remotion", "cz-controls.json"), "utf8").catch(() => "null")));
  return { id, version: v, name: meta.name, template, assets: ready, warnings, component, styleOptions, controls };
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

/** Hasil skrip analisis skill per media (wajah, matte subjek), ditulis ke <proyek>/skill-data/<mediaId>/. */
export const skillDataDir = (folder: string, mediaId: string) => join(folder, "skill-data", mediaId);
export interface SkillMedia { faces?: unknown[]; subject?: string }
/** faces.json dan subject.webm per media; subject berupa path absolut (pemanggil mengubahnya jadi URL). */
export async function skillMedia(folder: string, mediaIds: string[]): Promise<Record<string, SkillMedia>> {
  const out: Record<string, SkillMedia> = {};
  for (const id of mediaIds) {
    const d = skillDataDir(folder, id), m: SkillMedia = {};
    try { const f = JSON.parse(await readFile(join(d, "faces.json"), "utf8")); if (Array.isArray(f)) m.faces = f; } catch { /* belum dianalisis */ }
    if (existsSync(join(d, "subject.webm"))) m.subject = join(d, "subject.webm");
    if (m.faces || m.subject) out[id] = m;
  }
  return out;
}

/** Library untuk komposisi: URL komponen/public skill dari base, dan data media proyek. */
export async function compositionLib(lib: Library, base: string, folder: string, mediaIds: string[], subjectUrl: (mediaId: string, path: string) => string) {
  const media = await skillMedia(folder, mediaIds);
  for (const [id, m] of Object.entries(media)) if (m.subject) m.subject = subjectUrl(id, m.subject);
  return {
    template: lib.template, assets: lib.assets, base,
    component: lib.component ? { url: base + lib.component.file, publicBase: base + lib.component.publicDir + "/", sfxLib: lib.component.sfxLib } : null,
    media,
  };
}

/** Path file di dalam folder versi skill; menolak keluar folder. */
export function skillFile(id: string, v: number, rel: string): string {
  if (!SAFE_ID.test(id) || !Number.isInteger(v)) throw new Error("tidak sah");
  const base = versionDir(id, v);
  const p = resolve(base, rel);
  if (!p.startsWith(base + sep)) throw new Error("path di luar folder skill");
  return p;
}

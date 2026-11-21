// Skrip Python milik skill, dijalankan atas permintaan Claude lewat cz_run_skill_script (bukan Bash):
// hanya file .py di dalam folder skill, argumen tanpa shell, folder kerja di dalam proyek.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import type { Project } from "@cz/core";
import { toolBin } from "./config.ts";
import { venvPython, visionDir } from "./pyenv.ts";
import { mediaFile } from "./media.ts";
import { skillDataDir, skillFile, versionDir } from "./skills.ts";

const TIMEOUT = 60 * 60_000;

const runs = (bin: string, args: string[]) => new Promise<boolean>((res) => {
  const p = spawn(bin, args, { windowsHide: true });
  p.on("error", () => res(false)); p.on("close", (code) => res(code === 0));
});

/** Semua Python di komputer: CZ_PYTHON, lalu python3/python di PATH (Windows: semua hasil `where`), lalu py. */
async function candidates(): Promise<string[]> {
  // Python milik CZ (cz install) lebih dulu: paket skill video sudah terpasang di sana.
  const out = [process.env.CZ_PYTHON, existsSync(venvPython()) ? venvPython() : undefined];
  if (process.platform === "win32") {
    for (const n of ["python3", "python"]) {
      const r = spawnSync("where", [n], { encoding: "utf8", windowsHide: true });
      if (r.status === 0) out.push(...r.stdout.split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !/WindowsApps/i.test(x)));
    }
    out.push("py");
  } else out.push("python3", "python");
  return [...new Set(out.filter((x): x is string => !!x))];
}

/** Modul pihak ketiga yang diimpor skrip (modul di folder skrip itu sendiri dilewati). */
async function importsOf(file: string): Promise<string[]> {
  const src = await readFile(file, "utf8");
  const local = new Set((await readdir(dirname(file))).filter((f) => f.endsWith(".py")).map((f) => f.slice(0, -3)));
  const mods = new Set<string>();
  for (const m of src.matchAll(/^(?:import\s+([\w., ]+)|from\s+([\w.]+)\s+import)/gm)) {
    for (const part of (m[1] ?? m[2]).split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0].split(".")[0];
      if (name && !local.has(name)) mods.add(name);
    }
  }
  return [...mods];
}

/** Python pertama yang bisa mengimpor semua modul skrip; bila tidak ada, yang pertama bisa jalan (galatnya terlihat di keluaran). */
async function python(file: string): Promise<string> {
  const mods = await importsOf(file);
  const test = mods.length ? `import ${mods.join(", ")}` : "pass";
  let first: string | null = null;
  for (const c of await candidates()) {
    if (!(await runs(c, ["--version"]))) continue;
    first ??= c;
    if (await runs(c, ["-c", test])) return c;
  }
  if (!first) throw new Error("Python tidak ditemukan. Pasang Python 3 lalu buka ulang CZ (atau isi CZ_PYTHON dengan path python.exe).");
  return first;
}

/** {media:ID} file asli, {proxy:ID}, {data:ID} folder hasil analisis media, {work} folder kerja, {skill} folder skill, {models} model wajah/matte CZ. */
export async function expandArgs(args: string[], folder: string, p: Project, skillDir: string, work: string): Promise<string[]> {
  const out: string[] = [];
  for (const a of args) {
    out.push(await replaceAsync(a, /\{(media|proxy|data):([\w-]+)\}|\{(work|skill|models)\}/g, async (m, kind, id, plain) => {
      if (plain === "work") return work;
      if (plain === "skill") return skillDir;
      if (plain === "models") return visionDir();
      const media = p.media.find((x) => x.id === id);
      if (!media) throw new Error(`media ${id} tidak ada`);
      if (kind === "media") return mediaFile(folder, media);
      if (kind === "proxy") return join(folder, media.proxy);
      const d = skillDataDir(folder, id);
      await mkdir(d, { recursive: true });
      return d;
    }));
  }
  return out;
}

async function replaceAsync(s: string, re: RegExp, fn: (...m: string[]) => Promise<string>) {
  const parts: Promise<string>[] = [];
  s.replace(re, (...m) => { parts.push(fn(...(m as string[]))); return ""; });
  const vals = await Promise.all(parts);
  return s.replace(re, () => vals.shift()!);
}

export async function runSkillScript(o: {
  folder: string; project: Project; skill: { id: string; version: number }; script: string; args: string[];
  onLine?: (line: string) => void; signal?: AbortSignal;
}): Promise<{ code: number; output: string; work: string }> {
  if (!/\.py$/i.test(o.script)) throw new Error("Hanya skrip .py di folder skill yang bisa dijalankan");
  const file = skillFile(o.skill.id, o.skill.version, o.script);
  if (!existsSync(file)) throw new Error(`Skrip tidak ada: ${o.script}`);
  const work = join(o.folder, "skill-work");
  await mkdir(work, { recursive: true });
  const args = await expandArgs(o.args, o.folder, o.project, versionDir(o.skill.id, o.skill.version), work);
  const bin = await python(file);
  // ffmpeg milik CZ ikut di PATH (skrip skill memanggil ffmpeg/ffprobe).
  const ff = toolBin("ffmpeg");
  const env = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", PYTHON_COLORS: "0", NO_COLOR: "1", ...(ff !== "ffmpeg" ? { PATH: dirname(ff) + delimiter + (process.env.PATH ?? "") } : {}) };
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [file, ...args], { cwd: work, env, windowsHide: true });
    let output = "";
    const take = (d: Buffer) => {
      const t = d.toString("utf8");
      output = (output + t).slice(-8000);
      for (const line of t.split(/\r?\n/)) if (line.trim()) o.onLine?.(line.trim().slice(0, 300));
    };
    child.stdout.on("data", take); child.stderr.on("data", take);
    const timer = setTimeout(() => child.kill(), TIMEOUT);
    o.signal?.addEventListener("abort", () => child.kill());
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, output, work }); });
  });
}

/** id komposisi yang didaftarkan skill (<Composition id="...">), dibaca dari sumbernya. */
export async function skillCompositionIds(skillDir: string): Promise<string[]> {
  const ids = new Set<string>();
  const walk = async (d: string, depth: number): Promise<void> => {
    if (depth > 4 || !existsSync(d)) return;
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.isDirectory()) { if (e.name !== "node_modules") await walk(join(d, e.name), depth + 1); }
      else if (/\.(tsx|jsx)$/.test(e.name)) for (const m of (await readFile(join(d, e.name), "utf8")).matchAll(/<Composition[\s\S]{0,200}?\bid=["']([\w-]+)["']/g)) ids.add(m[1]);
    }
  };
  await walk(join(skillDir, "remotion", "src"), 0);
  await walk(join(skillDir, "src"), 0);
  return [...ids];
}

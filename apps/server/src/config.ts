import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Settings {
  /** Perubahan Claude masuk sebagai usulan yang diterima/ditolak user. */
  reviewClaude: boolean;
  /** Bahasa transkrip: auto | id | en. */
  txLang: string;
  /** Model untuk `claude -p`: "" = bawaan Claude Code user, atau alias opus | sonnet | haiku. */
  claudeModel: string;
  /** Effort untuk `claude -p`: "" = bawaan, atau low | medium | high | xhigh | max. */
  claudeEffort: string;
  /** Mesin render: auto = gambar frame dibantu GPU (ANGLE) + penyandian CPU; gpu = ANGLE + NVENC; cpu = tanpa GPU. */
  renderEngine: RenderEngine;
}
export type RenderEngine = "auto" | "gpu" | "cpu";
export const RENDER_ENGINES: RenderEngine[] = ["auto", "gpu", "cpu"];
export const CLAUDE_MODELS = ["", "opus", "sonnet", "haiku"];
export const CLAUDE_EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];
const DEFAULT_SETTINGS: Settings = { reviewClaude: false, txLang: "auto", claudeModel: "", claudeEffort: "", renderEngine: "auto" };
const settingsFile = () => join(config.dataDir, "settings.json");

/** ffmpeg/ffprobe: salinan yang dipasang CZ di folder data dulu, lalu yang ada di PATH. */
export function toolBin(name: "ffmpeg" | "ffprobe"): string {
  const local = join(config.dataDir, "ffmpeg", "bin", name + (process.platform === "win32" ? ".exe" : ""));
  return existsSync(local) ? local : name;
}

export function getSettings(): Settings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(settingsFile(), "utf8")) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export async function setSettings(changes: Partial<Settings>): Promise<Settings> {
  const next = { ...getSettings() };
  if (typeof changes.reviewClaude === "boolean") next.reviewClaude = changes.reviewClaude;
  if (changes.txLang === "auto" || changes.txLang === "id" || changes.txLang === "en") next.txLang = changes.txLang;
  if (typeof changes.claudeModel === "string" && CLAUDE_MODELS.includes(changes.claudeModel)) next.claudeModel = changes.claudeModel;
  if (typeof changes.claudeEffort === "string" && CLAUDE_EFFORTS.includes(changes.claudeEffort)) next.claudeEffort = changes.claudeEffort;
  if (RENDER_ENGINES.includes(changes.renderEngine as RenderEngine)) next.renderEngine = changes.renderEngine as RenderEngine;
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(settingsFile(), JSON.stringify(next, null, 2));
  return next;
}

/** Pengaturan proses server; diisi startServer. Satu server = satu user = satu proses. */
export const config = {
  dataDir: join(homedir(), ".cz-studio"),
  /** Pustaka milik user yang terlihat: Videos\CZ Studio\{Skills, Aset, Proyek}. Alat (ffmpeg, whisper, model) tetap di dataDir. */
  libraryDir: join(homedir(), "Videos", "CZ Studio"),
  port: 4317,
  /** Rahasia untuk server MCP: hanya proses yang dijalankan CZ yang boleh memanggil /api/mcp. */
  token: randomBytes(24).toString("hex"),
  /** Perintah untuk menjalankan CLI CZ lagi (server MCP untuk Claude): [node, cli.js|cli.ts].
   *  Dihitung dari lokasi modul ini, bukan process.argv[1], supaya benar walau server dijalankan dari skrip lain. */
  self: [process.execPath, fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./cli.ts" : "./cli.js", import.meta.url))] as string[],
};

export const LIBRARY = { skills: "Skills", assets: "Aset", projects: "Proyek", packs: "Paket" } as const;
export const libraryPath = (kind: keyof typeof LIBRARY) => join(config.libraryDir, LIBRARY[kind]);

/** Skill dan aset bawaan dari versi lama (<dataDir>/skills, /builtin) dipindah ke pustaka di Videos\CZ Studio, per folder:
 *  yang belum ada di pustaka dipindah (rename), yang sudah ada dibiarkan di tempat lama (tidak ditimpa). Gagal = folder lama tetap. */
export async function migrateLibrary() {
  for (const [old, kind] of [["skills", "skills"], ["builtin", "assets"]] as const) {
    const from = join(config.dataDir, old), to = libraryPath(kind);
    if (!existsSync(from)) continue;
    await mkdir(to, { recursive: true });
    for (const name of await readdir(from)) {
      if (existsSync(join(to, name))) continue;
      try {
        await rename(join(from, name), join(to, name));
        console.log(`Dipindah: ${join(from, name)} → ${join(to, name)}`);
      } catch (e) { console.error(`Tidak bisa memindah ${join(from, name)}: ${(e as Error).message}`); }
    }
  }
}

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Settings {
  /** Perubahan Claude masuk sebagai usulan yang diterima/ditolak user. */
  reviewClaude: boolean;
  /** Bahasa transkrip: auto | id | en. */
  txLang: string;
}
const DEFAULT_SETTINGS: Settings = { reviewClaude: false, txLang: "auto" };
const settingsFile = () => join(config.dataDir, "settings.json");

export function getSettings(): Settings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(settingsFile(), "utf8")) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export async function setSettings(changes: Partial<Settings>): Promise<Settings> {
  const next = { ...getSettings() };
  if (typeof changes.reviewClaude === "boolean") next.reviewClaude = changes.reviewClaude;
  if (changes.txLang === "auto" || changes.txLang === "id" || changes.txLang === "en") next.txLang = changes.txLang;
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(settingsFile(), JSON.stringify(next, null, 2));
  return next;
}

/** Pengaturan proses server; diisi startServer. Satu server = satu user = satu proses. */
export const config = {
  dataDir: join(homedir(), ".cz-studio"),
  port: 4317,
  /** Rahasia untuk server MCP: hanya proses yang dijalankan CZ yang boleh memanggil /api/mcp. */
  token: randomBytes(24).toString("hex"),
  /** Perintah untuk menjalankan CLI ini lagi (server MCP, render): [node, cli.js|cli.ts]. */
  self: [process.execPath, process.argv[1]] as string[],
};

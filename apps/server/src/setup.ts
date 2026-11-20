// Menyiapkan alat yang dibutuhkan CZ di folder data: ffmpeg + ffprobe, whisper-cli, model transkrip.
// Dijalankan saat pemasangan (postinstall), lewat `cz setup`, dan otomatis di latar saat `cz` dibuka bila ada yang kurang.
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { checkClaude, findClaude } from "./claude.ts";
import { config } from "./config.ts";
import { probe, run } from "./media.ts";
import { DEFAULT_MODEL, download, findModel, findWhisper, installModel, installWhisper, unzip } from "./transcribe.ts";

export type SetupState = "menunggu" | "memeriksa" | "mengunduh" | "siap" | "gagal";
export interface SetupStep { id: "ffmpeg" | "whisper" | "model" | "chrome" | "claude"; label: string; state: SetupState; progress: number; note?: string }

export const setup: { steps: SetupStep[]; running: boolean } = {
  running: false,
  steps: [
    { id: "ffmpeg", label: "Pengolah video (ffmpeg)", state: "menunggu", progress: 0 },
    { id: "whisper", label: "Penulis transkrip (whisper)", state: "menunggu", progress: 0 },
    { id: "model", label: "Model bahasa transkrip", state: "menunggu", progress: 0 },
    { id: "chrome", label: "Mesin ekspor (Chrome Headless)", state: "menunggu", progress: 0 },
    { id: "claude", label: "Claude Code", state: "menunggu", progress: 0 },
  ],
};

/** ffmpeg yang dipakai CZ butuh filter thumbnail (tile, fps), normalisasi suara (loudnorm), dan libx264. */
export async function ffmpegWorks(): Promise<boolean> {
  try {
    const filters = await run("ffmpeg", ["-hide_banner", "-filters"]);
    if (!["tile", "fps", "loudnorm", "silencedetect"].every((f) => new RegExp(`\\s${f}\\s`).test(filters))) return false;
    const dir = await mkdtemp(join(tmpdir(), "cz-cek-"));
    try {
      const f = join(dir, "uji.mp4");
      await run("ffmpeg", ["-v", "error", "-nostdin", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", f]);
      return (await probe(f)).width === 64;
    } finally { await rm(dir, { recursive: true, force: true }); }
  } catch { return false; }
}

// Cermin GitHub dulu: gyan.dev bisa sangat lambat (~70 KB/dtk, ~25 menit), GitHub ~20 MB/dtk untuk build yang sama.
const SOURCES = [
  "https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-essentials_build.zip",
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
  "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
];

/** Windows: unduh build ffmpeg lengkap ke <data>/ffmpeg/bin. Sistem lain: lewat paket sistem. */
async function installFfmpeg(onProgress: (p: number) => void) {
  if (process.platform !== "win32") throw new Error("Pasang ffmpeg lewat paket sistem (brew install ffmpeg / apt install ffmpeg)");
  const root = join(config.dataDir, "ffmpeg");
  await mkdir(root, { recursive: true });
  let lastErr: unknown;
  for (const url of SOURCES) {
    const zip = join(root, "ffmpeg.zip");
    const tmp = join(root, "buka");
    try {
      await download(url, zip, "ffmpeg", onProgress);
      await rm(tmp, { recursive: true, force: true });
      await mkdir(tmp, { recursive: true });
      unzip(zip, tmp);
      const exe = await find(tmp, "ffmpeg.exe");
      if (!exe || !existsSync(join(dirname(exe), "ffprobe.exe"))) throw new Error("ffmpeg.exe atau ffprobe.exe tidak ada di arsip");
      await rm(join(root, "bin"), { recursive: true, force: true });
      await cp(dirname(exe), join(root, "bin"), { recursive: true });
      return;
    } catch (e) { lastErr = e; }
    finally { await rm(zip, { force: true }); await rm(zip + ".part", { force: true }); await rm(tmp, { recursive: true, force: true }); }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Gagal mengunduh ffmpeg");
}

async function find(dir: string, name: string, depth = 4): Promise<string | null> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.toLowerCase() === name) return join(dir, e.name);
    if (e.isDirectory() && depth > 0) { const hit = await find(join(dir, e.name), name, depth - 1); if (hit) return hit; }
  }
  return null;
}

/** Claude Code lewat npm (paket resmi @anthropic-ai/claude-code). Login tetap dilakukan user. */
function installClaudeCode(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["install", "-g", "@anthropic-ai/claude-code"], { shell: process.platform === "win32", windowsHide: true });
    let err = "";
    child.stderr?.on("data", (d) => { err = (err + d).slice(-2000); });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split("\n").at(-1) || "npm gagal memasang Claude Code"))));
  });
}

let current: Promise<void> | null = null;

/** Memeriksa lalu memasang yang kurang. onChange dipanggil tiap ada kemajuan (untuk terminal). */
export function ensureSetup(onChange: () => void = () => {}): Promise<void> {
  current ??= (async () => {
    setup.running = true;
    const step = async (id: SetupStep["id"], ok: () => Promise<boolean>, install: (p: (x: number) => void) => Promise<unknown>) => {
      const s = setup.steps.find((x) => x.id === id)!;
      s.state = "memeriksa"; s.progress = 0; s.note = undefined; onChange();
      try {
        if (!(await ok())) {
          s.state = "mengunduh"; onChange();
          await install((x) => { s.progress = x; onChange(); });
          if (!(await ok())) throw new Error("terpasang tapi belum bisa dipakai");
        }
        s.state = "siap"; s.progress = 1;
      } catch (e) { s.state = "gagal"; s.note = (e as Error).message; }
      onChange();
    };
    try {
      await step("ffmpeg", ffmpegWorks, installFfmpeg);
      await step("whisper", async () => !!(await findWhisper()), installWhisper);
      await step("model", async () => !!(await findModel()), (p) => installModel(DEFAULT_MODEL, p));
      // Chrome Headless: ensureBrowser tidak mengunduh ulang bila sudah ada.
      let chromeReady = false;
      await step("chrome", async () => chromeReady, async (p) => {
        const { ensureBrowser } = await import("@remotion/renderer");
        await ensureBrowser({ onBrowserDownload: () => ({ version: null, onProgress: ({ percent }) => p(percent) }) });
        chromeReady = true;
      });
      await step("claude", async () => !!findClaude(), installClaudeCode);
      const c = setup.steps.find((x) => x.id === "claude")!;
      if (c.state === "siap" && (await checkClaude(true)).state !== "terhubung") c.note = "terpasang; masuk lewat tombol Masuk ke Claude di CZ";
    } finally {
      setup.running = false;
      current = null;
      onChange();
    }
  })();
  return current;
}


// Menyiapkan alat yang dibutuhkan CZ di folder data: ffmpeg + ffprobe, whisper-cli, model transkrip.
// Dijalankan saat pemasangan (postinstall), lewat `cz setup`, dan otomatis di latar saat `cz` dibuka bila ada yang kurang.
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { askConsent } from "./consent.ts";
import { builtinReady, installBuiltin } from "./builtin.ts";
import { checkClaude, findClaude } from "./claude.ts";
import { config } from "./config.ts";
import { probe, run } from "./media.ts";
import { installPyEnv, installVision, pyEnvReady, visionReady } from "./pyenv.ts";
import { DEFAULT_MODEL, download, findModel, findWhisper, installModel, installWhisper, unzip } from "./transcribe.ts";

export type SetupState = "menunggu" | "memeriksa" | "mengunduh" | "siap" | "gagal";
export interface SetupStep { id: "ffmpeg" | "whisper" | "model" | "assets" | "chrome" | "python" | "vision" | "claude"; label: string; state: SetupState; progress: number; note?: string }

export const setup: { steps: SetupStep[]; running: boolean } = {
  running: false,
  steps: [
    { id: "ffmpeg", label: "Pengolah video (ffmpeg)", state: "menunggu", progress: 0 },
    { id: "whisper", label: "Penulis transkrip (whisper)", state: "menunggu", progress: 0 },
    { id: "model", label: "Model bahasa transkrip", state: "menunggu", progress: 0 },
    { id: "assets", label: "Aset bawaan (SFX, font)", state: "menunggu", progress: 0 },
    { id: "chrome", label: "Mesin ekspor (Chrome Headless)", state: "menunggu", progress: 0 },
    { id: "python", label: "Mesin skrip skill (Python, OpenCV, ONNX)", state: "menunggu", progress: 0 },
    { id: "vision", label: "Model wajah dan matte subjek", state: "menunggu", progress: 0 },
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

// ffmpeg 7.1.1 essentials dikunci ke satu rilis dan diverifikasi SHA-256 (hash dihitung dari unduhan resmi GyanD/codexffmpeg).
// Sumber "terbaru" (BtbN latest, gyan.dev release) sengaja tidak dipakai karena isinya berubah tanpa bisa diverifikasi.
const FFMPEG = { url: "https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-essentials_build.zip", expect: { sha256: "04861d3339c5ebe38b56c19a15cf2c0cc97f5de4fa8910e4d47e5e6404e4a2d4", size: 92234348 } };
const SOURCES = [FFMPEG.url];

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
      await download(url, zip, "ffmpeg", onProgress, FFMPEG.expect);
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
async function installClaudeCode(): Promise<void> {
  if (!(await askConsent("CZ_ALLOW_CLAUDE_INSTALL", "Pasang Claude Code secara global lewat npm (npm install -g @anthropic-ai/claude-code)?"))) {
    throw new Error("Claude Code belum dipasang. Pasang dari claude.com/claude-code, atau jalankan cz install di terminal dan setujui");
  }
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
      await step("assets", builtinReady, installBuiltin);
      // Chrome Headless: ensureBrowser tidak mengunduh ulang bila sudah ada.
      let chromeReady = false;
      await step("chrome", async () => chromeReady, async (p) => {
        const { ensureBrowser } = await import("@remotion/renderer");
        await ensureBrowser({ onBrowserDownload: () => ({ version: null, onProgress: ({ percent }) => p(percent) }) });
        chromeReady = true;
      });
      await step("python", pyEnvReady, installPyEnv);
      await step("vision", visionReady, installVision);
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


/** Ringkasan untuk user setelah pemasangan: apa yang sudah siap, apa yang masih perlu dikerjakan sendiri, dan cara memulai. */
export function nextSteps(): string[] {
  const st = (id: SetupStep["id"]) => setup.steps.find((x) => x.id === id);
  const todo: string[] = [];
  const bad = (id: SetupStep["id"]) => st(id)?.state !== "siap";
  if (bad("ffmpeg")) todo.push(process.platform === "win32" ? "Pengolah video (ffmpeg) belum siap → jalankan: cz install" : "Pasang ffmpeg lewat paket sistem (brew install ffmpeg / apt install ffmpeg), lalu: cz doctor");
  if (bad("whisper") || bad("model")) todo.push("Transkrip lokal (whisper + model) belum siap → jalankan: cz install");
  if (bad("assets")) todo.push("Aset bawaan (SFX transisi, font) belum terpasang → jalankan: cz install (SFX butuh ffmpeg)");
  if (bad("chrome")) todo.push("Mesin ekspor (Chrome Headless) belum siap → jalankan: cz install (butuh internet sekali)");
  if (bad("python") || bad("vision")) todo.push("Deteksi wajah dan potongan subjek belum aktif. Pasang Python 3.10 sampai 3.13 (python.org, centang Add to PATH), lalu: cz install. Fitur lain tetap jalan");
  const c = st("claude");
  if (c?.state !== "siap") todo.push("Fitur AI (opsional): pasang Claude Code dengan `npm install -g @anthropic-ai/claude-code`, jalankan `claude` sekali untuk login (butuh langganan Pro/Max). Tanpa itu, semua fitur non-AI tetap jalan");
  else if (c.note) todo.push("Fitur AI (opsional): Claude Code sudah terpasang, tinggal login: jalankan `claude` sekali");
  return [
    todo.length ? "CZ Studio terpasang. Yang masih perlu Anda lakukan:" : "CZ Studio terpasang dan semua alat siap.",
    ...todo.map((t, i) => `  ${i + 1}. ${t}`),
    "",
    "Mulai: ketik `cz` lalu Enter (membuka CZ Studio di browser).",
    "Cek kesiapan kapan saja: `cz doctor`.",
  ];
}

// Transkrip per kata secara lokal dengan whisper.cpp. Audio tidak pernah keluar dari komputer.
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "./config.ts";
import { run } from "./media.ts";

/** Ukuran unduhan (MB). small-q5_1 = model small yang dipadatkan: ketepatan hampir sama, kurang dari separuh ukuran. */
export const MODELS = { base: 148, "small-q5_1": 190, small: 488, medium: 1530 } as const;
export type ModelName = keyof typeof MODELS;
export const DEFAULT_MODEL: ModelName = "small-q5_1";

const exe = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
const binDir = () => join(config.dataDir, "whisper");
const modelDir = () => join(config.dataDir, "models");

async function findIn(dir: string, name: string, depth = 3): Promise<string | null> {
  if (!existsSync(dir) || depth < 0) return null;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.toLowerCase() === name) return join(dir, e.name);
    if (e.isDirectory()) { const hit = await findIn(join(dir, e.name), name, depth - 1); if (hit) return hit; }
  }
  return null;
}

/** Biner whisper-cli: folder data dulu, lalu PATH. */
export async function findWhisper(): Promise<string | null> {
  const local = await findIn(binDir(), exe);
  if (local) return local;
  const r = spawnSync(process.platform === "win32" ? "where" : "which", ["whisper-cli"], { encoding: "utf8", windowsHide: true });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() || null : null;
}

export async function findModel(): Promise<string | null> {
  for (const name of [DEFAULT_MODEL, "small", "medium", "base"] as ModelName[]) {
    const f = join(modelDir(), `ggml-${name}.bin`);
    if (existsSync(f)) return f;
  }
  return null;
}

export async function engineStatus() {
  const [bin, model] = [await findWhisper(), await findModel()];
  return { ready: !!bin && !!model, bin, model };
}

/** Unduh ke dest (lewat .part). Tanpa onProgress: kemajuan dicetak ke terminal. */
export async function download(url: string, dest: string, label: string, onProgress?: (p: number) => void) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Gagal mengunduh ${label} (${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  let got = 0, shown = -1;
  const body = Readable.fromWeb(res.body as never);
  body.on("data", (c: Buffer) => {
    got += c.length;
    const pct = total ? Math.floor((got / total) * 100) : -1;
    if (onProgress) { if (total) onProgress(got / total); return; }
    if (pct !== shown && pct % 5 === 0) { shown = pct; process.stdout.write(`\r${label}: ${pct}% `); }
  });
  await pipeline(body, createWriteStream(dest + ".part"));
  await rename(dest + ".part", dest);
  if (!onProgress) process.stdout.write(`\r${label}: selesai        \n`);
}

/** tar bawaan Windows 10+ bisa membuka zip; di sistem lain unzip. */
export function unzip(zip: string, dir: string) {
  const r = process.platform === "win32"
    ? spawnSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", zip, "-C", dir], { windowsHide: true })
    : spawnSync("unzip", ["-oq", zip, "-d", dir]);
  if (r.status !== 0) throw new Error("Gagal membuka arsip unduhan");
}

export async function installModel(model: ModelName = DEFAULT_MODEL, onProgress?: (p: number) => void) {
  await mkdir(modelDir(), { recursive: true });
  const mf = join(modelDir(), `ggml-${model}.bin`);
  if (!existsSync(mf)) await download(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`, mf, `Model ${model} (~${MODELS[model]} MB)`, onProgress);
  return mf;
}

/** whisper-cli resmi dari rilis whisper.cpp (Windows). Sistem lain: paket sistem. */
export async function installWhisper(onProgress?: (p: number) => void) {
  if (await findWhisper()) return;
  if (process.platform !== "win32") throw new Error("Pasang whisper-cli lewat paket sistem (mis. brew install whisper-cpp)");
  const rel = await fetch("https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=10").then((r) => r.json()) as { assets?: { name: string; browser_download_url: string }[] }[];
  const asset = rel.flatMap((r) => r.assets ?? []).find((a) => a.name === "whisper-bin-x64.zip");
  if (!asset) throw new Error("Biner whisper.cpp untuk Windows tidak ditemukan di rilis terbaru");
  await mkdir(binDir(), { recursive: true });
  const zip = join(binDir(), "whisper.zip");
  await download(asset.browser_download_url, zip, "whisper-cli", onProgress);
  try { unzip(zip, binDir()); } finally { await rm(zip, { force: true }); }
  if (!(await findWhisper())) throw new Error("whisper-cli.exe tidak ada di dalam arsip");
}

/** `cz models install`: model ggml dari Hugging Face dan (di Windows) whisper-cli dari rilis resmi whisper.cpp. */
/** `cz models install`: model + whisper-cli, kemajuan di terminal. */
export async function installModels(model: ModelName = DEFAULT_MODEL) {
  const mf = await installModel(model);
  console.log(`Model ${model}: ${mf}`);
  if (await findWhisper()) { console.log("whisper-cli sudah terpasang."); return; }
  try { await installWhisper(); console.log("whisper-cli terpasang."); }
  catch (e) { console.log((e as Error).message); }
}

export interface TxWord { text: string; srcStart: number; srcEnd: number; estimated: boolean }

/** Transkrip satu file. lang: "auto" | "id" | "en". */
export async function transcribe(src: string, cacheDir: string, lang: string, onProgress: (p: number) => void): Promise<TxWord[]> {
  const { bin, model } = await engineStatus();
  if (!bin || !model) throw new Error("Model transkrip belum dipasang. Jalankan: cz models install");
  await mkdir(cacheDir, { recursive: true });
  const wav = join(cacheDir, `tx-${Date.now()}.wav`);
  const out = wav.replace(/\.wav$/, "");
  try {
    await run("ffmpeg", ["-y", "-v", "error", "-nostdin", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
    // -ml 1 -sow: satu segmen per kata, dengan offset ms.
    await run(bin, ["-m", model, "-f", wav, "-l", lang, "-ml", "1", "-sow", "-oj", "-of", out, "-pp", "-np"], undefined, (chunk) => {
      const m = /progress\s*=\s*(\d+)%/.exec(chunk.toString());
      if (m) onProgress(Number(m[1]) / 100);
    });
    const json = JSON.parse(await readFile(out + ".json", "utf8")) as { transcription?: { offsets: { from: number; to: number }; text: string }[] };
    return parseWhisper(json);
  } finally {
    await rm(wav, { force: true });
    await rm(out + ".json", { force: true });
  }
}

export function parseWhisper(json: { transcription?: { offsets: { from: number; to: number }; text: string }[] }): TxWord[] {
  const words: TxWord[] = [];
  for (const seg of json.transcription ?? []) {
    const text = seg.text.trim();
    if (!text || /^[[(].*[\])]$/.test(text)) continue; // [BLANK_AUDIO], (musik)
    // Tanda baca yang berdiri sendiri digabung ke kata sebelumnya.
    if (!/[\p{L}\p{N}]/u.test(text) && words.length) { words.at(-1)!.text += text; continue; }
    const s = seg.offsets.from / 1000, e = seg.offsets.to / 1000;
    words.push({ text, srcStart: s, srcEnd: Math.max(e, s + 0.02), estimated: e <= s });
  }
  return words;
}

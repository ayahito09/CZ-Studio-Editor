// Transkrip per kata secara lokal dengan whisper.cpp. Audio tidak pernah keluar dari komputer.
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "./config.ts";
import { run } from "./media.ts";

export const MODELS = { base: 148, small: 488, medium: 1530 } as const;
export type ModelName = keyof typeof MODELS;
export const DEFAULT_MODEL: ModelName = "small";

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
  for (const name of [DEFAULT_MODEL, "medium", "base"] as ModelName[]) {
    const f = join(modelDir(), `ggml-${name}.bin`);
    if (existsSync(f)) return f;
  }
  return null;
}

export async function engineStatus() {
  const [bin, model] = [await findWhisper(), await findModel()];
  return { ready: !!bin && !!model, bin, model };
}

async function download(url: string, dest: string, label: string) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Gagal mengunduh ${label} (${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  let got = 0, shown = -1;
  const body = Readable.fromWeb(res.body as never);
  body.on("data", (c: Buffer) => {
    got += c.length;
    const pct = total ? Math.floor((got / total) * 100) : -1;
    if (pct !== shown && pct % 5 === 0) { shown = pct; process.stdout.write(`\r${label}: ${pct}% `); }
  });
  await pipeline(body, createWriteStream(dest + ".part"));
  await rename(dest + ".part", dest);
  process.stdout.write(`\r${label}: selesai        \n`);
}

/** `cz models install`: model ggml dari Hugging Face dan (di Windows) whisper-cli dari rilis resmi whisper.cpp. */
export async function installModels(model: ModelName = DEFAULT_MODEL) {
  await mkdir(modelDir(), { recursive: true });
  const mf = join(modelDir(), `ggml-${model}.bin`);
  if (existsSync(mf)) console.log(`Model ${model} sudah ada: ${mf}`);
  else await download(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`, mf, `Model ${model} (~${MODELS[model]} MB)`);

  if (await findWhisper()) { console.log("whisper-cli sudah terpasang."); return; }
  if (process.platform !== "win32") {
    console.log("Pasang whisper-cli lewat paket sistem (mis. brew install whisper-cpp), lalu jalankan cz doctor.");
    return;
  }
  const rel = await fetch("https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=10").then((r) => r.json()) as { assets?: { name: string; browser_download_url: string }[] }[];
  const asset = rel.flatMap((r) => r.assets ?? []).find((a) => a.name === "whisper-bin-x64.zip");
  if (!asset) throw new Error("Biner whisper.cpp untuk Windows tidak ditemukan di rilis terbaru");
  await mkdir(binDir(), { recursive: true });
  const zip = join(binDir(), "whisper.zip");
  await download(asset.browser_download_url, zip, "whisper-cli");
  // tar bawaan Windows 10+ bisa membuka zip.
  const t = spawnSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", zip, "-C", binDir()], { windowsHide: true });
  await rm(zip, { force: true });
  if (t.status !== 0) throw new Error("Gagal membuka zip whisper.cpp");
  if (!(await findWhisper())) throw new Error("whisper-cli.exe tidak ada di dalam zip");
  console.log("whisper-cli terpasang.");
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

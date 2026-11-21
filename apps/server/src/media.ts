// Mesin media: probe, proxy, thumbnail strip, dan waveform lewat ffmpeg/ffprobe milik user.
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join } from "node:path";
import { PEAKS_PER_SEC, thumbPlan, type Media } from "@cz/core";
import { toolBin } from "./config.ts";

export const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi", ".mts", ".m2ts", ".mpg", ".mpeg", ".wmv", ".flv", ".3gp"]);
const exists = (p: string) => access(p).then(() => true, () => false);

export const mediaFile = (folder: string, m: Media) => (isAbsolute(m.path) ? m.path : join(folder, m.path));
export const derived = (folder: string, m: Media) => ({
  proxy: join(folder, m.proxy),
  thumbs: join(folder, "cache", `${m.id}.thumbs.jpg`),
  peaks: join(folder, "cache", `${m.id}.peaks.bin`),
  env: join(folder, "cache", `${m.id}.env.bin`),
});

/** Jendela amplop per detik (5 ms) untuk deteksi jeda dan pemeriksaan sambungan. */
export const ENV_RATE = 200;

/** Level RMS dBFS per 5 ms dari file asli (bukan proxy), di-cache sebagai Float32. */
export async function envelope(folder: string, m: Media): Promise<Float32Array> {
  const file = derived(folder, m).env;
  if (await exists(file)) { const b = await readFile(file); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); }
  const per = 16000 / ENV_RATE;
  const out: number[] = [];
  let carry: Buffer = Buffer.alloc(0), sum = 0, count = 0;
  await run("ffmpeg", ["-v", "error", "-nostdin", "-i", mediaFile(folder, m), "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], (chunk) => {
    const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const usable = buf.length - (buf.length % 2);
    for (let i = 0; i < usable; i += 2) {
      const v = buf.readInt16LE(i) / 32768;
      sum += v * v;
      if (++count === per) { out.push(sum > 0 ? Math.max(-100, 10 * Math.log10(sum / per)) : -100); sum = 0; count = 0; }
    }
    carry = buf.subarray(usable);
  });
  const arr = Float32Array.from(out);
  await mkdir(join(folder, "cache"), { recursive: true });
  await writeFile(file, Buffer.from(arr.buffer));
  return arr;
}

/** Nama file aman untuk folder media: tanpa path, tanpa karakter aneh. */
export function safeName(name: string) {
  const base = basename(name).replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(-120);
  return base && base !== "." && base !== ".." ? base : "video.mp4";
}

let active = new Set<ChildProcess>();
export const killAll = () => { for (const c of active) c.kill(); active = new Set(); };

export function run(cmd: string, args: string[], onStdout?: (chunk: Buffer) => void, onStderr?: (chunk: Buffer) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try { child = spawn(cmd === "ffmpeg" || cmd === "ffprobe" ? toolBin(cmd) : cmd, args, { windowsHide: true }); }
    catch (e) { return reject(e); }
    active.add(child);
    let out = "", err = "";
    child.stdout!.on("data", (d: Buffer) => (onStdout ? onStdout(d) : (out += d)));
    child.stderr!.on("data", (d: Buffer) => { err = (err + d).slice(-4000); onStderr?.(d); });
    child.on("error", (e: NodeJS.ErrnoException) => {
      active.delete(child);
      reject(e.code === "ENOENT" ? new Error(`Alat pengolah video (${cmd}) belum terpasang. Buka Terminal lalu ketik: cz setup`) : e);
    });
    child.on("close", (code) => {
      active.delete(child);
      code === 0 ? resolve(out) : reject(new Error(`${cmd} gagal (kode ${code}): ${err.trim().split("\n").at(-1) ?? ""}`));
    });
  });
}

const rate = (s: unknown) => {
  if (typeof s !== "string") return 0;
  const [a, b] = s.split("/").map(Number);
  return b ? a / b : a || 0;
};

/** Metadata lewat ffprobe JSON. Hanya field dasar yang dipakai supaya ffprobe versi minimal pun cukup. */
export async function probe(file: string) {
  const json = JSON.parse(await run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file]));
  const streams: Record<string, unknown>[] = json.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  if (!v) throw new Error("File ini tidak berisi video");
  const duration = Number(json.format?.duration ?? v.duration);
  if (!(duration > 0)) throw new Error("Durasi video tidak terbaca");
  let width = Number(v.width), height = Number(v.height);
  // Video ponsel sering disimpan miring dengan metadata rotasi; ffmpeg memutarnya otomatis.
  const sideData = (v.side_data_list as { rotation?: number }[] | undefined) ?? [];
  const rot = Math.abs(Number((v.tags as { rotate?: string } | undefined)?.rotate ?? sideData.find((d) => d.rotation !== undefined)?.rotation ?? 0)) % 180;
  if (rot === 90) [width, height] = [height, width];
  const fps = rate(v.avg_frame_rate) || rate(v.r_frame_rate) || 30;
  return { duration, width, height, fps: Math.round(fps * 1000) / 1000, hasAudio: streams.some((s) => s.codec_type === "audio") };
}

/**
 * File yang dibaca render: H.264 dengan frame rate tetap, resolusi asli. Remotion gagal ("No frame found at position")
 * pada HEVC / frame rate variabel seperti MOV iPhone. File asli tidak diubah; hasilnya di-cache di folder proxy.
 */
export async function renderSource(folder: string, m: Media, onProgress?: (frac: number) => void): Promise<string> {
  const src = mediaFile(folder, m);
  const codec = (await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", src])).trim();
  if (codec === "h264" && extname(src).toLowerCase() === ".mp4") return src;
  const out = join(folder, "proxy", `${m.id}.render.mp4`);
  if (await exists(out)) return out;
  await mkdir(join(folder, "proxy"), { recursive: true });
  const tmp = out + ".tmp.mp4";
  await run("ffmpeg", [
    "-y", "-v", "error", "-nostdin", "-i", src, "-progress", "pipe:1", "-nostats",
    "-r", String(Math.round(m.fps) || 30), "-fps_mode", "cfr",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p",
    ...(m.hasAudio ? ["-c:a", "aac", "-b:a", "256k"] : ["-an"]),
    "-movflags", "+faststart", tmp,
  ], (chunk) => {
    const us = /out_time_us=(\d+)/.exec(chunk.toString());
    if (us) onProgress?.(Math.min(1, Number(us[1]) / 1e6 / m.duration));
  }).catch(async (e) => { await rm(tmp, { force: true }); throw e; });
  await rename(tmp, out);
  return out;
}

export type Stage = "menunggu" | "proxy" | "thumbnail" | "waveform" | "siap" | "gagal";
export interface JobStatus { stage: Stage; progress: number; error?: string }

/** Antrean persiapan latar belakang per proyek: satu media dikerjakan pada satu waktu. */
export class MediaJobs {
  status = new Map<string, JobStatus>();
  private queue: Promise<void> = Promise.resolve();
  private folder: string;
  /** Dipanggil saat proxy/thumbnail/waveform media siap (dipakai untuk transkrip otomatis). */
  onReady: (m: Media) => void = () => {};
  constructor(folder: string) { this.folder = folder; }

  /** Menjadwalkan media yang hasil olahannya belum lengkap. */
  async ensure(media: Media[]) {
    for (const m of media) {
      if (this.status.has(m.id) && this.status.get(m.id)!.stage !== "gagal") continue;
      const d = derived(this.folder, m);
      if ((await exists(d.proxy)) && (await exists(d.thumbs)) && (!m.hasAudio || (await exists(d.peaks)))) {
        this.status.set(m.id, { stage: "siap", progress: 1 });
        this.onReady(m);
        continue;
      }
      this.status.set(m.id, { stage: "menunggu", progress: 0 });
      this.queue = this.queue.then(() => this.prepare(m)).catch(() => {});
    }
  }

  private async prepare(m: Media) {
    const st = this.status.get(m.id)!;
    const d = derived(this.folder, m);
    const src = mediaFile(this.folder, m);
    try {
      await mkdir(join(this.folder, "proxy"), { recursive: true });
      await mkdir(join(this.folder, "cache"), { recursive: true });

      if (!(await exists(d.proxy))) {
        st.stage = "proxy"; st.progress = 0;
        const tmp = d.proxy + ".tmp.mp4";
        const shortSide = "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)'";
        await run("ffmpeg", [
          "-y", "-v", "error", "-nostdin", "-i", src, "-progress", "pipe:1", "-nostats",
          "-vf", shortSide, "-r", String(Math.round(m.fps) || 30), "-fps_mode", "cfr",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-g", "15", "-keyint_min", "15", "-sc_threshold", "0", "-pix_fmt", "yuv420p",
          ...(m.hasAudio ? ["-c:a", "aac", "-b:a", "128k", "-ac", "2"] : ["-an"]),
          "-movflags", "+faststart", tmp,
        ], (chunk) => {
          const us = /out_time_us=(\d+)/.exec(chunk.toString());
          if (us) st.progress = Math.min(1, Number(us[1]) / 1e6 / m.duration);
        });
        await rename(tmp, d.proxy);
      }

      if (!(await exists(d.thumbs))) {
        st.stage = "thumbnail"; st.progress = 0;
        const t = thumbPlan(m);
        await run("ffmpeg", [
          "-y", "-v", "error", "-nostdin", "-i", d.proxy,
          "-vf", `fps=1000/${Math.round(t.interval * 1000)},scale=${t.tileW}:${t.tileH},tile=${t.count}x1`,
          "-frames:v", "1", "-q:v", "5", d.thumbs,
        ]);
      }

      if (m.hasAudio && !(await exists(d.peaks))) {
        st.stage = "waveform"; st.progress = 0;
        const per = 8000 / PEAKS_PER_SEC;
        const peaks: number[] = [];
        let carry: Buffer = Buffer.alloc(0), max = 0, count = 0;
        await run("ffmpeg", ["-v", "error", "-nostdin", "-i", d.proxy, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], (chunk) => {
          const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
          const usable = buf.length - (buf.length % 2);
          for (let i = 0; i < usable; i += 2) {
            const s = Math.abs(buf.readInt16LE(i));
            if (s > max) max = s;
            if (++count === per) { peaks.push(Math.min(255, Math.round((max / 32768) * 255))); max = 0; count = 0; }
          }
          carry = buf.subarray(usable);
          st.progress = Math.min(1, peaks.length / PEAKS_PER_SEC / m.duration);
        });
        if (count) peaks.push(Math.min(255, Math.round((max / 32768) * 255)));
        await writeFile(d.peaks, Uint8Array.from(peaks));
      }
      st.stage = "siap"; st.progress = 1;
      this.onReady(m);
    } catch (e) {
      st.stage = "gagal"; st.error = (e as Error).message;
      await rm(d.proxy + ".tmp.mp4", { force: true });
    }
  }
}

/** Menulis stream upload ke folder media dengan nama unik. */
export async function saveUpload(folder: string, name: string, body: NodeJS.ReadableStream): Promise<string> {
  const ext = extname(name).toLowerCase();
  if (!VIDEO_EXT.has(ext)) throw new Error(`Format ${ext || "tanpa ekstensi"} tidak didukung (MP4, MOV, MKV, WebM, AVI, MTS, MPG, WMV, FLV, 3GP)`);
  await mkdir(join(folder, "media"), { recursive: true });
  let rel = join("media", safeName(name));
  for (let i = 2; await exists(join(folder, rel)); i++) rel = join("media", `${basename(safeName(name), ext)} (${i})${ext}`);
  const tmp = join(folder, rel + ".part");
  try {
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(tmp);
      body.on("error", reject);
      out.on("error", reject);
      out.on("finish", resolve);
      body.pipe(out);
    });
    await rename(tmp, join(folder, rel));
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  return rel.replaceAll("\\", "/");
}

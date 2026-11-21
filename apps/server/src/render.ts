// Render memakai komposisi Remotion yang sama dengan Player, jadi file akhir = yang terlihat di editor.
import { existsSync } from "node:fs";
import { cpus, freemem } from "node:os";
import type { OpenGlRenderer } from "@remotion/renderer";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyOp, filledRange, type Project } from "@cz/core";
import { config, getSettings, type RenderEngine } from "./config.ts";
import { mediaFile, nvencWorks, renderSource, run, safeName } from "./media.ts";
import { builtinSfxRoles } from "./builtin.ts";
import { listPacks } from "./packs.ts";
import { subjectFile } from "./faces.ts";
import { compositionLib, type Library } from "./skills.ts";

const here = dirname(fileURLToPath(import.meta.url));

export interface RenderSettings {
  width: number; height: number;
  fps: number;
  codec: "h264" | "h265" | "prores";
  crf: number;
  normalize: boolean;
  /** Mesin render untuk ekspor ini (CLI --cpu/--gpu); tanpa ini dipakai Pengaturan. */
  engine?: RenderEngine;
  /** Sampel motion blur shutter per frame bergerak (0 = mati). Bawaan MOTION_BLUR. */
  motionBlur?: number;
  range: "all" | "inout" | "scene";
  inFrame?: number; outFrame?: number; sceneId?: string;
  outDir?: string;
}
/** Konkurensi render: ±75% core, dibatasi RAM kosong (±1,2 GB per tab Chrome). CZ_RENDER_CONCURRENCY=n menggantinya. */
export function renderConcurrency(): number {
  const env = Number(process.env.CZ_RENDER_CONCURRENCY);
  if (Number.isInteger(env) && env >= 1) return env;
  return Math.max(1, Math.min(Math.floor(cpus().length * 0.75), Math.floor(freemem() / 1.2e9)));
}
/** Mode GL Chrome: ANGLE (Direct3D) di Windows lebih cepat untuk blur dan transform, hasil piksel sama. CZ_RENDER_GL=default mematikannya. */
export function renderGl(): OpenGlRenderer | null {
  const e = process.env.CZ_RENDER_GL;
  if (e === "default") return null;
  if (e) return e as OpenGlRenderer;
  return process.platform === "win32" ? "angle" : null;
}

const GPU_ERR = /\bgl\b|angle|gpu|webgl|graphics|context lost|target closed|crash|nvenc|nvcuda|encoder|hardware/i;
/** Bitrate NVENC setara CRF x264 pilihan user: CRF 18 ≈ 0,2 bit per piksel per frame, tiap −6 CRF ≈ 2× bitrate. */
export const gpuBitrate = (s: Pick<RenderSettings, "width" | "height" | "fps" | "crf">) =>
  `${Math.max(4, Math.round((s.width * s.height * s.fps * 0.2 * Math.pow(2, (18 - s.crf) / 6)) / 1e6))}M`;

/** Motion blur wajib di render final: 5 sampel shutter 180° hanya di frame yang bergerak. */
export const MOTION_BLUR = 5;
export type RenderState = "antre" | "menyiapkan" | "render" | "audio" | "selesai" | "gagal" | "batal";
export interface RenderJob {
  id: string; folder: string; title: string; settings: RenderSettings;
  state: RenderState; progress: number; frames: number; eta: number | null;
  output?: string; error?: string; note?: string; startedAt?: number; endedAt?: number;
}

let serveUrlPromise: Promise<string> | null = null;
/** Paket npm membawa bundel jadi (dist/render-bundle). Dari sumber: dibundel sekali per proses. */
export function serveUrl(): Promise<string> {
  const packaged = join(here, "render-bundle");
  if (existsSync(join(packaged, "index.html"))) return Promise.resolve(packaged);
  serveUrlPromise ??= (async () => {
    const { bundle } = await import("@remotion/bundler");
    return bundle({ entryPoint: join(here, "../../../packages/composition/src/entry.tsx"), outDir: join(config.dataDir, "bundle-dev") });
  })().catch((e) => { serveUrlPromise = null; throw e; });
  return serveUrlPromise;
}

const base = () => `http://127.0.0.1:${config.port}`;
/** File yang boleh dibaca Chrome headless lewat /api/file (hanya yang didaftarkan render). */
export const renderFiles = new Set<string>();
export const fileUrl = (path: string) => { renderFiles.add(path); return `${base()}/api/file?t=${config.token}&f=${encodeURIComponent(path)}`; };

/** Props komposisi untuk render: file asli (atau proxy untuk frame cepat) lewat server lokal ini. */
export async function renderProps(folder: string, project: Project, lib: Library | null, useProxy: boolean, out?: { width: number; height: number }, files?: Record<string, string>) {
  const src = Object.fromEntries(project.media.map((m) => [m.id, fileUrl(useProxy && m.kind !== "image" ? join(folder, m.proxy) : files?.[m.id] ?? mediaFile(folder, m))]));
  return {
    project, src,
    lib: lib ? await compositionLib(lib, `${base()}/api/skills/${lib.id}/${lib.version}/file/`, folder, project.media.map((m) => m.id), (_id, p) => fileUrl(p)) : null,
    output: out ?? { width: project.sequence.width, height: project.sequence.height },
    subjects: Object.fromEntries(project.media.filter((m) => existsSync(subjectFile(folder, m.id))).map((m) => [m.id, fileUrl(subjectFile(folder, m.id))])),
    builtinSfx: { base: `${base()}/api/builtin/`, roles: await builtinSfxRoles() },
    packs: (await listPacks()).map((p) => ({ ...p, url: `${base()}/api/packs/${p.id}/pack.js` })),
  };
}

let browserReady: Promise<unknown> | null = null;
async function prepare(onNote: (s: string) => void) {
  const r = await import("@remotion/renderer");
  if (!browserReady) {
    onNote("Mengunduh alat ekspor (sekali saja, sekitar 130 MB)…");
    browserReady = r.ensureBrowser().catch((e) => { browserReady = null; throw e; });
  }
  await browserReady;
  onNote("Menyiapkan video…");
  return { r, url: await serveUrl() };
}

/** Frame komposit untuk diperiksa Claude (cz_get_frame); memakai proxy supaya cepat. */
export async function stillFrame(folder: string, project: Project, lib: Library | null, frame: number, outFile: string, scale = 0.5) {
  const { r, url } = await prepare(() => {});
  const inputProps = await renderProps(folder, project, lib, true);
  const composition = await r.selectComposition({ serveUrl: url, id: "cz", inputProps });
  await mkdir(dirname(outFile), { recursive: true });
  await r.renderStill({ serveUrl: url, composition, inputProps, frame: Math.max(0, Math.min(composition.durationInFrames - 1, frame)), output: outFile, imageFormat: "jpeg", jpegQuality: 80, scale });
  return outFile;
}

/** Pesan gagal yang bisa ditindaklanjuti: penyebab umum diterjemahkan, sisanya 3 baris pertama pesan aslinya. */
export function friendlyError(e: Error): string {
  const m = e?.message ?? String(e);
  if (/ENOSPC|no space left/i.test(m)) return "Ruang disk penuh. Kosongkan ruang lalu coba lagi.";
  if (/EACCES|EPERM|EBUSY|permission denied/i.test(m)) return "Tidak bisa menulis ke folder tujuan. Pilih folder lain atau tutup file yang sedang dibuka.";
  if (/ffmpeg/i.test(m) && /not found|ENOENT/i.test(m)) return "ffmpeg tidak ditemukan. Jalankan cz install lalu coba lagi.";
  if (/ensureBrowser|chrome-headless|download/i.test(m) && /fail|ENOTFOUND|ECONN/i.test(m)) return "Alat ekspor gagal diunduh. Periksa koneksi internet lalu coba lagi.";
  return m.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 3).join(" · ").slice(0, 400);
}

/** Antrean render global: satu render berjalan pada satu waktu, memakai snapshot proyek saat tombol ditekan. */
export class RenderQueue {
  jobs: RenderJob[] = [];
  private snapshots = new Map<string, { project: Project; lib: Library | null }>();
  private cancel: (() => void) | null = null;
  private seq = 0;
  private running = false;

  enqueue(folder: string, project: Project, lib: Library | null, settings: RenderSettings): RenderJob {
    const job: RenderJob = { id: "r" + ++this.seq, folder, title: project.title, settings, state: "antre", progress: 0, frames: 0, eta: null };
    this.jobs.push(job);
    this.snapshots.set(job.id, { project, lib });
    void this.next();
    return job;
  }

  /** Untuk render dari terminal: tunggu sampai job selesai. */
  wait(id: string): Promise<RenderJob> {
    return new Promise((resolve) => {
      const t = setInterval(() => {
        const j = this.jobs.find((x) => x.id === id)!;
        if (["selesai", "gagal", "batal"].includes(j.state)) { clearInterval(t); resolve(j); }
      }, 500);
    });
  }

  stop(id: string) {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) return;
    if (j.state === "antre") j.state = "batal";
    else if (!["selesai", "gagal", "batal"].includes(j.state)) { j.state = "batal"; this.cancel?.(); }
  }

  get busy() { return this.jobs.some((j) => !["selesai", "gagal", "batal"].includes(j.state)); }

  private async next() {
    if (this.running) return;
    const job = this.jobs.find((j) => j.state === "antre");
    if (!job) return;
    this.running = true;
    try { await this.render(job); }
    catch (e) { if (job.state !== "batal") { job.state = "gagal"; job.error = friendlyError(e as Error); } }
    finally {
      job.endedAt = Date.now();
      this.snapshots.delete(job.id);
      this.cancel = null;
      this.running = false;
      void this.next();
    }
  }

  private async render(job: RenderJob) {
    const snap = this.snapshots.get(job.id)!;
    const s = job.settings;
    job.state = "menyiapkan"; job.startedAt = Date.now();
    let project = snap.project;
    if (s.fps !== project.sequence.fps) project = applyOp(project, { type: "setSequence", width: project.sequence.width, height: project.sequence.height, fps: s.fps })[0];
    const k = s.fps / snap.project.sequence.fps;
    let from = 0, to = project.sequence.durationFrames - 1;
    if (s.range === "inout" && s.inFrame !== undefined && s.outFrame !== undefined) { from = Math.round(s.inFrame * k); to = Math.round(s.outFrame * k) - 1; }
    if (s.range === "scene") {
      const sc = project.scenes.find((x) => x.id === s.sceneId);
      if (!sc) throw new Error("Bagian rencana tidak ditemukan");
      from = sc.start; to = sc.end - 1;
    }
    if (s.range === "all") {
      // Hanya bagian yang berisi video atau elemen: ujung kosong (mis. subtitle sisa setelah klip dihapus) tidak ikut.
      const f = filledRange(project);
      if (!f) throw new Error("Proyek kosong: belum ada klip video atau elemen di timeline");
      [from, to] = [f[0], f[1] - 1];
    }
    to = Math.min(to, project.sequence.durationFrames - 1);
    if (!(to >= from)) throw new Error("Bagian yang diekspor kosong");
    for (const m of project.media) if (!existsSync(mediaFile(job.folder, m)) && project.clips.some((c) => c.mediaId === m.id)) throw new Error(`File video tidak ditemukan: ${m.name}`);

    const { r, url } = await prepare((n) => { job.note = n; });
    if ((job.state as RenderState) === "batal") return;
    const engine = s.engine ?? getSettings().renderEngine;
    const files: Record<string, string> = {};
    for (const m of project.media.filter((x) => project.clips.some((c) => c.mediaId === x.id))) {
      job.note = `Menyiapkan ${m.name} untuk ekspor (sekali saja per video)`;
      files[m.id] = await renderSource(job.folder, m, (f) => { job.note = `Menyiapkan ${m.name} untuk ekspor · ${Math.round(f * 100)}%`; }, engine === "gpu");
      if ((job.state as RenderState) === "batal") return;
    }
    const inputProps = { ...(await renderProps(job.folder, project, snap.lib, false, { width: s.width, height: s.height }, files)), motionBlur: s.motionBlur ?? MOTION_BLUR };
    const gl = engine === "cpu" ? null : renderGl();
    const composition = await r.selectComposition({ serveUrl: url, id: "cz", inputProps, ...(gl ? { chromiumOptions: { gl } } : {}) });
    const ext = s.codec === "prores" ? "mov" : "mp4";
    const dir = s.outDir ?? join(job.folder, "render");
    await mkdir(dir, { recursive: true });
    // Waktu lokal sampai detik + nomor bila bentrok: render lama tidak pernah tertimpa.
    const d = new Date(), z = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
    const baseName = safeName(`${project.title}${s.range === "scene" ? "-" + s.sceneId : ""}-${stamp}`);
    let name = `${baseName}.${ext}`;
    for (let i = 2; existsSync(join(dir, name)); i++) name = `${baseName} (${i}).${ext}`;
    const out = join(dir, name);
    const raw = join(dir, `.${name}.raw.${ext}`);
    const { cancelSignal, cancel } = r.makeCancelSignal();
    this.cancel = cancel;
    job.state = "render"; job.note = undefined;
    const t0 = Date.now();
    const concurrency = renderConcurrency();
    // Penyandian GPU (NVENC) hanya di mesin "gpu" dan bila kartu NVIDIA bisa menyandi (diuji sekali); ProRes selalu CPU.
    const gpu = engine === "gpu" && s.codec !== "prores" && (await nvencWorks());
    const go = (glMode: OpenGlRenderer | null, useGpu: boolean) => r.renderMedia({
      serveUrl: url, composition, inputProps, outputLocation: raw, cancelSignal, concurrency,
      ...(glMode ? { chromiumOptions: { gl: glMode } } : {}),
      // Bawaan Remotion 30 dtk per pengambilan frame video; footage 1080p 60 fps di komputer yang sibuk bisa lebih lama dari itu.
      timeoutInMilliseconds: 180_000,
      codec: s.codec,
      ...(s.codec === "prores" ? { proResProfile: "standard" as const }
        // NVENC tidak menerima CRF: bitrate setara CRF pilihan user (lihat gpuBitrate).
        : useGpu ? { hardwareAcceleration: "required" as const, videoBitrate: gpuBitrate(s) }
        : { crf: s.crf, ...(s.codec === "h264" ? { x264Preset: "fast" as const } : {}) }),
      frameRange: [from, to], audioCodec: s.codec === "prores" ? "pcm-16" : "aac", audioBitrate: "192k",
      onProgress: (p) => {
        job.progress = p.progress; job.frames = p.renderedFrames;
        job.eta = p.progress > 0.02 ? Math.round(((Date.now() - t0) / p.progress) * (1 - p.progress) / 1000) : null;
      },
    });
    job.note = gpu ? "GPU (NVENC)" : gl ? "Gambar GPU, penyandian CPU" : "CPU";
    try {
      await go(gl, gpu);
    } catch (e) {
      // GPU bermasalah (driver ANGLE atau NVENC): ulangi sekali sepenuhnya di CPU, kecuali dibatalkan user.
      if ((!gl && !gpu) || (job.state as RenderState) === "batal" || !GPU_ERR.test(String((e as Error)?.message))) throw e;
      job.note = "GPU bermasalah, mengulang di CPU";
      await go(null, false);
    }
    if ((job.state as RenderState) === "batal") { await rm(raw, { force: true }); return; }
    if (s.normalize) {
      // Suara −14 LUFS, true peak −1 dBTP (loudnorm sudah membatasi puncak); video disalin apa adanya.
      job.state = "audio"; job.note = "Meratakan volume suara";
      await run("ffmpeg", ["-y", "-v", "error", "-nostdin", "-i", raw, "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1:LRA=11",
        ...(s.codec === "prores" ? ["-c:a", "pcm_s16le"] : ["-c:a", "aac", "-b:a", "192k"]), "-movflags", "+faststart", out]);
      await rm(raw, { force: true });
    } else await rename(raw, out);
    job.output = out; job.state = "selesai"; job.progress = 1; job.note = `${((await stat(out)).size / 1e6).toFixed(1)} MB`;
  }
}

export const renderQueue = new RenderQueue();

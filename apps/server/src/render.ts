// Render memakai komposisi Remotion yang sama dengan Player, jadi file akhir = yang terlihat di editor.
import { existsSync } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyOp, type Project } from "@cz/core";
import { config } from "./config.ts";
import { mediaFile, run, safeName } from "./media.ts";
import type { Library } from "./skills.ts";

const here = dirname(fileURLToPath(import.meta.url));

export interface RenderSettings {
  width: number; height: number;
  fps: number;
  codec: "h264" | "h265" | "prores";
  crf: number;
  normalize: boolean;
  range: "all" | "inout" | "scene";
  inFrame?: number; outFrame?: number; sceneId?: string;
  outDir?: string;
}
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
export function renderProps(folder: string, project: Project, lib: Library | null, useProxy: boolean, out?: { width: number; height: number }) {
  const src = Object.fromEntries(project.media.map((m) => [m.id, fileUrl(useProxy ? join(folder, m.proxy) : mediaFile(folder, m))]));
  return {
    project, src,
    lib: lib ? { template: lib.template, assets: lib.assets, base: `${base()}/api/skills/${lib.id}/${lib.version}/file/` } : null,
    output: out ?? { width: project.sequence.width, height: project.sequence.height },
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
  const inputProps = renderProps(folder, project, lib, true);
  const composition = await r.selectComposition({ serveUrl: url, id: "cz", inputProps });
  await mkdir(dirname(outFile), { recursive: true });
  await r.renderStill({ serveUrl: url, composition, inputProps, frame: Math.max(0, Math.min(composition.durationInFrames - 1, frame)), output: outFile, imageFormat: "jpeg", jpegQuality: 80, scale });
  return outFile;
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
    catch (e) { if (job.state !== "batal") { job.state = "gagal"; job.error = (e as Error).message.split("\n")[0]; } }
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
    to = Math.min(to, project.sequence.durationFrames - 1);
    if (!project.clips.length && !project.assets.length) throw new Error("Proyek kosong: belum ada klip di timeline");
    if (!(to >= from)) throw new Error("Bagian yang diekspor kosong");
    for (const m of project.media) if (!existsSync(mediaFile(job.folder, m)) && project.clips.some((c) => c.mediaId === m.id)) throw new Error(`File video tidak ditemukan: ${m.name}`);

    const { r, url } = await prepare((n) => { job.note = n; });
    if ((job.state as RenderState) === "batal") return;
    const inputProps = renderProps(job.folder, project, snap.lib, false, { width: s.width, height: s.height });
    const composition = await r.selectComposition({ serveUrl: url, id: "cz", inputProps });
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
    await r.renderMedia({
      serveUrl: url, composition, inputProps, outputLocation: raw, cancelSignal,
      codec: s.codec, ...(s.codec === "prores" ? { proResProfile: "standard" as const } : { crf: s.crf }),
      frameRange: [from, to], audioCodec: s.codec === "prores" ? "pcm-16" : "aac", audioBitrate: "192k",
      onProgress: (p) => {
        job.progress = p.progress; job.frames = p.renderedFrames;
        job.eta = p.progress > 0.02 ? Math.round(((Date.now() - t0) / p.progress) * (1 - p.progress) / 1000) : null;
      },
    });
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

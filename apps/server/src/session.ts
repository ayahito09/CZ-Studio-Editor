import { copyFile, mkdir, readFile, rename, writeFile, access } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  applyOp, buildCaptions, checkCuts, createProject, DEFAULT_SILENCE, describeOp, detectSilences, expandPreset, History, newId, srcToSeq, suggestFillers, validateOp, validateProject,
  type Media, type Op, type Project, type SilenceOptions, type Source,
} from "@cz/core";
import { checkClaude, ClaudeBridge } from "./claude.ts";
import { buildPrompt } from "./prompts.ts";
import { getSettings } from "./config.ts";
import { loadLibrary, versionDir, type Library } from "./skills.ts";
import { ENV_RATE, envelope, mediaFile, MediaJobs, probe } from "./media.ts";
import { engineStatus, transcribe } from "./transcribe.ts";

export type AutoState = "menunggu" | "berjalan" | "selesai" | "dilewati" | "gagal";
export interface AutoStep { id: string; label: string; state: AutoState; note?: string }

export interface TxStatus { stage: "menunggu" | "transkrip" | "siap" | "gagal"; progress: number; error?: string }

export const PROJECT_FILE = "project.cz.json";
const exists = (p: string) => access(p).then(() => true, () => false);

/** Satu proyek yang sedang terbuka: riwayat undo, status simpan, dan penulisan ke disk. */
export class Session {
  folder: string;
  history: History;
  dirty = false;
  savedAt: number;
  jobs: MediaJobs;
  tx = new Map<string, TxStatus>();
  claude: ClaudeBridge;
  /** Perubahan Claude yang menunggu persetujuan (mode tinjau). */
  pending: { id: string; label: string; op: Op; at: number }[] = [];
  private pendingSeq = 0;
  private lib: { key: string; value: Promise<Library | null> } | null = null;
  private txQueue: Promise<void> = Promise.resolve();
  private saving: Promise<void> = Promise.resolve();

  constructor(folder: string, project: Project) {
    this.folder = folder;
    this.history = new History(project);
    this.savedAt = Date.now();
    this.jobs = new MediaJobs(folder);
    this.claude = new ClaudeBridge(folder);
    // Transkrip otomatis begitu media siap, bila model lokal sudah dipasang.
    this.jobs.onReady = (m) => {
      if (!m.hasAudio || this.tx.has(m.id) || this.history.project.transcript.words.some((w) => w.mediaId === m.id)) return;
      void engineStatus().then((e) => { if (e.ready) this.transcribe(m.id); });
    };
    void this.jobs.ensure(project.media);
  }

  static async open(folder: string): Promise<Session> {
    const file = join(folder, PROJECT_FILE);
    if (!(await exists(file))) throw new Error(`Tidak ada ${PROJECT_FILE} di folder ini`);
    let data: unknown;
    try { data = JSON.parse(await readFile(file, "utf8")); }
    catch { throw new Error(`${PROJECT_FILE} rusak (bukan JSON yang sah)`); }
    const errs = validateProject(data);
    if (errs.length) throw new Error(`${PROJECT_FILE} tidak sah: ${errs.join("; ")}`);
    const s = new Session(folder, data as Project);
    await s.claude.load();
    return s;
  }

  static async create(folder: string, title: string): Promise<Session> {
    if (await exists(join(folder, PROJECT_FILE))) throw new Error("Folder ini sudah berisi proyek. Pakai Buka proyek.");
    for (const sub of ["media", "proxy", "cache", "render", ".cz"]) await mkdir(join(folder, sub), { recursive: true });
    const s = new Session(folder, createProject(title));
    s.dirty = true;
    await s.save();
    return s;
  }

  apply(op: unknown, source: Source = "manual"): string | null {
    const err = this.history.apply(op, source);
    if (!err) this.dirty = true;
    return err;
  }

  undo() { if (this.history.undo()) { this.dirty = true; void this.jobs.ensure(this.history.project.media); } }
  redo() { if (this.history.redo()) { this.dirty = true; void this.jobs.ensure(this.history.project.media); } }

  /** path: relatif ke folder proyek (sudah disalin) atau absolut (ditautkan). */
  async importMedia(path: string, linked: boolean): Promise<Media> {
    const info = await probe(linked ? path : join(this.folder, path));
    const id = newId(this.history.project.media.map((m) => m.id), "m");
    const media: Media = { id, name: basename(path), path, linked, proxy: `proxy/${id}.mp4`, ...info };
    const err = this.apply({ type: "addMedia", media, place: true });
    if (err) throw new Error(err);
    await this.jobs.ensure([media]);
    return media;
  }

  /** Menjadwalkan transkrip satu media (menimpa transkrip lama media itu, bisa dibatalkan dengan Ctrl+Z). */
  transcribe(mediaId: string, lang = getSettings().txLang) {
    const m = this.history.project.media.find((x) => x.id === mediaId);
    if (!m) throw new Error("media tidak ada");
    if (!m.hasAudio) throw new Error("media ini tidak punya audio");
    const st: TxStatus = { stage: "menunggu", progress: 0 };
    this.tx.set(mediaId, st);
    this.txQueue = this.txQueue.then(async () => {
      try {
        st.stage = "transkrip";
        const words = await transcribe(mediaFile(this.folder, m), join(this.folder, "cache"), lang, (p) => { st.progress = p; });
        const err = this.apply({ type: "setTranscript", mediaId, words });
        if (err) throw new Error(err);
        st.stage = "siap"; st.progress = 1;
      } catch (e) { st.stage = "gagal"; st.error = (e as Error).message; }
    });
  }

  /** Deteksi jeda di semua media ber-audio + usulan kata isian/ulangan dari transkrip. Usulan lama diganti. */
  async detectCuts(opts: SilenceOptions = DEFAULT_SILENCE) {
    const p = this.history.project;
    const cuts = [];
    let threshold: number | null = null;
    for (const m of p.media.filter((x) => x.hasAudio && p.clips.some((c) => c.mediaId === x.id))) {
      const r = detectSilences(await envelope(this.folder, m), ENV_RATE, m.duration, opts);
      threshold = r.threshold;
      for (const g of r.regions) cuts.push({ kind: "jeda" as const, mediaId: m.id, ...g, by: "auto" as const });
    }
    for (const f of suggestFillers(p.transcript.words)) cuts.push({ ...f, by: "auto" as const });
    // Bagian yang sudah tidak ada di timeline (sudah dipotong) tidak diusulkan lagi.
    const live = cuts.filter((c) => p.clips.some((k) => k.mediaId === c.mediaId && k.srcIn < c.srcEnd && k.srcOut > c.srcStart));
    const err = this.apply({ type: "addCuts", cuts: live, replaceKinds: ["jeda", "isian", "ulangan"] });
    if (err) throw new Error(err);
    return { threshold, count: live.length };
  }

  /** Terapkan potongan lalu tandai titik bermasalah (kata terpotong, lonjakan level) sebagai penanda di timeline. */
  async applyCuts(cutIds: string[], source: Source = "manual") {
    const p = this.history.project;
    const cuts = p.cuts.filter((c) => cutIds.includes(c.id) && c.state !== "applied");
    if (!cuts.length) throw new Error("Tidak ada potongan aktif untuk diterapkan");
    const env = [];
    for (const id of new Set(cuts.map((c) => c.mediaId))) {
      const m = p.media.find((x) => x.id === id)!;
      if (m.hasAudio) env.push({ mediaId: id, db: await envelope(this.folder, m), rate: ENV_RATE });
    }
    const problems = checkCuts(cuts, p.transcript.words, env);
    const op: Op = { type: "applyCuts", cutIds: cuts.map((c) => c.id) };
    const after = applyOp(p, op)[0];
    // Posisi penanda: titik sambungan setelah potongan diterapkan.
    const markers: Op[] = problems.flatMap((x) => {
      const cut = cuts.find((c) => c.id === x.cutId)!;
      const f = srcToSeq(after, cut.mediaId, cut.srcEnd) ?? srcToSeq(after, cut.mediaId, Math.max(0, cut.srcStart - 0.01));
      return f === null ? [] : [{ type: "addMarker", frame: f, label: `Periksa: ${x.detail}` } as Op];
    });
    const err = this.apply(markers.length ? { type: "batch", label: `Terapkan ${cuts.length} potongan`, ops: [op, ...markers] } : op, source);
    if (err) throw new Error(err);
    return problems;
  }

  /** Pustaka skill yang dipakai proyek (template + aset), di-cache per versi. Muat ulang dengan reloadLibrary. */
  library(): Promise<Library | null> {
    const sk = this.history.project.skill;
    const key = sk ? `${sk.id}@${sk.version}` : "";
    if (this.lib?.key !== key) this.lib = { key, value: sk ? loadLibrary(sk.id, sk.version).catch(() => null) : Promise.resolve(null) };
    return this.lib.value;
  }
  reloadLibrary() { this.lib = null; }

  review() { return getSettings().reviewClaude; }
  propose(op: Op): string {
    const err = validateOp(op, this.history.project);
    if (err) return `Ditolak: ${err}`;
    this.pending.push({ id: "u" + ++this.pendingSeq, label: describeOp(op), op, at: Date.now() });
    return "Diusulkan; menunggu user menerima atau menolak di panel Claude.";
  }
  /** Perubahan dari Claude: langsung (tercatat sumber "claude") atau masuk usulan bila mode tinjau aktif. */
  claudeOp(op: Op): string {
    if (this.review()) return this.propose(op);
    const err = this.apply(op, "claude");
    return err ? `Ditolak: ${err}` : `Berhasil: ${describeOp(op)}.`;
  }
  /** Terima (apply) atau tolak usulan. Usulan yang sudah tidak cocok dengan proyek dilaporkan. */
  settlePending(ids: string[], accept: boolean): string[] {
    const errs: string[] = [];
    for (const u of this.pending.filter((x) => ids.includes(x.id))) {
      if (accept) { const e = this.apply(u.op, "claude"); if (e) errs.push(`${u.label}: ${e}`); }
    }
    this.pending = this.pending.filter((x) => !ids.includes(x.id));
    return errs;
  }

  /** Op untuk memilih opsi scene: aset scene lama (yang tidak dikunci) diganti aset preset, kamera dan gaya caption ikut preset. */
  async chooseOps(sceneId: string, optionId: string): Promise<Op[]> {
    const p = this.history.project;
    const sc = p.scenes.find((x) => x.id === sceneId);
    const opt = sc?.options.find((o) => o.id === optionId);
    if (!sc || !opt) throw new Error("scene atau opsi tidak ada");
    const lib = await this.library();
    const preset = lib?.template?.stylePresets.find((x) => x.id === opt.presetId);
    const ops: Op[] = [];
    const old = p.assets.filter((a) => a.sceneId === sc.id && !a.locked).map((a) => a.id);
    if (old.length) ops.push({ type: "removeAssets", ids: old });
    if (lib?.template) {
      const assets = expandPreset(lib.template, new Map(lib.assets.map((d) => [d.id, d])), sc, opt.presetId, p.sequence.fps, p.sequence);
      if (assets.length) ops.push({ type: "addAssets", assets });
    }
    for (const c of p.captions.filter((c) => c.start < sc.end && c.end > sc.start)) {
      if (preset?.caption) ops.push({ type: "updateCaption", id: c.id, changes: { style: { ...c.style, ...preset.caption } } });
    }
    ops.push({ type: "updateScene", id: sc.id, changes: { choice: opt.id, camera: preset?.camera ?? null } });
    return ops;
  }

  /** Rapikan otomatis setelah proyek dibuat: langkah berurutan, yang tidak bisa jalan dilewati dengan alasan. */
  auto: { steps: AutoStep[]; running: boolean } | null = null;

  async autoEdit() {
    if (this.auto?.running) throw new Error("Rapikan otomatis sedang berjalan");
    const steps: AutoStep[] = [
      { id: "siapkan", label: "Menyiapkan video", state: "menunggu" },
      { id: "transkrip", label: "Menulis transkrip", state: "menunggu" },
      { id: "jeda", label: "Memotong jeda", state: "menunggu" },
      { id: "subtitle", label: "Membuat subtitle", state: "menunggu" },
      { id: "gaya", label: "Claude menyiapkan gaya edit", state: "menunggu" },
      { id: "tata", label: "Claude menata tiap bagian", state: "menunggu" },
    ];
    this.auto = { steps, running: true };
    const step = async (id: string, fn: () => Promise<string | void>) => {
      const s = steps.find((x) => x.id === id)!;
      s.state = "berjalan";
      try { const skip = await fn(); if (typeof skip === "string") { s.state = "dilewati"; s.note = skip; } else s.state = "selesai"; }
      catch (e) { s.state = "gagal"; s.note = (e as Error).message; }
    };
    const wait = async (done: () => boolean, maxMs = 30 * 60_000) => {
      const t0 = Date.now();
      while (!done()) { if (Date.now() - t0 > maxMs) throw new Error("terlalu lama"); await new Promise((r) => setTimeout(r, 700)); }
    };
    const p = () => this.history.project;
    try {
      await step("siapkan", async () => {
        if (!p().media.length) return "Belum ada video";
        await wait(() => p().media.every((m) => ["siap", "gagal"].includes(this.jobs.status.get(m.id)?.stage ?? "")));
      });
      await step("transkrip", async () => {
        const audio = p().media.filter((m) => m.hasAudio);
        if (!audio.length) return "Video tanpa suara";
        if (!(await engineStatus()).ready) return "Alat transkrip belum dipasang (cz models install)";
        for (const m of audio) if (!this.tx.has(m.id) && !p().transcript.words.some((w) => w.mediaId === m.id)) this.transcribe(m.id);
        await wait(() => audio.every((m) => p().transcript.words.some((w) => w.mediaId === m.id) || ["siap", "gagal"].includes(this.tx.get(m.id)?.stage ?? "")));
        if (!p().transcript.words.length) return "Tidak ada ucapan yang terbaca";
      });
      await step("jeda", async () => {
        if (!p().media.some((m) => m.hasAudio)) return "Video tanpa suara";
        await this.detectCuts();
        const ids = p().cuts.filter((c) => c.kind === "jeda" && c.state === "proposed").map((c) => c.id);
        if (!ids.length) return "Tidak ada jeda panjang";
        await this.applyCuts(ids);
      });
      await step("subtitle", async () => {
        if (!p().transcript.words.length) return "Butuh transkrip";
        const lib = await this.library();
        const caps = buildCaptions(p(), lib?.template?.caption.wordsPerLine ?? 4);
        if (!caps.length) return "Tidak ada ucapan";
        const err = this.apply({ type: "setCaptions", captions: caps });
        if (err) throw new Error(err);
      });
      const claudeOk = (await checkClaude()).state === "terhubung";
      const runClaude = async (label: string, prompt: string, opts: Parameters<ClaudeBridge["enqueue"]>[2]) => {
        const t = this.claude.enqueue(label, prompt, opts);
        await wait(() => t.state !== "antre" && t.state !== "berjalan");
        if (t.state !== "selesai") throw new Error(t.log.filter((l) => l.kind === "error").at(-1)?.text ?? "Claude berhenti");
      };
      await step("gaya", async () => {
        const sk = p().skill;
        if (!sk) return "Proyek tanpa gaya edit";
        if ((await this.library())?.template) return "Gaya sudah siap";
        if (!claudeOk) return "Claude belum terhubung";
        const dir = versionDir(sk.id, sk.version);
        await runClaude("Siapkan gaya edit", buildPrompt("generate-skill", "", null, { ...sk, dir }), { skill: { ...sk, dir }, addDirs: [dir] });
        this.reloadLibrary();
        if (!(await this.library())?.template) throw new Error("Claude belum menyimpan gaya");
      });
      await step("tata", async () => {
        const lib = await this.library();
        if (!lib?.template) return "Gaya edit belum siap";
        if (!claudeOk) return "Claude belum terhubung";
        if (!p().transcript.words.length) return "Butuh transkrip";
        await runClaude("Tata gaya otomatis", buildPrompt("auto-style", "", p()), { addDirs: [versionDir(lib.id, lib.version)] });
      });
    } finally {
      this.auto.running = false;
    }
  }

  get busy() {
    return !!this.auto?.running || Object.values(Object.fromEntries(this.jobs.status)).some((j) => j.stage !== "siap" && j.stage !== "gagal")
      || [...this.tx.values()].some((t) => t.stage === "menunggu" || t.stage === "transkrip") || this.claude.busy;
  }

  /** Ditulis atomik (tmp lalu rename); versi lama hari ini disalin sekali ke .cz/backups. */
  save(): Promise<void> {
    const run = this.saving.then(async () => {
      if (!this.dirty) return;
      const snapshot = this.history.project;
      this.dirty = false;
      const file = join(this.folder, PROJECT_FILE);
      try {
        const backups = join(this.folder, ".cz", "backups");
        const daily = join(backups, new Date().toISOString().slice(0, 10) + ".json");
        if ((await exists(file)) && !(await exists(daily))) {
          await mkdir(backups, { recursive: true });
          await copyFile(file, daily);
        }
        await writeFile(file + ".tmp", JSON.stringify(snapshot, null, 2) + "\n");
        await rename(file + ".tmp", file);
        this.savedAt = Date.now();
      } catch (e) {
        if (this.history.project === snapshot) this.dirty = true; // coba lagi di autosave berikutnya
        throw e;
      }
    });
    this.saving = run.catch(() => {}); // satu simpan yang gagal tidak memblokir simpan berikutnya
    return run;
  }

  state() {
    const h = this.history;
    return {
      folder: this.folder,
      project: h.project,
      dirty: this.dirty,
      savedAt: this.savedAt,
      undo: h.done.at(-1)?.label ?? null,
      redo: h.undone.at(-1)?.label ?? null,
      jobs: Object.fromEntries(h.project.media.map((m) => [m.id, this.jobs.status.get(m.id) ?? { stage: "menunggu", progress: 0 }])),
      tx: Object.fromEntries(this.tx),
      claude: this.claude.view(),
      pending: this.pending.map(({ id, label, at }) => ({ id, label, at })),
      busy: this.busy,
      auto: this.auto,
    };
  }
}

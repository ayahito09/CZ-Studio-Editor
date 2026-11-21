import { copyFile, mkdir, readFile, rename, writeFile, access } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
  applyOp, buildCaptions, checkCuts, createProject, DEFAULT_SILENCE, describeOp, detectSilences, expandPreset, History, newId, srcToSeq, suggestFillers, validateOp, validateProject,
  type Media, type Op, type Project, type SilenceOptions, type Source,
} from "@cz/core";
import { ClaudeBridge } from "./claude.ts";
import { detectFaces, faceEngineReady } from "./faces.ts";
import { componentPrompt, editComponentPrompt } from "./prompts.ts";
import { getSettings } from "./config.ts";
import { builtinSfxRoles } from "./builtin.ts";
import { hasComponent, type CodeTarget } from "./skillCode.ts";
import { forkVersion, loadLibrary, versionDir, type Library } from "./skills.ts";
import { ENV_RATE, envelope, IMAGE_EXT, mediaFile, MediaJobs, probe, probeImage } from "./media.ts";
import { engineStatus, transcribe } from "./transcribe.ts";

export type AutoState = "menunggu" | "berjalan" | "selesai" | "dilewati" | "gagal";
export interface AutoStep { id: string; label: string; state: AutoState; note?: string; progress?: number; startedAt?: number; endedAt?: number }
/** Bagian timeline yang terakhir diubah Claude: UI menaruh kursor Claude di sana. */
export interface ClaudeFocus { frame: number; end: number; label: string; ids: string[]; at: number }

/** Kemajuan satu media 0..1 lintas tahap (proxy paling lama). */
export const jobFraction = (j: { stage: string; progress: number } | undefined) =>
  !j ? 0 : j.stage === "siap" || j.stage === "gagal" ? 1 : j.stage === "proxy" ? j.progress * 0.8
    : j.stage === "thumbnail" ? 0.8 + j.progress * 0.05 : j.stage === "waveform" ? 0.85 + j.progress * 0.15 : 0;

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
  claudeFocus: ClaudeFocus | null = null;
  /** Laporan cz_set_status terakhir (teks + kemajuan 0..1 bila Claude menyebutnya). */
  claudeNote: { text: string; progress?: number; at: number } | null = null;
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
      void detectFaces(this.folder, m).catch(() => {}); // mesin wajah CZ: dipakai kamera dan penempatan elemen
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
  /** place=false: masuk pustaka media saja, tidak ditaruh di timeline (foto/video untuk slot elemen). Foto selalu begitu. */
  async importMedia(path: string, linked: boolean, place = true): Promise<Media> {
    const image = IMAGE_EXT.has(extname(path).toLowerCase());
    const info = image ? await probeImage(linked ? path : join(this.folder, path)) : await probe(linked ? path : join(this.folder, path));
    const id = newId(this.history.project.media.map((m) => m.id), "m");
    const media: Media = { id, name: basename(path), path, linked, proxy: image ? path : `proxy/${id}.mp4`, ...(image ? { kind: "image" as const } : {}), ...info };
    const err = this.apply({ type: "addMedia", media, place: place && !image });
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
  /** Versi skill yang sedang ditulis komposisinya oleh Claude (cz_write_skill_file / cz_build_skill_component). */
  codeTarget: CodeTarget | null = null;
  /** Skill tanpa kode: buat versi baru (skill asli utuh), pindahkan proyek ke versi itu, dan siapkan tugas Claude
   *  untuk menulis komposisi Remotion-nya. Mengembalikan argumen ClaudeBridge.enqueue. */
  async prepareComponent(sk: { id: string; version: number }, text = "") {
    const nv = await forkVersion(sk.id, sk.version);
    if (this.history.project.skill?.id === sk.id) this.apply({ type: "setSkill", skill: { id: sk.id, version: nv } });
    this.reloadLibrary();
    this.codeTarget = { id: sk.id, version: nv };
    const dir = versionDir(sk.id, nv);
    const skill = { id: sk.id, version: nv, dir };
    return ["Tulis mesin skill", componentPrompt(dir, nv, await builtinSfxRoles(), text), { skill, addDirs: [dir] }] as [string, string, { skill: typeof skill; addDirs: string[] }];
  }
  /** Ubah skill = ubah kode komposisinya di versi baru (skill tanpa kode: ditulis dulu dengan permintaan itu). */
  async prepareEdit(sk: { id: string; version: number }, text: string) {
    if (!hasComponent(sk.id, sk.version)) return this.prepareComponent(sk, text);
    const nv = await forkVersion(sk.id, sk.version);
    if (this.history.project.skill?.id === sk.id) this.apply({ type: "setSkill", skill: { id: sk.id, version: nv } });
    this.reloadLibrary();
    this.codeTarget = { id: sk.id, version: nv };
    const dir = versionDir(sk.id, nv);
    const skill = { id: sk.id, version: nv, dir };
    return [`Ubah skill (versi ${nv})`, editComponentPrompt(dir, nv, await builtinSfxRoles(), text), { skill, addDirs: [dir] }] as [string, string, { skill: typeof skill; addDirs: string[] }];
  }

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
    const before = this.history.project;
    const err = this.apply(op, "claude");
    if (!err) this.markFocus(before, describeOp(op));
    return err ? `Ditolak: ${err}` : `Berhasil: ${describeOp(op)}.`;
  }
  /** Immer menjaga identitas objek yang tidak berubah: yang baru/berubah = yang tidak ada di proyek sebelumnya. */
  private markFocus(before: Project, label: string) {
    const p = this.history.project;
    const old = new Set<object>([...before.assets, ...before.scenes, ...before.captions]);
    const changed = [
      ...p.assets.filter((a) => !old.has(a)).map((a) => ({ id: a.id, start: a.start, end: a.start + a.duration })),
      ...p.scenes.filter((x) => !old.has(x)).map((x) => ({ id: x.id, start: x.start, end: x.end })),
      ...p.captions.filter((x) => !old.has(x)).map((x) => ({ id: x.id, start: x.start, end: x.end })),
    ];
    if (!changed.length) return;
    this.claudeFocus = {
      frame: Math.min(...changed.map((c) => c.start)), end: Math.max(...changed.map((c) => c.end)),
      label, ids: changed.slice(0, 200).map((c) => c.id), at: Date.now(),
    };
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

  /** Rapikan otomatis setelah proyek dibuat (tanpa Claude; skill dan penataan dipilih user dari editor): langkah berurutan, yang tidak bisa jalan dilewati dengan alasan. */
  auto: { steps: AutoStep[]; running: boolean; startedAt: number } | null = null;

  async autoEdit() {
    if (this.auto?.running) throw new Error("Rapikan otomatis sedang berjalan");
    const steps: AutoStep[] = [
      { id: "siapkan", label: "Menyiapkan video", state: "menunggu" },
      { id: "wajah", label: "Mendeteksi wajah", state: "menunggu" },
      { id: "transkrip", label: "Menulis transkrip", state: "menunggu" },
      { id: "jeda", label: "Memotong jeda", state: "menunggu" },
      { id: "subtitle", label: "Membuat subtitle", state: "menunggu" },
    ];
    this.auto = { steps, running: true, startedAt: Date.now() };
    this.claudeNote = null;
    let cur: AutoStep | null = null;
    const step = async (id: string, fn: () => Promise<string | void>) => {
      const s = (cur = steps.find((x) => x.id === id)!);
      s.state = "berjalan"; s.startedAt = Date.now(); s.progress = 0;
      try { const skip = await fn(); if (typeof skip === "string") { s.state = "dilewati"; s.note = skip; } else s.state = "selesai"; }
      catch (e) { s.state = "gagal"; s.note = (e as Error).message; }
      s.progress = 1; s.endedAt = Date.now();
    };
    // progress: kemajuan langkah yang berjalan (0..1), dibaca tiap putaran tunggu; tidak pernah mundur.
    const wait = async (done: () => boolean, progress?: () => number | undefined, maxMs = 30 * 60_000) => {
      const t0 = Date.now();
      while (!done()) {
        if (Date.now() - t0 > maxMs) throw new Error("terlalu lama");
        const v = progress?.();
        if (cur && v !== undefined && Number.isFinite(v)) cur.progress = Math.max(cur.progress ?? 0, Math.min(0.99, v));
        await new Promise((r) => setTimeout(r, 700));
      }
    };
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const p = () => this.history.project;
    try {
      await step("siapkan", async () => {
        if (!p().media.length) return "Belum ada video";
        await wait(() => p().media.every((m) => ["siap", "gagal"].includes(this.jobs.status.get(m.id)?.stage ?? "")),
          () => avg(p().media.map((m) => jobFraction(this.jobs.status.get(m.id)))));
      });
      await step("wajah", async () => {
        const vids = p().media.filter((m) => m.width > 0);
        if (!vids.length) return "Belum ada video";
        if (!(await faceEngineReady())) return "Mesin wajah belum dipasang (cz install)";
        let done = 0;
        await Promise.all(vids.map((m) => detectFaces(this.folder, m).then(() => { done++; if (cur) cur.progress = done / vids.length; })));
      });
      await step("transkrip", async () => {
        const audio = p().media.filter((m) => m.hasAudio);
        if (!audio.length) return "Video tanpa suara";
        if (!(await engineStatus()).ready) return "Alat transkrip belum dipasang (cz models install)";
        for (const m of audio) if (!this.tx.has(m.id) && !p().transcript.words.some((w) => w.mediaId === m.id)) this.transcribe(m.id);
        await wait(() => audio.every((m) => p().transcript.words.some((w) => w.mediaId === m.id) || ["siap", "gagal"].includes(this.tx.get(m.id)?.stage ?? "")),
          () => avg(audio.map((m) => { const t = this.tx.get(m.id); return !t || t.stage === "siap" || t.stage === "gagal" ? 1 : t.progress; })));
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
      claudeFocus: this.claudeFocus,
      claudeNote: this.claudeNote,
      pending: this.pending.map(({ id, label, at }) => ({ id, label, at })),
      busy: this.busy,
      auto: this.auto,
    };
  }
}

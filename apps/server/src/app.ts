import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { DEFAULT_SILENCE, isServerOnly, type Op, type Project, type SilenceOptions } from "@cz/core";
import { checkClaude, claudeStatus, openLogin, writeMcpConfig } from "./claude.ts";
import { config, getSettings, setSettings } from "./config.ts";
import { derived, killAll, mediaFile, safeName, saveUpload, VIDEO_EXT } from "./media.ts";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { ACTION_LABEL, ACTIONS, buildPrompt, estimate, type Action } from "./prompts.ts";
import { renderFiles, renderQueue, type RenderSettings } from "./render.ts";
import { Session } from "./session.ts";
import { addSkill, forkVersion, getMeta, inventory, listSkills, loadLibrary, skillFile, versionDir } from "./skills.ts";
import { callTool, toolList } from "./tools.ts";
import { engineStatus } from "./transcribe.ts";
import { ensureSetup, setup } from "./setup.ts";

export interface Options { port: number; dataDir: string; webDir: string | null; }

const AUTOSAVE_MS = 30_000;
const RECENT_MAX = 12;
const bad = (msg: string, code = 400) => Object.assign(new Error(msg), { statusCode: code });

export async function startServer(opts: Options) {
  config.dataDir = opts.dataDir;
  config.port = opts.port;
  let session: Session | null = null;
  const recentFile = join(opts.dataDir, "recent.json");
  await mkdir(opts.dataDir, { recursive: true });

  // Path yang sama bisa tertulis dengan / atau \ dan huruf besar/kecil berbeda di Windows: satukan.
  const sameFolder = (a: string, b: string) => (process.platform === "win32" ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));
  const readRecent = async (): Promise<string[]> => {
    let r: unknown;
    try { r = JSON.parse(await readFile(recentFile, "utf8")); } catch { return []; }
    const out: string[] = [];
    for (const f of Array.isArray(r) ? r : []) if (typeof f === "string" && !out.some((x) => sameFolder(x, f))) out.push(resolve(f));
    return out;
  };
  const writeRecent = (list: string[]) => writeFile(recentFile, JSON.stringify(list.slice(0, RECENT_MAX), null, 2));
  const remember = async (folder: string) => writeRecent([resolve(folder), ...(await readRecent()).filter((f) => !sameFolder(f, folder))]);

  /** Data kartu proyek di beranda: judul, durasi, waktu diubah, dan video pertama untuk sampul/cuplikan. */
  const recentCards = async () => Promise.all((await readRecent()).map(async (folder, i) => {
    const base = { i, folder, name: basename(folder), exists: false, title: basename(folder), durationSec: 0, updatedAt: 0, videos: 0, poster: null as null | { width: number; height: number; duration: number }, preview: false };
    const file = join(folder, "project.cz.json");
    try {
      const [raw, st] = await Promise.all([readFile(file, "utf8"), stat(file)]);
      const p = JSON.parse(raw) as Project;
      const m = coverMedia(p);
      return {
        ...base, exists: true, title: p.title || base.title, durationSec: p.sequence.durationFrames / (p.sequence.fps || 30), updatedAt: st.mtimeMs, videos: p.media.length,
        poster: m && existsSync(derived(folder, m).thumbs) ? { width: m.width, height: m.height, duration: m.duration } : null,
        preview: !!m && existsSync(derived(folder, m).proxy),
      };
    } catch { return base; }
  }));
  const coverMedia = (p: Project) => {
    const c = [...p.clips].filter((x) => x.trackId === "V1").sort((a, b) => a.start - b.start)[0];
    return p.media.find((m) => m.id === c?.mediaId) ?? p.media[0] ?? null;
  };
  const recentFile_ = async (i: number, kind: "thumbs" | "proxy") => {
    const folder = (await readRecent())[i];
    if (!folder) return null;
    try {
      const p = JSON.parse(await readFile(join(folder, "project.cz.json"), "utf8")) as Project;
      const m = coverMedia(p);
      const f = m ? derived(folder, m)[kind] : null;
      return f && existsSync(f) ? f : null;
    } catch { return null; }
  };
  const defaultDir = join(homedir(), "Videos", "CZ Studio");
  const state = async () => ({
    session: session?.state() ?? null,
    recent: session ? [] : await recentCards(),
    defaultDir,
    claude: claudeStatus(),
    settings: getSettings(),
    renders: renderQueue.jobs.slice(-20),
    busy: !!session?.busy || renderQueue.busy || setup.running,
    setup,
  });
  const switchTo = async (next: Session) => {
    await session?.save();
    session?.claude.stop();
    session = next;
    await remember(next.folder);
  };

  const app = Fastify({ bodyLimit: 20 * 1024 * 1024 });
  // Port bisa 0 (render dari terminal); host yang diizinkan dihitung dari port yang benar-benar dipakai.
  const allowed = (host: string) => host === `127.0.0.1:${config.port}` || host === `localhost:${config.port}`;

  // Situs lain di browser yang sama tidak boleh menyentuh proyek: tolak host asing (DNS rebinding).
  // POST hanya menerima application/json, jadi form lintas-situs ditolak dan fetch lintas-situs butuh CORS yang tidak kita beri.
  app.addHook("onRequest", async (req, reply) => {
    if (!allowed(req.headers.host ?? "")) return reply.code(403).send({ error: "host tidak diizinkan" });
  });

  const folderOf = (body: unknown): string => {
    const f = (body as { folder?: unknown })?.folder;
    if (typeof f !== "string" || !isAbsolute(f.trim())) throw bad("Tulis lokasi folder lengkap, mis. C:\\Video\\Proyek1");
    return resolve(f.trim());
  };
  const needSession = () => {
    if (!session) throw bad("Belum ada proyek yang terbuka", 409);
    return session;
  };
  const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
  app.setErrorHandler((err: { statusCode?: number; message: string }, _req, reply) => {
    reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 400).send({ error: err.message });
  });

  app.get("/api/state", state);
  app.post("/api/open", async (req) => { await switchTo(await Session.open(folderOf(req.body))); return state(); });
  app.post("/api/new", async (req) => {
    const b = body(req);
    const title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 200) : "";
    // Tanpa folder: dibuatkan di Videos\CZ Studio\<judul>, diberi nomor bila namanya sudah ada.
    let folder: string;
    if (typeof b.folder === "string" && b.folder.trim()) folder = folderOf(b);
    else {
      const name = safeName(title || "Proyek baru").replace(/\.+$/, "") || "Proyek baru";
      folder = join(defaultDir, name);
      for (let n = 2; existsSync(folder); n++) folder = join(defaultDir, `${name} (${n})`);
    }
    const s = await Session.create(folder, title || basename(folder));
    const sk = b.skill as { id?: unknown; version?: unknown } | undefined;
    if (sk && typeof sk.id === "string") {
      await loadLibrary(sk.id, Number(sk.version)).catch(() => { throw bad("Gaya edit tidak ditemukan"); });
      const err = s.apply({ type: "setSkill", skill: { id: sk.id, version: Number(sk.version) } });
      if (err) throw bad(err);
    }
    await switchTo(s);
    return state();
  });
  app.post("/api/auto/start", async () => {
    const s = needSession();
    void s.autoEdit().catch((e) => console.error("Rapikan otomatis gagal:", e.message));
    return state();
  });
  app.get("/api/recent/:i/:kind", async (req, reply) => {
    const { i, kind } = req.params as { i: string; kind: string };
    if (kind !== "poster" && kind !== "preview") return reply.code(404).send({ error: "tidak ada" });
    const f = await recentFile_(Number(i), kind === "poster" ? "thumbs" : "proxy");
    if (!f) return reply.code(404).send({ error: "tidak ada" });
    return reply.header("cache-control", "no-cache").sendFile(basename(f), dirname(f));
  });
  app.post("/api/recent/forget", async (req) => {
    const f = body(req).folder;
    if (typeof f !== "string") throw bad("folder tidak sah");
    await writeRecent((await readRecent()).filter((x) => !sameFolder(x, f)));
    return state();
  });
  app.post("/api/close", async () => { await session?.save(); session?.claude.stop(); session = null; return state(); });
  app.post("/api/op", async (req, reply) => {
    const op = body(req).op;
    if (isServerOnly(op)) return reply.code(403).send({ error: "op ini hanya untuk server" });
    const err = needSession().apply(op);
    if (err) return reply.code(400).send({ error: err });
    return state();
  });
  app.post("/api/undo", async () => { needSession().undo(); return state(); });
  app.post("/api/redo", async () => { needSession().redo(); return state(); });
  app.post("/api/save", async () => { await needSession().save(); return state(); });
  app.get("/api/history", async () => {
    const h = needSession().history;
    return { done: h.done.map((e) => ({ label: e.label, source: e.source, at: e.at })).slice(-200), undone: h.undone.length };
  });
  app.get("/api/settings", async () => getSettings());
  app.post("/api/settings", async (req) => { await setSettings(body(req)); return state(); });

  // ---------- Media ----------
  // Upload hasil seret-lepas: badan permintaan langsung dialirkan ke folder media, tidak ditampung di memori.
  app.addContentTypeParser("application/octet-stream", (_req, payload, done) => done(null, payload));
  app.put("/api/media/upload", async (req) => {
    const s = needSession();
    const name = String((req.query as { name?: unknown }).name ?? "");
    const rel = await saveUpload(s.folder, name, req.body as NodeJS.ReadableStream);
    await s.importMedia(rel, false);
    return state();
  });
  // Impor dari path di disk: disalin ke folder proyek, atau ditautkan saja (link=true) untuk file besar.
  app.post("/api/media/import", async (req) => {
    const s = needSession();
    const { paths, link } = body(req);
    if (!Array.isArray(paths) || !paths.length || paths.length > 50) throw bad("Isi lokasi 1 sampai 50 video");
    const errors: string[] = [];
    for (const raw of paths) {
      const p = typeof raw === "string" ? raw.trim().replace(/^"|"$/g, "") : "";
      try {
        if (!isAbsolute(p)) throw new Error("tulis lokasi lengkap");
        if (!VIDEO_EXT.has(extname(p).toLowerCase())) throw new Error("format tidak didukung");
        if (!existsSync(p)) throw new Error("file tidak ditemukan");
        await s.importMedia(link === true ? resolve(p) : await saveUpload(s.folder, basename(p), createReadStream(p)), link === true);
      } catch (e) { errors.push(`${basename(p) || "(kosong)"}: ${(e as Error).message}`); }
    }
    if (errors.length) throw bad(errors.join("; "));
    return state();
  });
  app.get("/api/media/:id/:kind", async (req, reply) => {
    const s = needSession();
    const { id, kind } = req.params as { id: string; kind: string };
    const m = s.history.project.media.find((x) => x.id === id);
    if (!m || !["proxy", "thumbs", "peaks"].includes(kind)) return reply.code(404).send({ error: "tidak ada" });
    const file = derived(s.folder, m)[kind as "proxy" | "thumbs" | "peaks"];
    if (!existsSync(file)) return reply.code(404).send({ error: "belum siap" });
    return reply.header("cache-control", "no-cache").sendFile(basename(file), dirname(file));
  });
  // File untuk Chrome headless saat render: hanya yang didaftarkan render, dan hanya dengan token proses ini.
  app.get("/api/file", async (req, reply) => {
    const { t, f } = req.query as { t?: string; f?: string };
    if (t !== config.token || !f || !renderFiles.has(f) || !existsSync(f)) return reply.code(404).send({ error: "tidak ada" });
    return reply.sendFile(basename(f), dirname(f));
  });

  // ---------- F3: transkrip dan potong jeda ----------
  app.get("/api/engine", async () => engineStatus());
  app.post("/api/transcribe", async (req) => {
    const s = needSession();
    const { mediaId, lang } = body(req);
    if (typeof lang === "string") await setSettings({ txLang: lang });
    const ids = typeof mediaId === "string" ? [mediaId] : s.history.project.media.filter((m) => m.hasAudio).map((m) => m.id);
    if (!(await engineStatus()).ready) throw bad(setup.running ? "Alat transkrip sedang disiapkan, tunggu sebentar" : "Alat pembuat transkrip belum siap. Buka Terminal lalu ketik: cz setup");
    for (const id of ids) s.transcribe(id);
    return state();
  });
  app.post("/api/cuts/detect", async (req) => {
    const s = needSession();
    const b = body(req);
    const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && v >= lo && v <= hi ? v : d);
    const opts: SilenceOptions = {
      minGap: num(b.minGap, DEFAULT_SILENCE.minGap, 0.1, 10),
      padding: num(b.padding, DEFAULT_SILENCE.padding, 0, 2),
      thresholdDb: typeof b.thresholdDb === "number" && b.thresholdDb >= -90 && b.thresholdDb <= -5 ? b.thresholdDb : null,
    };
    const r = await s.detectCuts(opts);
    return { ...(await state()), detect: r };
  });
  app.post("/api/cuts/apply", async (req) => {
    const ids = body(req).cutIds;
    if (!Array.isArray(ids) || !ids.length) throw bad("Pilih potongan");
    const problems = await needSession().applyCuts(ids.map(String));
    return { ...(await state()), problems };
  });

  // ---------- F4: Claude ----------
  app.get("/api/claude/status", async (req) => checkClaude((req.query as { force?: string }).force === "1"));
  app.post("/api/claude/login", async () => {
    if (!openLogin()) throw bad("Claude Code belum dipasang di komputer ini");
    return { ok: true };
  });
  app.post("/api/claude/run", async (req) => {
    const s = needSession();
    const { action, text } = body(req);
    if (!ACTIONS.includes(action as Action)) throw bad("aksi tidak dikenal");
    if (typeof text !== "string" || text.length > 20_000) throw bad("teks terlalu panjang");
    if (action === "ask" && !text.trim()) throw bad("Tulis permintaan dulu");
    const lib = await s.library();
    const addDirs = lib ? [versionDir(lib.id, lib.version)] : [];
    s.claude.enqueue(action === "ask" ? text.trim().slice(0, 80) : ACTION_LABEL[action as Action], buildPrompt(action as Action, text, s.history.project), { addDirs });
    return state();
  });
  app.get("/api/claude/estimate", async (req) => {
    const a = (req.query as { action?: string }).action as Action;
    return { text: estimate(a, session?.history.project ?? null) };
  });
  app.post("/api/claude/stop", async (req) => { needSession().claude.stop(body(req).id as string | undefined); return state(); });
  app.post("/api/claude/new-session", async () => { await needSession().claude.newSession(); return state(); });
  app.post("/api/claude/pending", async (req) => {
    const { ids, accept } = body(req);
    const s = needSession();
    const all = ids === "all" ? s.pending.map((u) => u.id) : Array.isArray(ids) ? ids.map(String) : [];
    const errs = s.settlePending(all, accept === true);
    if (errs.length) throw bad(`Sebagian usulan tidak bisa diterapkan: ${errs.join("; ")}`);
    return state();
  });

  // Dipanggil server MCP (`cz mcp`) yang dijalankan Claude Code; butuh token proses ini.
  const mcpAuth = (req: { headers: Record<string, unknown> }) => { if (req.headers["x-cz-token"] !== config.token) throw bad("token MCP tidak sah", 403); };
  app.get("/api/mcp/tools", async (req) => { mcpAuth(req); return toolList(); });
  app.post("/api/mcp/call", async (req) => {
    mcpAuth(req);
    const { name, arguments: args } = body(req);
    if (!session) return { content: [{ type: "text", text: "Tidak ada proyek yang terbuka di CZ Studio." }], isError: true };
    return callTool(session, String(name), (args ?? {}) as Record<string, unknown>);
  });

  // ---------- F5: skill ----------
  app.get("/api/skills", async () => listSkills());
  app.post("/api/skills/add", async (req) => {
    const p = body(req).path;
    if (typeof p !== "string" || !p.trim()) throw bad("Tulis lokasi folder gaya edit atau file .zip");
    const meta = await addSkill(p);
    return { meta, skills: await listSkills() };
  });
  // Seret-lepas folder atau .zip gaya edit dari browser: file diunggah satu per satu ke folder sementara, lalu dipasang.
  const skillUploads = new Map<string, string>();
  app.put("/api/skills/upload", async (req) => {
    const { batch, path } = req.query as { batch?: string; path?: string };
    if (!batch || !/^[a-z0-9]{8,32}$/.test(batch)) throw bad("unggahan tidak sah");
    const parts = String(path ?? "").split(/[\\/]+/).filter(Boolean);
    if (!parts.length || parts.length > 20 || parts.some((p) => p === ".." || p === "." || p.includes(":"))) throw bad("nama file tidak sah");
    if (!skillUploads.has(batch)) {
      if (skillUploads.size > 20) throw bad("terlalu banyak unggahan berjalan");
      skillUploads.set(batch, await mkdtemp(join(tmpdir(), "cz-skill-up-")));
    }
    const root = skillUploads.get(batch)!;
    const dest = resolve(root, ...parts);
    if (!dest.startsWith(root + sep)) throw bad("nama file tidak sah");
    await mkdir(dirname(dest), { recursive: true });
    const { pipeline } = await import("node:stream/promises");
    const { createWriteStream } = await import("node:fs");
    await pipeline(req.body as NodeJS.ReadableStream, createWriteStream(dest));
    return { ok: true };
  });
  app.post("/api/skills/upload/done", async (req) => {
    const batch = String(body(req).batch ?? "");
    const root = skillUploads.get(batch);
    if (!root) throw bad("Tidak ada file yang diunggah");
    skillUploads.delete(batch);
    try {
      const top = await readdir(root);
      const zip = top.length === 1 && extname(top[0]).toLowerCase() === ".zip" ? join(root, top[0]) : null;
      const meta = await addSkill(zip ?? root, "diunggah lewat seret-lepas");
      return { meta, skills: await listSkills() };
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  app.get("/api/skills/:id/:v", async (req) => {
    const { id, v } = req.params as { id: string; v: string };
    const lib = await loadLibrary(id, Number(v));
    return { ...lib, meta: await getMeta(id), inventory: await inventory(id, Number(v)) };
  });
  app.get("/api/skills/:id/:v/file/*", async (req, reply) => {
    const { id, v } = req.params as { id: string; v: string };
    const f = skillFile(id, Number(v), decodeURIComponent((req.params as { "*": string })["*"]));
    if (!existsSync(f)) return reply.code(404).send({ error: "tidak ada" });
    return reply.header("cache-control", "max-age=3600").sendFile(basename(f), dirname(f));
  });
  app.post("/api/skills/:id/:v/generate", async (req) => {
    const s = needSession();
    const { id, v } = req.params as { id: string; v: string };
    const dir = versionDir(id, Number(v));
    if (!existsSync(dir)) throw bad("versi skill tidak ada");
    const skill = { id, version: Number(v), dir };
    s.claude.enqueue("Siapkan gaya edit", buildPrompt("generate-skill", String(body(req).text ?? ""), null, skill), { skill, addDirs: [dir] });
    return state();
  });
  app.post("/api/skills/:id/:v/edit", async (req) => {
    const s = needSession();
    const { id, v } = req.params as { id: string; v: string };
    const text = String(body(req).text ?? "").trim();
    if (!text) throw bad("Tulis perubahan yang diinginkan");
    const nv = await forkVersion(id, Number(v));
    const skill = { id, version: nv, dir: versionDir(id, nv) };
    s.claude.enqueue(`Ubah gaya edit (versi ${nv})`, buildPrompt("edit-skill", text, null, skill), { skill, addDirs: [skill.dir] });
    return state();
  });
  app.post("/api/project/skill", async (req) => {
    const s = needSession();
    const { id, version } = body(req);
    const op: Op = { type: "setSkill", skill: typeof id === "string" ? { id, version: Number(version) } : null };
    if (typeof id === "string") await loadLibrary(id, Number(version));
    const err = s.apply(op);
    if (err) throw bad(err);
    s.reloadLibrary();
    return state();
  });
  app.get("/api/library", async () => {
    const lib = await needSession().library();
    return lib ? { ...lib, base: `/api/skills/${lib.id}/${lib.version}/file/` } : null;
  });
  app.post("/api/library/reload", async () => { needSession().reloadLibrary(); return { ok: true }; });

  // ---------- F7: plan ----------
  app.post("/api/scene/choose", async (req) => {
    const s = needSession();
    const { sceneId, optionId } = body(req);
    const ops = await s.chooseOps(String(sceneId), String(optionId));
    const err = s.apply({ type: "batch", label: `Pilih opsi ${String(optionId)} untuk ${String(sceneId)}`, ops });
    if (err) throw bad(err);
    return state();
  });
  const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  app.put("/api/notes/image", async (req) => {
    const s = needSession();
    const name = basename(String((req.query as { name?: unknown }).name ?? "gambar.png")).replace(/[^\w.-]/g, "_");
    const ext = extname(name).toLowerCase();
    if (!IMG_EXT.has(ext)) throw bad("Gambar harus PNG, JPG, WebP, atau GIF");
    const dir = join(s.folder, ".cz", "notes");
    await mkdir(dir, { recursive: true });
    const rel = `.cz/notes/${Date.now()}-${name}`;
    const { pipeline } = await import("node:stream/promises");
    const { createWriteStream } = await import("node:fs");
    await pipeline(req.body as NodeJS.ReadableStream, createWriteStream(join(s.folder, rel)));
    return { path: rel };
  });
  app.get("/api/notes/image", async (req, reply) => {
    const s = needSession();
    const p = resolve(s.folder, String((req.query as { p?: string }).p ?? ""));
    if (!p.startsWith(join(s.folder, ".cz", "notes") + sep) || !existsSync(p)) return reply.code(404).send({ error: "tidak ada" });
    return reply.sendFile(basename(p), dirname(p));
  });

  // ---------- F8: render ----------
  app.get("/api/render/precheck", async () => {
    const s = needSession();
    const p = s.history.project;
    const issues: string[] = [];
    const open = p.notes.filter((n) => n.status !== "selesai");
    if (open.length) issues.push(`${open.length} catatan belum selesai`);
    for (const m of p.media) if (p.clips.some((c) => c.mediaId === m.id) && !existsSync(mediaFile(s.folder, m))) issues.push(`File video tidak ditemukan: ${m.name}`);
    const lib = await s.library();
    if (p.skill && !lib?.template) issues.push("Gaya edit proyek ini belum disiapkan");
    const defs = new Set(lib?.assets.map((d) => d.id) ?? []);
    const missing = p.assets.filter((a) => a.defId && !defs.has(a.defId));
    if (missing.length) issues.push(`${missing.length} elemen sudah tidak ada di gaya edit`);
    const { width: W, height: H } = p.sequence;
    const out = p.assets.filter((a) => !a.hidden && (a.transform.x < 80 || a.transform.x > W - 80 || a.transform.y < 220 || a.transform.y > H - 400));
    if (out.length) issues.push(`${out.length} elemen keluar dari batas aman`);
    if (p.cuts.some((c) => c.state === "proposed")) issues.push("Ada usulan potongan yang belum ditinjau");
    return { issues };
  });
  app.post("/api/render", async (req) => {
    const s = needSession();
    const b = body(req);
    const p = s.history.project;
    const int = (v: unknown, d: number, lo: number, hi: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : d);
    const settings: RenderSettings = {
      width: int(b.width, p.sequence.width, 16, 7680), height: int(b.height, p.sequence.height, 16, 7680),
      fps: int(b.fps, p.sequence.fps, 1, 120),
      codec: b.codec === "h265" || b.codec === "prores" ? b.codec : "h264",
      crf: int(b.crf, 18, 1, 51), normalize: b.normalize !== false,
      range: b.range === "inout" || b.range === "scene" ? b.range : "all",
      inFrame: int(b.inFrame, 0, 0, 1e9), outFrame: int(b.outFrame, 0, 0, 1e9), sceneId: typeof b.sceneId === "string" ? b.sceneId : undefined,
      outDir: typeof b.outDir === "string" && isAbsolute(b.outDir) ? b.outDir : undefined,
    };
    await s.save();
    renderQueue.enqueue(s.folder, p, await s.library(), settings);
    return state();
  });
  app.post("/api/render/stop", async (req) => { renderQueue.stop(String(body(req).id)); return state(); });
  app.post("/api/render/reveal", async (req) => {
    const { id, open } = body(req);
    const j = renderQueue.jobs.find((x) => x.id === id);
    if (!j?.output || !existsSync(j.output)) throw bad("File render tidak ada");
    const f = j.output;
    if (process.platform === "win32") spawn(open ? "cmd" : "explorer", open ? ["/c", "start", "", f] : [`/select,${f}`], { detached: true, windowsHide: true }).unref();
    else spawn(process.platform === "darwin" ? "open" : "xdg-open", open ? [f] : [dirname(f)], { detached: true }).unref();
    return { ok: true };
  });
  app.get("/api/render/:id/file", async (req, reply) => {
    const j = renderQueue.jobs.find((x) => x.id === (req.params as { id: string }).id);
    if (!j?.output || !existsSync(j.output)) return reply.code(404).send({ error: "tidak ada" });
    return reply.sendFile(basename(j.output), dirname(j.output));
  });

  await app.register(fastifyStatic, { root: opts.webDir ?? opts.dataDir, serve: !!opts.webDir });
  if (opts.webDir) {
    app.setNotFoundHandler((req, reply) => req.url.startsWith("/api/") ? reply.code(404).send({ error: "tidak ada" }) : reply.sendFile("index.html"));
  }

  const timer = setInterval(() => { session?.save().catch((e) => console.error("Autosave gagal:", e.message)); }, AUTOSAVE_MS);
  const shutdown = async () => {
    clearInterval(timer);
    killAll();
    session?.claude.stop();
    try { await session?.save(); } catch (e) { console.error("Gagal menyimpan saat keluar:", (e as Error).message); }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ host: "127.0.0.1", port: opts.port });
  const addr = app.server.address();
  if (addr && typeof addr === "object") config.port = addr.port;
  // Port 0 = render dari terminal: jangan timpa konfigurasi MCP server yang mungkin sedang dibuka user.
  // Port 0 = render dari terminal. Selain itu: siapkan alat yang kurang di latar (npm bisa memblokir postinstall).
  if (opts.port !== 0) { await writeMcpConfig(); void checkClaude(); void ensureSetup(); }
  return {
    url: `http://127.0.0.1:${config.port}`,
    openFolder: async (folder: string) => switchTo(await Session.open(folder)),
    newFolder: async (folder: string, title: string) => switchTo(await Session.create(folder, title)),
    session: () => session,
    close: () => app.close(),
  };
}

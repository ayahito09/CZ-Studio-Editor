// Jembatan ke Claude Code milik user. CZ tidak menyimpan API key: pemakaian dihitung ke login Claude user.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config, getSettings } from "./config.ts";

export type ClaudeState = "terhubung" | "belum-login" | "tidak-terpasang" | "memeriksa";
export interface ClaudeStatus { state: ClaudeState; version?: string; path?: string; detail?: string; checkedAt: number }

let status: ClaudeStatus = { state: "memeriksa", checkedAt: 0 };
let checking: Promise<ClaudeStatus> | null = null;

/** `where claude` di Windows bisa memberi beberapa baris; .exe dijalankan langsung, .cmd lewat shell. */
export function findClaude(): string | null {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8", windowsHide: true });
  if (r.status === 0) {
    const lines = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const hit = lines.find((l) => /\.exe$/i.test(l)) ?? lines.find((l) => /\.cmd$/i.test(l)) ?? lines[0];
    if (hit) return hit;
  }
  // Tidak di PATH: lokasi pemasangan umum (installer resmi, npm), lalu Claude Code bawaan aplikasi desktop Claude.
  const home = homedir();
  const fixed = process.platform === "win32"
    ? [join(home, ".local", "bin", "claude.exe"), join(process.env.APPDATA ?? "", "npm", "claude.cmd")]
    : [join(home, ".local", "bin", "claude"), join(home, ".claude", "local", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"];
  const found = fixed.find((p) => p && existsSync(p));
  return found ?? (process.platform === "win32" ? desktopClaude() : null);
}

/** %LOCALAPPDATA%\Claude-Data\claude_*\claude-code\<versi>\<hash>\claude.exe — versi terbaru. */
function desktopClaude(): string | null {
  const base = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Claude-Data");
  const list = (dir: string) => { try { return readdirSync(dir); } catch { return []; } };
  const cmp = (a: string, b: string) => b.localeCompare(a, undefined, { numeric: true });
  for (const app of list(base).filter((d) => d.startsWith("claude_"))) {
    const codeDir = join(base, app, "claude-code");
    for (const ver of list(codeDir).sort(cmp)) {
      for (const hash of list(join(codeDir, ver))) {
        const exe = join(codeDir, ver, hash, "claude.exe");
        if (existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

/** Buka jendela Claude Code yang terlihat supaya user bisa masuk (/login) sendiri. */
export function openLogin(): boolean {
  const bin = findClaude();
  if (!bin) return false;
  if (process.platform === "win32") spawn("cmd", ["/c", "start", "Masuk ke Claude", "cmd", "/k", bin, "auth", "login"], { detached: true, windowsHide: false }).unref();
  else if (process.platform === "darwin") spawn("osascript", ["-e", `tell application "Terminal" to do script "${bin.replace(/"/g, '\\"')} auth login"`], { detached: true }).unref();
  else spawn("x-terminal-emulator", ["-e", bin, "auth", "login"], { detached: true }).unref();
  return true;
}

const quote = (a: string) => (/^[\w./:=\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);
function spawnClaude(bin: string, args: string[], cwd?: string): ChildProcess {
  const viaShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin);
  return viaShell
    ? spawn([quote(bin), ...args.map(quote)].join(" "), { cwd, shell: true, windowsHide: true })
    : spawn(bin, args, { cwd, windowsHide: true });
}

function collect(child: ChildProcess, input: string | null, timeoutMs: number): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    let out = "", err = "";
    const t = setTimeout(() => killTree(child), timeoutMs);
    child.stdout!.on("data", (d) => (out += d));
    child.stderr!.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(t); resolve({ code: -1, out, err: err + e.message }); });
    child.on("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
    if (input !== null) child.stdin!.end(input); else child.stdin!.end();
  });
}

export function killTree(child: ChildProcess) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
  else child.kill("SIGTERM");
}

/** `claude --version` lalu panggilan uji singkat (memakai sedikit kuota user; hanya saat diminta). */
export function checkClaude(force = false): Promise<ClaudeStatus> {
  if (checking) return checking;
  if (!force && status.checkedAt && Date.now() - status.checkedAt < 10 * 60_000) return Promise.resolve(status);
  checking = (async () => {
    const bin = findClaude();
    if (!bin) return (status = { state: "tidak-terpasang", checkedAt: Date.now() });
    const v = await collect(spawnClaude(bin, ["--version"]), null, 20_000);
    if (v.code !== 0) return (status = { state: "tidak-terpasang", path: bin, detail: v.err.trim().slice(0, 300), checkedAt: Date.now() });
    const version = v.out.trim().split(/\s/)[0];
    // Cara utama: `claude auth status` (cepat, tanpa memakai kuota). Versi lama tanpa perintah itu: panggilan uji singkat.
    const a = await collect(spawnClaude(bin, ["auth", "status"]), null, 20_000);
    try {
      const st = JSON.parse(a.out.slice(a.out.indexOf("{"))) as { loggedIn?: boolean };
      if (typeof st.loggedIn === "boolean") return (status = { state: st.loggedIn ? "terhubung" : "belum-login", version, path: bin, checkedAt: Date.now() });
    } catch { /* bukan JSON: pakai panggilan uji */ }
    const t = await collect(spawnClaude(bin, ["-p", "--output-format", "json"]), "Balas satu kata: ok", 90_000);
    let res: { is_error?: boolean; result?: string } = {};
    try { res = JSON.parse(t.out.trim().split("\n").at(-1) ?? "{}"); } catch { /* bukan JSON */ }
    const text = `${res.result ?? ""} ${t.err}`;
    if (t.code !== 0 || res.is_error) {
      const auth = /login|log in|auth|api key|credential|unauthori[sz]ed|401/i.test(text);
      return (status = { state: auth ? "belum-login" : "terhubung", version, path: bin, detail: text.trim().slice(0, 300), checkedAt: Date.now() });
    }
    return (status = { state: "terhubung", version, path: bin, checkedAt: Date.now() });
  })().finally(() => { checking = null; });
  return checking;
}
export const claudeStatus = () => status;

export interface LogEntry { at: number; kind: "user" | "text" | "tool" | "result" | "error" | "frame" | "info"; text: string }
export interface Task {
  id: string; label: string; prompt: string;
  state: "antre" | "berjalan" | "selesai" | "gagal" | "dihentikan";
  log: LogEntry[]; startedAt?: number; endedAt?: number; costUsd?: number;
  /** Skill yang sedang di-generate/diubah: alat cz_save_* menulis ke sini. */
  skill?: { id: string; version: number; dir: string };
  addDirs: string[];
}

const SYSTEM = `Kamu bekerja di dalam CZ Studio, editor video lokal milik user.
- Ubah proyek HANYA lewat alat mcp__cz__* (cz_get_project, cz_set_scenes, cz_add_asset, ...). Jangan menyunting project.cz.json atau file media.
- Waktu sequence dalam frame (bilangan bulat); waktu sumber dalam detik. Baca fps dari cz_get_project.
- Footage asli tidak diubah dan tidak ada color grading kecuali diminta.
- Audio dan video tidak dikirim kepadamu; lihat frame hanya bila perlu lewat cz_get_frame.
- Aset atau scene yang dikunci user tidak boleh diubah; alat akan menolak.
- Jawab user dalam bahasa Indonesia yang singkat.`;

/** Satu tugas Claude per proyek; tugas berikutnya antre. session_id disimpan supaya Claude ingat konteks proyek. */
export class ClaudeBridge {
  tasks: Task[] = [];
  private child: ChildProcess | null = null;
  private folder: string;
  private seq = 0;
  sessionId: string | null = null;
  constructor(folder: string) { this.folder = folder; }

  private stateFile = () => join(this.folder, ".cz", "claude.json");
  async load() {
    try { this.sessionId = JSON.parse(await readFile(this.stateFile(), "utf8")).sessionId ?? null; } catch { /* belum ada sesi */ }
  }
  private async persist() {
    await mkdir(join(this.folder, ".cz"), { recursive: true });
    await writeFile(this.stateFile(), JSON.stringify({ sessionId: this.sessionId }, null, 2));
  }
  async newSession() { this.sessionId = null; await this.persist(); }

  get running() { return this.tasks.find((t) => t.state === "berjalan") ?? null; }
  get busy() { return this.tasks.some((t) => t.state === "berjalan" || t.state === "antre"); }

  enqueue(label: string, prompt: string, opts: { skill?: Task["skill"]; addDirs?: string[] } = {}): Task {
    const t: Task = { id: "t" + ++this.seq, label, prompt, state: "antre", log: [{ at: Date.now(), kind: "user", text: prompt }], skill: opts.skill, addDirs: opts.addDirs ?? [] };
    this.tasks.push(t);
    if (this.tasks.length > 30) this.tasks = this.tasks.filter((x, i) => i >= this.tasks.length - 30 || x.state === "antre" || x.state === "berjalan");
    void this.next();
    return t;
  }

  log(kind: LogEntry["kind"], text: string) { this.running?.log.push({ at: Date.now(), kind, text }); }

  stop(id?: string) {
    for (const t of this.tasks) if (t.state === "antre" && (!id || t.id === id)) t.state = "dihentikan";
    const r = this.running;
    if (r && (!id || r.id === id) && this.child) { r.state = "dihentikan"; killTree(this.child); }
  }

  private async next() {
    if (this.running) return;
    const t = this.tasks.find((x) => x.state === "antre");
    if (!t) return;
    const bin = findClaude();
    if (!bin) { t.state = "gagal"; t.log.push({ at: Date.now(), kind: "error", text: "Claude Code tidak terpasang. Pasang dari https://claude.com/claude-code lalu jalankan claude sekali untuk login." }); return void this.next(); }
    t.state = "berjalan"; t.startedAt = Date.now();
    const args = [
      "-p", "--output-format", "stream-json", "--verbose",
      "--mcp-config", join(config.dataDir, "cz-mcp.json"), "--strict-mcp-config",
      "--allowedTools", "mcp__cz__*,Read,Glob,Grep",
      // Satu baris: claude.cmd (instalasi npm) dijalankan lewat cmd.exe, yang memutus perintah di baris baru.
      "--append-system-prompt", SYSTEM.replace(/\s*\n\s*/g, " "),
      ...(getSettings().claudeModel ? ["--model", getSettings().claudeModel] : []),
      ...t.addDirs.filter((d) => existsSync(d)).flatMap((d) => ["--add-dir", d]),
      ...(this.sessionId ? ["--resume", this.sessionId] : []),
    ];
    const child = spawnClaude(bin, args, this.folder);
    this.child = child;
    let buf = "", err = "";
    child.stdout!.on("data", (d: Buffer) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { this.onLine(t, buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    child.stderr!.on("data", (d) => { err = (err + d).slice(-3000); });
    child.stdin!.end(t.prompt);
    await new Promise<void>((resolve) => {
      child.on("error", (e) => { err += e.message; resolve(); });
      child.on("close", () => resolve());
    });
    if (buf.trim()) this.onLine(t, buf);
    this.child = null;
    t.endedAt = Date.now();
    if (t.state === "berjalan") {
      const failed = !t.log.some((l) => l.kind === "result") || t.log.at(-1)?.kind === "error";
      t.state = failed ? "gagal" : "selesai";
      if (failed && err.trim()) t.log.push({ at: Date.now(), kind: "error", text: err.trim().split("\n").slice(-3).join("\n") });
      // Sesi lama yang tidak bisa dilanjutkan: mulai baru di tugas berikutnya.
      if (failed && /session|resume/i.test(err)) await this.newSession();
    }
    await this.persist();
    void this.next();
  }

  private onLine(t: Task, line: string) {
    let m: Record<string, unknown>;
    try { m = JSON.parse(line); } catch { return; }
    if (typeof m.session_id === "string" && m.session_id !== this.sessionId) this.sessionId = m.session_id;
    const push = (kind: LogEntry["kind"], text: string) => t.log.push({ at: Date.now(), kind, text });
    if (m.type === "assistant") {
      const content = ((m.message as { content?: unknown[] })?.content ?? []) as Record<string, unknown>[];
      for (const c of content) {
        if (c.type === "text" && typeof c.text === "string" && c.text.trim()) push("text", c.text.trim());
        if (c.type === "tool_use") push("tool", `${String(c.name).replace(/^mcp__cz__/, "")} ${JSON.stringify(c.input).slice(0, 200)}`);
      }
    } else if (m.type === "result") {
      t.costUsd = typeof m.total_cost_usd === "number" ? m.total_cost_usd : undefined;
      if (m.is_error) push("error", String(m.result ?? m.subtype ?? "Claude berhenti dengan galat"));
      else push("result", typeof m.result === "string" && m.result.trim() ? m.result.trim() : "Selesai");
    }
  }

  view() {
    return {
      sessionId: this.sessionId,
      tasks: this.tasks.map((t) => ({ ...t, prompt: undefined, addDirs: undefined, log: t.log.slice(-200) })),
    };
  }
}

/** Konfigurasi MCP yang diberikan ke Claude: server stdio `cz mcp` yang meneruskan ke server lokal ini. */
export async function writeMcpConfig() {
  await mkdir(config.dataDir, { recursive: true });
  const [cmd, ...args] = config.self;
  const cfg = { mcpServers: { cz: { type: "stdio", command: cmd, args: [...args, "mcp", "--port", String(config.port)], env: { CZ_TOKEN: config.token } } } };
  await writeFile(join(config.dataDir, "cz-mcp.json"), JSON.stringify(cfg, null, 2));
}

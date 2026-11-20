#!/usr/bin/env node
import { exec, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const HELP = `CZ Studio

  cz                         buka beranda (daftar proyek dan skill)
  cz open "<folder proyek>"  buka proyek
  cz new "<folder>" [--title "<judul>"] [--video "<file>"] [--skill <id>]
                             buat proyek baru
  cz skill add "<folder skill atau .zip>"
  cz render "<folder proyek>" [--preset 9:16|1:1|4:5|16:9] [--codec h264|h265|prores]
  cz models install [--model base|small|medium]
                             unduh model transkrip lokal (whisper.cpp)
  cz doctor                  cek Node, ffmpeg, Claude Code, model, port
  cz update                  perbarui ke versi terbaru

  --port <n>     port server (bawaan 4317)
  --no-open      jangan buka browser
  --data <dir>   folder data (bawaan ~/.cz-studio)
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string", default: "4317" },
    "no-open": { type: "boolean", default: false },
    data: { type: "string", default: join(homedir(), ".cz-studio") },
    title: { type: "string" },
    video: { type: "string" },
    skill: { type: "string" },
    preset: { type: "string" },
    codec: { type: "string" },
    model: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

const [cmd, arg, arg2] = positionals;
const COMMANDS = ["open", "new", "skill", "render", "models", "doctor", "update", "mcp"];
const needsArg = ["open", "new", "skill", "render", "models"];
if (values.help || (cmd && !COMMANDS.includes(cmd)) || (cmd && needsArg.includes(cmd) && !arg)) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error("--port harus angka 1-65535"); process.exit(1); }
const dataDir = resolve(values.data);
const { config } = await import("./config.ts");
config.dataDir = dataDir;

// Bundel: dist/cli.js + dist/web. Dari sumber: apps/server/src/cli.ts + dist/web (hasil npm run build).
const here = dirname(fileURLToPath(import.meta.url));
const webDir = [join(here, "web"), join(here, "../../../dist/web")].find((d) => existsSync(join(d, "index.html"))) ?? null;
const pkgFile = [join(here, "../package.json"), join(here, "../../../package.json")].find(existsSync);
const version = pkgFile ? JSON.parse(readFileSync(pkgFile, "utf8")).version as string : "dev";

async function main() {
  switch (cmd) {
    case "mcp": {
      const { runMcp } = await import("./mcp.ts");
      return runMcp(port);
    }
    case "models": {
      if (arg !== "install") { console.log(HELP); process.exit(1); }
      const { installModels, MODELS } = await import("./transcribe.ts");
      const m = values.model ?? "small";
      if (!(m in MODELS)) throw new Error("--model harus base, small, atau medium");
      return installModels(m as keyof typeof MODELS);
    }
    case "skill": {
      if (arg !== "add" || !arg2) { console.log(HELP); process.exit(1); }
      const { addSkill } = await import("./skills.ts");
      const meta = await addSkill(arg2);
      console.log(`Skill "${meta.name}" ditambahkan sebagai ${meta.id} v${Math.max(...meta.versions)}.`);
      console.log("Buka CZ Studio lalu tekan Generate template di panel Skill (butuh Claude Code).");
      return;
    }
    case "doctor": return doctor();
    case "update": {
      console.log("Memperbarui cz-studio lewat npm…");
      const r = spawnSync("npm", ["install", "-g", "cz-studio@latest"], { stdio: "inherit", shell: process.platform === "win32" });
      process.exit(r.status ?? 1);
    }
    case "render": return renderCli();
  }

  const { startServer } = await import("./app.ts");
  const server = await startServer({ port, dataDir, webDir });
  if (cmd === "open") await server.openFolder(resolve(arg));
  if (cmd === "new") {
    await server.newFolder(resolve(arg), values.title ?? basename(resolve(arg)));
    const s = server.session()!;
    if (values.skill) {
      const { getMeta } = await import("./skills.ts");
      const meta = await getMeta(values.skill);
      const err = s.apply({ type: "setSkill", skill: { id: meta.id, version: Math.max(...meta.versions) } });
      if (err) throw new Error(err);
    }
    if (values.video) {
      // Bawaan SPEC: media disalin ke folder proyek supaya proyek mudah dipindah.
      const { saveUpload } = await import("./media.ts");
      const { createReadStream } = await import("node:fs");
      const v = resolve(values.video);
      await s.importMedia(await saveUpload(s.folder, basename(v), createReadStream(v)), false);
    }
  }
  console.log(`CZ Studio ${version} jalan di ${server.url}  (Ctrl+C untuk berhenti)`);
  if (!webDir) console.log("UI belum di-build: jalankan npm run build, atau npm run dev untuk pengembangan.");
  if (!values["no-open"] && webDir) {
    const u = server.url;
    exec(process.platform === "win32" ? `start "" "${u}"` : process.platform === "darwin" ? `open "${u}"` : `xdg-open "${u}"`);
  }
}

/** Render tanpa browser: server sementara di port acak, render, lalu keluar. */
async function renderCli() {
  const { startServer } = await import("./app.ts");
  const { renderQueue } = await import("./render.ts");
  const { SEQUENCE_PRESETS } = await import("@cz/core");
  const server = await startServer({ port: 0, dataDir, webDir: null });
  await server.openFolder(resolve(arg));
  const s = server.session()!;
  const p = s.history.project;
  const preset = SEQUENCE_PRESETS.find((x) => x.id === values.preset);
  if (values.preset && !preset) throw new Error(`--preset harus ${SEQUENCE_PRESETS.map((x) => x.id).join(", ")}`);
  const codec = values.codec === "h265" || values.codec === "prores" ? values.codec : "h264";
  const job = renderQueue.enqueue(s.folder, p, await s.library(), {
    width: preset?.width ?? p.sequence.width, height: preset?.height ?? p.sequence.height, fps: p.sequence.fps,
    codec, crf: 18, normalize: true, range: "all",
  });
  const tick = setInterval(() => {
    const j = renderQueue.jobs.find((x) => x.id === job.id)!;
    process.stdout.write(`\r${j.note ?? j.state} ${Math.round(j.progress * 100)}%${j.eta ? ` · sisa ${j.eta} dtk` : ""}        `);
  }, 1000);
  const done = await renderQueue.wait(job.id);
  clearInterval(tick);
  console.log(done.state === "selesai" ? `\nSelesai: ${done.output}` : `\nRender ${done.state}: ${done.error ?? ""}`);
  await server.close();
  process.exit(done.state === "selesai" ? 0 : 1);
}

async function doctor() {
  const ok = (b: boolean) => (b ? "✓" : "✗");
  const ver = (bin: string, args: string[]) => {
    // Sama seperti aplikasi memanggilnya: spawn langsung, tanpa shell.
    const r = spawnSync(bin, args, { encoding: "utf8", windowsHide: true });
    return r.status === 0 ? (r.stdout || r.stderr).split("\n")[0].trim() : null;
  };
  const major = Number(process.versions.node.split(".")[0]);
  console.log(`CZ Studio ${version}\n`);
  console.log(`${ok(major >= 20)} Node.js ${process.versions.node}${major >= 20 ? "" : "  → butuh Node 20 atau lebih baru"}`);
  const ff = ver("ffmpeg", ["-version"]), fp = ver("ffprobe", ["-version"]);
  console.log(`${ok(!!ff)} ffmpeg ${ff ? ff.split(" ")[2] : "tidak ditemukan  → pasang ffmpeg dan tambahkan ke PATH (winget install Gyan.FFmpeg)"}`);
  console.log(`${ok(!!fp)} ffprobe ${fp ? "ada" : "tidak ditemukan"}`);
  const { checkClaude } = await import("./claude.ts");
  const c = await checkClaude(true);
  const claudeMsg = { "terhubung": `terhubung (${c.version})`, "belum-login": "belum login  → buka terminal, jalankan claude, lalu login", "tidak-terpasang": "tidak terpasang  → https://claude.com/claude-code", "memeriksa": "" }[c.state];
  console.log(`${ok(c.state === "terhubung")} Claude Code ${claudeMsg}`);
  const { engineStatus } = await import("./transcribe.ts");
  const e = await engineStatus();
  console.log(`${ok(!!e.bin)} whisper-cli ${e.bin ?? "tidak ditemukan  → cz models install"}`);
  console.log(`${ok(!!e.model)} Model transkrip ${e.model ? basename(e.model) : "belum dipasang  → cz models install"}`);
  const net = await import("node:net");
  const free = await new Promise<boolean>((res) => { const sv = net.createServer().once("error", () => res(false)).listen(port, "127.0.0.1", () => sv.close(() => res(true))); });
  console.log(`${ok(free)} Port ${port} ${free ? "kosong" : "sedang dipakai (CZ sudah jalan? atau pakai --port)"}`);
  console.log(`\nFolder data: ${dataDir}`);
  console.log("Fitur non-AI (impor, potong, timeline, aset, render) tetap jalan tanpa Claude Code.");
}

try {
  await main();
} catch (e) {
  const err = e as NodeJS.ErrnoException;
  console.error(err.code === "EADDRINUSE" ? `Port ${port} sedang dipakai. Coba: cz --port ${port + 1}` : err.message);
  process.exit(1);
}

// npm run dev: server dari sumber (.ts langsung, Node 23.6+) + Vite dengan proxy /api.
import { spawn } from "node:child_process";

const run = (args) => spawn(process.execPath, args, { stdio: "inherit" });
const kids = [
  run(["apps/server/src/cli.ts", "--no-open", ...process.argv.slice(2)]),
  run(["node_modules/vite/bin/vite.js", "apps/web"]),
];
const stop = () => { for (const k of kids) k.kill("SIGINT"); };
process.on("SIGINT", stop);
for (const k of kids) k.on("exit", (code) => { if (code) { stop(); process.exitCode = code; } });

// `cz mcp`: server MCP stdio yang dijalankan Claude Code. Ia tidak menyentuh proyek sendiri;
// setiap alat diteruskan ke server CZ lokal (/api/mcp/*), yang memvalidasi dan mencatatnya di riwayat sebagai "claude".
import { createInterface } from "node:readline";

export async function runMcp(port: number) {
  const token = process.env.CZ_TOKEN ?? "";
  const base = `http://127.0.0.1:${port}/api/mcp`;
  const call = async (path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", "x-cz-token": token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? `server CZ membalas ${res.status}`);
    return data;
  };
  const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");

  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg: { id?: number | string; method?: string; params?: Record<string, unknown> };
    try { msg = JSON.parse(line); } catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); continue; }
    if (msg.id === undefined) continue; // notifikasi (initialized, cancelled)
    const reply = (result: unknown) => send({ jsonrpc: "2.0", id: msg.id, result });
    try {
      switch (msg.method) {
        case "initialize":
          reply({ protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "cz", version: "1" } });
          break;
        case "ping": reply({}); break;
        case "tools/list": reply({ tools: await call("/tools") }); break;
        case "tools/call":
          try { reply(await call("/call", { name: msg.params?.name, arguments: msg.params?.arguments ?? {} })); }
          catch (e) { reply({ content: [{ type: "text", text: (e as Error).message }], isError: true }); }
          break;
        default: send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Metode tidak dikenal: ${msg.method}` } });
      }
    } catch (e) {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: (e as Error).message } });
    }
  }
}

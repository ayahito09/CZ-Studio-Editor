// Paket elemen lokal (milik developer, tidak ikut paket npm): <pustaka>/Paket/<id>/pack.json (katalog elemen) + pack.js (komponennya).
// Tanpa paket, CZ tetap jalan; panel Elemen hanya berisi elemen dari skill.
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AssetDef } from "@cz/core";
import { libraryPath } from "./config.ts";

export interface PackMeta { id: string; name: string; assets: AssetDef[] }
const PACK_FILE = "pack.js";

export const packDir = (id: string) => join(libraryPath("packs"), id);
export const packFile = (id: string) => (/^[\w-]+$/.test(id) ? join(packDir(id), PACK_FILE) : "");

/** Paket yang terpasang (pack.json dan pack.js ada). Dibaca ulang tiap panggilan: kecil dan jarang dipanggil. */
export async function listPacks(): Promise<PackMeta[]> {
  const root = libraryPath("packs");
  if (!existsSync(root)) return [];
  const out: PackMeta[] = [];
  for (const e of await readdir(root, { withFileTypes: true })) {
    if (!e.isDirectory() || !existsSync(join(root, e.name, PACK_FILE))) continue;
    try {
      const j = JSON.parse(await readFile(join(root, e.name, "pack.json"), "utf8")) as Partial<PackMeta>;
      if (Array.isArray(j.assets)) out.push({ id: e.name, name: String(j.name ?? e.name), assets: j.assets });
    } catch { /* paket rusak dilewati */ }
  }
  return out;
}

/** Semua definisi elemen dari paket (menggantikan katalog bawaan lama). */
export const packDefs = async (): Promise<AssetDef[]> => (await listPacks()).flatMap((p) => p.assets);

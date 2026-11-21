// Paket elemen lokal milik developer (tidak ikut paket npm): modul JS yang dimuat dengan import() di Player dan di Chrome headless saat render,
// memakai react/remotion/cz-motion milik CZ (satu salinan), jadi pratinjau = render. Server mendaftarkannya di /api/packs.
import { useEffect, useState, type FC } from "react";
import { continueRender, delayRender } from "remotion";
import type { AssetDef } from "@cz/core";
import type { AssetProps } from "./assetProps.ts";

export interface PackInfo { id: string; name: string; url: string; assets: AssetDef[] }
type PackModule = { components: Record<string, FC<AssetProps>> };
const g = globalThis as unknown as { __czPacks?: Record<string, PackModule> };

// new Function: bundler (Vite/webpack) tidak boleh mencoba membundel URL modul paket.
const importUrl = new Function("u", "return import(u)") as (u: string) => Promise<unknown>;
const loads = new Map<string, Promise<void>>();
const loaded = new Set<string>();
let active: PackInfo[] = [];

/** Paket yang sedang dipakai editor/komposisi: modul skill menunggunya dulu karena "cz-assets" datang dari paket. */
export const setActivePacks = (p: PackInfo[]) => { active = p; };

export function loadPack(p: PackInfo): Promise<void> {
  let l = loads.get(p.url);
  if (!l) {
    l = importUrl(p.url).then(() => { loaded.add(p.url); });
    l.catch(() => loads.delete(p.url));
    loads.set(p.url, l);
  }
  return l;
}
export const ensurePacks = (): Promise<void> => Promise.all(active.map(loadPack)).then(() => {}, () => {});

/** Komponen elemen dari paket yang sudah dimuat (undefined bila tidak ada paket yang memilikinya). */
export const packComponent = (id: string | undefined): FC<AssetProps> | undefined =>
  id ? Object.values(g.__czPacks ?? {}).map((m) => m.components[id]).find(Boolean) : undefined;

/** Memuat paket (menahan render sampai selesai); true bila semua siap atau gagal (elemen yang hilang jatuh ke tampilan cadangan). */
export function usePacksLoaded(packs: PackInfo[] | undefined): boolean {
  const list = packs ?? [];
  if (list.length) active = list;
  const key = list.map((p) => p.url).join("|");
  const [done, setDone] = useState(() => list.every((p) => loaded.has(p.url)));
  const [handle] = useState(() => (list.length && !done ? delayRender("paket elemen", { timeoutInMilliseconds: 120_000 }) : null));
  useEffect(() => {
    if (!list.length) return;
    let live = true;
    Promise.all(list.map(loadPack)).then(() => {}, () => {})
      .finally(() => { if (live) setDone(true); if (handle !== null) continueRender(handle); });
    return () => { live = false; };
  }, [key]);
  return done || !list.length;
}

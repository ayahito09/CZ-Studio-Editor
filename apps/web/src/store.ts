import { useSyncExternalStore } from "react";

/** Nilai kecil yang sering berubah (playhead) tanpa me-render ulang seluruh editor. */
export interface Store<T> { get(): T; set(v: T): void; sub(fn: () => void): () => void }

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (v) => { if (v !== value) { value = v; subs.forEach((f) => f()); } },
    sub: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}

export const useStore = <T,>(s: Store<T>) => useSyncExternalStore(s.sub, s.get);

export function timecode(frame: number, fps: number) {
  const f = Math.max(0, Math.round(frame));
  const r = Math.round(fps);
  const totalSec = Math.floor(f / r);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(totalSec / 3600))}:${p(Math.floor(totalSec / 60) % 60)}:${p(totalSec % 60)}:${p(f % r)}`;
}

export function loadLocal<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? { ...fallback, ...JSON.parse(v) } : fallback; }
  catch { return fallback; }
}
export function saveLocal(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* penyimpanan browser tidak tersedia */ }
}

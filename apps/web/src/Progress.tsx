import { useEffect, useRef, useState, type ReactNode } from "react";

/** "sisa ~2 mnt" dari detik. */
export function fmtLeft(sec: number) {
  if (sec < 5) return "hampir selesai";
  if (sec < 60) return `sisa ~${Math.ceil(sec / 5) * 5} dtk`;
  const m = Math.round(sec / 60);
  return m < 60 ? `sisa ~${m} mnt` : `sisa ~${Math.floor(m / 60)} j ${m % 60} mnt`;
}
export function fmtElapsed(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return s < 60 ? `${s} dtk` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} mnt`;
}

/** Perkiraan sisa waktu dari laju sejauh ini; null bila belum cukup data. */
export function etaSec(value: number, since: number, now = Date.now()) {
  const el = (now - since) / 1000;
  if (value < 0.02 || value >= 1 || el < 3) return null;
  return (el * (1 - value)) / value;
}

/** Detak sekali per detik supaya waktu berjalan dan sisa waktu tetap segar di antara polling. */
function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => { if (!on) return; const t = setInterval(() => set((n) => n + 1), 1000); return () => clearInterval(t); }, [on]);
}

/**
 * Bilah kemajuan dengan persen dan perkiraan sisa waktu.
 * value null = belum diketahui (bilah bergerak, waktu berjalan ditampilkan).
 * since: kapan pekerjaan mulai (ms); tanpa itu dihitung dari saat bilah pertama tampil.
 * eta: sisa detik dari server bila ada (lebih akurat dari tebakan laju).
 */
export function Progress({ value, since, eta, label, size = "md" }: { value: number | null; since?: number; eta?: number | null; label?: ReactNode; size?: "sm" | "md" }) {
  const mounted = useRef(Date.now());
  const start = since ?? mounted.current;
  const done = value !== null && value >= 1;
  useTick(!done);
  const v = value === null ? null : Math.max(0, Math.min(1, value));
  const left = eta ?? (v === null ? null : etaSec(v, start));
  const pct = v === null ? null : Math.floor(v * 100);
  return (
    <div className={`prog prog--${size}` + (v === null ? " is-indet" : "")}>
      {label && <span className="prog__label">{label}</span>}
      <div className="prog__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}
        aria-valuetext={pct === null ? "Sedang diproses" : `${pct}%${left !== null ? `, ${fmtLeft(left)}` : ""}`}>
        <div className="prog__fill" style={v === null ? undefined : { width: `${v * 100}%` }} />
      </div>
      <span className="prog__meta mono">
        <b>{pct === null ? "…" : `${pct}%`}</b>
        <span>{done ? "selesai" : left !== null ? fmtLeft(left) : v === null || (pct ?? 0) < 2 ? `berjalan ${fmtElapsed((Date.now() - start) / 1000)}` : "menghitung sisa waktu…"}</span>
      </span>
    </div>
  );
}

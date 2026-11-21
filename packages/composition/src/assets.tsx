// Aset bawaan CZ sebagai KOMPONEN KODE (katalognya di @cz/core BUILTIN_ASSETS), juga fondasi aset skill: komposisi
// "Aset…" skill mengimpornya dari modul "cz-assets" (beri warna/font skill), dan membungkus elemen khasnya dengan Life/Stagger.
// Semua gerak dari mesin cz-motion: masuk dengan follow-through, isi masuk bertahap, ketikan sungguhan, angka bergulir, dan keluar di kecepatan puncak.
// Frame dibaca di dalam komponen (useCurrentFrame), jadi motion blur render menyapu setiap gerak.
import { Children, type CSSProperties, type FC, type ReactNode } from "react";
import { getRemotionEnvironment, Html5Video, OffthreadVideo, useCurrentFrame } from "remotion";
import {
  BlurIn, DropIn, EASE_PRO, Move, Phone, RiseTilt, TypeLine, WipeReveal, clamp01, curve, enter, exit, lerp, measure, pop, pressScale,
  smoothSteps, snapIn, springEase, SPRING_PRO, tempo, type FontSpec, type K,
} from "./motion/index.ts";

export interface AssetProps {
  params: Record<string, unknown>;
  durationInFrames: number; fps: number;
  /** Ukuran kotak aset (px sequence). */
  width: number; height: number;
  /** Kata yang diucapkan selama aset tampil: detik relatif awal aset. */
  words: { w: string; s: number; e: number }[];
  /** URL video untuk param bertipe media. */
  mediaSrc?: string;
  /** Font gaya edit (skill) pengganti font UI bawaan, mis. "'CE Inter', sans-serif". */
  font?: string;
}

export const UI = `Inter, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
export const str = (v: unknown, d = "") => (typeof v === "string" ? v : v === undefined || v === null ? d : String(v));
export const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
export const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
const rendering = () => getRemotionEnvironment().isRendering;

/** Masuk + keluar seluruh aset (follow-through mesin), dalam frame nyata. */
export function lifeKeys(len: number, T: (n: number) => number, o: { dir?: "up" | "down" | "left" | "right" | "none"; dist?: number; scale?: number; blur?: number; dur?: number; outDir?: "up" | "down" | "none" } = {}): K[] {
  const inF = T(o.dur ?? 18), outF = Math.min(T(10), Math.floor(len / 3));
  return [
    ...enter(0, { dir: o.dir ?? "up", dist: o.dist ?? 80, dur: inF, blur: o.blur ?? 20, scale: o.scale ?? 0.95 }),
    ...exit(Math.max(inF + 1, len - outF), { dir: o.outDir ?? "up", dist: (o.dist ?? 80) * 0.6, dur: outF, scale: 0.94 }),
  ];
}

/** Bungkus teks ke beberapa baris sesuai lebar nyata font. */
export function wrap(text: string, font: FontSpec, maxW: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && measure(next, font) > maxW) { out.push(cur); cur = w; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

/* ---------------- Judul bergerak ---------------- */
export const KineticTitle: FC<AssetProps> = ({ params, durationInFrames, fps, width, height, font }) => {
  const ff = font ?? UI;
  const T = tempo(fps);
  const text = str(params.text, "Teks");
  const gaya = str(params.gaya, "blur");
  const ink = str(params.warna, "#FFFFFF"), acc = str(params.aksenWarna, "#DCF90C");
  let size = num(params.ukuran, 92);
  const fontAt = (s: number): FontSpec => ({ family: ff, size: s, weight: 750, letterSpacing: -0.02 });
  // kecilkan sampai kata terpanjang muat dan baris tidak melebihi tinggi kotak
  for (let i = 0; i < 12; i++) {
    const lines = wrap(text, fontAt(size), width * 0.94);
    const widest = Math.max(...text.split(/\s+/).map((w) => measure(w, fontAt(size))));
    if (widest <= width * 0.94 && lines.length * size * 1.2 <= height) break;
    size *= 0.88;
  }
  const f = fontAt(size);
  const lines = wrap(text, f, width * 0.94);
  const akN = str(params.aksen).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const every = T(4), dur = T(14);
  const shadow: CSSProperties = { textShadow: "0 6px 28px rgba(0,0,0,.35)" };
  let idx = 0;
  const rows = lines.map((line, li) => {
    const ws = line.split(" ");
    const keep = ws.map((w, i) => (akN && w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") === akN ? i : -1)).filter((i) => i >= 0);
    const wordStyle = Object.fromEntries(keep.map((i) => [i, { textShadow: `0 0 ${size * 0.3}px ${acc}99` }]));
    const start = T(6) + idx * every;
    idx += ws.length;
    const common = { text: line, start, font: f, ink, accent: keep.length ? acc : undefined, keep, every, dur, wordStyle, style: shadow };
    const node: ReactNode =
      gaya === "naik" ? <RiseTilt {...common} /> :
      gaya === "jatuh" ? <DropIn {...common} /> :
      gaya === "sapu" ? <WipeReveal {...common} dur={T(24)} /> :
      gaya === "ketik" ? <TypeLine text={line} start={start} cpf={18 / fps} caret={li === lines.length - 1 ? "bar" : "none"} caretColor={acc}
        style={{ fontFamily: ff, fontSize: size, fontWeight: 750, color: ink, ...shadow }} /> :
      <BlurIn {...common} />;
    if (gaya === "ketik") idx += Math.ceil((line.length / 18) * fps / every);
    return <div key={li} style={{ display: "flex", justifyContent: "center", height: size * 1.2 }}>{node}</div>;
  });
  return (
    <Move keys={lifeKeys(durationInFrames, T, { dir: "none", dist: 0, blur: 0, scale: 1, dur: 6 })} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, display: "flex", flexDirection: "column", justifyContent: "center" }}>{rows}</div>
    </Move>
  );
};

/* ---------------- Mockup chat diketik ---------------- */
type Msg = { from: string; text: string; me: boolean };
export const ChatMockup: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI;
  const frame = useCurrentFrame();
  const T = tempo(fps);
  const dark = str(params.tema) === "gelap";
  const acc = str(params.aksen, "#D97757");
  const bg = dark ? "#1F1F1E" : "#FAF9F5", ink = dark ? "#F4F3EE" : "#1F1E1D", soft = dark ? "#2B2A27" : "#EFEDE6", line = dark ? "#3A3935" : "#E5E3DA";
  const raw = list(params.pesan);
  const first = raw[0]?.split(":")[0]?.trim() ?? "Saya";
  const msgs: Msg[] = raw.map((r) => {
    const i = r.indexOf(":");
    const from = i > 0 ? r.slice(0, i).trim() : first;
    return { from, text: (i > 0 ? r.slice(i + 1) : r).trim(), me: from === first };
  });
  const cps = num(params.kecepatan, 18);
  // Jadwal: pesan saya diketik di kotak tulis lalu dikirim; balasan didahului titik-titik mengetik lalu mengalir per kata.
  type Ev = { m: Msg; typeAt: number; typeDur: number; showAt: number; streamDur: number };
  const evs: Ev[] = [];
  let t = T(16);
  for (const m of msgs) {
    if (m.me) { const d = Math.max(T(8), Math.round((m.text.length / cps) * fps)); evs.push({ m, typeAt: t, typeDur: d, showAt: t + d + T(4), streamDur: 0 }); t += d + T(4) + T(10); }
    else { const words = m.text.split(/\s+/).length; const d = Math.round(words * fps / 9); evs.push({ m, typeAt: t, typeDur: T(22), showAt: t + T(22), streamDur: d }); t += T(22) + d + T(12); }
  }
  // Muat di durasi aset: jadwal dipadatkan bila lebih panjang dari sisa waktu sebelum keluar.
  const k = Math.min(1, Math.max(1, len - T(18) - T(16)) / Math.max(1, t - T(16)));
  const at = (x: number) => T(16) + (x - T(16)) * k;
  for (const e of evs) { e.typeAt = at(e.typeAt); e.typeDur *= k; e.showAt = at(e.showAt); e.streamDur *= k; }

  const pad = 40, headH = 120, inputH = 132, areaH = height - headH - inputH - pad;
  const fs = 34, bubbleW = width * 0.74;
  const bubbleFont: FontSpec = { family: ff, size: fs, weight: 450 };
  const heightOf = (m: Msg) => wrap(m.text, bubbleFont, bubbleW - 56).length * fs * 1.32 + 40 + 18;
  // gulir ke bawah setiap pesan baru muncul (mulus, tidak meloncat)
  let acc0 = 0;
  const steps: Array<[number, number]> = [[0, 0]];
  for (const e of evs) { acc0 += heightOf(e.m); steps.push([e.showAt, Math.max(0, acc0 - areaH)]); }
  const scroll = smoothSteps(frame, steps, T(14), EASE_PRO.move);
  const typing = evs.find((e) => e.m.me && frame >= e.typeAt - T(6) && frame < e.showAt);
  const sendAt = typing ? typing.showAt - T(4) : -1000;
  const lastSend = [...evs].reverse().find((e) => e.m.me && frame >= e.showAt - T(4));
  return (
    <Move keys={lifeKeys(len, T, { dist: 120, blur: 24 })} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, borderRadius: 44, background: bg, boxShadow: "0 40px 90px -30px rgba(0,0,0,.45)", overflow: "hidden", position: "relative", fontFamily: ff, color: ink }}>
        {/* kepala */}
        <div style={{ height: headH, display: "flex", alignItems: "center", gap: 20, padding: `0 ${pad}px`, borderBottom: `1.5px solid ${line}` }}>
          <Move keys={pop(T(6))} anchor="flow"><div style={{ width: 64, height: 64, borderRadius: 20, background: acc, color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 30 }}>{str(params.judul, "Chat").slice(0, 1).toUpperCase()}</div></Move>
          <Move keys={snapIn(T(9), { dir: "left", dist: 20 })} anchor="flow"><div style={{ fontSize: 38, fontWeight: 650 }}>{str(params.judul, "Chat")}</div></Move>
        </div>
        {/* pesan */}
        <div style={{ position: "absolute", left: 0, right: 0, top: headH, height: areaH + pad, overflow: "hidden" }}>
          <div style={{ padding: `${pad / 2}px ${pad}px`, transform: `translateY(${-scroll}px)`, display: "flex", flexDirection: "column", gap: 18 }}>
            {evs.map((e, i) => {
              if (!e.m.me && frame >= e.typeAt && frame < e.showAt) return <TypingDots key={i} at={e.typeAt} soft={soft} ink={ink} T={T} />;
              if (frame < e.showAt) return null;
              const shown = e.m.me ? e.m.text : streamWords(e.m.text, frame - e.showAt, e.streamDur);
              return (
                <Move key={i} keys={e.m.me ? snapIn(e.showAt, { dir: "up", dist: 60, blur: 6, scale: 0.9 }) : snapIn(e.showAt, { dir: "up", dist: 24, blur: 8 })} anchor="flow"
                  origin={e.m.me ? "100% 100%" : "0% 100%"} style={{ alignSelf: e.m.me ? "flex-end" : "flex-start", maxWidth: bubbleW }}>
                  <div style={{ padding: "20px 28px", borderRadius: 30, borderBottomRightRadius: e.m.me ? 10 : 30, borderBottomLeftRadius: e.m.me ? 30 : 10,
                    background: e.m.me ? acc : soft, color: e.m.me ? "#fff" : ink, fontSize: fs, lineHeight: 1.32, whiteSpace: "pre-wrap" }}>{shown}</div>
                </Move>
              );
            })}
          </div>
        </div>
        {/* kotak tulis: teks diketik sungguhan dengan kursor, tombol kirim ditekan */}
        <div style={{ position: "absolute", left: pad / 2, right: pad / 2, bottom: pad / 2, height: inputH - pad / 2, borderRadius: 32, border: `1.5px solid ${line}`,
          background: dark ? "#262624" : "#fff", display: "flex", alignItems: "center", padding: "0 18px 0 30px", gap: 16 }}>
          <div style={{ flex: 1, overflow: "hidden", whiteSpace: "nowrap", fontSize: 32, color: ink, display: "flex", alignItems: "center" }}>
            {typing ? <Typed text={typing.m.text} at={typing.typeAt} dur={typing.typeDur} caret={acc} /> : <span style={{ color: dark ? "#8A887F" : "#A6A39A" }}>Tulis pesan…</span>}
          </div>
          <div style={{ width: 68, height: 68, borderRadius: 20, background: acc, color: "#fff", display: "grid", placeItems: "center", fontSize: 34, fontWeight: 700,
            transform: `scale(${pressScale(frame, typing ? sendAt : lastSend ? lastSend.showAt - T(4) : -1000, 0.12)})` }}>↑</div>
        </div>
      </div>
    </Move>
  );
};

/** Ketikan huruf demi huruf dengan kursor; kotak tulis bergeser mengikuti ujung ketikan (yang tampil = huruf yang baru diketik). */
const Typed: FC<{ text: string; at: number; dur: number; caret: string }> = ({ text, at, dur, caret }) => {
  const frame = useCurrentFrame();
  const n = Math.max(0, Math.min(text.length, Math.floor(((frame - at) / Math.max(1, dur)) * text.length)));
  const shown = text.slice(0, n);
  const blink = n < text.length || Math.floor((frame - at) / 8) % 2 === 0;
  return (
    <span style={{ whiteSpace: "pre" }}>
      {shown.length > 40 ? "…" + shown.slice(-40) : shown}
      <span style={{ display: "inline-block", width: 3, height: 36, marginLeft: 3, verticalAlign: "middle", background: caret, borderRadius: 2, opacity: blink ? 1 : 0 }} />
    </span>
  );
};

const streamWords = (text: string, age: number, dur: number) => {
  const ws = text.split(/(\s+)/);
  const n = Math.ceil((ws.length * clamp01(age / Math.max(1, dur))));
  return ws.slice(0, Math.max(1, n)).join("");
};

const TypingDots: FC<{ at: number; soft: string; ink: string; T: (n: number) => number }> = ({ at, soft, ink, T }) => {
  const frame = useCurrentFrame();
  return (
    <Move keys={snapIn(at, { dir: "up", dist: 16 })} anchor="flow" style={{ alignSelf: "flex-start" }}>
      <div style={{ display: "flex", gap: 10, padding: "26px 30px", borderRadius: 30, borderBottomLeftRadius: 10, background: soft }}>
        {[0, 1, 2].map((i) => {
          const ph = ((frame - at) / T(18) - i * 0.18) * Math.PI * 2;
          return <span key={i} style={{ width: 14, height: 14, borderRadius: 7, background: ink, opacity: 0.35 + 0.45 * Math.max(0, Math.sin(ph)), transform: `translateY(${-6 * Math.max(0, Math.sin(ph))}px)` }} />;
        })}
      </div>
    </Move>
  );
};

/* ---------------- Kartu poin ---------------- */
export const PointCard: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, font }) => {
  const ff = font ?? UI;
  const frame = useCurrentFrame();
  const T = tempo(fps);
  const tema = str(params.tema, "terang");
  const acc = str(params.aksen, "#3683D6");
  const ink = tema === "terang" ? "#111318" : "#FFFFFF";
  const bg = tema === "terang" ? "#FFFFFF" : tema === "gelap" ? "#121316" : "rgba(255,255,255,.14)";
  const poin = list(params.poin);
  const tf: FontSpec = { family: ff, size: 54, weight: 720, letterSpacing: -0.02 };
  const titleLines = wrap(str(params.judul), tf, width - 120);
  const bar = EASE_PRO.move(clamp01((frame - T(14)) / T(16)));
  return (
    <Move keys={lifeKeys(len, T, { dist: 90, blur: 26, scale: 0.95, dur: 16 })} anchor="flow" style={{ width }}>
      <div style={{ width, boxSizing: "border-box", padding: 56, borderRadius: 40, background: bg, color: ink, fontFamily: ff,
        boxShadow: tema === "kaca" ? "inset 0 0 0 1.5px rgba(255,255,255,.35)" : "0 30px 70px -20px rgba(0,0,0,.35)",
        backdropFilter: tema === "kaca" ? "blur(24px)" : undefined }}>
        {titleLines.map((l, i) => (
          <div key={i} style={{ height: 54 * 1.2 }}><BlurIn text={l} start={T(8) + i * T(8)} font={tf} ink={ink} every={T(3)} dur={T(12)} /></div>
        ))}
        <div style={{ height: 6, width: `${bar * 30}%`, background: acc, borderRadius: 3, margin: "16px 0 20px" }} />
        {str(params.sub) && <Move keys={snapIn(T(16), { dir: "up", dist: 14 })} anchor="flow"><div style={{ fontSize: 34, opacity: 0.7, marginBottom: 26 }}>{str(params.sub)}</div></Move>}
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {poin.map((p, i) => {
            const at = T(22) + i * T(7);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 22 }}>
                <Move keys={pop(at, { dur: T(12) })} anchor="flow"><div style={{ width: 52, height: 52, borderRadius: 16, background: acc, color: "#fff", display: "grid", placeItems: "center", fontSize: 28, fontWeight: 700 }}>{str(params.ikon, "✦")}</div></Move>
                <Move keys={snapIn(at + T(3), { dir: "right", dist: 30, blur: 10 })} anchor="flow"><div style={{ fontSize: 40, fontWeight: 560 }}>{p}</div></Move>
              </div>
            );
          })}
        </div>
      </div>
    </Move>
  );
};

/* ---------------- B-roll ---------------- */
export const BRoll: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, mediaSrc, font }) => {
  const ff = font ?? UI;
  const frame = useCurrentFrame();
  const T = tempo(fps);
  const bingkai = str(params.bingkai, "kartu");
  const acc = str(params.aksen, "#3683D6");
  const V = rendering() ? OffthreadVideo : Html5Video;
  const kb = 1 + 0.08 * curve("drift")(clamp01(frame / Math.max(1, len))); // zoom pelan yang terus bergerak
  const media = mediaSrc
    ? <V src={mediaSrc} muted trimBefore={Math.round(num(params.mulai, 0) * fps)} pauseWhenBuffering style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${kb})` }} />
    : <div style={{ width: "100%", height: "100%", background: `linear-gradient(160deg, ${acc}, #111)`, display: "grid", placeItems: "center", color: "#fff", fontFamily: ff, fontSize: 40, textAlign: "center", padding: 40, boxSizing: "border-box" }}>Pilih video B-roll di panel kanan</div>;
  const label = str(params.label) ? (
    <Move keys={snapIn(T(14), { dir: "up", dist: 18 })} anchor="flow" style={{ position: "absolute", left: "50%", bottom: bingkai === "penuh" ? 360 : 300 }}>
      <div style={{ transform: "translateX(-50%)", background: acc, color: "#fff", fontFamily: ff, fontWeight: 650, fontSize: 38, padding: "14px 30px", borderRadius: 999, whiteSpace: "nowrap" }}>{str(params.label)}</div>
    </Move>
  ) : null;
  if (bingkai === "penuh") {
    const keys: K[] = [{ f: 0, scale: 1.12, blur: 14, opacity: 0 }, { f: T(4), opacity: 1, ease: EASE_PRO.linear }, { f: T(14), scale: 1, blur: 0, ease: EASE_PRO.enterSnap },
      { f: Math.max(T(15), len - T(10)), opacity: 1, blur: 0 }, { f: len, opacity: 0, blur: 12, ease: EASE_PRO.exit }];
    return <div style={{ width, height, position: "relative", overflow: "hidden" }}><Move keys={keys} anchor="flow" style={{ width, height }}>{media}</Move>{label}</div>;
  }
  if (bingkai === "ponsel") {
    return (
      <div style={{ width, height, position: "relative" }}>
        <Move keys={[...enter(0, { dir: "up", dist: 420, dur: T(22), blur: 20, rot: 5 }), ...exit(Math.max(T(23), len - T(10)), { dir: "down", dist: 420, dur: T(10) })]} float={{ amp: 6, period: 110 }}>
          <Phone w={width * 0.56}>{media}</Phone>
        </Move>
        {label}
      </div>
    );
  }
  // kartu melayang / miring 3D: tilt mengendap lalu terus berayun pelan
  const tilt = bingkai === "miring";
  const keys: K[] = [
    ...enter(0, { dir: tilt ? "left" : "up", dist: tilt ? 260 : 160, dur: T(20), blur: 22, scale: 0.92 }),
    { f: 0, ry: tilt ? -34 : 14, rx: tilt ? 10 : 8 }, { f: T(22), ry: tilt ? -16 : 0, rx: tilt ? 6 : 0, ease: springEase(SPRING_PRO.settle, T(22)) },
    { f: Math.max(T(23), len - T(10)), ry: tilt ? -10 : 0 },
    ...exit(Math.max(T(23), len - T(10)), { dir: "up", dist: 140, dur: T(10) }),
  ];
  return (
    <div style={{ width, height, position: "relative" }}>
      <Move keys={keys} float={{ amp: 5, period: 120, rot: 0.4 }} perspective={1800}>
        <div style={{ width: width * 0.8, height: width * 0.8 * 1.25, borderRadius: 40, overflow: "hidden", boxShadow: "0 50px 100px -30px rgba(0,0,0,.55), 0 0 0 6px rgba(255,255,255,.9)" }}>{media}</div>
      </Move>
      {label}
    </div>
  );
};

/* ---------------- Angka naik ---------------- */
export const CountUp: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI;
  const frame = useCurrentFrame();
  const T = tempo(fps);
  const target = num(params.nilai, 1000);
  const acc = str(params.aksen, "#DCF90C"), ink = str(params.warna, "#FFFFFF");
  const p = EASE_PRO.move(clamp01((frame - T(6)) / T(36)));
  const pPrev = EASE_PRO.move(clamp01((frame - 1 - T(6)) / T(36)));
  const dec = Number.isInteger(target) ? 0 : 1;
  const fmt = (v: number) => v.toLocaleString("id-ID", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const value = fmt(lerp(0, target, p));
  // blur vertikal sebanding kecepatan hitung, seperti digit yang berputar cepat
  const speed = Math.abs(p - pPrev) * 60;
  const size = Math.min(220, (width * 0.9) / Math.max(3, (str(params.awalan) + fmt(target) + str(params.akhiran)).length * 0.58));
  const line = EASE_PRO.move(clamp01((frame - T(26)) / T(16)));
  return (
    <Move keys={lifeKeys(len, T, { dir: "up", dist: 50, blur: 16, scale: 0.9, dur: 14 })} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: ff, color: ink, textShadow: "0 8px 30px rgba(0,0,0,.35)" }}>
        <div style={{ display: "flex", alignItems: "baseline", fontSize: size, fontWeight: 800, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
          {str(params.awalan) && <Move keys={snapIn(T(4), { dir: "right", dist: 20 })} anchor="flow"><span style={{ fontSize: size * 0.55, marginRight: size * 0.08, color: acc }}>{str(params.awalan)}</span></Move>}
          <span style={{ filter: speed > 0.4 ? `blur(0px ${Math.min(8, speed * 2)}px)` : undefined }}>{value}</span>
          {str(params.akhiran) && <Move keys={pop(T(40), { dur: T(12) })} anchor="flow"><span style={{ color: acc, marginLeft: size * 0.04 }}>{str(params.akhiran)}</span></Move>}
        </div>
        <div style={{ height: 8, width: size * 2.2 * line, background: acc, borderRadius: 4, margin: `${size * 0.12}px 0` }} />
        {str(params.label) && <BlurIn text={str(params.label)} start={T(30)} font={{ family: ff, size: Math.max(34, size * 0.26), weight: 550 }} ink={ink} every={T(3)} dur={T(12)} />}
      </div>
    </Move>
  );
};

/* ---------------- Notifikasi ---------------- */
export const Notification: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI;
  const T = tempo(fps);
  const acc = str(params.aksen, "#E1306C");
  const app = str(params.aplikasi, "Aplikasi");
  const inF = T(18), outF = Math.min(T(10), Math.floor(len / 3));
  const keys: K[] = [
    { f: 0, y: -height * 1.6, opacity: 0, blur: 10, scale: 0.96 }, { f: T(3), opacity: 1, ease: EASE_PRO.linear }, { f: T(9), blur: 0, ease: EASE_PRO.enterSnap },
    { f: inF, y: 0, scale: 1, ease: springEase(SPRING_PRO.morph, inF) },
    { f: Math.max(inF + 1, len - outF), y: 0, opacity: 1 }, { f: len, y: -height * 1.6, opacity: 0, ease: EASE_PRO.exitHard },
  ];
  return (
    <Move keys={keys} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, boxSizing: "border-box", borderRadius: 48, padding: "30px 36px", display: "flex", gap: 26, alignItems: "center", fontFamily: ff,
        background: "rgba(246,246,248,.94)", boxShadow: "0 30px 70px -20px rgba(0,0,0,.45)", color: "#111" }}>
        <Move keys={pop(T(8), { dur: T(12) })} anchor="flow">
          <div style={{ width: 112, height: 112, borderRadius: 28, background: `linear-gradient(135deg, ${acc}, #7a3cff)`, color: "#fff", display: "grid", placeItems: "center", fontSize: 44, fontWeight: 800 }}>
            {app.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase()}</div>
        </Move>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Move keys={snapIn(T(10), { dir: "up", dist: 10 })} anchor="flow"><div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, color: "#6B6B70" }}><span>{app.toUpperCase()}</span><span>{str(params.waktu)}</span></div></Move>
          <Move keys={snapIn(T(13), { dir: "up", dist: 10 })} anchor="flow"><div style={{ fontSize: 38, fontWeight: 700, marginTop: 4 }}>{str(params.judul)}</div></Move>
          <Move keys={snapIn(T(16), { dir: "up", dist: 10 })} anchor="flow"><div style={{ fontSize: 34, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{str(params.isi)}</div></Move>
        </div>
      </div>
    </Move>
  );
};

/* ---------------- Pembungkus "hidup" untuk elemen khas skill ---------------- */
type Dir = "up" | "down" | "left" | "right" | "none";

/** Bungkus elemen apa pun supaya hidup: masuk follow-through (opasitas → blur → posisi → skala), melayang halus
 *  selama tampil, lalu keluar di kecepatan puncak. Dipakai komposisi "Aset…" skill untuk elemen yang tidak punya padanan bawaan. */
export const Life: FC<{ durationInFrames: number; fps: number; dir?: Dir; dist?: number; blur?: number; scale?: number; float?: boolean; style?: CSSProperties; children: ReactNode }> = ({
  durationInFrames, fps, dir = "up", dist = 80, blur = 20, scale = 0.95, float = true, style, children,
}) => (
  <Move keys={lifeKeys(durationInFrames, tempo(fps), { dir, dist, blur, scale })} anchor="flow" float={float ? { amp: 4, period: 120 } : undefined} style={style}>{children}</Move>
);

/** Anak-anaknya masuk bertahap (snapIn, jarak `every` frame desain) setelah induknya mulai mendarat: gerak tidak berhenti. */
export const Stagger: FC<{ fps: number; start?: number; every?: number; dir?: Dir; dist?: number; style?: CSSProperties; children: ReactNode }> = ({
  fps, start = 8, every = 4, dir = "up", dist = 20, style, children,
}) => {
  const T = tempo(fps);
  return <div style={style}>{Children.toArray(children).map((c, i) => <Move key={i} keys={snapIn(T(start) + i * T(every), { dir, dist })} anchor="flow">{c}</Move>)}</div>;
};

/** Komponen aset bawaan per nama komposisi (dipakai skill lewat "cz-assets"). */
export const BUILTIN_COMPONENTS: Record<string, FC<AssetProps>> = {
  "cz.teks": KineticTitle, "cz.chat": ChatMockup, "cz.kartu": PointCard, "cz.broll": BRoll, "cz.angka": CountUp, "cz.notif": Notification,
};

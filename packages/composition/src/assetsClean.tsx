// Aset bawaan gaya editorial bersih (disarikan dari board Clean Editing): kartu UI putih, badge, ring, diagram, aksen kata, dan latar.
// Sama seperti assets.tsx: komponen kode yang digerakkan mesin cz-motion; isinya param (data proyek), katalognya di @cz/core BUILTIN_ASSETS.
// Bahasa gerak: masuk blur → tajam dengan kurva lembut, isi masuk bertahap, garis/ring tergambar, angka bergulir, keluar di kecepatan puncak.
import type { CSSProperties, FC, ReactNode } from "react";
import { getRemotionEnvironment, Html5Video, OffthreadVideo, useCurrentFrame } from "remotion";
import { BlurIn, EASE_PRO, MacCursor, Move, TypeLine, clamp01, curve, lerp, measure, pop, pressScale, snapIn, tempo, type FontSpec, type K } from "./motion/index.ts";
import { lifeKeys, list, num, str, UI, wrap, type AssetProps } from "./assets.tsx";

// Warna isi kartu lewat variabel CSS supaya satu komponen bisa bertema terang/gelap/kaca/biru (param "tema").
const BLUE = "#3683D6", LINE = "var(--line, #E6EBF2)", INK = "var(--ink, #0F172A)", MUTED = "var(--muted, #64748B)", SOFT = "var(--soft, #EEF2F7)";
const SHADOW = "0 18px 40px rgba(20,40,80,.12)";
const GENTLE = curve("gentle");
const THEMES: Record<string, { bg: string; ink: string; muted: string; soft: string; line: string; glass?: boolean }> = {
  terang: { bg: "#FFFFFF", ink: "#0F172A", muted: "#64748B", soft: SOFT, line: "#E6EBF2" },
  gelap: { bg: "#15171C", ink: SOFT, muted: "#9AA3B2", soft: "#23262D", line: "rgba(255,255,255,.10)" },
  kaca: { bg: "rgba(255,255,255,.14)", ink: "#FFFFFF", muted: "rgba(255,255,255,.72)", soft: "rgba(255,255,255,.12)", line: "rgba(255,255,255,.28)", glass: true },
  biru: { bg: "linear-gradient(160deg,#4C94E6,#2A6FC4)", ink: "#FFFFFF", muted: "rgba(255,255,255,.75)", soft: "rgba(255,255,255,.16)", line: "rgba(255,255,255,.22)" },
};
const card = (params: Record<string, unknown>, extra: CSSProperties = {}): CSSProperties => {
  const t = THEMES[str(params.tema, "terang")] ?? THEMES.terang;
  return {
    ["--ink" as string]: t.ink, ["--muted" as string]: t.muted, ["--soft" as string]: t.soft, ["--line" as string]: t.line,
    background: t.bg, backdropFilter: t.glass ? "blur(28px)" : undefined, border: `1.5px solid ${t.line}`, borderRadius: 28,
    boxShadow: t.glass ? "inset 0 0 0 1px rgba(255,255,255,.18), 0 30px 60px rgba(0,0,0,.25)" : SHADOW, boxSizing: "border-box", color: t.ink, overflow: "hidden", ...extra,
  };
};
/** Elemen kecil di dalam kartu: naik pelan dari blur. */
const inK = (at: number, dir: "up" | "down" | "left" | "right" = "up", dist = 18) => snapIn(at, { dir, dist, blur: 10, dur: 12 });
const prog = (frame: number, at: number, dur: number) => GENTLE(clamp01((frame - at) / Math.max(1, dur)));
const initials = (s: string) => s.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const fmt = (v: number, dec = 0) => v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const short = (v: number) => (v >= 1e6 ? `${fmt(v / 1e6, v % 1e6 ? 1 : 0)}M` : v >= 1e4 ? `${fmt(v / 1e3, v % 1e3 ? 1 : 0)}K` : fmt(v));

/** Video proyek (param media) yang terus zoom pelan; tanpa media: gradien aksen. */
const Media: FC<{ src?: string; from: number; fps: number; len: number; acc: string; label?: string }> = ({ src, from, fps, len, acc, label }) => {
  const frame = useCurrentFrame();
  const V = getRemotionEnvironment().isRendering ? OffthreadVideo : Html5Video;
  const kb = 1 + 0.06 * curve("drift")(clamp01(frame / Math.max(1, len)));
  return src
    ? <V src={src} muted trimBefore={Math.round(from * fps)} pauseWhenBuffering style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${kb})` }} />
    : <div style={{ width: "100%", height: "100%", background: `linear-gradient(150deg, ${acc}, color-mix(in srgb, ${acc} 55%, #000))`, display: "grid", placeItems: "center", color: "#fff", fontSize: 30, fontWeight: 600, textAlign: "center", padding: 24, boxSizing: "border-box", transform: `scale(${kb})` }}>{label}</div>;
};

/** Angka yang bergulir naik dari 0. */
const Count: FC<{ to: number; at: number; dur: number; format?: (v: number) => string }> = ({ to, at, dur, format = (v) => fmt(v) }) => {
  const frame = useCurrentFrame();
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{format(lerp(0, to, EASE_PRO.move(clamp01((frame - at) / Math.max(1, dur)))))}</span>;
};

/* ---------------- Kartu profil (Instagram) ---------------- */
export const ProfileCard: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, BLUE);
  const nama = str(params.nama, "Nama Kamu");
  const stats: [number, string][] = [[num(params.posts, 79), "posts"], [num(params.followers, 40000), "followers"], [num(params.following, 801), "following"]];
  const bio = list(params.bio);
  return (
    <Move keys={lifeKeys(len, T, { dist: 90, blur: 10, dur: 15 })} anchor="flow" style={{ width }}>
      <div style={card(params, { width, padding: 40, fontFamily: ff })}>
        <Move keys={inK(T(6))} anchor="flow"><div style={{ textAlign: "center", fontSize: 30, fontWeight: 700, marginBottom: 26 }}>{str(params.username, "username")}</div></Move>
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <Move keys={pop(T(8), { dur: T(14) })} anchor="flow">
            <div style={{ width: 150, height: 150, borderRadius: "50%", padding: 5, background: `conic-gradient(${acc}, #8EC5FF, ${acc})` }}>
              <div style={{ width: "100%", height: "100%", borderRadius: "50%", border: "5px solid #fff", boxSizing: "border-box", background: `linear-gradient(150deg, ${acc}, color-mix(in srgb, ${acc} 55%, #000))`, color: "#fff", display: "grid", placeItems: "center", fontSize: 52, fontWeight: 700 }}>{initials(nama)}</div>
            </div>
          </Move>
          <div style={{ flex: 1, display: "flex", justifyContent: "space-around" }}>
            {stats.map(([v, l], i) => (
              <Move key={l} keys={inK(T(12) + i * T(3))} anchor="flow">
                <div style={{ textAlign: "center" }}><div style={{ fontSize: 40, fontWeight: 700 }}><Count to={v} at={T(12) + i * T(3)} dur={T(30)} format={short} /></div><div style={{ fontSize: 24, color: MUTED }}>{l}</div></div>
              </Move>
            ))}
          </div>
        </div>
        <Move keys={inK(T(20))} anchor="flow"><div style={{ fontSize: 32, fontWeight: 700, marginTop: 26 }}>{nama}</div></Move>
        {bio.map((b, i) => <TypeLine key={i} text={b} start={T(26) + i * T(18)} cpf={1.1} caret="none" style={{ fontSize: 28, lineHeight: 1.3, color: "#334155" }} />)}
        <Move keys={inK(T(30))} anchor="flow">
          <div style={{ display: "flex", gap: 14, marginTop: 24 }}>
            {["Edit profile", "Share profile"].map((x) => <div key={x} style={{ flex: 1, background: SOFT, borderRadius: 14, padding: "14px 0", textAlign: "center", fontSize: 26, fontWeight: 600 }}>{x}</div>)}
          </div>
        </Move>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 24, marginInline: -40, marginBottom: -40 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Move key={i} keys={pop(T(34) + i * T(2), { from: 0.8, dur: T(12) })} anchor="flow">
              <div style={{ aspectRatio: "4 / 5", background: `linear-gradient(${140 + i * 30}deg, ${acc}${i % 2 ? "CC" : ""}, color-mix(in srgb, ${acc} 55%, #000))` }} />
            </Move>
          ))}
        </div>
      </div>
    </Move>
  );
};

/* ---------------- Kartu harga ---------------- */
export const PriceCard: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, BLUE);
  const frame = useCurrentFrame();
  const harga = num(params.harga, 1200);
  const btnAt = T(40);
  return (
    <Move keys={lifeKeys(len, T, { dist: 90, blur: 10, dur: 15 })} anchor="flow" style={{ width }}>
      <div style={card(params, { width, padding: 44, fontFamily: ff })}>
        <Move keys={inK(T(6))} anchor="flow">
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ width: 72, height: 72, borderRadius: 18, background: INK, color: "#fff", display: "grid", placeItems: "center", fontSize: 30, fontWeight: 800 }}>{initials(str(params.produk, "P"))}</div>
            <div><div style={{ fontSize: 36, fontWeight: 700 }}>{str(params.produk, "Produk")}</div><div style={{ fontSize: 24, color: MUTED }}>{str(params.sub)}</div></div>
          </div>
        </Move>
        <div style={{ textAlign: "center", fontSize: 150, fontWeight: 800, color: acc, letterSpacing: "-0.04em", margin: "30px 0 8px", lineHeight: 1 }}>
          {str(params.awalan, "$")}<Count to={harga} at={T(12)} dur={T(34)} />
        </div>
        <Move keys={inK(T(30))} anchor="flow"><div style={{ textAlign: "center", fontSize: 26, color: MUTED }}>{str(params.catatan)}</div></Move>
        <Move keys={inK(btnAt)} anchor="flow">
          <div style={{ margin: "26px auto 0", width: "70%", background: acc, color: "#fff", borderRadius: 999, padding: "18px 0", textAlign: "center", fontSize: 28, fontWeight: 650,
            transform: `scale(${pressScale(frame, btnAt + T(14), 0.08)})` }}>{str(params.tombol, "Ambil sekarang")}</div>
        </Move>
      </div>
    </Move>
  );
};

/* ---------------- Jendela browser ---------------- */
export const BrowserCard: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, mediaSrc, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, BLUE);
  const bar = 70;
  return (
    <Move keys={lifeKeys(len, T, { dist: 100, blur: 10, dur: 18 })} anchor="flow" style={{ width, height }}>
      <div style={card(params, { width, height, fontFamily: ff, display: "flex", flexDirection: "column" })}>
        <div style={{ height: bar, display: "flex", alignItems: "center", gap: 12, padding: "0 24px", background: SOFT, borderBottom: `1.5px solid ${LINE}` }}>
          {["#FF5F57", "#FEBC2E", "#28C840"].map((c, i) => <Move key={c} keys={pop(T(6) + i * T(2), { dur: T(10) })} anchor="flow"><div style={{ width: 18, height: 18, borderRadius: 9, background: c }} /></Move>)}
          <div style={{ flex: 1, marginLeft: 16, height: 42, borderRadius: 12, background: "#fff", border: `1.5px solid ${LINE}`, display: "flex", alignItems: "center", padding: "0 18px", fontSize: 22, color: MUTED, overflow: "hidden" }}>
            <TypeLine text={str(params.url, "kamu.com")} start={T(10)} cpf={0.9} caretColor={acc} caretUntil={T(34)} style={{ fontSize: 22, color: MUTED, whiteSpace: "nowrap" }} />
          </div>
        </div>
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <Media src={mediaSrc} from={num(params.mulai, 0)} fps={fps} len={len} acc={acc} label={str(params.judul)} />
          {str(params.judul) && mediaSrc && (
            <Move keys={inK(T(24))} anchor="flow" style={{ position: "absolute", left: 28, bottom: 28 }}>
              <div style={{ background: "rgba(255,255,255,.94)", borderRadius: 16, padding: "12px 22px", fontSize: 28, fontWeight: 650 }}>{str(params.judul)}</div>
            </Move>
          )}
        </div>
      </div>
    </Move>
  );
};

/* ---------------- Kartu dokumen ---------------- */
export const DocCard: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, BLUE);
  const lines = list(params.isi);
  const each = Math.max(T(5), Math.min(T(14), (len - T(40)) / Math.max(1, lines.length)));
  return (
    <Move keys={lifeKeys(len, T, { dist: 90, blur: 10, dur: 15 })} anchor="flow" style={{ width }}>
      <div style={card(params, { width, padding: "34px 40px", fontFamily: ff })}>
        <Move keys={inK(T(6))} anchor="flow">
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 28, fontWeight: 700, marginBottom: 18 }}>
            <span style={{ width: 14, height: 14, borderRadius: 7, background: acc }} />{str(params.judul, "Dokumen")}
          </div>
        </Move>
        {lines.map((l, i) => (
          <Move key={i} keys={inK(T(14) + i * each, "up", 10)} anchor="flow"><div style={{ fontSize: 25, lineHeight: 1.4, color: "#334155" }}>{l}</div></Move>
        ))}
      </div>
    </Move>
  );
};

/* ---------------- Carousel kartu (kursor menekan panah) ---------------- */
export const Carousel: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, BLUE);
  const frame = useCurrentFrame();
  const items = list(params.kartu);
  const n = Math.max(1, items.length);
  const step = Math.max(T(20), (len - T(30)) / n);
  const cw = width * 0.62, ch = height - 120, gap = 40;
  const clicks = items.slice(1).map((_, i) => T(18) + (i + 1) * step - T(8));
  let pos = 0;
  for (const c of clicks) pos += EASE_PRO.move(clamp01((frame - c - T(4)) / T(14)));
  const nextX = width / 2 - 70, arrowY = height / 2 - 40;
  return (
    <Move keys={lifeKeys(len, T, { dist: 80, blur: 10, dur: 18 })} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, position: "relative", fontFamily: ff }}>
        <div style={{ position: "absolute", top: 0, left: width / 2 - cw / 2, height: ch, display: "flex", gap, transform: `translateX(${-pos * (cw + gap)}px)` }}>
          {items.map((it, i) => {
            const d = Math.abs(i - pos);
            return (
              <div key={i} style={card(params, { width: cw, height: ch, flexShrink: 0, display: "grid", placeItems: "center", padding: 30, textAlign: "center", fontSize: 40, fontWeight: 700,
                opacity: 1 - Math.min(0.55, d * 0.55), transform: `scale(${1 - Math.min(0.12, d * 0.12)})`, filter: d > 0.05 ? `blur(${Math.min(4, d * 4)}px)` : undefined })}>{it}</div>
            );
          })}
        </div>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: 120 }}>
          {["‹", "›"].map((a, i) => (
            <div key={a} style={{ width: 70, height: 70, borderRadius: 35, background: "#fff", boxShadow: SHADOW, display: "grid", placeItems: "center", fontSize: 44, color: INK,
              transform: `scale(${i ? clicks.reduce((s, c) => Math.min(s, pressScale(frame, c, 0.12)), 1) : 1})` }}>{a}</div>
          ))}
        </div>
        <div style={{ position: "absolute", bottom: 84, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 10 }}>
          {items.map((_, i) => <span key={i} style={{ width: 10, height: 10, borderRadius: 5, background: Math.round(pos) === i ? acc : "#CBD5E1" }} />)}
        </div>
        {clicks.length > 0 && (
          <div style={{ position: "absolute", left: width / 2, top: height / 2 }}>
            <MacCursor appearAt={clicks[0] - T(16)} keys={[{ f: clicks[0] - T(16), x: nextX + 120, y: arrowY + 140 }, ...clicks.map((c) => ({ f: c, x: nextX, y: height / 2 - 35, click: true }))]} />
          </div>
        )}
      </div>
    </Move>
  );
};

/* ---------------- Polaroid ---------------- */
export const Polaroid: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, mediaSrc, font }) => {
  const T = tempo(fps), acc = str(params.aksen, BLUE);
  const rot = num(params.miring, -4);
  const keys: K[] = [...lifeKeys(len, T, { dist: 120, blur: 12, dur: 18 }), { f: 0, rot: rot - 10 }, { f: T(22), rot, ease: GENTLE }];
  return (
    <Move keys={keys} anchor="flow" float={{ amp: 4, period: 120, rot: 0.4 }} style={{ width, height }}>
      <div style={{ width, height, background: "#fff", padding: "28px 28px 0", boxSizing: "border-box", boxShadow: "0 30px 60px rgba(20,40,80,.22)", borderRadius: 10, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, overflow: "hidden", background: "#111" }}><Media src={mediaSrc} from={num(params.mulai, 0)} fps={fps} len={len} acc={acc} /></div>
        <div style={{ height: 130, display: "grid", placeItems: "center" }}>
          <BlurIn text={str(params.keterangan, "momen ini")} start={T(16)} font={{ family: `"Instrument Serif", Georgia, serif`, size: 54, weight: 400 }} ink={INK} every={T(3)} dur={T(12)} style={{ fontStyle: "italic" }} />
        </div>
      </div>
    </Move>
  );
};

/* ---------------- Bubble komentar ---------------- */
export const CommentBubble: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, BLUE);
  const msgs = list(params.pesan).map((r) => { const i = r.indexOf(":"); return i > 0 ? { from: r.slice(0, i).trim(), text: r.slice(i + 1).trim() } : { from: "", text: r }; });
  return (
    <Move keys={lifeKeys(len, T, { dist: 60, blur: 10, dur: 15 })} anchor="flow" style={{ width }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, fontFamily: ff }}>
        {msgs.map((m, i) => (
          <Move key={i} keys={inK(T(4) + i * T(14), "up", 26)} anchor="flow" origin="0% 100%">
            <div style={card(params, { display: "flex", gap: 20, alignItems: "flex-start", padding: "22px 28px", borderRadius: 24 })}>
              <div style={{ width: 56, height: 56, flexShrink: 0, borderRadius: 28, background: `linear-gradient(150deg, ${acc}, color-mix(in srgb, ${acc} 55%, #000))`, color: "#fff", display: "grid", placeItems: "center", fontSize: 22, fontWeight: 700 }}>{initials(m.from || "U")}</div>
              <div style={{ minWidth: 0 }}>
                {m.from && <div style={{ fontSize: 24, fontWeight: 700 }}>{m.from}</div>}
                <div style={{ fontSize: 28, lineHeight: 1.3 }}>{m.text}</div>
                <div style={{ fontSize: 20, color: MUTED, marginTop: 6 }}>Balas · ♡</div>
              </div>
            </div>
          </Move>
        ))}
      </div>
    </Move>
  );
};

/* ---------------- Kolom komentar diketik + kirim (CTA) ---------------- */
export const CommentInput: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, BLUE);
  const frame = useCurrentFrame();
  const text = str(params.teks, "brand");
  const typeAt = T(14), cpf = 0.45, sendAt = Math.min(len - T(16), typeAt + Math.ceil(text.length / cpf) + T(14));
  const dark = str(params.tema, "gelap") === "gelap";
  const sendX = width / 2 - height / 2, sendY = 0;
  return (
    <Move keys={lifeKeys(len, T, { dist: 50, blur: 10, dur: 15 })} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, position: "relative", borderRadius: height / 2, background: dark ? "rgba(20,22,28,.92)" : "#fff", border: `1.5px solid ${dark ? "rgba(255,255,255,.14)" : LINE}`,
        boxShadow: SHADOW, display: "flex", alignItems: "center", gap: 18, padding: `0 ${height * 0.16}px`, boxSizing: "border-box", fontFamily: ff }}>
        <Move keys={pop(T(6), { dur: T(12) })} anchor="flow"><div style={{ width: height * 0.66, height: height * 0.66, borderRadius: "50%", background: `linear-gradient(150deg, ${acc}, color-mix(in srgb, ${acc} 55%, #000))` }} /></Move>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <TypeLine text={text} start={typeAt} cpf={cpf} caretColor={acc} caretUntil={sendAt} placeholder="Tambahkan komentar…" placeholderColor={dark ? "#7C8597" : "#94A3B8"}
            style={{ fontSize: height * 0.36, color: dark ? "#fff" : INK, whiteSpace: "nowrap" }} />
        </div>
        <div style={{ width: height * 0.7, height: height * 0.7, borderRadius: "50%", background: acc, color: "#fff", display: "grid", placeItems: "center", fontSize: height * 0.36, fontWeight: 800,
          transform: `scale(${pressScale(frame, sendAt, 0.14)})` }}>↑</div>
        <div style={{ position: "absolute", left: width / 2, top: height / 2 }}>
          <MacCursor appearAt={sendAt - T(18)} color={dark ? "#fff" : "#000"} keys={[{ f: sendAt - T(18), x: sendX + 90, y: sendY + 110 }, { f: sendAt, x: sendX, y: sendY, click: true }]} />
        </div>
      </div>
    </Move>
  );
};

/* ---------------- Kartu video YouTube ---------------- */
export const YouTubeCard: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, mediaSrc, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, BLUE);
  return (
    <Move keys={lifeKeys(len, T, { dist: 80, blur: 10, dur: 15 })} anchor="flow" style={{ width }}>
      <div style={card(params, { width, fontFamily: ff, borderRadius: 24 })}>
        <div style={{ position: "relative", aspectRatio: "16 / 9", overflow: "hidden" }}>
          <Media src={mediaSrc} from={num(params.mulai, 0)} fps={fps} len={len} acc={acc} label={str(params.judul)} />
          <Move keys={pop(T(12), { dur: T(14) })} anchor="flow" style={{ position: "absolute", left: "50%", top: "50%", marginLeft: -50, marginTop: -35 }}>
            <div style={{ width: 100, height: 70, borderRadius: 20, background: "#FF0033", display: "grid", placeItems: "center" }}><div style={{ width: 0, height: 0, borderLeft: "28px solid #fff", borderTop: "17px solid transparent", borderBottom: "17px solid transparent", marginLeft: 6 }} /></div>
          </Move>
          <div style={{ position: "absolute", right: 14, bottom: 14, background: "rgba(0,0,0,.8)", color: "#fff", fontSize: 22, fontWeight: 600, padding: "4px 10px", borderRadius: 8 }}>{str(params.durasi, "10:15")}</div>
        </div>
        <div style={{ display: "flex", gap: 18, padding: "20px 24px" }}>
          <Move keys={pop(T(16), { dur: T(12) })} anchor="flow"><div style={{ width: 56, height: 56, borderRadius: 28, background: `linear-gradient(150deg, ${acc}, color-mix(in srgb, ${acc} 55%, #000))` }} /></Move>
          <div style={{ minWidth: 0 }}>
            <Move keys={inK(T(18))} anchor="flow"><div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.25 }}>{str(params.judul, "Judul video")}</div></Move>
            <Move keys={inK(T(22))} anchor="flow"><div style={{ fontSize: 22, color: MUTED, marginTop: 4 }}>{str(params.kanal, "Kanal")} · {str(params.info, "2 jam lalu")}</div></Move>
          </div>
        </div>
      </div>
    </Move>
  );
};

/* ---------------- Ikon aplikasi (deret; angka = halaman kalender) ---------------- */
export const AppIcons: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, BLUE);
  const icons = list(params.ikon);
  const n = Math.max(1, icons.length), gap = 30;
  const size = Math.min(height, (width - gap * (n - 1)) / n);
  return (
    <Move keys={lifeKeys(len, T, { dist: 40, blur: 10, scale: 1, dur: 10 })} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, display: "flex", justifyContent: "center", alignItems: "center", gap, fontFamily: ff }}>
        {icons.map((ic, i) => {
          const cal = /^\d{1,2}$/.test(ic);
          return (
            <Move key={i} keys={pop(T(4) + i * T(4), { dur: T(14), from: 0.5 })} anchor="flow">
              <div style={{ width: size, height: size, borderRadius: size * 0.24, background: "#fff", boxShadow: SHADOW, overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: acc }}>
                {cal && <div style={{ alignSelf: "stretch", height: size * 0.26, background: "#E5383B", color: "#fff", fontSize: size * 0.13, fontWeight: 700, display: "grid", placeItems: "center" }}>{str(params.bulan, "HARI")}</div>}
                <div style={{ flex: cal ? 1 : undefined, display: "grid", placeItems: "center", fontSize: size * (cal ? 0.42 : 0.5), fontWeight: 800, color: cal ? INK : acc, lineHeight: 1 }}>{ic}</div>
              </div>
            </Move>
          );
        })}
      </div>
    </Move>
  );
};

/* ---------------- Kartu kaca ---------------- */
export const GlassCard: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, BLUE);
  return (
    <Move keys={lifeKeys(len, T, { dist: 90, blur: 14, dur: 18 })} anchor="flow" float={{ amp: 5, period: 130 }} style={{ width, height }}>
      <div style={{ width, height, borderRadius: 56, background: "linear-gradient(160deg, rgba(255,255,255,.28), rgba(255,255,255,.06))", backdropFilter: "blur(30px)",
        boxShadow: "inset 0 0 0 2px rgba(255,255,255,.35), 0 40px 80px rgba(0,0,0,.25)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, color: "#fff", fontFamily: ff, position: "relative" }}>
        <Move keys={pop(T(10), { dur: T(14) })} anchor="flow" style={{ position: "absolute", right: -26, top: -26 }}>
          <div style={{ width: 96, height: 96, borderRadius: 28, background: `linear-gradient(150deg, ${acc}, color-mix(in srgb, ${acc} 55%, #000))`, boxShadow: "inset 0 0 0 2px rgba(255,255,255,.4)", display: "grid", placeItems: "center", fontSize: 46 }}>{str(params.ikon, "✓")}</div>
        </Move>
        <BlurIn text={str(params.judul, "You are")} start={T(12)} font={{ family: `"Instrument Serif", Georgia, serif`, size: 64, weight: 400 }} ink="#fff" every={T(3)} dur={T(12)} style={{ fontStyle: "italic" }} />
        <BlurIn text={str(params.sub, "Growing")} start={T(18)} font={{ family: ff, size: 96, weight: 800, letterSpacing: -0.03 }} ink="#fff" every={T(3)} dur={T(14)} />
      </div>
    </Move>
  );
};

/* ---------------- Badge diamond bernomor ---------------- */
export const DiamondBadge: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, BLUE);
  const d = Math.min(110, height * 0.7);
  return (
    <Move keys={lifeKeys(len, T, { dist: 30, blur: 10, scale: 1, dur: 12 })} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center", gap: 34, fontFamily: ff, color: "#fff" }}>
        <Move keys={[...pop(T(2), { dur: T(16), from: 0.3 }), { f: T(2), rot: -90 }, { f: T(18), rot: 0, ease: GENTLE }]} anchor="flow">
          <div style={{ width: d, height: d, transform: "rotate(45deg)", borderRadius: d * 0.16, background: `linear-gradient(135deg, ${acc}, #1E4F8C)`, boxShadow: `0 0 0 4px rgba(255,255,255,.18), 0 12px 30px ${acc}66`, display: "grid", placeItems: "center" }}>
            <span style={{ transform: "rotate(-45deg)", fontSize: d * 0.42, fontWeight: 800 }}>{str(params.nomor, "1")}</span>
          </div>
        </Move>
        <div>
          <BlurIn text={str(params.judul, "Poin pertama")} start={T(10)} font={{ family: ff, size: 58, weight: 750, letterSpacing: -0.02 }} ink="#fff" every={T(3)} dur={T(12)} style={{ textShadow: "0 4px 20px rgba(0,0,0,.35)" }} />
          {str(params.sub) && <BlurIn text={str(params.sub)} start={T(16)} font={{ family: ff, size: 34, weight: 450 }} ink="rgba(255,255,255,.75)" every={T(3)} dur={T(12)} />}
        </div>
      </div>
    </Move>
  );
};

/** Ring SVG yang terisi `t` (0..1). */
const Ring: FC<{ size: number; stroke: number; t: number; color: string; track: string; children?: ReactNode }> = ({ size, stroke, t, color, track, children }) => {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <div style={{ width: size, height: size, position: "relative" }}>
      <svg width={size} height={size} style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - clamp01(t))} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>{children}</div>
    </div>
  );
};

/* ---------------- Countdown ring ---------------- */
export const CountdownRing: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, "#E0262B");
  const frame = useCurrentFrame();
  const from = num(params.dari, 60);
  // berjalan sepanjang durasi aset: dari N ke 0
  const t = clamp01(frame / Math.max(1, len - 1));
  const left = Math.ceil(from * (1 - t));
  const size = Math.min(width, height);
  return (
    <Move keys={lifeKeys(len, T, { dist: 20, blur: 10, dur: 12 })} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, display: "grid", placeItems: "center", fontFamily: ff, color: "#fff" }}>
        <div style={{ borderRadius: "50%", boxShadow: `0 0 ${size * 0.25}px ${acc}55` }}>
          <Ring size={size} stroke={size * 0.06} t={1 - t} color={acc} track="rgba(255,255,255,.16)">
            <div style={{ fontSize: size * 0.36, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{left}</div>
            {str(params.label) && <div style={{ fontSize: size * 0.1, opacity: 0.8 }}>{str(params.label)}</div>}
          </Ring>
        </div>
      </div>
    </Move>
  );
};

/* ---------------- Progress ring ---------------- */
export const ProgressRing: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, "#A855F7");
  const frame = useCurrentFrame();
  const pct = Math.max(0, Math.min(100, num(params.persen, 75)));
  const p = EASE_PRO.move(clamp01((frame - T(8)) / T(36)));
  const size = Math.min(width, height);
  return (
    <Move keys={lifeKeys(len, T, { dist: 30, blur: 10, dur: 14 })} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, display: "grid", placeItems: "center", fontFamily: ff, color: "#fff" }}>
        <div style={{ borderRadius: "50%", background: "rgba(10,12,20,.35)", boxShadow: `0 0 ${size * 0.2}px ${acc}66` }}>
          <Ring size={size} stroke={size * 0.07} t={(pct / 100) * p} color={acc} track="rgba(255,255,255,.14)">
            <div style={{ fontSize: size * 0.26, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{Math.round(pct * p)}%</div>
            {str(params.label) && <div style={{ fontSize: size * 0.09, opacity: 0.8 }}>{str(params.label)}</div>}
          </Ring>
        </div>
      </div>
    </Move>
  );
};

/** Pil putih (node diagram). */
const Pill: FC<{ children: ReactNode; acc?: string; size?: number }> = ({ children, acc, size = 34 }) => (
  <div style={{ background: "#fff", borderRadius: 999, padding: `${size * 0.36}px ${size * 0.8}px`, boxShadow: SHADOW, fontSize: size, fontWeight: 650, color: INK, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: size * 0.35 }}>
    {acc && <span style={{ width: size * 0.7, height: size * 0.7, borderRadius: size * 0.2, background: acc }} />}{children}
  </div>
);

/* ---------------- Mind-map ---------------- */
export const MindMap: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, BLUE);
  const frame = useCurrentFrame();
  const kids = list(params.cabang);
  const n = Math.max(1, kids.length);
  const cx = width * 0.22, cy = height / 2, kx = width * 0.62;
  const ys = kids.map((_, i) => (n === 1 ? cy : lerp(height * 0.12, height * 0.88, i / (n - 1))));
  return (
    <Move keys={lifeKeys(len, T, { dist: 40, blur: 10, scale: 1, dur: 12 })} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, position: "relative", fontFamily: ff }}>
        <svg width={width} height={height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          {ys.map((y, i) => {
            const t = prog(frame, T(12) + i * T(5), T(14));
            const d = `M ${cx + 90} ${cy} C ${(cx + kx) / 2} ${cy}, ${(cx + kx) / 2} ${y}, ${kx - 20} ${y}`;
            return <path key={i} d={d} fill="none" stroke="rgba(255,255,255,.9)" strokeWidth={3} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - t} strokeLinecap="round" />;
          })}
        </svg>
        <Move keys={pop(T(4), { dur: T(14) })} anchor="flow" style={{ position: "absolute", left: cx, top: cy, transform: "translate(-50%, -50%)" }}><Pill size={40}>{str(params.pusat, "Ide")}</Pill></Move>
        {kids.map((k, i) => (
          <Move key={i} keys={inK(T(20) + i * T(5), "left", 20)} anchor="flow" style={{ position: "absolute", left: kx, top: ys[i], transform: "translateY(-50%)" }}><Pill acc={acc}>{k}</Pill></Move>
        ))}
      </div>
    </Move>
  );
};

/* ---------------- Alur langkah (vertikal) ---------------- */
export const FlowSteps: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, BLUE);
  const frame = useCurrentFrame();
  const steps = list(params.langkah);
  const n = Math.max(1, steps.length);
  const each = Math.max(T(10), Math.min(T(24), (len - T(30)) / n));
  const rowH = height / n;
  return (
    <Move keys={lifeKeys(len, T, { dist: 40, blur: 10, scale: 1, dur: 12 })} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, position: "relative", fontFamily: ff }}>
        {steps.map((s, i) => {
          const at = T(6) + i * each;
          const y = rowH * i + rowH / 2;
          const line = i < n - 1 ? prog(frame, at + T(8), each - T(4)) : 0;
          return (
            <div key={i}>
              {i < n - 1 && <div style={{ position: "absolute", left: 40, top: y + 32, width: 3, height: (rowH - 64) * line, background: "rgba(255,255,255,.85)", borderRadius: 2 }} />}
              <Move keys={inK(at, "left", 26)} anchor="flow" style={{ position: "absolute", left: 0, top: y, transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 24 }}>
                <div style={{ width: 82, height: 64, display: "grid", placeItems: "center" }}>
                  <div style={{ width: 54, height: 54, borderRadius: 16, background: acc, color: "#fff", display: "grid", placeItems: "center", fontSize: 28, fontWeight: 800, boxShadow: SHADOW }}>{i + 1}</div>
                </div>
                <Pill>{s}</Pill>
              </Move>
            </div>
          );
        })}
      </div>
    </Move>
  );
};

/* ---------------- Radial garis + titik ---------------- */
export const RadialDots: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height }) => {
  const T = tempo(fps), acc = str(params.aksen, "#E0785A"), ink = str(params.warna, "#FFFFFF");
  const frame = useCurrentFrame();
  const n = Math.max(3, Math.min(32, Math.round(num(params.jumlah, 14))));
  const R = Math.min(width, height) / 2 - 20;
  const spin = 6 * curve("drift")(clamp01(frame / Math.max(1, len)));
  const hit = prog(frame, T(30), T(10));
  return (
    <Move keys={lifeKeys(len, T, { dist: 0, dir: "none", blur: 8, scale: 0.9, dur: 12 })} anchor="flow" style={{ width, height }}>
      <svg width={width} height={height} style={{ overflow: "visible" }}>
        <g transform={`translate(${width / 2} ${height / 2}) rotate(${spin})`}>
          {Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2 + ((i * 37) % 7) * 0.04;
            const rr = R * (0.65 + ((i * 53) % 10) / 28);
            const t = prog(frame, T(4) + i * T(1), T(14));
            const x = Math.cos(a) * rr * t, y = Math.sin(a) * rr * t;
            return (
              <g key={i}>
                <line x1={0} y1={0} x2={x} y2={y} stroke={ink} strokeOpacity={0.7} strokeWidth={2} />
                <rect x={x - 8} y={y - 8} width={16} height={16} fill={ink} opacity={t} />
              </g>
            );
          })}
          <rect x={-26} y={-26} width={52} height={52} fill={hit > 0.5 ? acc : ink} transform={`scale(${1 + 0.25 * Math.sin(hit * Math.PI)})`} />
        </g>
      </svg>
    </Move>
  );
};

/* ---------------- Aksen kata ---------------- */
export const WordAccent: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI, T = tempo(fps);
  const frame = useCurrentFrame();
  const kata = str(params.kata, "never");
  const gaya = str(params.gaya, "elips");
  const ink = str(params.warna, "#FFFFFF"), acc = str(params.aksen, gaya === "pil" ? "#DCF90C" : "#E0262B");
  const serif = str(params.huruf, "sans") === "serif";
  const family = serif ? `"Instrument Serif", Georgia, serif` : ff;
  let size = num(params.ukuran, 96);
  const f = (s: number): FontSpec => ({ family, size: s, weight: serif ? 400 : 750, letterSpacing: serif ? 0 : -0.02 });
  for (let i = 0; i < 10 && wrap(kata, f(size), width * 0.86).length > 1; i++) size *= 0.9;
  const w = Math.min(width * 0.9, measure(kata, f(size)));
  const draw = prog(frame, T(10), T(16));
  const textIn = <BlurIn text={kata} start={T(2)} font={f(size)} ink={gaya === "pil" ? "#111" : gaya === "glow" ? acc : ink} every={T(2)} dur={T(10)} style={{ fontStyle: serif ? "italic" : undefined, whiteSpace: "nowrap" }} />;
  let deco: ReactNode = null;
  if (gaya === "elips") {
    const W = w + size * 0.7, H = size * 1.35;
    deco = (
      <svg width={W} height={H} style={{ position: "absolute", left: "50%", top: "50%", marginLeft: -W / 2, marginTop: -H / 2, overflow: "visible" }}>
        <path d={`M ${W * 0.62} ${H * 0.06} C ${W * 1.02} ${H * 0.1}, ${W * 1.02} ${H * 0.92}, ${W * 0.5} ${H * 0.96} C ${-W * 0.04} ${H * 0.98}, ${-W * 0.02} ${H * 0.04}, ${W * 0.56} ${H * 0.02}`}
          fill="none" stroke={acc} strokeWidth={Math.max(3, size * 0.05)} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
      </svg>
    );
  } else if (gaya === "garis") {
    deco = <div style={{ position: "absolute", left: "50%", bottom: height / 2 - size * 0.62, width: w * draw, marginLeft: -w / 2, height: Math.max(4, size * 0.07), background: acc, borderRadius: 99 }} />;
  } else if (gaya === "kurung") {
    const W = w + size * 0.6, H = size * 1.3, L = size * 0.3, s = Math.max(3, size * 0.045);
    const corner = (x: number, y: number, dx: number, dy: number, i: number) => {
      const t = prog(frame, T(8) + i * T(2), T(10));
      return <path key={i} d={`M ${x} ${y + dy * L * t} L ${x} ${y} L ${x + dx * L * t} ${y}`} fill="none" stroke={acc} strokeWidth={s} strokeLinecap="square" />;
    };
    deco = (
      <svg width={W} height={H} style={{ position: "absolute", left: "50%", top: "50%", marginLeft: -W / 2, marginTop: -H / 2, overflow: "visible" }}>
        {[corner(0, 0, 1, 1, 0), corner(W, 0, -1, 1, 1), corner(0, H, 1, -1, 2), corner(W, H, -1, -1, 3)]}
      </svg>
    );
  }
  const pill = gaya === "pil";
  return (
    <Move keys={lifeKeys(len, T, { dist: 20, blur: 10, scale: 1, dur: 10 })} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, display: "grid", placeItems: "center", position: "relative" }}>
        {pill && <div style={{ position: "absolute", left: "50%", top: "50%", width: (w + size * 0.5) * draw, height: size * 1.15, marginLeft: -(w + size * 0.5) / 2, marginTop: -size * 0.575, background: acc, transform: "rotate(-4deg)", transformOrigin: "0% 50%", borderRadius: size * 0.08 }} />}
        <div style={{ position: "relative", transform: pill ? "rotate(-4deg)" : undefined, filter: gaya === "glow" ? `drop-shadow(0 0 ${size * 0.25 * draw}px ${acc})` : undefined, display: "flex", alignItems: "baseline" }}>
          {textIn}
          {gaya === "titik" && <Move keys={pop(T(12), { dur: T(12) })} anchor="flow"><span style={{ display: "inline-block", width: size * 0.2, height: size * 0.2, borderRadius: "50%", background: acc, marginLeft: size * 0.04 }} /></Move>}
        </div>
        {deco}
      </div>
    </Move>
  );
};

/* ---------------- Latar layar penuh (+ kata besar) ---------------- */
export const Backdrop: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI, T = tempo(fps);
  const frame = useCurrentFrame();
  const gaya = str(params.gaya, "grid-putih");
  const teks = str(params.teks);
  const custom = str(params.warna, "#2F6FD8");
  const bg = gaya === "grid-putih" ? "#FFFFFF" : gaya === "biru" ? "linear-gradient(180deg, #4C94E6, #2A6FC4)" : gaya === "hitam" ? "#0B0B0D" : gaya === "elektrik" ? "#1F3BFF" : custom;
  const ink = gaya === "grid-putih" ? INK : "#FFFFFF";
  const drift = (frame / Math.max(1, fps)) * 6; // grid ikut bergeser pelan
  const keys: K[] = [{ f: 0, opacity: 0, blur: 14, scale: 1.04 }, { f: T(6), opacity: 1, ease: EASE_PRO.linear }, { f: T(16), blur: 0, scale: 1, ease: GENTLE },
    { f: Math.max(T(17), len - T(10)), opacity: 1 }, { f: len, opacity: 0, ease: EASE_PRO.exit }];
  const grid = gaya !== "hitam";
  const lineC = gaya === "grid-putih" ? "#E6EBF2" : "rgba(255,255,255,.10)", lineC4 = gaya === "grid-putih" ? "#D9E1EC" : "rgba(255,255,255,.16)";
  return (
    <Move keys={keys} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, background: bg, position: "relative", overflow: "hidden", fontFamily: ff }}>
        {grid && <div style={{ position: "absolute", inset: -216, transform: `translate(${drift % 54}px, ${(drift * 0.6) % 54}px)`,
          backgroundImage: `linear-gradient(${lineC4} 1.5px, transparent 1.5px), linear-gradient(90deg, ${lineC4} 1.5px, transparent 1.5px), linear-gradient(${lineC} 1.5px, transparent 1.5px), linear-gradient(90deg, ${lineC} 1.5px, transparent 1.5px)`,
          backgroundSize: "216px 216px, 216px 216px, 54px 54px, 54px 54px" }} />}
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center, transparent 55%, rgba(30,40,60,.08))" }} />
        {teks && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: "0 80px" }}>
            <div style={{ textAlign: "center" }}>
              {wrap(teks, { family: ff, size: num(params.ukuran, 120), weight: 800, letterSpacing: -0.03 }, width - 160).map((l, i) => (
                <BlurIn key={i} text={l} start={T(12) + i * T(6)} font={{ family: ff, size: num(params.ukuran, 120), weight: 800, letterSpacing: -0.03 }} ink={ink} every={T(3)} dur={T(14)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Move>
  );
};

/* ---------------- Area blur bawah (di balik caption/elemen di bawah wajah) ---------------- */
export const BottomBlur: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height }) => {
  const T = tempo(fps);
  const k = num(params.kekuatan, 60) / 100;
  const keys: K[] = [{ f: 0, opacity: 0 }, { f: T(16), opacity: 1, ease: GENTLE }, { f: Math.max(T(17), len - T(12)), opacity: 1 }, { f: len, opacity: 0, ease: EASE_PRO.exit }];
  const mask = "linear-gradient(to bottom, transparent, #000 45%)";
  return (
    <Move keys={keys} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, backdropFilter: `blur(${Math.round(28 * k)}px)`, WebkitMaskImage: mask, maskImage: mask,
        background: `linear-gradient(to bottom, transparent, rgba(0,0,0,${(0.55 * k).toFixed(2)}))` }} />
    </Move>
  );
};

/* ================= Elemen tambahan (inventaris Clean Editing) ================= */

/** Tanda bintang 4 sudut (bullet ✦). */
const Star4: FC<{ size: number; color: string; rot?: number }> = ({ size, color, rot = 0 }) => (
  <svg width={size} height={size} viewBox="-50 -50 100 100" style={{ transform: `rotate(${rot}deg)` }}>
    <path d="M0 -48 C 6 -10, 10 -6, 48 0 C 10 6, 6 10, 0 48 C -6 10, -10 6, -48 0 C -10 -6, -6 -10, 0 -48 Z" fill={color} />
  </svg>
);

/* ---------------- Kotak "Balas Claude" (diketik lalu dikirim) ---------------- */
export const ReplyBox: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, "#D97757");
  const frame = useCurrentFrame();
  const text = str(params.teks, "Bikinin hook 3 detik buat video ini");
  const typeAt = T(14), cpf = 0.6, sendAt = Math.min(len - T(14), typeAt + Math.ceil(text.length / cpf) + T(10));
  return (
    <Move keys={lifeKeys(len, T, { dist: 60, blur: 10, dur: 15 })} anchor="flow" style={{ width, height }}>
      <div style={card(params, { width, height, borderRadius: 34, position: "relative", fontFamily: ff })}>
        <div style={{ position: "absolute", left: 40, right: 40, top: 36 }}>
          <TypeLine text={text} start={typeAt} cpf={cpf} caretColor={acc} caretUntil={sendAt} placeholder={str(params.placeholder, "Balas ke Claude…")} placeholderColor="#9A9890"
            style={{ fontSize: 34, color: INK }} />
        </div>
        <div style={{ position: "absolute", left: 34, bottom: 30, display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 46, height: 46, borderRadius: 23, border: `1.5px solid ${LINE}`, display: "grid", placeItems: "center", fontSize: 28, color: MUTED }}>+</div>
          <div style={{ height: 46, padding: "0 18px", borderRadius: 23, background: SOFT, display: "flex", alignItems: "center", gap: 10, fontSize: 26, color: INK }}>
            <span style={{ width: 16, height: 16, borderRadius: 8, background: acc }} />{str(params.model, "Claude")}</div>
        </div>
        <div style={{ position: "absolute", right: 30, bottom: 28, width: 56, height: 56, borderRadius: 14, background: acc, color: "#fff", display: "grid", placeItems: "center",
          fontSize: 32, fontWeight: 800, transform: `scale(${pressScale(frame, sendAt, 0.14)})` }}>↑</div>
      </div>
    </Move>
  );
};

/* ---------------- Bullet ✦ ---------------- */
export const BulletList: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, "#DCF90C"), ink = str(params.warna, "#FFFFFF");
  const frame = useCurrentFrame();
  const items = list(params.poin);
  const size = num(params.ukuran, 44);
  const each = Math.max(T(10), Math.min(T(20), (len - T(24)) / Math.max(1, items.length)));
  return (
    <Move keys={lifeKeys(len, T, { dist: 20, blur: 8, scale: 1, dur: 10 })} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, display: "flex", flexDirection: "column", justifyContent: "center", gap: size * 0.7, fontFamily: ff, color: ink, textShadow: "0 3px 16px rgba(0,0,0,.35)" }}>
        {items.map((it, i) => {
          const at = T(4) + i * each;
          const p = prog(frame, at, T(12));
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: size * 0.45 }}>
              <Move keys={pop(at, { dur: T(14), from: 0.2 })} anchor="flow"><Star4 size={size * 0.75} color={acc} rot={(1 - p) * 120} /></Move>
              <BlurIn text={it} start={at + T(3)} font={{ family: ff, size, weight: 600 }} ink={ink} every={T(2)} dur={T(10)} />
            </div>
          );
        })}
      </div>
    </Move>
  );
};

/* ---------------- Kartu aplikasi (nama + rating + tombol) ---------------- */
export const AppCard: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, BLUE);
  const frame = useCurrentFrame();
  const nama = str(params.nama, "Claude");
  return (
    <Move keys={lifeKeys(len, T, { dist: 70, blur: 10, dur: 15 })} anchor="flow" style={{ width, height }}>
      <div style={card(params, { width, height, display: "flex", alignItems: "center", gap: 28, padding: "0 34px 0 40px", fontFamily: ff })}>
        <Move keys={pop(T(6), { dur: T(14) })} anchor="flow">
          <div style={{ width: height * 0.58, height: height * 0.58, borderRadius: height * 0.15, background: `linear-gradient(150deg, ${acc}, color-mix(in srgb, ${acc} 55%, #000))`, color: "#fff",
            display: "grid", placeItems: "center", fontSize: height * 0.3, fontWeight: 800 }}>{str(params.ikon) || nama.slice(0, 1).toUpperCase()}</div>
        </Move>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Move keys={inK(T(10))} anchor="flow"><div style={{ fontSize: 38, fontWeight: 700 }}>{nama}</div></Move>
          <Move keys={inK(T(13))} anchor="flow"><div style={{ fontSize: 25, color: MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{str(params.sub)}</div></Move>
          <Move keys={inK(T(16))} anchor="flow"><div style={{ fontSize: 22, color: "#F5B301", marginTop: 4 }}>★★★★★ <span style={{ color: MUTED }}>{str(params.rating, "4.9")}</span></div></Move>
        </div>
        <Move keys={pop(T(18), { dur: T(12) })} anchor="flow">
          <div style={{ height: 58, padding: "0 30px", borderRadius: 29, background: acc, color: "#fff", fontSize: 26, fontWeight: 650, display: "flex", alignItems: "center",
            transform: `scale(${pressScale(frame, T(34), 0.1)})` }}>{str(params.tombol, "Coba")}</div>
        </Move>
      </div>
    </Move>
  );
};

/* ---------------- Checklist (✕ merah atau ✓ hijau) ---------------- */
export const Checklist: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, BLUE);
  const frame = useCurrentFrame();
  const rows = list(params.baris);
  const good = str(params.tanda, "salah") === "benar";
  const mark = good ? "#16A34A" : "#E0262B";
  const each = Math.max(T(10), Math.min(T(22), (len - T(30)) / Math.max(1, rows.length)));
  return (
    <Move keys={lifeKeys(len, T, { dist: 80, blur: 12, dur: 15 })} anchor="flow" style={{ width }}>
      <div style={card(params, { width, padding: "32px 38px", fontFamily: ff })}>
        <Move keys={inK(T(6))} anchor="flow"><div style={{ fontSize: 30, fontWeight: 650, display: "flex", alignItems: "center", gap: 12 }}><span style={{ color: acc }}>✦</span>{str(params.judul, "Hasil naskah")}</div></Move>
        {rows.map((r, i) => {
          const at = T(14) + i * each;
          const p = prog(frame, at - T(2), T(10)), x = prog(frame, at + T(4), T(8));
          return (
            <div key={i} style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 20, opacity: 0.25 + 0.75 * p }}>
              <div style={{ width: 50, height: 50, flex: "none", borderRadius: 25, border: `3px solid ${x > 0.5 ? mark : "#D5D9E0"}`, boxSizing: "border-box", display: "grid", placeItems: "center",
                color: mark, fontSize: 28, fontWeight: 800, transform: `scale(${1 + 0.25 * Math.sin(Math.PI * x)})` }}>{x > 0.2 ? (good ? "✓" : "✕") : ""}</div>
              <div style={{ fontSize: 32, fontWeight: 500, color: p > 0.5 ? INK : MUTED }}>{r}</div>
            </div>
          );
        })}
      </div>
    </Move>
  );
};

/* ---------------- Ulang prompt → hasil berbeda ---------------- */
export const RetryResults: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, "#D97757");
  const frame = useCurrentFrame();
  const prompt = str(params.prompt, "Buatin naskah video 30 detik");
  const hasil = list(params.hasil);
  const cyc = T(26), rounds = Math.max(1, hasil.length);
  const outAt = T(10) + cyc * rounds;
  const round = Math.min(rounds, 1 + Math.floor(Math.max(0, frame - T(10)) / cyc));
  const tIn = T(10) + (round - 1) * cyc;
  const cw = (width - 20 * Math.max(0, hasil.length - 1)) / Math.max(1, hasil.length);
  return (
    <Move keys={lifeKeys(len, T, { dist: 70, blur: 10, dur: 15 })} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, position: "relative", fontFamily: ff }}>
        <div style={card(params, { position: "absolute", left: 0, right: 0, top: 0, height: 120, borderRadius: 30, display: "flex", alignItems: "center", gap: 18, padding: "0 30px" })}>
          <div style={{ flex: 1, overflow: "hidden" }}><TypeLine key={round} text={prompt} start={tIn} cpf={1.6} caretColor={acc} style={{ fontSize: 30, color: INK, whiteSpace: "nowrap" }} /></div>
          <div style={{ height: 46, padding: "0 16px", borderRadius: 23, background: SOFT, display: "flex", alignItems: "center", fontSize: 24, color: MUTED }}>↻ ×{round}</div>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: acc, color: "#fff", display: "grid", placeItems: "center", fontSize: 30, fontWeight: 800,
            transform: `scale(${pressScale(frame, tIn + T(18), 0.14)})` }}>↑</div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 160, bottom: 0, display: "flex", gap: 20 }}>
          {hasil.map((h, i) => (
            <Move key={i} keys={inK(outAt + i * T(5), "up", 40)} anchor="flow" style={{ width: cw }}>
              <div style={card(params, { width: cw, height: height - 160, padding: 24, fontSize: 26, lineHeight: 1.35 })}>
                <div style={{ fontSize: 20, color: MUTED, marginBottom: 10 }}>Hasil {i + 1}</div>{h}</div>
            </Move>
          ))}
        </div>
      </div>
    </Move>
  );
};

/* ---------------- Jam (cincin waktu + angka naik) ---------------- */
export const ClockRing: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, BLUE), ink = str(params.warna, "#FFFFFF");
  const frame = useCurrentFrame();
  const target = num(params.nilai, 3);
  const p = EASE_PRO.move(clamp01((frame - T(8)) / T(40)));
  const size = Math.min(width, height);
  const R = size * 0.36, SW = size * 0.055, C2 = 2 * Math.PI * R;
  return (
    <Move keys={lifeKeys(len, T, { dist: 30, blur: 12, dur: 14 })} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, display: "grid", placeItems: "center", position: "relative", fontFamily: ff, color: ink }}>
        <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} style={{ position: "absolute" }}>
          <circle r={R} fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.18)" strokeWidth={SW} />
          <circle r={R} fill="none" stroke={acc} strokeWidth={SW} strokeLinecap="round" strokeDasharray={C2} strokeDashoffset={C2 * (1 - p * 0.92)} transform="rotate(-90)" />
          {Array.from({ length: 12 }, (_, i) => <rect key={i} x={-2} y={-R + SW + 8} width={4} height={14} rx={2} fill="rgba(255,255,255,.4)" transform={`rotate(${i * 30})`} />)}
        </svg>
        <div style={{ position: "relative", textAlign: "center" }}>
          <div style={{ fontSize: size * 0.22, fontWeight: 750, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
            {(target * p).toFixed(Number.isInteger(target) && target >= 10 ? 0 : 1).replace(".", ",")}<span style={{ fontSize: size * 0.09, marginLeft: 8 }}>{str(params.satuan, "jam")}</span></div>
          {str(params.label) && <div style={{ fontSize: size * 0.06, opacity: 0.75 }}>{str(params.label)}</div>}
        </div>
      </div>
    </Move>
  );
};

/* ---------------- Video wall (zoom-out) ---------------- */
export const VideoWall: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, mediaSrc, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, BLUE);
  const frame = useCurrentFrame();
  const labels = list(params.kartu);
  const cols = 4, rows = 6, gap = 18;
  const tw = (width - gap * (cols + 1)) / cols, th = tw * 16 / 9;
  const z = lerp(1.9, 1, EASE_PRO.move(clamp01(frame / T(48))));
  const dark = str(params.latar, "hitam") === "hitam";
  return (
    <Move keys={lifeKeys(len, T, { dist: 0, dir: "none", blur: 14, scale: 1, dur: 10 })} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, position: "relative", overflow: "hidden", background: dark ? "#07080B" : "#FFFFFF", fontFamily: ff }}>
        <div style={{ position: "absolute", left: "50%", top: "50%", width: cols * (tw + gap), transform: `translate(-50%, -50%) scale(${z})`, display: "grid",
          gridTemplateColumns: `repeat(${cols}, ${tw}px)`, gap }}>
          {Array.from({ length: cols * rows }, (_, i) => {
            const center = i === Math.floor(rows / 2) * cols + 1;
            const drift = Math.sin((frame / fps) * 0.6 + i) * 6;
            const lab = labels.length ? labels[i % labels.length] : "";
            return (
              <div key={i} style={{ height: th, borderRadius: 18, overflow: "hidden", position: "relative", transform: `translateY(${(i % 2 ? 1 : -1) * drift}px)`,
                background: `linear-gradient(${150 + i * 23}deg, ${acc}${i % 3 ? "AA" : ""}, color-mix(in srgb, ${acc} 55%, #000))`, boxShadow: "0 10px 24px rgba(0,0,0,.35)" }}>
                {center && mediaSrc && <Media src={mediaSrc} from={num(params.mulai, 0)} fps={fps} len={len} acc={acc} />}
                {lab && !center && <div style={{ position: "absolute", left: 10, right: 10, bottom: 12, color: "#fff", fontSize: 20, fontWeight: 650 }}>{lab}</div>}
              </div>
            );
          })}
        </div>
        {str(params.judul) && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "radial-gradient(ellipse at center, rgba(0,0,0,.55), transparent 65%)" }}>
            <BlurIn text={str(params.judul)} start={T(30)} font={{ family: ff, size: 92, weight: 800, letterSpacing: -0.03 }} ink="#fff" every={T(3)} dur={T(14)} />
          </div>
        )}
      </div>
    </Move>
  );
};

/* ---------------- Panel split (turun dari atas) ---------------- */
export const SplitPanel: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI, T = tempo(fps);
  const frame = useCurrentFrame();
  const biru = str(params.gaya, "putih") === "biru";
  const inP = curve("gentle")(clamp01(frame / T(46)));
  const outP = EASE_PRO.exit(clamp01((frame - (len - T(20))) / T(20)));
  const h = height * (inP - outP);
  const ink = biru ? "#FFFFFF" : "#0F172A";
  const drift = (frame / Math.max(1, fps)) * 6;
  const line = biru ? "rgba(255,255,255,.10)" : "#E6EBF2";
  const size = num(params.ukuran, 72);
  return (
    <div style={{ width, height, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: h, overflow: "hidden", background: biru ? "linear-gradient(180deg,#4C94E6,#2A6FC4)" : "#FFFFFF",
        boxShadow: "0 20px 50px rgba(0,0,0,.25)", borderBottomLeftRadius: 36, borderBottomRightRadius: 36 }}>
        <div style={{ position: "absolute", inset: -108, transform: `translate(${drift % 54}px, ${(drift * 0.6) % 54}px)`,
          backgroundImage: `linear-gradient(${line} 1.5px, transparent 1.5px), linear-gradient(90deg, ${line} 1.5px, transparent 1.5px)`, backgroundSize: "54px 54px" }} />
        <div style={{ position: "absolute", left: 0, right: 0, top: height * 0.5, transform: "translateY(-50%)", padding: "0 90px", textAlign: "center", fontFamily: ff }}>
          {str(params.judul) && <BlurIn text={str(params.judul)} start={T(30)} font={{ family: ff, size, weight: 750, letterSpacing: -0.02 }} ink={ink} every={T(3)} dur={T(12)} />}
          {str(params.sub) && <BlurIn text={str(params.sub)} start={T(38)} font={{ family: `"Instrument Serif", Georgia, serif`, size: size * 0.75, weight: 400 }} ink={ink} every={T(3)} dur={T(12)} style={{ fontStyle: "italic" }} />}
        </div>
      </div>
    </div>
  );
};

/* ---------------- Sebelum / sesudah ---------------- */
export const BeforeAfter: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, mediaSrc, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, "#DCF90C");
  const frame = useCurrentFrame();
  const cw = (width - 140) / 2;
  const pa = prog(frame, T(22), T(16));
  const label = (t: string, serif: boolean) => (
    <div style={{ textAlign: "center", marginTop: 18, fontFamily: serif ? `"Instrument Serif", Georgia, serif` : ff, fontStyle: serif ? "italic" : "normal", fontSize: 44, color: "#fff", textShadow: "0 3px 14px rgba(0,0,0,.4)" }}>{t}</div>
  );
  return (
    <Move keys={lifeKeys(len, T, { dist: 50, blur: 10, scale: 1, dur: 14 })} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: ff }}>
        <Move keys={inK(T(4), "up", 40)} anchor="flow" style={{ width: cw }}>
          <div style={{ width: cw, height: height - 90, borderRadius: 26, overflow: "hidden", background: "#1B2A4A", boxShadow: "0 14px 34px rgba(0,0,0,.3)", filter: "grayscale(.8) brightness(.8)" }}>
            <Media src={mediaSrc} from={num(params.mulai, 0)} fps={fps} len={len} acc="#334155" /></div>
          {label(str(params.kiri, "sebelum"), false)}
        </Move>
        <svg width={140} height={60} style={{ overflow: "visible", marginBottom: 60 }}>
          <line x1={20} y1={30} x2={20 + 90 * pa} y2={30} stroke="#fff" strokeWidth={5} strokeLinecap="round" />
          {pa > 0.9 && <path d="M118 30 l-20 -15 v30 z" fill="#fff" />}
        </svg>
        <Move keys={inK(T(24), "up", 40)} anchor="flow" style={{ width: cw }}>
          <div style={{ width: cw, height: height - 90, borderRadius: 26, overflow: "hidden", background: "#fff", boxShadow: `0 0 0 4px ${acc}, 0 14px 34px rgba(0,0,0,.3)` }}>
            <Media src={mediaSrc} from={num(params.mulaiSesudah, num(params.mulai, 0))} fps={fps} len={len} acc={BLUE} /></div>
          {label(str(params.kanan, "sesudah"), true)}
        </Move>
      </div>
    </Move>
  );
};

/* ---------------- Kartu bertumpuk (testimoni/kutipan) ---------------- */
export const StackedCards: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, BLUE);
  const items = list(params.kartu).map((r) => { const i = r.indexOf(":"); return i > 0 ? { from: r.slice(0, i).trim(), text: r.slice(i + 1).trim() } : { from: "", text: r }; });
  const n = Math.max(1, items.length);
  const each = Math.max(T(8), Math.min(T(18), (len - T(24)) / n));
  const cardH = Math.min(260, height / (n * 0.7 + 0.3));
  return (
    <Move keys={lifeKeys(len, T, { dist: 60, blur: 10, dur: 14 })} anchor="flow" style={{ width, height }}>
      <div style={{ width, height, position: "relative", fontFamily: ff }}>
        {items.map((m, i) => {
          const dx = (i % 2 ? 1 : -1) * 40, rot = (i % 2 ? 1 : -1) * 2.5;
          return (
            <Move key={i} keys={[...inK(T(4) + i * each, "up", 60), { f: 0, rot: rot * 3 }, { f: T(4) + i * each + T(14), rot, ease: GENTLE }]} anchor="flow"
              style={{ position: "absolute", left: (width - width * 0.86) / 2 + dx, top: i * cardH * 0.7, width: width * 0.86, zIndex: i }}>
              <div style={card(params, { padding: "24px 30px", minHeight: cardH, borderRadius: 24 })}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 24, background: `linear-gradient(150deg, ${acc}, color-mix(in srgb, ${acc} 55%, #000))`, color: "#fff", display: "grid", placeItems: "center", fontSize: 20, fontWeight: 700 }}>{initials(m.from || "U")}</div>
                  <div style={{ fontSize: 26, fontWeight: 700 }}>{m.from || "Klien"}</div>
                  <div style={{ marginLeft: "auto", color: "#F5B301", fontSize: 22 }}>★★★★★</div>
                </div>
                <div style={{ fontSize: 27, lineHeight: 1.35, color: INK }}>{m.text}</div>
              </div>
            </Move>
          );
        })}
      </div>
    </Move>
  );
};

/* ---------------- Gelembung pikiran ---------------- */
export const ThoughtBubble: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI, T = tempo(fps);
  const kiri = str(params.arah, "kanan") === "kiri";
  const bh = height * 0.68;
  return (
    <Move keys={lifeKeys(len, T, { dist: 30, blur: 10, scale: 0.8, dur: 14 })} anchor="flow" float={{ amp: 5, period: 100 }} style={{ width, height }}>
      <div style={{ width, height, position: "relative", fontFamily: ff }}>
        {[0, 1].map((i) => (
          <Move key={i} keys={pop(T(2) + i * T(3), { dur: T(12) })} anchor="flow"
            style={{ position: "absolute", [kiri ? "right" : "left"]: 20 + i * 44, bottom: 10 + i * 40 } as CSSProperties}>
            <div style={card(params, { width: 26 + i * 16, height: 26 + i * 16, borderRadius: "50%" })} />
          </Move>
        ))}
        <Move keys={pop(T(9), { dur: T(16), from: 0.5 })} anchor="flow" style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
          <div style={card(params, { height: bh, borderRadius: bh / 2, display: "grid", placeItems: "center", padding: "0 40px", textAlign: "center" })}>
            <BlurIn text={str(params.teks, "kok mahal ya?")} start={T(16)} font={{ family: ff, size: num(params.ukuran, 44), weight: 650 }} ink={INK} every={T(3)} dur={T(10)} />
          </div>
        </Move>
      </div>
    </Move>
  );
};

/* ---------------- Dekorasi (X lime, partikel pixel, doodle, sparkle) ---------------- */
const seeded = (i: number, k: number) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
export const Decor: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height }) => {
  const T = tempo(fps), acc = str(params.aksen, "#DCF90C");
  const frame = useCurrentFrame();
  const gaya = str(params.gaya, "x");
  const n = Math.max(1, Math.min(40, Math.round(num(params.jumlah, gaya === "pixel" ? 18 : 3))));
  const items = Array.from({ length: n }, (_, i) => {
    const at = T(2) + i * T(gaya === "pixel" ? 1 : 5);
    const x = n === 1 ? width / 2 : seeded(i, 1) * width, y = n === 1 ? height / 2 : seeded(i, 2) * height;
    const s = gaya === "pixel" ? 8 + seeded(i, 3) * 18 : Math.min(width, height) * (n === 1 ? 0.7 : 0.28 + seeded(i, 3) * 0.15);
    const bob = Math.sin(((frame - at) / fps) * 2 + i) * (gaya === "pixel" ? 10 : 6);
    const blink = gaya === "pixel" ? 0.4 + 0.6 * Math.abs(Math.sin((frame / fps) * 3 + i)) : 1;
    const shape =
      gaya === "x" ? (
        <svg width={s} height={s} viewBox="-50 -50 100 100"><path d="M-40 -28 L-28 -40 L0 -12 L28 -40 L40 -28 L12 0 L40 28 L28 40 L0 12 L-28 40 L-40 28 L-12 0 Z" fill={acc} /></svg>
      ) : gaya === "pixel" ? <div style={{ width: s, height: s, background: acc, boxShadow: `0 0 ${s}px ${acc}` }} />
      : gaya === "sparkle" ? <Star4 size={s} color={acc} rot={(frame - at) * 0.8} />
      : (
        <svg width={s} height={s * 0.75} viewBox="0 0 120 90" style={{ overflow: "visible" }}>
          <path d="M20 60 C 0 60, 0 30, 22 28 C 24 6, 56 2, 64 20 C 76 4, 108 10, 102 34 C 122 40, 116 70, 94 68 C 86 86, 52 84, 46 72 C 36 80, 18 76, 20 60 Z"
            fill="none" stroke={acc} strokeWidth={4} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - prog(frame, at, T(18))} />
        </svg>
      );
    return (
      <div key={i} style={{ position: "absolute", left: x, top: y, opacity: blink, transform: `translate(-50%, calc(-50% + ${bob}px))` }}>
        <Move keys={pop(at, { dur: T(14), from: 0.2 })} anchor="flow">{shape}</Move>
      </div>
    );
  });
  return <Move keys={lifeKeys(len, T, { dist: 0, dir: "none", blur: 6, scale: 1, dur: 8 })} anchor="flow" style={{ width, height }}><div style={{ width, height, position: "relative" }}>{items}</div></Move>;
};

/* ---------------- Kartu artifak (aplikasi buatan AI: tab + hasil) ---------------- */
export const ArtifactCard: FC<AssetProps> = ({ params, durationInFrames: len, fps, width, height, font }) => {
  const ff = font ?? UI, T = tempo(fps), acc = str(params.aksen, BLUE);
  const frame = useCurrentFrame();
  const tabs = list(params.tab);
  const outs = list(params.hasil);
  const genAt = T(40);
  return (
    <Move keys={lifeKeys(len, T, { dist: 80, blur: 12, dur: 16 })} anchor="flow" style={{ width, height }}>
      <div style={card(params, { width, height, padding: "30px 34px", fontFamily: ff, position: "relative" })}>
        <Move keys={inK(T(6))} anchor="flow"><div style={{ fontSize: 18, color: MUTED, display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: acc }} />{str(params.label, "Studio Naskah")}</div></Move>
        <Move keys={inK(T(9))} anchor="flow"><div style={{ fontSize: 40, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 6 }}>{str(params.judul, "Ide, Naskah & Caption")}</div></Move>
        <div style={{ display: "flex", gap: 26, marginTop: 18, borderBottom: `1.5px solid ${LINE}`, fontSize: 20 }}>
          {tabs.map((t, i) => <div key={t} style={{ paddingBottom: 10, borderBottom: i === 0 ? `3px solid ${acc}` : "none", color: i === 0 ? INK : MUTED, fontWeight: i === 0 ? 650 : 500 }}>{t}</div>)}
        </div>
        <div style={{ marginTop: 20, height: 64, borderRadius: 16, border: `1.5px solid ${LINE}`, display: "flex", alignItems: "center", padding: "0 18px", gap: 14 }}>
          <div style={{ flex: 1, overflow: "hidden" }}><TypeLine text={str(params.isian, "bikin tool naskah sendiri")} start={T(14)} cpf={0.8} caretColor={acc} caretUntil={genAt} style={{ fontSize: 24, color: INK, whiteSpace: "nowrap" }} /></div>
          <div style={{ height: 44, padding: "0 18px", borderRadius: 12, background: acc, color: "#fff", display: "flex", alignItems: "center", fontSize: 20, fontWeight: 650,
            transform: `scale(${pressScale(frame, genAt, 0.1)})` }}>Generate</div>
        </div>
        {outs.map((o, i) => (
          <Move key={i} keys={inK(genAt + T(10) + i * T(8))} anchor="flow">
            <div style={{ marginTop: 14, padding: "14px 18px", borderRadius: 14, background: SOFT, fontSize: 23, lineHeight: 1.35 }}>{o}</div>
          </Move>
        ))}
      </div>
    </Move>
  );
};

/** Komponen gaya editorial bersih per id katalog. */
export const CLEAN_COMPONENTS: Record<string, FC<AssetProps>> = {
  "cz.profil": ProfileCard, "cz.harga": PriceCard, "cz.browser": BrowserCard, "cz.dokumen": DocCard, "cz.carousel": Carousel, "cz.polaroid": Polaroid,
  "cz.komentar": CommentBubble, "cz.kolomkomentar": CommentInput, "cz.youtube": YouTubeCard, "cz.ikon": AppIcons, "cz.kaca": GlassCard,
  "cz.diamond": DiamondBadge, "cz.countdown": CountdownRing, "cz.progress": ProgressRing, "cz.mindmap": MindMap, "cz.alur": FlowSteps, "cz.radial": RadialDots,
  "cz.aksen": WordAccent, "cz.latar": Backdrop, "cz.blurbawah": BottomBlur,
  "cz.balasclaude": ReplyBox, "cz.bullet": BulletList, "cz.aplikasi": AppCard, "cz.checklist": Checklist, "cz.ulangprompt": RetryResults, "cz.jam": ClockRing,
  "cz.videowall": VideoWall, "cz.split": SplitPanel, "cz.sebelumsesudah": BeforeAfter, "cz.tumpuk": StackedCards, "cz.pikiran": ThoughtBubble, "cz.dekor": Decor,
  "cz.artifak": ArtifactCard,
};

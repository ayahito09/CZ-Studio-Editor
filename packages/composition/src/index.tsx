// Satu komposisi untuk pratinjau (Player di browser) dan render (F8), supaya yang terlihat = yang dirender.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  AbsoluteFill, continueRender, delayRender, Easing, getRemotionEnvironment, Html5Audio, Html5Video, interpolate, OffthreadVideo,
  Sequence, useCurrentFrame,
} from "remotion";
import {
  clipLen, paramValues, resolveValue, wordFrames,
  type AssetDef, type AssetInstance, type Caption, type CaptionStyle, type Clip, type Element, type Project, type Template, type TextStyle,
} from "@cz/core";

export interface Library { template: Template | null; assets: AssetDef[]; /** URL dasar file skill (font, SFX, gambar). */ base: string }
export interface CompositionProps {
  project: Project;
  /** URL tiap media: proxy saat pratinjau, file asli saat render. */
  src: Record<string, string>;
  lib: Library | null;
  /** Ukuran keluaran; isi sequence diskalakan (cover) bila berbeda. */
  output: { width: number; height: number };
  [key: string]: unknown;
}

/** Font bawaan yang ada di Windows (Player dan Chrome headless), supaya pratinjau = render. */
const FONT = `"Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif`;
const dbToGain = (db: number) => Math.min(1, Math.pow(10, db / 20)); // elemen audio HTML tidak bisa > 1
const DUCK = 0.35; // ≈ −9 dB: musik dan SFX di bawah suara asli

const rendering = () => getRemotionEnvironment().isRendering;

/** Frame sequence yang berisi ucapan (dari transkrip), dengan jeda tahan 6 frame supaya ducking tidak naik-turun. */
function speechMask(p: Project): Uint8Array {
  const mask = new Uint8Array(p.sequence.durationFrames + 1);
  for (const f of wordFrames(p).values()) for (let i = Math.max(0, f.start - 3); i < Math.min(mask.length, f.end + 6); i++) mask[i] = 1;
  return mask;
}

function volumeAt(c: Clip, len: number, duck: Uint8Array | null) {
  const g = dbToGain(c.gainDb);
  if (!c.fadeIn && !c.fadeOut && !duck) return g;
  return (f: number) => {
    let v = g;
    if (c.fadeIn && f < c.fadeIn) v *= f / c.fadeIn;
    if (c.fadeOut && f > len - c.fadeOut) v *= Math.max(0, (len - f) / c.fadeOut);
    if (duck?.[c.start + Math.round(f)]) v *= DUCK;
    return v;
  };
}

export function CzComposition({ project, src, lib, output }: CompositionProps) {
  const fps = project.sequence.fps;
  const { width: W, height: H } = project.sequence;
  const out = output ?? { width: W, height: H };
  const k = Math.max(out.width / W, out.height / H);
  // Urutan tampilan track: S, V3, V2, V1, A1...; dibalik supaya V1 digambar paling bawah.
  const video = [...project.tracks].reverse().filter((t) => t.kind === "video" && !t.hidden);
  const footage = video.filter((t) => project.clips.some((c) => c.trackId === t.id));
  const anySolo = project.tracks.some((t) => t.kind === "audio" && t.solo);
  const audio = project.tracks.filter((t) => t.kind === "audio" && !t.muted && (!anySolo || t.solo));
  const on = (trackId: string) => project.clips.filter((c) => c.trackId === trackId && c.enabled && src[c.mediaId]);
  const speech = useMemo(() => speechMask(project), [project.transcript, project.clips, project.sequence]);
  const captionTrackHidden = project.tracks.some((t) => t.kind === "caption" && t.hidden);
  const hiddenTracks = new Set(project.tracks.filter((t) => t.hidden).map((t) => t.id));
  const defs = useMemo(() => new Map((lib?.assets ?? []).map((d) => [d.id, d])), [lib]);
  const Vid = rendering() ? OffthreadVideo : Html5Video;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      <FontLoader lib={lib} />
      <div style={{ position: "absolute", width: W, height: H, left: (out.width - W * k) / 2, top: (out.height - H * k) / 2, transform: `scale(${k})`, transformOrigin: "0 0", overflow: "hidden", fontFamily: FONT }}>
        <Camera project={project}>
          {footage.flatMap((t) => on(t.id).map((c) => (
            <Sequence key={c.id} from={c.start} durationInFrames={clipLen(c, fps)} premountFor={fps} layout="absolute-fill">
              <Vid src={src[c.mediaId]} muted trimBefore={Math.round(c.srcIn * fps)} pauseWhenBuffering
                style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </Sequence>
          )))}
        </Camera>
        {/* Aset digambar sesuai urutan daftar (Ctrl+[ / ] mengubah urutan). */}
        {project.assets.filter((a) => !a.hidden && !hiddenTracks.has(a.trackId)).map((a) => (
          <Sequence key={a.id} from={a.start} durationInFrames={Math.max(1, a.duration)} layout="none">
            <AssetView a={a} def={a.defId ? defs.get(a.defId) : undefined} lib={lib} />
          </Sequence>
        ))}
        {!captionTrackHidden && project.captions.map((c) => (
          <Sequence key={c.id} from={c.start} durationInFrames={Math.max(1, c.end - c.start)} layout="none">
            <CaptionView c={c} style={{ ...(lib?.template?.caption ?? {}), ...(c.style as CaptionStyle) }} seq={project.sequence} tokens={lib?.template?.tokens ?? {}} />
          </Sequence>
        ))}
      </div>
      {audio.flatMap((t) => on(t.id).map((c) => {
        const len = clipLen(c, fps);
        const duck = t.id === "A1" ? null : speech;
        return (
          <Sequence key={c.id} from={c.start} durationInFrames={len} layout="none">
            <Html5Audio src={src[c.mediaId]} trimBefore={Math.round(c.srcIn * fps)} volume={volumeAt(c, len, duck)} pauseWhenBuffering />
          </Sequence>
        );
      }))}
      <AssetSfx project={project} lib={lib} defs={defs} speech={speech} />
    </AbsoluteFill>
  );
}

/** Zoom kamera halus per scene (preset gaya), hanya pada footage. */
function Camera({ project, children }: { project: Project; children: ReactNode }) {
  const f = useCurrentFrame();
  const sc = project.scenes.find((s) => s.camera && f >= s.start && f < s.end);
  const scale = sc?.camera ? interpolate(f, [sc.start, sc.end], [sc.camera.from, sc.camera.to], { easing: Easing.inOut(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  return <AbsoluteFill style={{ transform: scale !== 1 ? `scale(${scale})` : undefined }}>{children}</AbsoluteFill>;
}

function AssetSfx({ project, lib, defs, speech }: { project: Project; lib: Library | null; defs: Map<string, AssetDef>; speech: Uint8Array }) {
  const map = lib?.template?.sfx;
  const sfxTrack = project.tracks.find((t) => t.id === "A2");
  if (!map || !lib || sfxTrack?.muted) return null;
  const fps = project.sequence.fps;
  const items: ReactNode[] = [];
  for (const a of project.assets) {
    if (a.hidden) continue;
    const outFrames = (a.defId ? defs.get(a.defId)?.out?.frames : undefined) ?? 10;
    for (const [when, role] of [["in", a.sfx.in], ["out", a.sfx.out]] as const) {
      const file = role ? map[role] : undefined;
      if (!file) continue;
      const from = when === "in" ? a.start : Math.max(a.start, a.start + a.duration - outFrames);
      items.push(
        <Sequence key={a.id + when} from={from} durationInFrames={fps * 3} layout="none">
          <Html5Audio src={lib.base + file} volume={(f) => Math.min(1, a.sfx.volume) * (speech[from + Math.round(f)] ? DUCK : 1)} />
        </Sequence>,
      );
    }
  }
  return <>{items}</>;
}

/** Font dari folder skill (token fontFiles: {Keluarga: "fonts/x.ttf"}). Render menunggu font selesai dimuat. */
function FontLoader({ lib }: { lib: Library | null }) {
  const files = (lib?.template?.tokens.fontFiles ?? null) as Record<string, string> | null;
  const key = files ? JSON.stringify(files) : "";
  const [handle] = useState(() => (key ? delayRender("font skill") : null));
  useEffect(() => {
    if (!files || !lib) return;
    Promise.all(Object.entries(files).map(([family, path]) => new FontFace(family, `url("${lib.base}${path}")`).load().then((f) => document.fonts.add(f)).catch(() => {})))
      .finally(() => { if (handle !== null) continueRender(handle); });
  }, [key]);
  return null;
}

// ---------- Animasi ----------
const CURVES: Record<string, (t: number) => number> = {
  gentle: Easing.bezier(0.25, 0.1, 0.25, 1), snappy: Easing.bezier(0.2, 0.9, 0.1, 1), linear: (t) => t,
  bounce: Easing.bezier(0.34, 1.56, 0.64, 1),
};
interface Pose { opacity: number; x: number; y: number; scale: number; blur: number; clip: number }
const REST: Pose = { opacity: 1, x: 0, y: 0, scale: 1, blur: 0, clip: 0 };
export const ANIM_PRESETS = ["fade", "blurRise", "blurFade", "pop", "slideUp", "slideDown", "slideLeft", "slideRight", "scaleIn", "wipe"] as const;

/** Pose saat t=0 (belum masuk / sudah keluar) untuk tiap preset. */
function hidden(preset: string): Partial<Pose> {
  switch (preset) {
    case "fade": return { opacity: 0 };
    case "blurRise": return { opacity: 0, y: 40, blur: 16 };
    case "blurFade": return { opacity: 0, blur: 14 };
    case "pop": return { opacity: 0, scale: 0.6 };
    case "scaleIn": return { opacity: 0, scale: 0.85 };
    case "slideUp": return { opacity: 0, y: 120 };
    case "slideDown": return { opacity: 0, y: -120 };
    case "slideLeft": return { opacity: 0, x: 160 };
    case "slideRight": return { opacity: 0, x: -160 };
    case "wipe": return { clip: 100 };
    default: return {};
  }
}
function pose(frame: number, duration: number, inP: string | null, outP: string | null, inF = 12, outF = 10, curve = "gentle"): Pose {
  const ease = CURVES[curve] ?? CURVES.gentle;
  const mix = (h: Partial<Pose>, t: number): Pose => {
    const e = ease(Math.max(0, Math.min(1, t)));
    const p = { ...REST };
    for (const [key, v] of Object.entries(h) as [keyof Pose, number][]) p[key] = v + (REST[key] - v) * e;
    return p;
  };
  if (inP && frame < inF) return mix(hidden(inP), frame / inF);
  if (outP && frame > duration - outF) return mix(hidden(outP), (duration - frame) / outF);
  return REST;
}

/** Nilai transform pada frame (relatif aset) dari keyframe, interpolasi linear; tanpa keyframe = transform dasar. */
export function transformAt(a: AssetInstance, frame: number) {
  const base = a.transform;
  if (!a.keyframes.length) return base;
  const out = { ...base };
  for (const key of ["x", "y", "scale", "rotation", "opacity"] as const) {
    const ks = a.keyframes.filter((k) => k[key] !== undefined).sort((p, q) => p.frame - q.frame);
    if (!ks.length) continue;
    if (ks.length === 1) { out[key] = ks[0][key]!; continue; }
    out[key] = interpolate(frame, ks.map((k) => k.frame), ks.map((k) => k[key]!), { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  }
  return out;
}

const ANCHOR: Record<string, [string, string]> = {
  "center": ["-50%", "-50%"], "top-left": ["0%", "0%"], "top-center": ["-50%", "0%"], "top-right": ["-100%", "0%"],
  "center-left": ["0%", "-50%"], "center-right": ["-100%", "-50%"],
  "bottom-left": ["0%", "-100%"], "bottom-center": ["-50%", "-100%"], "bottom-right": ["-100%", "-100%"],
};

export function AssetView({ a, def, lib }: { a: AssetInstance; def?: AssetDef; lib: Library | null }) {
  const frame = useCurrentFrame();
  const tokens = lib?.template?.tokens ?? {};
  const params = paramValues(def, a.params);
  const t = transformAt(a, frame);
  const p = pose(frame, a.duration, a.anim.in, a.anim.out, def?.in?.frames, def?.out?.frames, def?.in?.curve);
  const [ax, ay] = ANCHOR[def?.layout.anchor ?? "center"] ?? ANCHOR.center;
  const num = (v: unknown) => { const r = resolveValue(v, params, tokens); return typeof r === "number" ? r : undefined; };
  const ctx: Ctx = { params, tokens, lib, textStyles: lib?.template?.textStyles ?? {} };
  const tree: Element[] = def?.tree ?? [{ type: "text", text: String(params.text ?? params.title ?? "Teks"), size: 72, weight: 700, color: "#fff" }];
  return (
    <div data-asset-id={a.id} style={{
      position: "absolute", left: t.x, top: t.y, width: num(def?.layout.w), height: num(def?.layout.h),
      transform: `translate(${ax}, ${ay}) translate(${p.x}px, ${p.y}px) rotate(${t.rotation}deg) scale(${t.scale * p.scale})`,
      transformOrigin: `${ax.replace("-", "")} ${ay.replace("-", "")}`,
      opacity: t.opacity * p.opacity, filter: p.blur ? `blur(${p.blur}px)` : undefined,
      clipPath: p.clip ? `inset(0 ${p.clip}% 0 0)` : undefined,
    }}>
      {tree.map((el, i) => <El key={i} el={el} ctx={ctx} root />)}
    </div>
  );
}

// ---------- Elemen dasar ----------
interface Ctx { params: Record<string, unknown>; tokens: Record<string, unknown>; lib: Library | null; textStyles: Record<string, TextStyle> }
const SHADOWS: Record<string, string> = { soft: "0 18px 50px rgba(10,20,40,.18)", hard: "0 6px 0 rgba(0,0,0,.25)", glow: "0 0 40px rgba(20,59,255,.45)" };

function textCss(st: TextStyle & Record<string, unknown>): CSSProperties {
  return {
    fontFamily: st.font ? `"${st.font}", ${FONT}` : undefined, fontSize: st.size, fontWeight: st.weight,
    color: st.color, lineHeight: st.lineHeight, textTransform: st.uppercase ? "uppercase" : undefined,
    letterSpacing: st.letterSpacing !== undefined ? `${st.letterSpacing}em` : undefined, fontStyle: st.italic ? "italic" : undefined,
  };
}

function El({ el, ctx, root }: { el: Element; ctx: Ctx; root?: boolean }) {
  const r = (v: unknown) => resolveValue(v, ctx.params, ctx.tokens);
  const n = (v: unknown) => { const x = r(v); return typeof x === "number" ? x : undefined; };
  const s = (v: unknown) => { const x = r(v); return typeof x === "string" ? x : undefined; };
  const named = typeof el.style === "string" ? ctx.textStyles[el.style] ?? {} : (el.style as TextStyle) ?? {};
  const resolvedStyle = Object.fromEntries(Object.entries(named).map(([k, v]) => [k, r(v)])) as TextStyle;
  const own = { font: s(el.font), size: n(el.size), weight: n(el.weight), color: s(el.color), lineHeight: n(el.lineHeight), uppercase: el.uppercase as boolean | undefined };
  const text = { ...resolvedStyle, ...Object.fromEntries(Object.entries(own).filter(([, v]) => v !== undefined)) };
  const shadow = s(el.shadow);
  const hasSize = el.w !== undefined || el.h !== undefined;
  const box: CSSProperties = {
    position: el.x !== undefined || el.y !== undefined ? "absolute" : "relative", left: n(el.x), top: n(el.y),
    width: n(el.w), height: n(el.h), opacity: n(el.opacity), borderRadius: n(el.radius),
    background: s(el.fill), border: el.stroke ? `${n(el.strokeWidth) ?? 2}px solid ${s(el.stroke)}` : undefined,
    boxShadow: shadow ? SHADOWS[shadow] ?? shadow : undefined, padding: n(el.padding), transform: el.rotate ? `rotate(${n(el.rotate)}deg)` : undefined,
    filter: el.blur ? `blur(${n(el.blur)}px)` : undefined, textAlign: s(el.align) as CSSProperties["textAlign"],
  };
  const url = (v: unknown) => { const x = s(v) ?? ""; return /^(https?:|data:|blob:|\/)/.test(x) ? x : (ctx.lib?.base ?? "") + x; };
  const kids = el.children?.map((c, i) => <El key={i} el={c} ctx={ctx} />);
  const bound = el.bind !== undefined ? ctx.params[el.bind] : undefined;

  switch (el.type) {
    // rect tanpa ukuran di akar aset = latar seluruh kotak aset; konten setelahnya ditumpuk di atasnya.
    case "rect": return <div style={{ ...box, ...(root && !hasSize ? { position: "absolute", inset: 0 } : {}) }}>{kids}</div>;
    case "mask": return <div style={{ ...box, overflow: "hidden" }}>{kids}</div>;
    case "stack":
      return (
        <div style={{ ...box, display: "flex", flexDirection: el.direction === "row" ? "row" : "column", gap: n(el.gap),
          alignItems: s(el.alignItems) ?? (el.direction === "row" ? "center" : undefined), justifyContent: s(el.justify) }}>{kids}</div>
      );
    case "text": return <div style={{ ...box, ...textCss(text), whiteSpace: "pre-wrap" }}>{String(bound ?? r(el.text) ?? "")}</div>;
    case "list": {
      const items = Array.isArray(bound) ? bound : Array.isArray(r(el.items)) ? (r(el.items) as unknown[]) : [];
      return (
        <div style={{ ...box, display: "flex", flexDirection: "column", gap: n(el.gap) ?? 12, ...textCss(text) }}>
          {items.map((it, i) => <div key={i}>{el.marker ? `${s(el.marker)} ` : ""}{String(it)}</div>)}
        </div>
      );
    }
    case "image": {
      const srcUrl = url(bound ?? el.src);
      return srcUrl ? <img src={srcUrl} style={{ ...box, objectFit: (s(el.fit) ?? "cover") as CSSProperties["objectFit"], display: "block" }} /> : null;
    }
    case "video": {
      const srcUrl = url(bound ?? el.src);
      const V = rendering() ? OffthreadVideo : Html5Video;
      return srcUrl ? <V src={srcUrl} muted style={{ ...box, objectFit: "cover" }} /> : null;
    }
    case "icon": {
      const size = n(el.size) ?? 64;
      const d = s(bound ?? el.d);
      return d && d.startsWith("M")
        ? <svg viewBox="0 0 24 24" width={size} height={size} style={box} fill="none" stroke={s(el.color) ?? "currentColor"} strokeWidth={n(el.strokeWidth) ?? 2} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
        : <span style={{ ...box, fontSize: size, lineHeight: 1 }}>{d ?? s(el.char) ?? "●"}</span>;
    }
    case "shape": {
      const w = n(el.w) ?? 200, h = n(el.h) ?? 200, fill = s(el.fill) ?? "none", stroke = s(el.stroke) ?? "none", sw = n(el.strokeWidth) ?? 4;
      const kind = s(el.kind) ?? "circle";
      return (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ ...box, background: undefined, border: undefined, overflow: "visible" }}>
          {kind === "circle" && <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - sw} ry={h / 2 - sw} fill={fill} stroke={stroke} strokeWidth={sw} />}
          {kind === "line" && <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />}
          {kind === "arrow" && <path d={`M0 ${h / 2}H${w - sw * 3}M${w - h / 3} ${h / 6}L${w} ${h / 2}L${w - h / 3} ${(5 * h) / 6}`} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />}
          {kind === "rect" && <rect x={sw / 2} y={sw / 2} width={w - sw} height={h - sw} rx={n(el.radius) ?? 0} fill={fill} stroke={stroke} strokeWidth={sw} />}
        </svg>
      );
    }
    case "ui-chat": {
      const msgs = (Array.isArray(bound) ? bound : []) as ({ from?: string; text?: string } | string)[];
      const accent = s(el.accent) ?? (resolveValue("$accent", ctx.params, ctx.tokens) as string) ?? "#143BFF";
      return (
        <div style={{ ...box, display: "flex", flexDirection: "column", gap: 14, ...textCss(text) }}>
          {msgs.map((m, i) => {
            const me = typeof m === "object" && m.from === "me";
            return <div key={i} style={{ alignSelf: me ? "flex-end" : "flex-start", maxWidth: "78%", padding: "18px 26px", borderRadius: 30,
              background: me ? accent : "#F1F3F7", color: me ? "#fff" : "#111" }}>{typeof m === "string" ? m : m.text}</div>;
          })}
        </div>
      );
    }
  }
  return null;
}

// ---------- Caption ----------
export function captionAnchor(c: Caption, seq: { width: number; height: number }) {
  const y = c.position.y ?? (c.position.preset === "atas" ? 360 : c.position.preset === "dada" ? Math.round(seq.height * 0.6) : seq.height - 560);
  return { x: c.position.x ?? seq.width / 2, y };
}

function CaptionView({ c, style, seq, tokens }: { c: Caption; style: CaptionStyle; seq: { width: number; height: number }; tokens: Record<string, unknown> }) {
  const frame = useCurrentFrame();
  const tok = (v: unknown) => resolveValue(v, {}, tokens) as string | undefined;
  const accent = tok(style.accent) ?? "#143BFF";
  const active = tok(style.activeColor) ?? accent;
  const { x, y } = captionAnchor(c, seq);
  const p = pose(frame, c.end - c.start, style.in ?? "blurRise", style.out ?? null, 6, 4);
  const effect = style.activeEffect ?? "warna";
  return (
    <div data-caption-id={c.id} style={{
      position: "absolute", left: x, top: y, width: seq.width - 160, transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px) scale(${p.scale})`,
      opacity: p.opacity, filter: p.blur ? `blur(${p.blur}px)` : undefined, textAlign: "center",
      ...textCss({ ...style, font: tok(style.font), color: tok(style.color) ?? "#fff", size: style.size ?? 68, weight: style.weight ?? 700, lineHeight: style.lineHeight ?? 1.15 }),
      textShadow: style.shadow ?? "0 4px 18px rgba(0,0,0,.35)", WebkitTextStroke: style.stroke,
    }}>
      {c.words.map((w, i) => {
        const rel = frame + c.start;
        const isActive = effect !== "tidak" && rel >= w.start && rel < w.end;
        const ws: CSSProperties = {
          display: "inline-block", marginRight: "0.28em",
          fontWeight: w.style === "tebal" ? 900 : undefined,
          fontFamily: w.style === "serif" ? "Georgia, 'Times New Roman', serif" : undefined, fontStyle: w.style === "serif" ? "italic" : undefined,
          color: w.color ?? (w.style === "aksen" ? accent : isActive && effect === "warna" ? active : undefined),
          transform: isActive && effect === "skala" ? "scale(1.08)" : undefined,
          background: isActive && effect === "latar" ? active : undefined, borderRadius: 10, padding: isActive && effect === "latar" ? "0 .15em" : undefined,
        };
        return <span key={i} data-word-index={i} style={ws}>{w.text}</span>;
      })}
    </div>
  );
}

/** Pratinjau satu aset di panel Aset (thumbnail): latar netral, aset di tengah. */
export function AssetPreview({ def, lib, width, height }: { def: AssetDef; lib: Library | null; width: number; height: number; [k: string]: unknown }) {
  const a: AssetInstance = {
    id: "preview", trackId: "V3", defId: def.id, defVersion: def.version, sceneId: null, start: 0, duration: 90, anchorWordId: null,
    params: {}, transform: { x: width / 2, y: height / 2, scale: 1, rotation: 0, opacity: 1 }, anim: { in: def.in?.preset ?? null, out: null },
    keyframes: [], sfx: { in: null, out: null, volume: 0 }, locked: false, hidden: false, detached: false, edited: false,
  };
  const anchored = { ...def, layout: { ...def.layout, anchor: "center" } };
  return <AbsoluteFill style={{ background: "linear-gradient(160deg,#dfe6f2,#b9c4d6)" }}><AssetView a={a} def={anchored} lib={lib} /></AbsoluteFill>;
}

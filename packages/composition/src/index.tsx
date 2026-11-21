// Satu komposisi untuk pratinjau (Player di browser) dan render (F8), supaya yang terlihat = yang dirender.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  AbsoluteFill, continueRender, delayRender, getRemotionEnvironment, Html5Audio, Html5Video, OffthreadVideo,
  Sequence, useCurrentFrame, useVideoConfig,
} from "remotion";
import { SafeEdgesLayer } from "./SafeEdges.tsx";
import { HeadCutout } from "./HeadCutout.tsx";
import { SkillScenes, skillAssetDefs, skillCovered, useSkillRegistry, type Registry, type SkillComponent, type SkillMediaData } from "./skill.tsx";
import { EASE_PRO, MotionBlur, Move, clamp01, curve, sample, tempo, type K } from "./motion/index.ts";
import { Camera, TransitionLayer, TransitionSfx, assetKeys, staggerStyle, useMotionMask, wipeClip, wordPose } from "./native.tsx";
import { BUILTIN_COMPONENTS, type AssetProps } from "./assets.tsx";
import { CLEAN_COMPONENTS } from "./assetsClean.tsx";
import {
  BUILTIN_ASSETS, clipLen, keyWordIndex, paramValues, resolveValue, wordFrames,
  type AssetDef, type AssetInstance, type Caption, type CaptionStyle, type Clip, type Element, type Project, type Template, type TextStyle,
} from "@cz/core";

export interface Library {
  template: Template | null; assets: AssetDef[]; /** URL dasar file skill (font, SFX, gambar). */ base: string;
  /** Komposisi Remotion milik skill (bila skill membawanya) dan data analisis media dari skrip skill. */
  component?: SkillComponent | null; media?: Record<string, SkillMediaData>;
}
export interface CompositionProps {
  project: Project;
  /** URL tiap media: proxy saat pratinjau, file asli saat render. */
  src: Record<string, string>;
  lib: Library | null;
  /** Ukuran keluaran; isi sequence diskalakan (cover) bila berbeda. */
  output: { width: number; height: number };
  /** Motion blur shutter (jumlah sampel per frame bergerak) saat render; 0/1 = mati. Pratinjau selalu tanpa sampel tambahan. */
  motionBlur?: number;
  /** Video subjek ber-alpha per media (mesin matte CZ), untuk elemen dan teks "di belakang kepala". */
  subjects?: Record<string, string>;
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

export function CzComposition({ project, src, lib, output, motionBlur, subjects }: CompositionProps) {
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
  // Definisi aset: bawaan CZ (kode) + komposisi "Aset…" skill (kode) + aset lama skill (pohon JSON, hanya dibaca).
  const needSkillAssets = !!lib?.component && project.assets.some((a) => a.defId?.startsWith("skill:"));
  const { reg } = useSkillRegistry(lib?.component ?? null, needSkillAssets);
  const defs = useMemo(() => new Map([...BUILTIN_ASSETS, ...skillAssetDefs(reg, project.sequence), ...(lib?.assets ?? [])].map((d) => [d.id, d])), [lib, reg, project.sequence]);
  // Kata per frame sequence, untuk aset kode yang mengikuti ucapan (mis. teks diketik saat diucapkan).
  const spoken = useMemo(() => {
    const fr = wordFrames(project);
    return project.transcript.words.flatMap((w) => { const f = fr.get(w.id); return f ? [{ text: w.text, start: f.start, end: f.end }] : []; }).sort((a, b) => a.start - b.start);
  }, [project.transcript, project.clips, project.sequence]);
  const Vid = rendering() ? OffthreadVideo : Html5Video;
  const covered = useMemo(() => skillCovered(project), [project.scenes, project.clips, project.tracks, project.sequence]);
  const frame = useCurrentFrame();
  const bySkill = !!lib?.component && covered(frame);
  // Motion blur shutter hanya saat render, hanya di frame yang bergerak (masker dari data proyek).
  const samples = rendering() ? Math.max(1, Math.round(motionBlur ?? 0)) : 1;
  const mask = useMotionMask(project, defs, samples > 1);
  // Frasa caption keluar (blur naik) sesudah kata terakhirnya bila ada jeda sebelum frasa berikutnya; tanpa jeda = berganti langsung.
  const T = tempo(fps);
  // Frasa tidak pernah tampil bersamaan dengan frasa berikutnya (data lama bisa tumpang tindih 1 frame).
  const capExit = useMemo(() => {
    const cs = [...project.captions].sort((a, b) => a.start - b.start);
    return new Map(cs.map((c, i) => {
      const next = cs[i + 1]?.start ?? Infinity;
      const room = next - c.end;
      const exit = room >= T(3) ? Math.min(room, T(8)) : 0;
      return [c.id, { exit, len: Math.max(1, Math.min(c.end + exit, next) - c.start) }];
    }));
  }, [project.captions, fps]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      <FontLoader lib={lib} />
      <MotionBlur samples={samples} active={(f) => !!mask?.[Math.round(f)]}>
      <div style={{ position: "absolute", width: W, height: H, left: (out.width - W * k) / 2, top: (out.height - H * k) / 2, transform: `scale(${k})`, transformOrigin: "0 0", overflow: "hidden", fontFamily: FONT }}>
        <TransitionLayer project={project}>
        {/* Tetap terpasang (hanya disembunyikan) supaya video tidak dimuat ulang di batas scene skill. */}
        <AbsoluteFill style={{ opacity: bySkill ? 0 : 1 }}><Camera project={project}>
          {footage.flatMap((t) => on(t.id).map((c) => (
            <Sequence key={c.id} from={c.start} durationInFrames={clipLen(c, fps)} premountFor={fps} layout="absolute-fill">
              <Vid src={src[c.mediaId]} muted trimBefore={Math.round(c.srcIn * fps)} pauseWhenBuffering
                style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </Sequence>
          )))}
        </Camera></AbsoluteFill>
        <SkillScenes project={project} src={src} component={lib?.component ?? null} media={lib?.media ?? {}} />
        <SafeEdgesLayer project={project} />
        {/* Elemen dan teks "di belakang kepala": digambar sebelum potongan subjek, jadi kepala menutupinya. */}
        {project.assets.filter((a) => !a.hidden && !hiddenTracks.has(a.trackId) && a.params.behindHead === true).map((a) => (
          <Sequence key={a.id} from={a.start} durationInFrames={Math.max(1, a.duration)} layout="none">
            <AssetView a={a} def={a.defId ? defs.get(a.defId) : undefined} lib={lib} reg={reg} src={src}
              words={spoken.filter((w) => w.start >= a.start && w.start < a.start + a.duration).map((w) => ({ w: w.text, s: (w.start - a.start) / fps, e: (w.end - a.start) / fps }))} />
          </Sequence>
        ))}
        {!captionTrackHidden && !bySkill && project.captions.filter((c) => (c.style as Record<string, unknown>).behindHead === true).map((c) => (
          <Sequence key={c.id} from={c.start} durationInFrames={capExit.get(c.id)?.len ?? Math.max(1, c.end - c.start)} layout="none">
            <CaptionView c={c} style={{ ...(lib?.template?.caption ?? {}), ...(c.style as CaptionStyle) }} seq={project.sequence} tokens={lib?.template?.tokens ?? {}} exitFrames={capExit.get(c.id)?.exit ?? 0} />
          </Sequence>
        ))}
        <HeadCutout project={project} subjects={subjects ?? {}} lib={lib} />
        {/* Aset digambar sesuai urutan daftar (Ctrl+[ / ] mengubah urutan). */}
        {project.assets.filter((a) => !a.hidden && !hiddenTracks.has(a.trackId) && a.params.behindHead !== true).map((a) => (
          <Sequence key={a.id} from={a.start} durationInFrames={Math.max(1, a.duration)} layout="none">
            <AssetView a={a} def={a.defId ? defs.get(a.defId) : undefined} lib={lib} reg={reg} src={src}
              words={spoken.filter((w) => w.start >= a.start && w.start < a.start + a.duration).map((w) => ({ w: w.text, s: (w.start - a.start) / fps, e: (w.end - a.start) / fps }))} />
          </Sequence>
        ))}
        {!captionTrackHidden && !bySkill && project.captions.filter((c) => (c.style as Record<string, unknown>).behindHead !== true).map((c) => (
          <Sequence key={c.id} from={c.start} durationInFrames={capExit.get(c.id)?.len ?? Math.max(1, c.end - c.start)} layout="none">
            <CaptionView c={c} style={{ ...(lib?.template?.caption ?? {}), ...(c.style as CaptionStyle) }} seq={project.sequence} tokens={lib?.template?.tokens ?? {}} exitFrames={capExit.get(c.id)?.exit ?? 0} />
          </Sequence>
        ))}
        </TransitionLayer>
      </div>
      </MotionBlur>
      <TransitionSfx project={project} base={lib?.base ?? null} />
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

// ---------- Animasi (mesin gerak wajib, ./motion) ----------
export const ANIM_PRESETS = ["fade", "blurRise", "blurFade", "pop", "slideUp", "slideDown", "slideLeft", "slideRight", "scaleIn", "wipe"] as const;

/** Nilai transform pada frame (relatif aset) dari keyframe. Tiap key boleh membawa kurva (ease = kurva segmen yang tiba di key itu);
 *  tanpa kurva = moveSoft, bukan linear. Tanpa keyframe = transform dasar. */
export function transformAt(a: AssetInstance, frame: number) {
  const base = a.transform;
  if (!a.keyframes.length) return base;
  const keys: K[] = a.keyframes.map(({ frame: f, ease, ...v }) => ({ f, ...v, ...(ease ? { ease: curve(ease) } : {}) }));
  const v = sample(keys, frame, EASE_PRO.moveSoft);
  const out = { ...base };
  for (const key of ["x", "y", "scale", "rotation", "opacity"] as const) if (typeof v[key] === "number") out[key] = v[key] as number;
  return out;
}

const ANCHOR: Record<string, [string, string]> = {
  "center": ["-50%", "-50%"], "top-left": ["0%", "0%"], "top-center": ["-50%", "0%"], "top-right": ["-100%", "0%"],
  "center-left": ["0%", "-50%"], "center-right": ["-100%", "-50%"],
  "bottom-left": ["0%", "-100%"], "bottom-center": ["-50%", "-100%"], "bottom-right": ["-100%", "-100%"],
};

/** Aset kode: komponen bawaan CZ atau komposisi "Aset…" skill, digerakkan mesin cz-motion dari dalam komponennya. */
function codeAsset(def: AssetDef | undefined, reg: Registry | null): ((p: AssetProps) => ReactNode) | null {
  if (!def?.component) return null;
  const B = BUILTIN_COMPONENTS[def.component] ?? CLEAN_COMPONENTS[def.component];
  if (B) return (p) => <B {...p} />;
  const e = def.component.startsWith("skill:") ? reg?.[def.component.slice(6)] : undefined;
  // Komposisi skill menerima isi sebagai props biasa (sama seperti defaultProps-nya) + ukuran, durasi, dan kata.
  return e ? (p) => <e.C {...e.defaultProps} {...p.params} durationInFrames={p.durationInFrames} fps={p.fps} width={p.width} height={p.height} words={p.words} mediaSrc={p.mediaSrc} /> : null;
}

export function AssetView({ a, def, lib, reg = null, src = {}, words = [] }: {
  a: AssetInstance; def?: AssetDef; lib: Library | null; reg?: Registry | null; src?: Record<string, string>; words?: AssetProps["words"];
}) {
  const frame = useCurrentFrame();
  const tokens = lib?.template?.tokens ?? {};
  const params = paramValues(def, a.params);
  const { fps } = useVideoConfig();
  const T = tempo(fps);
  const t = transformAt(a, frame);
  // Durasi bawaan mesin (frame desain @30 fps): masuk 16 f, keluar 10 f.
  const inF = def?.in?.frames ?? T(16), outF = def?.out?.frames ?? T(10);
  const keys = useMemo(() => assetKeys(a.anim.in, a.anim.out, a.duration, inF, outF, def?.in?.curve), [a.anim.in, a.anim.out, a.duration, inF, outF, def?.in?.curve]);
  const [ax, ay] = ANCHOR[def?.layout.anchor ?? "center"] ?? ANCHOR.center;
  const origin = `${ax.replace("-", "")} ${ay.replace("-", "")}`;
  const num = (v: unknown) => { const r = resolveValue(v, params, tokens); return typeof r === "number" ? r : undefined; };
  const ctx: Ctx = { params, tokens, lib, textStyles: lib?.template?.textStyles ?? {}, stagger: a.anim.in ? { frame, inF } : null };
  const tree: Element[] = def?.tree ?? [{ type: "text", text: String(params.text ?? params.title ?? "Teks"), size: 72, weight: 700, color: "#fff" }];
  const w = num(def?.layout.w), h = num(def?.layout.h);
  const code = codeAsset(def, reg);
  const mediaKey = def && Object.entries(def.params).find(([, p]) => p.type === "media")?.[0];
  const body = code
    ? code({ params, durationInFrames: a.duration, fps, width: w ?? 1080, height: h ?? 1080, words, mediaSrc: mediaKey ? src[String(params[mediaKey] ?? "")] : undefined })
    : tree.map((el, i) => <El key={i} el={el} ctx={ctx} root order={i > 0 ? i - 1 : undefined} />);
  return (
    <div data-asset-id={a.id} style={{
      position: "absolute", left: t.x, top: t.y, width: w, height: h,
      transform: `translate(${ax}, ${ay}) rotate(${t.rotation}deg) scale(${t.scale})`, transformOrigin: origin,
      opacity: t.opacity, clipPath: wipeClip(a.anim.in, a.anim.out, frame, a.duration, inF, outF),
    }}>
      {/* Move: follow-through masuk/keluar + blur arah gerak dari kecepatan (dimatikan di dalam motion blur render). */}
      <Move keys={keys} anchor="flow" origin={origin} style={{ width: w, height: h }}>{body}</Move>
    </div>
  );
}

// ---------- Elemen dasar ----------
interface Ctx {
  params: Record<string, unknown>; tokens: Record<string, unknown>; lib: Library | null; textStyles: Record<string, TextStyle>;
  /** Anak langsung elemen akar masuk bertahap setelah asetnya mulai mendarat (null = aset tanpa animasi masuk). */
  stagger: { frame: number; inF: number } | null;
}
const SHADOWS: Record<string, string> = { soft: "0 18px 50px rgba(10,20,40,.18)", hard: "0 6px 0 rgba(0,0,0,.25)", glow: "0 0 40px rgba(20,59,255,.45)" };

function textCss(st: TextStyle & Record<string, unknown>): CSSProperties {
  return {
    fontFamily: st.font ? `"${st.font}", ${FONT}` : undefined, fontSize: st.size, fontWeight: st.weight,
    color: st.color, lineHeight: st.lineHeight, textTransform: st.uppercase ? "uppercase" : undefined,
    letterSpacing: st.letterSpacing !== undefined ? `${st.letterSpacing}em` : undefined, fontStyle: st.italic ? "italic" : undefined,
  };
}

function El({ el, ctx, root, order }: { el: Element; ctx: Ctx; root?: boolean; order?: number }) {
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
  if (ctx.stagger && order !== undefined) {
    const st = staggerStyle(ctx.stagger.frame, order, ctx.stagger.inF);
    if (st.opacity !== undefined) box.opacity = Number(box.opacity ?? 1) * Number(st.opacity);
    if (st.transform) box.transform = [st.transform, box.transform].filter(Boolean).join(" ");
    if (st.filter) box.filter = [box.filter, st.filter].filter(Boolean).join(" ");
  }
  const url = (v: unknown) => { const x = s(v) ?? ""; return /^(https?:|data:|blob:|\/)/.test(x) ? x : (ctx.lib?.base ?? "") + x; };
  const kids = el.children?.map((c, i) => <El key={i} el={c} ctx={ctx} order={root ? i : undefined} />);
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

/** Caption per kata (mesin gerak): tiap kata masuk TEPAT di onset ucapannya dengan follow-through (opasitas dulu, blur menyusul,
 *  posisi terakhir); kata serif tiba dalam warna aksen lalu mengendap ke warna teks; efek kata aktif dihaluskan; frasa keluar
 *  dengan blur naik bila ada jeda sebelum frasa berikutnya. Kata yang belum diucapkan tidak tampil, tetapi tetap memegang
 *  tempatnya supaya baris tidak bergeser. */
function CaptionView({ c, style, seq, tokens, exitFrames = 0 }: { c: Caption; style: CaptionStyle; seq: { width: number; height: number }; tokens: Record<string, unknown>; exitFrames?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const T = tempo(fps);
  const tok = (v: unknown) => resolveValue(v, {}, tokens) as string | undefined;
  const accent = tok(style.accent) ?? "#143BFF";
  const active = tok(style.activeColor) ?? accent;
  const ink = tok(style.color) ?? "#fff";
  const { x, y } = captionAnchor(c, seq);
  // bawaan: pil yang mekar di belakang kata aktif ("latar" lama = pil)
  const effect = style.activeEffect === "latar" ? "pil" : style.activeEffect ?? "pil";
  const preset = style.in ?? "springRise";
  const len = c.end - c.start;
  const ex = exitFrames > 0 && frame >= len ? curve("gentleOut")(clamp01((frame - len + 1) / exitFrames)) : 0;
  const settle = curve("drift");
  const layout = style.layout ?? "kata";
  const keyAccent = style.keyAccent ?? null;
  const ki = keyWordIndex(c.words);
  const rel = frame + c.start;
  return (
    <div data-caption-id={c.id} style={{
      position: "absolute", left: x, top: y, width: seq.width - 160, transform: `translate(-50%, -50%) translateY(${-8 * ex}px)`,
      opacity: 1 - ex, filter: ex > 0.02 ? `blur(${10 * ex}px)` : undefined, textAlign: "center",
      ...textCss({ ...style, font: tok(style.font), color: ink, size: style.size ?? 68, weight: style.weight ?? 700, lineHeight: style.lineHeight ?? 1.15 }),
      textShadow: style.shadow ?? "0 2px 2px rgba(0,0,0,.28), 0 8px 28px rgba(0,0,0,.38)", WebkitTextStroke: style.stroke,
    }}>
      {body()}
    </div>
  );

  function body(): ReactNode {
    if (layout === "kata" || ki < 0) return c.words.map((_, i) => word(i));
    if (layout === "satu-kata") {
      const cur = c.words.reduce((b, w, i) => (w.start <= rel ? i : b), -1);
      return cur < 0 ? null : word(cur, { size: 1.4 });
    }
    const others = c.words.map((_, i) => i).filter((i) => i !== ki);
    if (layout === "dua-tingkat") return <>
      <div style={{ fontSize: "0.6em", fontWeight: 500 }}>{others.map((i) => word(i, { plain: true }))}</div>
      {ki >= 0 && <div style={{ fontSize: "1.25em", fontWeight: 800, lineHeight: 1.05 }}>{word(ki)}</div>}
    </>;
    if (layout === "poster") return <>
      <div style={{ fontSize: "0.65em", fontWeight: 500 }}>{others.map((i) => word(i, { plain: true }))}</div>
      {ki >= 0 && <div style={{ fontSize: "2.4em", fontWeight: 900, lineHeight: 1, letterSpacing: "-0.03em", textTransform: "lowercase" }}>
        {word(ki, { plain: true, color: accent, dot: true })}</div>}
    </>;
    // subtitle-italic: kalimat kecil italic selalu tampil, kata kunci serif glow besar di atasnya saat diucapkan
    return <>
      {ki >= 0 && <div style={{ fontSize: "1.9em", lineHeight: 1.05 }}>{word(ki, { accent: "glow", hideBefore: true })}</div>}
      <div style={{ fontSize: "0.5em", fontWeight: 500, fontStyle: "italic", textTransform: "lowercase", marginTop: "0.6em" }}>
        {c.words.map((w) => w.text).join(" ")}</div>
    </>;
  }

  /** Satu kata dengan pose masuk mesin, efek kata aktif, dan (bila kata kunci) aksennya. */
  function word(i: number, o: { size?: number; plain?: boolean; color?: string; dot?: boolean; accent?: string; hideBefore?: boolean } = {}): ReactNode {
    const w = c.words[i];
    const age = rel - w.start;
    const wp = wordPose(preset, age, T(7));
    const on = effect !== "tidak" && rel >= w.start && rel < w.end;
    // efek kata aktif naik/turun dengan kurva (tidak meloncat)
    const act = effect === "tidak" ? 0 : EASE_PRO.enterSnap(clamp01(age / T(4))) * (1 - EASE_PRO.exit(clamp01((rel - w.end) / T(4))));
    const pick = o.plain ? null : o.accent ?? (i === ki && keyAccent ? keyAccent : null);
    const acc = pick === "tanpa" ? null : pick;
    // aksen blok dipilih: menggantikan gaya per kata (tebal/serif/aksen) di semua kata blok ini
    const st = keyAccent ? "normal" : w.style;
    // sorotan kata aktif hanya untuk kata biasa (kata beraksen sudah punya tandanya sendiri)
    const hl = !o.plain && !acc ? act : 0;
    const serif = acc === "serif" || acc === "elips" || acc === "glow" || (!acc && st === "serif");
    let color = o.color ?? w.color ?? (!acc && st === "aksen" ? accent : on && effect === "warna" ? active : undefined);
    if (!o.color && !w.color && serif && acc !== "glow") { const s2 = settle(clamp01(age / T(12))); color = s2 < 1 ? mixHex(accent, ink, s2) : undefined; }
    if (acc === "glow") color = LIME;
    if (acc === "pil") color = "#111318";
    if (!o.color && !w.color && hl > 0.5 && effect === "pil") color = onColor(active);
    if (!o.color && !w.color && hl > 0.01 && effect === "glow") color = mixHex(ink, active, hl);
    let text: ReactNode = w.text;
    if (acc === "scramble" && age < T(10)) {
      const lock = Math.floor(clamp01(age / T(10)) * w.text.length);
      text = w.text.split("").map((ch, j) => (j < lock || !/\p{L}/u.test(ch) ? ch : "abcdefghijklmnopqrstuvwxyz"[Math.floor(rnd(Math.floor(age / 2), j) * 26)])).join("");
    }
    const ws: CSSProperties = {
      display: "inline-block", position: "relative", marginRight: "0.28em", fontSize: o.size ? `${o.size}em` : undefined,
      fontWeight: acc === "tebal" || acc === "titik" || (!acc && st === "tebal") ? 900 : serif ? 400 : undefined,
      fontFamily: serif ? "Georgia, 'Times New Roman', serif" : acc === "scramble" ? "ui-monospace, Consolas, monospace" : undefined, fontStyle: serif ? "italic" : undefined,
      color, opacity: o.hideBefore && age < 0 ? 0 : wp.opacity, filter: wp.filter,
      textShadow: acc === "glow" ? `0 0 0.25em ${LIME}AA` : acc === "pil" || (effect === "pil" && hl > 0.5) ? "none" : effect === "glow" && hl > 0.01 ? `0 0 ${0.45 * hl}em ${active}` : undefined,
      isolation: "isolate",
      transform: [wp.transform, acc === "pil" ? "rotate(-8deg)" : "", effect === "skala" && hl > 0.001 ? `scale(${1 + 0.1 * hl})` : "", effect === "pil" && hl > 0.001 ? `translateY(${-0.03 * hl}em) scale(${1 + 0.05 * hl})` : ""].filter(Boolean).join(" ") || undefined,
      background: acc === "pil" ? LIME : undefined, borderRadius: acc === "pil" ? "0.18em" : 10,
      padding: acc === "pil" ? "0.04em 0.3em" : undefined,
    };
    const ellipse = acc === "elips" ? (() => {
      const p = curve("gentle")(clamp01((age - T(3)) / T(14)));
      return p > 0 ? (
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ position: "absolute", left: "-14%", top: "-22%", width: "128%", height: "144%", overflow: "visible" }}>
          <path d="M8 34 C 4 10, 70 2, 92 22 C 104 38, 60 60, 22 52 C 8 49, 4 40, 14 30" fill="none" stroke="#E0262B" strokeWidth={3.2} strokeLinecap="round"
            pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} vectorEffect="non-scaling-stroke" />
        </svg>
      ) : null;
    })() : null;
    const dot = o.dot || acc === "titik";
    // pil: latar membulat mekar dari tengah di belakang kata; garis: garis bawah meluncur dari kiri
    const mark = hl > 0.01 && effect === "pil" ? (
      <span aria-hidden style={{ position: "absolute", inset: "-0.04em -0.2em", borderRadius: "0.32em", background: active, zIndex: -1, opacity: Math.min(1, hl * 1.4),
        transform: `scale(${0.7 + 0.3 * hl}, ${0.85 + 0.15 * hl})`, boxShadow: `0 0.12em 0.4em ${active}55` }} />
    ) : hl > 0.01 && effect === "garis" ? (
      <span aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: "-0.06em", height: "0.11em", borderRadius: 99, background: active,
        transform: `scaleX(${hl})`, transformOrigin: "0% 50%" }} />
    ) : null;
    return <span key={i} data-word-index={i} style={ws}>{mark}{dot ? w.text.replace(/[.,!?]$/, "") : text}{dot && <span style={{ color: LIME }}>.</span>}{ellipse}</span>;
  }
}

const LIME = "#DCF90C";
/** Warna teks yang terbaca di atas warna latar `bg` (gelap untuk latar terang, putih untuk latar gelap). */
const onColor = (bg: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(bg);
  if (!m) return "#FFFFFF";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? "#0B0B0D" : "#FFFFFF";
};
/** Acak deterministik per (frame, indeks huruf): render dan pratinjau sama. */
const rnd = (a: number, b: number) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

const mixHex = (a: string, b: string, t: number) => {
  const h = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null);
  const A = h(a), B = h(b);
  if (!A || !B) return t < 0.5 ? a : b;
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`;
};

/** Contoh gaya subtitle + aksen kata kunci di kotak pilihan Inspector: caption sungguhan (CaptionView), kata masuk satu per satu. */
export function CaptionPreview({ layout, keyAccent, activeEffect, inPreset, width, height }: {
  layout?: CaptionStyle["layout"]; keyAccent?: CaptionStyle["keyAccent"]; activeEffect?: CaptionStyle["activeEffect"]; inPreset?: string; width: number; height: number;
}) {
  const c: Caption = {
    id: "cap-preview", trackId: "C1", start: 0, end: 60, style: {}, position: { preset: "dada", y: height / 2 },
    words: ["editan", "ini", "terasa", "premium"].map((text, i) => ({ wordId: null, text, start: 4 + i * 7, end: 11 + i * 7, style: "normal" as const })),
  };
  return (
    <AbsoluteFill style={{ background: "linear-gradient(160deg,#2a3140,#11151c)" }}>
      <CaptionView c={c} style={{ size: 40, weight: 700, layout, keyAccent, activeEffect, in: inPreset }} seq={{ width, height }} tokens={{}} />
    </AbsoluteFill>
  );
}

/** Contoh satu preset gerak (masuk atau keluar) di kotak pilihan Inspector, digerakkan mesin yang sama dengan pratinjau/render. */
export function AnimPreview({ preset, dir, width, height }: { preset: string; dir: "in" | "out"; width: number; height: number }) {
  const a: AssetInstance = {
    id: "anim-preview", trackId: "V3", defId: null, defVersion: 0, sceneId: null, start: 0, duration: 45, anchorWordId: null,
    params: { text: "Aa" }, transform: { x: width / 2, y: height / 2, scale: 1, rotation: 0, opacity: 1 },
    anim: dir === "in" ? { in: preset, out: null } : { in: null, out: preset },
    keyframes: [], sfx: { in: null, out: null, volume: 0 }, locked: false, hidden: false, detached: false, edited: false,
  };
  return (
    <AbsoluteFill style={{ background: "#131313" }}>
      <Sequence durationInFrames={a.duration} layout="none"><AssetView a={a} lib={null} /></Sequence>
    </AbsoluteFill>
  );
}

/** Pratinjau satu aset di panel Aset (thumbnail): latar netral, aset di tengah. */
export function AssetPreview({ def, lib, width, height, reg = null }: { def: AssetDef; lib: Library | null; width: number; height: number; reg?: Registry | null; [k: string]: unknown }) {
  const { fps } = useVideoConfig();
  // Aset kode digambar utuh: diperkecil supaya kotaknya muat di thumbnail.
  const bw = typeof def.layout.w === "number" ? def.layout.w : width, bh = typeof def.layout.h === "number" ? def.layout.h : height;
  const fit = def.component ? Math.min(1, (width * 0.92) / bw, (height * 0.92) / bh) : 1;
  const a: AssetInstance = {
    id: "preview", trackId: "V3", defId: def.id, defVersion: def.version, sceneId: null, start: 0, duration: Math.round((def.duration ?? 3) * fps), anchorWordId: null,
    params: {}, transform: { x: width / 2, y: height / 2, scale: fit, rotation: 0, opacity: 1 }, anim: { in: def.in?.preset ?? null, out: null },
    keyframes: [], sfx: { in: null, out: null, volume: 0 }, locked: false, hidden: false, detached: false, edited: false,
  };
  const anchored = { ...def, layout: { ...def.layout, anchor: "center" } };
  return (
    <AbsoluteFill style={{ background: "linear-gradient(160deg,#2a3140,#11151c)" }}>
      <Sequence durationInFrames={a.duration} layout="none"><AssetView a={a} def={anchored} lib={lib} reg={reg} /></Sequence>
    </AbsoluteFill>
  );
}

export { loadSkillRegistry, skillAssetDefs, type Registry } from "./skill.tsx";

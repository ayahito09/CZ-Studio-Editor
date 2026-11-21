// Komposisi Remotion milik skill (dikompilasi server ke satu modul ESM). Dimuat dengan import() di Player dan di
// Chrome headless saat render, memakai react/remotion milik CZ, jadi pratinjau = render.
import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import * as Remotion from "remotion";
import { continueRender, delayRender, Sequence } from "remotion";
import { SKILL_ASSET, skillAssetDef, skillSegments, type AssetDef, type Project } from "@cz/core";
import * as Motion from "./motion/index.ts";
import { ensurePacks } from "./packs.tsx";

export interface SkillComponent { url: string; publicBase: string; sfxLib: Record<string, string[]> | null }
export interface SkillMediaData { faces?: unknown[]; subject?: string }
/** Komposisi skill: komponen + defaultProps (isi bawaan, juga dasar param aset "Aset…") + durasi bawaannya. */
export interface RegEntry { C: React.ComponentType<Record<string, unknown>>; defaultProps: Record<string, unknown>; durationInFrames: number; fps: number }
export type Registry = Record<string, RegEntry>;

const g = globalThis as unknown as { __czShared?: Record<string, unknown>; __czStaticBase?: string; __czRoot?: React.ComponentType };
const Marker = () => null;

// staticFile skill menunjuk folder public skill di server lokal; URL penuh (footage dari CZ) dilewatkan apa adanya.
const staticFile = (p: string) => /^(https?:|data:|blob:)/.test(p) ? p : (g.__czStaticBase ?? "/") + p.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
g.__czShared ??= {
  react: React, "react/jsx-runtime": JsxRuntime, "react/jsx-dev-runtime": JsxRuntime, "react-dom": ReactDOM,
  // getInputProps dilarang di Player dan di render berisi props CZ; komposisi skill membaca props-nya lewat React.
  remotion: { ...Remotion, staticFile, getInputProps: () => ({}), registerRoot: (C: React.ComponentType) => { g.__czRoot = C; }, Composition: Marker, Still: Marker },
  // Mesin gerak wajib CZ: satu salinan, jadi motion blur render CZ dan kamera/elemen skill saling mengenali.
  "cz-motion": Motion,
  // "cz-assets" (fondasi aset skill) didaftarkan oleh paket elemen lokal saat dimuat (lihat packs.tsx); tanpa paket, modul ini tidak ada.
};

/** Kumpulkan <Composition id component> dari root skill tanpa merendernya. */
function collect(node: unknown, out: Registry, depth = 0) {
  if (depth > 20 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const n of node) collect(n, out, depth + 1); return; }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (!el.props) return;
  if (el.type === Marker && typeof el.props.id === "string" && el.props.component) {
    const p = el.props;
    out[p.id as string] = {
      C: p.component as RegEntry["C"], defaultProps: (p.defaultProps && typeof p.defaultProps === "object" ? p.defaultProps : {}) as Record<string, unknown>,
      durationInFrames: Number(p.durationInFrames) || 90, fps: Number(p.fps) || 30,
    };
  }
  else if (typeof el.type === "function" && depth < 20) collect((el.type as (p: unknown) => unknown)(el.props), out, depth + 1);
  collect(el.props.children, out, depth + 1);
}

const loads = new Map<string, Promise<Registry>>();
// new Function: bundler (Vite/webpack) tidak boleh mencoba membundel URL modul skill.
const importUrl = new Function("u", "return import(u)") as (u: string) => Promise<unknown>;
/** Muat registry komposisi skill (di-cache per URL). Dipakai juga panel Elemen di editor, di luar Player. */
export function loadSkillRegistry(c: SkillComponent): Promise<Registry> { return load(c); }
function load(c: SkillComponent): Promise<Registry> {
  let p = loads.get(c.url);
  if (!p) {
    g.__czStaticBase = c.publicBase;
    p = ensurePacks().then(() => importUrl(c.url)).then(() => {
      const out: Registry = {};
      if (g.__czRoot) collect(React.createElement(g.__czRoot), out);
      return out;
    });
    p.catch(() => loads.delete(c.url));
    loads.set(c.url, p);
  }
  return p;
}

export function useSkillRegistry(c: SkillComponent | null, needed: boolean) {
  const [reg, setReg] = React.useState<Registry | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [handle] = React.useState(() => (c && needed ? delayRender("komponen skill", { timeoutInMilliseconds: 120_000 }) : null));
  React.useEffect(() => {
    if (!c || !needed) return;
    let live = true;
    load(c).then((r) => { if (live) setReg(r); }, (e) => { if (live) setError(String(e?.message ?? e)); })
      .finally(() => { if (handle !== null) continueRender(handle); });
    return () => { live = false; };
  }, [c?.url, needed]);
  return { reg, error };
}

/** Aset kode milik skill: setiap komposisi ber-id "Aset…" (isi bawaan = defaultProps-nya). */
export const skillAssetDefs = (reg: Registry | null, seq: { width: number; height: number }): AssetDef[] =>
  reg ? Object.entries(reg).filter(([id]) => SKILL_ASSET.test(id)).map(([id, e]) => skillAssetDef(id, e.defaultProps, e.durationInFrames, e.fps, seq)) : [];

/** Rentang frame yang digambar skill (footage dan caption CZ disembunyikan di sini). */
export function skillCovered(project: Project): (f: number) => boolean {
  const segs = skillSegments(project);
  return (f) => segs.some((s) => f >= s.from && f < s.from + s.durationInFrames);
}

export function SkillScenes({ project, src, component, media }: {
  project: Project; src: Record<string, string>; component: SkillComponent | null; media: Record<string, SkillMediaData>;
}) {
  const segs = React.useMemo(() => skillSegments(project), [project.scenes, project.clips, project.transcript, project.tracks, project.sequence]);
  const { reg, error } = useSkillRegistry(component, segs.length > 0);
  if (!segs.length || !component) return null;
  if (error) throw new Error(`Komponen skill gagal dimuat: ${error}`);
  if (!reg) return null;
  const { fps, width, height } = project.sequence;
  return (
    <>
      {segs.map((s) => {
        const C = reg[s.skill.component]?.C;
        if (!C || !src[s.mediaId]) return null;
        const m = media[s.mediaId];
        // URL CZ dibuat absolut supaya staticFile skill melewatkannya (di Player URL-nya relatif, mis. /api/media/...).
        const abs = (u: string) => new URL(u, location.href).href;
        // Wajah dari skrip analisis skill: detik sumber → relatif terhadap awal potongan.
        const faces = m?.faces?.filter((x) => Array.isArray(x) && x[0] >= s.a - 0.2 && x[0] <= s.b + 0.2).map((x) => [Math.round(((x as number[])[0] - s.a) * 1000) / 1000, ...(x as number[]).slice(1)]);
        const props: Record<string, unknown> = {
          ...(component.sfxLib ? { sfxLib: component.sfxLib } : {}),
          ...(faces?.length ? { faces } : {}),
          ...(m?.subject ? { subject: abs(m.subject), subjectA: s.a } : {}),
          seed: s.sceneIndex + 1,
          ...s.skill.props,
          // Diisi CZ: footage, rentang sumber, kata, ukuran. Suara asli tetap dari track audio CZ.
          src: abs(src[s.mediaId]), a: s.a, b: s.b, words: s.words, fps, width, height, voiceExternal: true,
        };
        return (
          <Sequence key={s.key} from={s.from} durationInFrames={s.durationInFrames} premountFor={fps} layout="absolute-fill">
            <C {...props} />
          </Sequence>
        );
      })}
    </>
  );
}

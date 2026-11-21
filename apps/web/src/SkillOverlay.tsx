// Seret elemen scene skill (kartu, caption, badge, …) langsung di Player. Komponen skill menandai tiap lapisan dengan
// data-cz-layer; geseran disimpan sebagai props.adjust[lapisan] di scene, jadi render memakai nilai yang sama.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { skillSegments, type Scene } from "@cz/core";
import { useEd } from "./ed.ts";
import { createStore, useStore } from "./store.ts";

export interface LayerAdjust { dx?: number; dy?: number; scale?: number; ox?: number; oy?: number; hidden?: boolean }
interface Box { key: string; x: number; y: number; w: number; h: number }

/** Lapisan skill yang dipilih (dibagi dengan Inspector scene). */
export const skillLayer = createStore<string | null>(null);

export const adjustOf = (s: Scene): Record<string, LayerAdjust> => ((s.skill?.props.adjust ?? {}) as Record<string, LayerAdjust>);

/** Tulis adjust satu lapisan; nilai kosong menghapus lapisan dari adjust (kembali ke tampilan asli skill). */
export function adjustOp(s: Scene, key: string, a: LayerAdjust | null) {
  const all = { ...adjustOf(s) };
  if (a && (a.dx || a.dy || (a.scale ?? 1) !== 1 || a.hidden)) all[key] = a; else delete all[key];
  const props = { ...s.skill!.props };
  if (Object.keys(all).length) props.adjust = all; else delete props.adjust;
  return { type: "updateScene" as const, id: s.id, changes: { skill: { component: s.skill!.component, props } } };
}

/** Kotak tiap lapisan = gabungan kotak isinya (pembungkus tanpa adjust memakai display:contents). */
function layerRect(el: HTMLElement): DOMRect | null {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  const els = el.style.display === "contents" ? el.querySelectorAll<HTMLElement>(":scope > *, :scope > * *") : [el];
  for (const x of els) {
    const q = x.getBoundingClientRect();
    if (q.width < 2 || q.height < 2) continue;
    l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
  }
  return Number.isFinite(l) ? new DOMRect(l, t, r - l, b - t) : null;
}

export function SkillOverlay({ frameRef }: { frameRef: React.RefObject<HTMLDivElement | null> }) {
  const ed = useEd();
  const p = ed.project;
  const { width: W, height: H } = p.sequence;
  const frame = useStore(ed.playhead);
  const sel = useStore(skillLayer);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [drag, setDrag] = useState<{ key: string; mode: "move" | "scale"; x0: number; y0: number; box: Box; dx: number; dy: number; s: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const seg = skillSegments(p).find((x) => frame >= x.from && frame < x.from + x.durationInFrames);
  const scene = seg ? p.scenes.find((s) => s.id === seg.sceneId) ?? null : null;
  const locked = scene?.status === "dikunci";

  useEffect(() => {
    let raf = 0, last = "";
    const tick = () => {
      const root = frameRef.current;
      if (root && scene) {
        const fr = root.getBoundingClientRect();
        const k = W / fr.width;
        const list: Box[] = [];
        root.querySelectorAll<HTMLElement>("[data-cz-layer]").forEach((el) => {
          // Sequence yang dipasang lebih awal (premount) tidak terlihat: dilewati.
          if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true } as CheckVisibilityOptions) && el.style.display !== "contents") return;
          if (el.closest("[style*='opacity: 0']")) return;
          const q = layerRect(el);
          if (!q) return;
          const box = { key: el.dataset.czLayer!, x: (q.left - fr.left) * k, y: (q.top - fr.top) * k, w: q.width * k, h: q.height * k };
          if (box.w * box.h > W * H * 0.85) return; // latar/footage selebar layar: tidak diseret
          list.push(box);
        });
        const key = JSON.stringify(list);
        if (key !== last) { last = key; setBoxes(list); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frameRef, W, H, scene?.id]);

  if (!scene?.skill) return null;
  const toSeq = (e: RPointerEvent) => {
    const fr = frameRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - fr.left) * W) / fr.width, y: ((e.clientY - fr.top) * W) / fr.width };
  };
  const down = (e: RPointerEvent, box: Box, mode: "move" | "scale") => {
    e.stopPropagation(); e.preventDefault();
    skillLayer.set(box.key);
    if (locked) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const { x, y } = toSeq(e);
    setDrag({ key: box.key, mode, x0: x, y0: y, box, dx: 0, dy: 0, s: 1 });
  };
  const move = (e: RPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const { x, y } = toSeq(e);
    if (d.mode === "move") setDrag({ ...d, dx: x - d.x0, dy: y - d.y0 });
    else setDrag({ ...d, s: Math.max(0.2, Math.min(4, (d.box.w + (x - d.x0)) / d.box.w)) });
  };
  const up = () => {
    const d = dragRef.current;
    setDrag(null);
    if (!d || (!d.dx && !d.dy && d.s === 1)) return;
    // Nilai adjust dalam px acuan lebar 1080 (sama dengan perhitungan komponen skill).
    const ref = 1080 / W;
    const prev = adjustOf(scene)[d.key] ?? {};
    const scale = (prev.scale ?? 1) * d.s;
    const next: LayerAdjust = {
      ...prev, dx: Math.round((prev.dx ?? 0) + d.dx * ref), dy: Math.round((prev.dy ?? 0) + d.dy * ref), scale: Math.round(scale * 1000) / 1000,
      // Titik skala = kiri-atas kotak saat pertama kali diskalakan, supaya kotak membesar ke kanan-bawah seperti pegangannya.
      ox: prev.ox ?? Math.round((d.box.x - (prev.dx ?? 0) / ref) * ref), oy: prev.oy ?? Math.round((d.box.y - (prev.dy ?? 0) / ref) * ref),
    };
    void ed.op(adjustOp(scene, d.key, next));
  };

  return (
    <div className="overlay overlay--skill" onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {boxes.map((b) => {
        const d = drag?.key === b.key ? drag : null;
        const w = b.w * (d?.s ?? 1), h = b.h * (d?.s ?? 1);
        return (
          <div key={b.key} className={"ov-box" + (sel === b.key ? " is-sel" : "") + (locked ? " is-locked" : "")}
            style={{ left: `${((b.x + (d?.dx ?? 0)) / W) * 100}%`, top: `${((b.y + (d?.dy ?? 0)) / H) * 100}%`, width: `${(w / W) * 100}%`, height: `${(h / H) * 100}%` }}
            title={`Lapisan skill: ${b.key}`} onPointerDown={(e) => down(e, b, "move")}>
            {sel === b.key && !locked && <span className="ov-handle ov-handle--se" onPointerDown={(e) => down(e, b, "scale")} />}
          </div>
        );
      })}
    </div>
  );
}

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { applyOp, type Op, type Project } from "@cz/core";
import { ASSET_DRAG, newAssetFor } from "./AssetsPanel.tsx";
import { useEd } from "./ed.ts";
import { withoutId } from "./ItemInspector.tsx";

interface Box { id: string; kind: "asset" | "caption"; x: number; y: number; w: number; h: number }
const SNAP_PX = 8;
const SAFE = { top: 220, bottom: 400, side: 80 };

const tryApply = (p: Project, op: Op) => { try { return applyOp(p, op)[0]; } catch { return null; } };

/** Lapisan edit di atas Player: memilih, menggeser, mengubah ukuran/rotasi aset dan caption langsung di video. */
export function Overlay({ frameRef }: { frameRef: React.RefObject<HTMLDivElement | null> }) {
  const ed = useEd();
  const p = ed.project;
  const { width: W, height: H } = p.sequence;
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const [editing, setEditing] = useState<{ id: string; kind: Box["kind"]; text: string; box: Box } | null>(null);
  const drag = useRef<{ id: string; kind: Box["kind"]; mode: "move" | "scale" | "rotate"; x0: number; y0: number; box: Box; alt: boolean; op: Op | null } | null>(null);

  // Ukur posisi aset/caption yang sedang tampil langsung dari DOM Player (komposisi yang sama dengan render).
  useEffect(() => {
    let raf = 0, last = "";
    const tick = () => {
      const root = frameRef.current;
      if (root) {
        const r = root.getBoundingClientRect();
        const k = W / r.width;
        const list: Box[] = [];
        root.querySelectorAll<HTMLElement>("[data-asset-id],[data-caption-id]").forEach((el) => {
          const b = el.getBoundingClientRect();
          if (!b.width && !b.height) return;
          list.push({ id: el.dataset.assetId ?? el.dataset.captionId!, kind: el.dataset.assetId ? "asset" : "caption", x: (b.left - r.left) * k, y: (b.top - r.top) * k, w: b.width * k, h: b.height * k });
        });
        const key = JSON.stringify(list);
        if (key !== last) { last = key; setBoxes(list); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frameRef, W]);

  const scale = () => (frameRef.current ? W / frameRef.current.getBoundingClientRect().width : 1);

  /** Delta yang menempelkan tepi/tengah kotak ke garis tengah, batas area aman, atau tepi aset lain. */
  const snap = (b: Box, dx: number, dy: number) => {
    const tol = SNAP_PX * scale();
    const xs = [W / 2, SAFE.side, W - SAFE.side, ...boxes.filter((o) => o.id !== b.id).flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
    const ys = [H / 2, SAFE.top, H - SAFE.bottom, ...boxes.filter((o) => o.id !== b.id).flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
    const pick = (edges: number[], cands: number[], d: number) => {
      let best: { d: number; at: number } | null = null;
      for (const e of edges) for (const c of cands) if (Math.abs(e + d - c) <= tol && (!best || Math.abs(e + d - c) < Math.abs(e + best.d - best.at))) best = { d: c - e, at: c };
      return best;
    };
    const sx = pick([b.x, b.x + b.w / 2, b.x + b.w], xs, dx), sy = pick([b.y, b.y + b.h / 2, b.y + b.h], ys, dy);
    setGuides({ x: sx ? [sx.at] : [], y: sy ? [sy.at] : [] });
    return { dx: sx?.d ?? dx, dy: sy?.d ?? dy };
  };

  const down = (e: RPointerEvent, b: Box, mode: "move" | "scale" | "rotate") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const a = b.kind === "asset" ? p.assets.find((x) => x.id === b.id) : null;
    ed.select(e.shiftKey ? [...ed.selection, b.id] : [b.id]);
    if (a?.locked) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: b.id, kind: b.kind, mode, x0: e.clientX, y0: e.clientY, box: b, alt: e.altKey, op: null };
  };

  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const k = scale();
    let dx = (e.clientX - d.x0) * k, dy = (e.clientY - d.y0) * k;
    let op: Op | null = null;
    if (d.kind === "caption") {
      const c = p.captions.find((x) => x.id === d.id)!;
      ({ dx, dy } = snap(d.box, dx, dy));
      op = { type: "updateCaption", id: c.id, changes: { position: { preset: c.position.preset, x: Math.round(d.box.x + d.box.w / 2 + dx), y: Math.round(d.box.y + d.box.h / 2 + dy) } } };
    } else {
      const a = p.assets.find((x) => x.id === d.id)!;
      const cx = d.box.x + d.box.w / 2, cy = d.box.y + d.box.h / 2;
      if (d.mode === "move") {
        ({ dx, dy } = snap(d.box, dx, dy));
        const t = { x: Math.round(a.transform.x + dx), y: Math.round(a.transform.y + dy) };
        op = d.alt || e.altKey ? { type: "addAssets", assets: [{ ...withoutId(a), transform: { ...a.transform, ...t } }] } : { type: "updateAsset", id: a.id, changes: { transform: t } };
      } else if (d.mode === "scale") {
        const r = frameRef.current!.getBoundingClientRect();
        const dist = (x: number, y: number) => Math.hypot((x - r.left) * k - cx, (y - r.top) * k - cy);
        const ratio = dist(e.clientX, e.clientY) / Math.max(1, dist(d.x0, d.y0));
        op = { type: "updateAsset", id: a.id, changes: { transform: { scale: Math.max(0.05, Math.round(a.transform.scale * ratio * 100) / 100) } } };
      } else {
        const r = frameRef.current!.getBoundingClientRect();
        const ang = (Math.atan2((e.clientY - r.top) * k - cy, (e.clientX - r.left) * k - cx) * 180) / Math.PI + 90;
        const snapped = e.shiftKey ? Math.round(ang / 15) * 15 : Math.round(ang);
        op = { type: "updateAsset", id: a.id, changes: { transform: { rotation: ((snapped + 540) % 360) - 180 } } };
      }
    }
    d.op = op;
    ed.setPreview(op ? tryApply(p, op) : null);
  };

  const up = async () => {
    const d = drag.current;
    drag.current = null;
    setGuides({ x: [], y: [] });
    if (d?.op) await ed.op(d.op);
    ed.setPreview(null);
  };

  const startEdit = (b: Box) => {
    if (b.kind === "caption") {
      const c = p.captions.find((x) => x.id === b.id)!;
      setEditing({ id: b.id, kind: "caption", text: c.words.map((w) => w.text).join(" "), box: b });
    } else {
      const a = p.assets.find((x) => x.id === b.id)!;
      if (a.locked) return;
      const def = a.defId ? ed.assetDefs.find((x) => x.id === a.defId) : undefined;
      const key = def ? Object.entries(def.params).find(([, pd]) => pd.type === "text")?.[0] : "text";
      if (!key) return;
      const val = a.params[key] ?? def?.params[key]?.default ?? "";
      setEditing({ id: b.id, kind: "asset", text: String(val), box: { ...b, id: key } });
    }
  };
  const commitEdit = (text: string) => {
    const ed0 = editing;
    setEditing(null);
    if (!ed0 || text === ed0.text || !text.trim()) return;
    if (ed0.kind === "asset") {
      const a = p.assets.find((x) => x.id === ed0.id)!;
      ed.op({ type: "updateAsset", id: a.id, changes: { params: { ...a.params, [ed0.box.id]: text } } });
      return;
    }
    // Teks caption diubah tanpa menyentuh audio; waktu kata dipertahankan bila jumlah kata sama, selain itu dibagi rata.
    const c = p.captions.find((x) => x.id === ed0.id)!;
    const parts = text.trim().split(/\s+/);
    const words = parts.length === c.words.length
      ? c.words.map((w, i) => ({ ...w, text: parts[i] }))
      : parts.map((t, i) => {
        const span = c.end - c.start, s = c.start + Math.floor((span * i) / parts.length), e = c.start + Math.floor((span * (i + 1)) / parts.length);
        return { wordId: null, text: t, start: s, end: Math.max(s + 1, e), style: "normal" as const };
      });
    ed.op({ type: "updateCaption", id: c.id, changes: { words } });
  };

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const outside = (b: Box) => b.x < SAFE.side || b.x + b.w > W - SAFE.side || b.y < SAFE.top || b.y + b.h > H - SAFE.bottom;

  return (
    <div className="overlay" onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onPointerDown={(e) => { if (e.target === e.currentTarget) ed.select([]); }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(ASSET_DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
      onDrop={(e) => {
        const defId = e.dataTransfer.getData(ASSET_DRAG);
        if (!defId || !frameRef.current) return;
        e.preventDefault();
        const r = frameRef.current.getBoundingClientRect();
        ed.op({ type: "addAssets", assets: [newAssetFor(ed, defId, ed.playhead.get(), { x: (e.clientX - r.left) * scale(), y: (e.clientY - r.top) * scale() })] });
      }}>
      {boxes.map((b) => {
        const sel = ed.selection.has(b.id);
        const locked = b.kind === "asset" && p.assets.find((a) => a.id === b.id)?.locked;
        return (
          <div key={b.id} className={"ov-box" + (sel ? " is-sel" : "") + (outside(b) ? " is-out" : "") + (locked ? " is-locked" : "")}
            style={{ left: pct(b.x, W), top: pct(b.y, H), width: pct(b.w, W), height: pct(b.h, H) }}
            onPointerDown={(e) => down(e, b, "move")} onDoubleClick={() => startEdit(b)}
            title={outside(b) ? "Keluar dari batas aman: bisa tertutup tombol aplikasi media sosial" : locked ? "Dikunci" : "Seret untuk memindah · Alt+seret untuk menggandakan · klik dua kali untuk mengetik"}>
            {sel && b.kind === "asset" && !locked && (
              <>
                <span className="ov-handle ov-handle--se" onPointerDown={(e) => down(e, b, "scale")} />
                <span className="ov-handle ov-handle--rot" onPointerDown={(e) => down(e, b, "rotate")} title="Putar (Shift = kelipatan 15°)" />
              </>
            )}
          </div>
        );
      })}
      {guides.x.map((x) => <div key={"x" + x} className="ov-guide ov-guide--v" style={{ left: pct(x, W) }} />)}
      {guides.y.map((y) => <div key={"y" + y} className="ov-guide ov-guide--h" style={{ top: pct(y, H) }} />)}
      {editing && (
        <textarea className="ov-edit" autoFocus defaultValue={editing.text}
          style={{ left: pct(editing.box.x, W), top: pct(editing.box.y, H), width: pct(Math.max(editing.box.w, 300), W) }}
          onBlur={(e) => commitEdit(e.target.value.trim())}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); } if (e.key === "Escape") setEditing(null); }} />
      )}
    </div>
  );
}

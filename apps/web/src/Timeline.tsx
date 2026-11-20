import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { applyOp, clipEnd, clipLen, srcToSeq, thumbPlan, type Clip, type Media, type Op, type Project, type Track, type TrackKind } from "@cz/core";
import { mediaUrl, type JobStatus } from "./api.ts";
import { ASSET_DRAG, newAssetFor } from "./AssetsPanel.tsx";
import { itemKind, TOOLS, useEd, type Tool } from "./ed.ts";
import { beatColor } from "./PlanPanel.tsx";
import { Icon, type IconName } from "./icons.tsx";
import { MEDIA_DRAG } from "./MediaPanel.tsx";
import { loadLocal, saveLocal, timecode, useStore } from "./store.ts";

const HEAD_W = 168;
const RULER_H = 30;
const DEFAULT_H: Record<TrackKind, number> = { scene: 24, video: 50, caption: 30, audio: 44 };
const EDGE_PX = 7;
const SNAP_PX = 9;
export const PPS_MIN = 2;
export const PPS_MAX = 1500;

/** Pratinjau op di browser memakai fungsi core yang sama dengan server. */
function tryApply(p: Project, op: Op): Project | null {
  try { return applyOp(p, op)[0]; } catch { return null; }
}

interface Drag {
  kind: "move" | "trim" | "roll" | "slip" | "slide" | "marquee" | "scrub";
  x0: number; y0: number; row0: number; moved: boolean;
  make?: (d: number, row: number, alt: boolean) => Op | null;
  anchors?: number[];
  candidates?: number[];
  op?: Op | null;
  additive?: boolean;
}

export function Timeline() {
  const ed = useEd();
  const { project } = ed;
  const fps = project.sequence.fps;
  const ppf = ed.pps / fps;
  const scrollRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const zoomAnchor = useRef<{ frame: number; offset: number } | null>(null);
  const [preview, setPreview] = useState<Project | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [view, setView] = useState({ left: 0, width: 800 });
  const [heights, setHeights] = useState<Record<string, number>>(() => loadLocal("cz.trackHeights", {}));
  const shown = preview ?? project;

  const tracks = project.tracks;
  const rowH = (t: Track) => heights[t.id] ?? DEFAULT_H[t.kind];
  const rowTops = useMemo(() => {
    const tops: number[] = [];
    let y = 0;
    for (const t of tracks) { tops.push(y); y += heights[t.id] ?? DEFAULT_H[t.kind]; }
    tops.push(y);
    return tops;
  }, [tracks, heights]);

  const contentFrames = Math.max(shown.sequence.durationFrames + fps * 10, Math.ceil(view.width / ppf));
  const contentW = contentFrames * ppf;

  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const update = () => setView({ left: el.scrollLeft, width: Math.max(100, el.clientWidth - HEAD_W) });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener("scroll", update); };
  }, []);

  // Zoom tetap berpusat di frame yang sama (kursor atau playhead).
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    if (a && scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, a.frame * ppf - a.offset);
    zoomAnchor.current = null;
  }, [ppf]);

  const zoomTo = (pps: number, frame: number, offset: number) => {
    zoomAnchor.current = { frame, offset };
    ed.setPps(Math.min(PPS_MAX, Math.max(PPS_MIN, pps)));
  };

  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
      e.preventDefault();
      const offset = e.clientX - el.getBoundingClientRect().left - HEAD_W;
      zoomTo(ed.pps * Math.pow(1.0018, -e.deltaY), (el.scrollLeft + offset) / ppf, offset);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  useEffect(() => {
    const onZoom = (e: Event) => {
      const kind = (e as CustomEvent<string>).detail;
      const el = scrollRef.current!;
      const ph = ed.playhead.get();
      const offset = Math.min(Math.max(0, ph * ppf - el.scrollLeft), view.width);
      if (kind === "in") zoomTo(ed.pps * 1.5, ph, offset);
      else if (kind === "out") zoomTo(ed.pps / 1.5, ph, offset);
      else {
        const secs = Math.max(1, project.sequence.durationFrames / fps);
        zoomAnchor.current = { frame: 0, offset: 0 };
        ed.setPps(Math.min(PPS_MAX, Math.max(PPS_MIN, (view.width - 24) / secs)));
      }
    };
    addEventListener("cz:zoom", onZoom);
    return () => removeEventListener("cz:zoom", onZoom);
  });

  const frameAt = (clientX: number) => (clientX - lanesRef.current!.getBoundingClientRect().left) / ppf;
  const rowAt = (clientY: number) => {
    const y = clientY - lanesRef.current!.getBoundingClientRect().top;
    const i = rowTops.findIndex((top, k) => k < tracks.length && y >= top && y < rowTops[k + 1]);
    return i < 0 ? (y < 0 ? 0 : tracks.length - 1) : i;
  };

  const snapCandidates = (exclude: Set<string>) => {
    const c = [0, ed.playhead.get(), ...project.markers.map((m) => m.frame)];
    if (ed.inOut.in !== null) c.push(ed.inOut.in);
    if (ed.inOut.out !== null) c.push(ed.inOut.out);
    for (const x of project.clips) if (!exclude.has(x.id)) c.push(x.start, clipEnd(x, fps));
    for (const s of project.scenes) if (!exclude.has(s.id)) c.push(s.start, s.end);
    for (const a of project.assets) if (!exclude.has(a.id)) c.push(a.start, a.start + a.duration);
    for (const cap of project.captions) if (!exclude.has(cap.id)) for (const w of cap.words) c.push(w.start, w.end);
    return c;
  };
  /** Menyesuaikan delta supaya salah satu anchor menempel ke kandidat terdekat. */
  const snapDelta = (d: number, anchors: number[], cands: number[]) => {
    if (!ed.snap || !anchors.length) return { d, at: null as number | null };
    let best: { d: number; at: number; dist: number } | null = null;
    for (const a of anchors) for (const c of cands) {
      const dist = Math.abs(a + d - c) * ppf;
      if (dist <= SNAP_PX && (!best || dist < best.dist)) best = { d: c - a, at: c, dist };
    }
    return best ? { d: best.d, at: best.at } : { d, at: null };
  };

  const linkedIds = (ids: string[]) => {
    const links = new Set(project.clips.filter((c) => ids.includes(c.id) && c.linkId).map((c) => c.linkId));
    return project.clips.filter((c) => ids.includes(c.id) || (c.linkId && links.has(c.linkId))).map((c) => c.id);
  };

  function beginDrag(e: RPointerEvent, d: Drag) {
    drag.current = d;
    lanesRef.current!.setPointerCapture(e.pointerId);
  }

  /** Aset, caption, dan scene: pilih, geser (tengah), atau trim (tepi). Kata caption bisa digeser tepinya per frame. */
  function itemDown(e: RPointerEvent, el: HTMLElement, base: Omit<Drag, "kind">) {
    const id = el.dataset.item!;
    const kind = itemKind(id);
    const wordEl = (e.target as HTMLElement).closest<HTMLElement>("[data-word]");
    const edgeOf = (r: DOMRect) => (r.width > EDGE_PX * 3 ? (e.clientX - r.left < EDGE_PX ? "in" : r.right - e.clientX < EDGE_PX ? "out" : null) : null);
    const edge = edgeOf(el.getBoundingClientRect());
    ed.select(e.shiftKey ? [...ed.selection, id] : [id]);
    const excl = new Set([id]);
    if (kind === "asset") {
      const a = project.assets.find((x) => x.id === id)!;
      if (a.locked) return;
      const end = a.start + a.duration;
      beginDrag(e, {
        ...base, kind: edge ? "trim" : "move", anchors: edge === "in" ? [a.start] : edge === "out" ? [end] : [a.start, end], candidates: snapCandidates(excl),
        make: (d) => {
          if (edge === "in") { const dd = Math.min(d, a.duration - 1); return { type: "updateAsset", id, changes: { start: Math.max(0, a.start + dd), duration: a.duration - Math.max(dd, -a.start) } }; }
          if (edge === "out") return { type: "updateAsset", id, changes: { duration: Math.max(1, a.duration + d) } };
          return d ? { type: "updateAsset", id, changes: { start: Math.max(0, a.start + d) } } : null;
        },
      });
      return;
    }
    if (kind === "caption") {
      const c = project.captions.find((x) => x.id === id)!;
      const wi = wordEl ? Number(wordEl.dataset.word) : -1;
      const wEdge = wordEl ? edgeOf(wordEl.getBoundingClientRect()) : null;
      if (wi >= 0 && wEdge) {
        const w = c.words[wi];
        beginDrag(e, {
          ...base, kind: "trim", anchors: [wEdge === "in" ? w.start : w.end], candidates: snapCandidates(excl),
          make: (d) => ({ type: "updateCaption", id, changes: { words: c.words.map((x, i) => (i !== wi ? x : wEdge === "in"
            ? { ...x, start: Math.max(0, Math.min(x.end - 1, x.start + d)) } : { ...x, end: Math.max(x.start + 1, x.end + d) })) } }),
        });
        return;
      }
      beginDrag(e, {
        ...base, kind: "move", anchors: [c.start, c.end], candidates: snapCandidates(excl),
        make: (d) => {
          const dd = Math.max(d, -c.start);
          return dd ? { type: "updateCaption", id, changes: { words: c.words.map((x) => ({ ...x, start: x.start + dd, end: x.end + dd })) } } : null;
        },
      });
      return;
    }
    if (kind === "scene") {
      const sc = project.scenes.find((x) => x.id === id)!;
      ed.seek(sc.start);
      if (!edge || sc.status === "dikunci") return;
      // Batas di antara dua scene digeser bersama supaya tidak ada celah.
      const nb = edge === "in" ? project.scenes.find((x) => x.end === sc.start) : project.scenes.find((x) => x.start === sc.end);
      const at = edge === "in" ? sc.start : sc.end;
      beginDrag(e, {
        ...base, kind: "trim", anchors: [at], candidates: snapCandidates(new Set([id, ...(nb ? [nb.id] : [])])),
        make: (d) => {
          const v = at + d;
          const ops: Op[] = [{ type: "updateScene", id, changes: edge === "in" ? { start: v } : { end: v } }];
          if (nb) ops.push({ type: "updateScene", id: nb.id, changes: edge === "in" ? { end: v } : { start: v } });
          return d ? { type: "batch", label: "Geser batas scene", ops } : null;
        },
      });
    }
  }

  function onLanesDown(e: RPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const f0 = frameAt(e.clientX);
    const row0 = rowAt(e.clientY);
    const base = { x0: e.clientX, y0: e.clientY, row0, moved: false };
    const itemEl = (e.target as HTMLElement).closest<HTMLElement>("[data-item]");
    if (itemEl && ed.tool !== "razor") { itemDown(e, itemEl, base); return; }
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-clip]");
    const tool = ed.tool;

    if (!el) {
      if (tool === "trackFwd") {
        const only = e.shiftKey ? tracks[row0].id : null;
        ed.select(project.clips.filter((c) => c.start >= f0 && (!only || c.trackId === only)).map((c) => c.id));
        return;
      }
      if (!e.shiftKey) ed.select([]);
      beginDrag(e, { ...base, kind: "marquee", additive: e.shiftKey });
      return;
    }

    const clip = project.clips.find((c) => c.id === el.dataset.clip)!;
    const r = el.getBoundingClientRect();
    const edge = r.width > EDGE_PX * 3 ? (e.clientX - r.left < EDGE_PX ? "in" : r.right - e.clientX < EDGE_PX ? "out" : null) : null;
    const group = new Set(linkedIds([clip.id]));
    const end = clipEnd(clip, fps);

    if (tool === "razor") {
      const frame = Math.round(snapDelta(Math.round(f0), [0], snapCandidates(new Set())).d);
      ed.op({ type: "split", frame, clipIds: e.shiftKey ? undefined : [clip.id] });
      return;
    }
    if (tool === "trackFwd") {
      ed.select(project.clips.filter((c) => c.start >= clip.start && (!e.shiftKey || c.trackId === clip.trackId)).map((c) => c.id));
      return;
    }

    const trimDrag = (ripple: boolean) => beginDrag(e, {
      ...base, kind: "trim", anchors: [edge === "in" ? clip.start : end], candidates: snapCandidates(group),
      make: (d) => ({ type: "trimClip", clipId: clip.id, edge: edge!, delta: d, ripple }),
    });

    if (tool === "select" || tool === "ripple") {
      if (edge) { ed.select(linkedIds([clip.id])); trimDrag(tool === "ripple"); return; }
      let ids: string[];
      if (e.shiftKey || e.ctrlKey) {
        const mine = linkedIds([clip.id]);
        ids = ed.selection.has(clip.id) ? [...ed.selection].filter((x) => !mine.includes(x)) : [...ed.selection, ...mine];
        ed.select(ids);
        return;
      }
      ids = ed.selection.has(clip.id) ? [...ed.selection] : linkedIds([clip.id]);
      ed.select(ids);
      if (tool === "ripple") return;
      const moving = new Set(linkedIds(ids));
      const leadKind = tracks.find((t) => t.id === clip.trackId)!.kind;
      const sameKind = tracks.filter((t) => t.kind === leadKind);
      const leadIdx = sameKind.findIndex((t) => t.id === clip.trackId);
      beginDrag(e, {
        ...base, kind: "move", anchors: [clip.start, end], candidates: snapCandidates(moving),
        make: (d, row, alt) => {
          const target = tracks[row];
          const shift = target.kind === leadKind ? sameKind.findIndex((t) => t.id === target.id) - leadIdx : 0;
          if (alt) {
            const ms = project.clips.filter((c) => moving.has(c.id));
            return {
              type: "addClips", clips: ms.map((c) => {
                const kind = tracks.find((t) => t.id === c.trackId)!.kind;
                const idx = sameKind.findIndex((t) => t.id === c.trackId);
                const trackId = kind === leadKind && shift && ids.includes(c.id) ? sameKind[idx + shift]?.id ?? c.trackId : c.trackId;
                return { trackId, mediaId: c.mediaId, srcIn: c.srcIn, srcOut: c.srcOut, start: Math.max(0, c.start + d), link: c.linkId ?? undefined, gainDb: c.gainDb, enabled: c.enabled, fadeIn: c.fadeIn, fadeOut: c.fadeOut };
              }),
            };
          }
          // Klip yang diklik jadi acuan pindah track (id pertama).
          return d || shift ? { type: "moveClips", clipIds: [clip.id, ...ids.filter((x) => x !== clip.id)], delta: d, trackShift: shift || undefined } : null;
        },
      });
      return;
    }

    if (tool === "roll") {
      if (!edge) return;
      const left = edge === "out" ? clip : project.clips.find((c) => c.trackId === clip.trackId && clipEnd(c, fps) === clip.start);
      if (!left) return;
      const cut = clipEnd(left, fps);
      beginDrag(e, { ...base, kind: "roll", anchors: [cut], candidates: snapCandidates(new Set(linkedIds([left.id]))), make: (d) => ({ type: "rollEdit", clipId: left.id, delta: d }) });
      return;
    }
    if (tool === "slip") {
      ed.select(linkedIds([clip.id]));
      beginDrag(e, { ...base, kind: "slip", make: (d) => ({ type: "slipClip", clipId: clip.id, delta: -d }) });
      return;
    }
    if (tool === "slide") {
      ed.select(linkedIds([clip.id]));
      beginDrag(e, { ...base, kind: "slide", anchors: [clip.start, end], candidates: snapCandidates(group), make: (d) => ({ type: "slideClip", clipId: clip.id, delta: d }) });
    }
  }

  function onLanesMove(e: RPointerEvent<HTMLDivElement>) {
    const dg = drag.current;
    if (!dg) { updateCursor(e); return; }
    if (!dg.moved && Math.hypot(e.clientX - dg.x0, e.clientY - dg.y0) < 3) return;
    dg.moved = true;
    const box = lanesRef.current!.getBoundingClientRect();
    if (dg.kind === "marquee") {
      const m = { x0: dg.x0 - box.left, y0: dg.y0 - box.top, x1: e.clientX - box.left, y1: e.clientY - box.top };
      setMarquee(m);
      const [xa, xb] = [Math.min(m.x0, m.x1) / ppf, Math.max(m.x0, m.x1) / ppf];
      const [ya, yb] = [Math.min(m.y0, m.y1), Math.max(m.y0, m.y1)];
      const hit = project.clips.filter((c) => {
        const i = tracks.findIndex((t) => t.id === c.trackId);
        return c.start < xb && clipEnd(c, fps) > xa && rowTops[i] < yb && rowTops[i + 1] > ya;
      }).map((c) => c.id);
      ed.select(dg.additive ? new Set([...ed.selection, ...hit]) : hit);
      return;
    }
    const raw = Math.round((e.clientX - dg.x0) / ppf);
    const { d, at } = snapDelta(raw, dg.anchors ?? [], dg.candidates ?? []);
    setSnapLine(at);
    const op = dg.make!(d, rowAt(e.clientY), e.altKey);
    dg.op = op;
    const next = op ? tryApply(project, op) : null;
    setPreview(next);
    const sign = d > 0 ? "+" : d < 0 ? "−" : "";
    const label = dg.kind === "move" ? (e.altKey && dg.op?.type === "addClips" ? "Duplikat " : "Geser ") : dg.kind === "trim" ? "Pangkas " : dg.kind === "roll" ? "Sambungan " : dg.kind === "slip" ? "Isi klip " : "Geser ";
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, text: op && !next ? "Tidak bisa ditaruh di sini" : `${label}${sign}${timecode(Math.abs(d), fps)}` });
  }

  async function onLanesUp() {
    const dg = drag.current;
    drag.current = null;
    setMarquee(null); setSnapLine(null); setTip(null);
    if (dg && dg.moved && dg.op) await ed.op(dg.op);
    setPreview(null);
  }

  function updateCursor(e: RPointerEvent<HTMLDivElement>) {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-clip]");
    let cursor = "";
    if (el) {
      const r = el.getBoundingClientRect();
      const nearEdge = r.width > EDGE_PX * 3 && (e.clientX - r.left < EDGE_PX || r.right - e.clientX < EDGE_PX);
      const t = ed.tool;
      if (t === "razor") cursor = "crosshair";
      else if (t === "slip" || t === "slide") cursor = "ew-resize";
      else if (nearEdge && (t === "select" || t === "ripple" || t === "roll")) cursor = "col-resize";
      else if (t === "select") cursor = "grab";
    }
    lanesRef.current!.style.cursor = cursor;
  }

  // Seret media dari panel ke timeline.
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(MEDIA_DRAG) && !e.dataTransfer.types.includes(ASSET_DRAG)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const f = Math.max(0, Math.round(frameAt(e.clientX)));
    setSnapLine(snapDelta(f, [0], snapCandidates(new Set())).at ?? f);
  };
  const onDrop = (e: React.DragEvent) => {
    const defId = e.dataTransfer.getData(ASSET_DRAG);
    if (defId) {
      e.preventDefault();
      setSnapLine(null);
      const raw = Math.max(0, Math.round(frameAt(e.clientX)));
      const start = raw + snapDelta(0, [raw], snapCandidates(new Set())).d;
      const t = tracks[rowAt(e.clientY)];
      const asset = newAssetFor(ed, defId, Math.max(0, start));
      ed.op({ type: "addAssets", assets: [{ ...asset, trackId: t.kind === "video" && t.id !== "V1" ? t.id : "V3" }] });
      return;
    }
    const id = e.dataTransfer.getData(MEDIA_DRAG);
    setSnapLine(null);
    const m = project.media.find((x) => x.id === id);
    if (!m) return;
    e.preventDefault();
    const raw = Math.max(0, Math.round(frameAt(e.clientX)));
    const start = raw + snapDelta(0, [raw], snapCandidates(new Set())).d;
    const t = tracks[rowAt(e.clientY)];
    const base = { mediaId: m.id, srcIn: 0, srcOut: m.duration, start: Math.max(0, start), link: "d" };
    const clips = t.kind === "audio" ? [{ ...base, trackId: t.id, link: undefined }]
      : [{ ...base, trackId: t.kind === "video" ? t.id : "V1" }, { ...base, trackId: "A1" }];
    ed.op({ type: "addClips", clips });
  };

  const resizeTrack = (t: Track) => (e: RPointerEvent<HTMLDivElement>) => {
    const y0 = e.clientY, h0 = rowH(t);
    const move = (ev: PointerEvent) => setHeights((hs) => ({ ...hs, [t.id]: Math.min(160, Math.max(22, h0 + ev.clientY - y0)) }));
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); setHeights((hs) => { saveLocal("cz.trackHeights", hs); return hs; }); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };

  const mediaById = useMemo(() => new Map(project.media.map((m) => [m.id, m])), [project.media]);
  const totalH = rowTops[tracks.length];

  return (
    <section className="timeline" aria-label="Linimasa">
      <TimelineBar />
      <div className="tl-body">
        <div className="tl-tools" role="toolbar" aria-label="Alat linimasa" aria-orientation="vertical">
          {TOOLS.map((t) => (
            <button key={t.id} className={"tool" + (ed.tool === t.id ? " is-on" : "")} aria-pressed={ed.tool === t.id}
              onClick={() => ed.setTool(t.id)} aria-label={`${t.label} (${t.key})`} data-tip={`${t.label} · ${t.key}`}>
              <Icon name={t.id as IconName} />
            </button>
          ))}
        </div>
        <div className="tl-scroll" ref={scrollRef}>
          <div className="tl-inner" style={{ width: HEAD_W + contentW }}>
            <div className="tl-rulerrow" style={{ height: RULER_H }}>
              <div className="tl-corner"><Clock /></div>
              <Ruler ppf={ppf} view={view} contentW={contentW} />
            </div>
            <div className="tl-rows">
              <div className="tl-heads">
                {tracks.map((t) => <TrackHead key={t.id} t={t} h={rowH(t)} onResize={resizeTrack(t)} />)}
              </div>
              <div className={`tl-lanes tool-${ed.tool}`} ref={lanesRef} style={{ width: contentW, height: totalH }}
                onPointerDown={onLanesDown} onPointerMove={onLanesMove} onPointerUp={onLanesUp} onPointerCancel={onLanesUp}
                onDragOver={onDragOver} onDragLeave={() => setSnapLine(null)} onDrop={onDrop}>
                {ed.inOut.in !== null && ed.inOut.out !== null && ed.inOut.out > ed.inOut.in && (
                  <div className="tl-inout" style={{ left: ed.inOut.in * ppf, width: (ed.inOut.out - ed.inOut.in) * ppf }} />
                )}
                {tracks.map((t, i) => (
                  <div key={t.id} className={`tl-lane tl-lane--${t.kind}` + (t.locked ? " is-locked" : "") + (t.hidden || t.muted ? " is-off" : "")}
                    style={{ top: rowTops[i], height: rowH(t) }} data-track={t.id}>
                    {shown.clips.filter((c) => c.trackId === t.id).map((c) => (
                      <ClipView key={c.id} c={c} m={mediaById.get(c.mediaId)} job={ed.s.jobs[c.mediaId]} kind={t.kind}
                        ppf={ppf} fps={fps} h={rowH(t)} selected={ed.selection.has(c.id)} ghost={!!preview} />
                    ))}
                    <Items t={t} p={shown} ppf={ppf} />
                  </div>
                ))}
                {snapLine !== null && <div className="tl-snap" style={{ left: snapLine * ppf }} />}
                {marquee && (
                  <div className="tl-marquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />
                )}
                {tip && <div className="tl-tip mono" style={{ left: tip.x + 14, top: Math.max(0, tip.y - 30) }}>{tip.text}</div>}
              </div>
            </div>
            <Playhead ppf={ppf} scrollRef={scrollRef} viewWidth={view.width} />
          </div>
        </div>
      </div>
    </section>
  );
}

function TimelineBar() {
  const ed = useEd();
  const fps = ed.project.sequence.fps;
  const { in: i, out: o } = ed.inOut;
  const zoom = (k: string) => dispatchEvent(new CustomEvent("cz:zoom", { detail: k }));
  const logPps = Math.log(ed.pps);
  return (
    <div className="tl-bar">
      <div className="tl-bar__group">
        <button className={"btn btn--chip" + (ed.snap ? " is-on" : "")} aria-pressed={ed.snap} onClick={() => ed.setSnap(!ed.snap)} title="Klip menempel ke klip dan penanda terdekat (S)">
          <Icon name="magnet" />Magnet
        </button>
        <button className="btn btn--chip" onClick={() => ed.op({ type: "addMarker", frame: ed.playhead.get() })} title="Tambah penanda di posisi sekarang (M)">
          <Icon name="marker" />Penanda
        </button>
      </div>
      <div className="tl-bar__group tl-bar__inout mono" aria-live="polite">
        <span title="Awal bagian bertanda (I)">Dari <b>{i === null ? "--:--:--:--" : timecode(i, fps)}</b></span>
        <span title="Akhir bagian bertanda (O)">Sampai <b>{o === null ? "--:--:--:--" : timecode(o, fps)}</b></span>
        {i !== null && o !== null && o > i && (
          <>
            <button className="btn btn--chip" onClick={() => ed.op({ type: "deleteRange", start: i, end: o, ripple: false })} title="Kosongkan bagian bertanda, celahnya dibiarkan (;)">Kosongkan</button>
            <button className="btn btn--chip" onClick={() => ed.op({ type: "deleteRange", start: i, end: o, ripple: true })} title="Hapus bagian bertanda dan rapatkan (')">Hapus bagian</button>
          </>
        )}
        {(i !== null || o !== null) && (
          <button className="btn btn--icon btn--sm" onClick={() => ed.setInOut({ in: null, out: null })} aria-label="Hapus tanda bagian" title="Hapus tanda bagian"><Icon name="close" /></button>
        )}
      </div>
      <div className="tl-bar__group tl-bar__zoom">
        <button className="btn btn--icon btn--sm" onClick={() => zoom("out")} aria-label="Perkecil" title="Perkecil (−)"><Icon name="zoomOut" /></button>
        <input type="range" aria-label="Perbesar linimasa" min={Math.log(PPS_MIN)} max={Math.log(PPS_MAX)} step={0.01} value={logPps}
          onChange={(e) => ed.setPps(Math.exp(Number(e.target.value)))} />
        <button className="btn btn--icon btn--sm" onClick={() => zoom("in")} aria-label="Perbesar" title="Perbesar (+)"><Icon name="zoomIn" /></button>
        <button className="btn btn--icon btn--sm" onClick={() => zoom("fit")} aria-label="Tampilkan seluruh video" title="Tampilkan seluruh video (\)"><Icon name="fit" /></button>
      </div>
    </div>
  );
}

function Clock() {
  const ed = useEd();
  const f = useStore(ed.playhead);
  return <span className="mono tc">{timecode(f, ed.project.sequence.fps)}</span>;
}

/** Jarak tick ruler mengikuti zoom: minimal ~90 px antar label. */
function tickStep(ppf: number, fps: number) {
  const steps = [1, 2, 5, 10, fps / 2, fps, 2 * fps, 5 * fps, 10 * fps, 15 * fps, 30 * fps, 60 * fps, 120 * fps, 300 * fps, 600 * fps];
  return steps.find((s) => s * ppf >= 90 && Number.isInteger(s)) ?? 600 * fps;
}

function Ruler({ ppf, view, contentW }: { ppf: number; view: { left: number; width: number }; contentW: number }) {
  const ed = useEd();
  const fps = ed.project.sequence.fps;
  const step = tickStep(ppf, fps);
  const minor = step / 5 >= 1 && (step / 5) * ppf >= 10 ? step / 5 : step / 2 >= 1 && (step / 2) * ppf >= 10 ? step / 2 : 0;
  const first = Math.floor(view.left / ppf / step) * step;
  const last = (view.left + view.width + 200) / ppf;
  const ticks: ReactNode[] = [];
  for (let f = first; f <= last; f += step) {
    ticks.push(<span key={f} className="tl-tick mono" style={{ left: f * ppf }}>{step < fps ? timecode(f, fps).slice(3) : timecode(f, fps).slice(0, 8)}</span>);
    if (minor) for (let g = f + minor; g < f + step; g += minor) ticks.push(<span key={"m" + g} className="tl-tick tl-tick--minor" style={{ left: g * ppf }} />);
  }
  const scrub = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".tl-marker")) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    ed.player.current?.pause();
    const at = (x: number) => ed.seek(Math.round((x - el.getBoundingClientRect().left) / ppf));
    at(e.clientX);
    const move = (ev: PointerEvent) => at(ev.clientX);
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  const { in: i, out: o } = ed.inOut;
  return (
    <div className="tl-ruler" style={{ width: contentW }} onPointerDown={scrub}>
      {ticks}
      {i !== null && <span className="tl-io tl-io--in" style={{ left: i * ppf }} />}
      {o !== null && <span className="tl-io tl-io--out" style={{ left: o * ppf }} />}
      {ed.project.markers.map((m) => (
        <button key={m.id} className="tl-marker" style={{ left: m.frame * ppf }} aria-label={`Penanda ${timecode(m.frame, fps)}${m.label ? ": " + m.label : ""}`}
          title={`${m.label || "Penanda"} · ${timecode(m.frame, fps)}\nKlik untuk lompat · Alt+klik untuk hapus`}
          onClick={(e) => (e.altKey ? ed.op({ type: "removeMarker", id: m.id }) : ed.seek(m.frame))} />
      ))}
    </div>
  );
}

function Playhead({ ppf, scrollRef, viewWidth }: { ppf: number; scrollRef: React.RefObject<HTMLDivElement | null>; viewWidth: number }) {
  const ed = useEd();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => {
      const x = ed.playhead.get() * ppf;
      if (ref.current) ref.current.style.transform = `translateX(${HEAD_W + x}px)`;
      const sc = scrollRef.current;
      // Saat diputar, timeline ikut berpindah halaman supaya playhead tetap terlihat.
      if (sc && ed.playing.get() && (x > sc.scrollLeft + viewWidth - 24 || x < sc.scrollLeft)) sc.scrollLeft = Math.max(0, x - 48);
    };
    update();
    return ed.playhead.sub(update);
  }, [ed.playhead, ed.playing, ppf, scrollRef, viewWidth]);
  return <div className="tl-playhead" ref={ref} aria-hidden="true"><span className="tl-playhead__cap" /></div>;
}

function TrackHead({ t, h, onResize }: { t: Track; h: number; onResize: (e: RPointerEvent<HTMLDivElement>) => void }) {
  const ed = useEd();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(t.name);
  const toggle = (key: "locked" | "hidden" | "muted" | "solo") => ed.op({ type: "updateTrack", trackId: t.id, changes: { [key]: !t[key] } });
  const commit = () => {
    setEditing(false);
    if (name.trim() && name.trim() !== t.name) ed.op({ type: "updateTrack", trackId: t.id, changes: { name: name.trim() } });
  };
  return (
    <div className={`tl-head tl-head--${t.kind}` + (h < 34 ? " is-compact" : "")} style={{ height: h }}>
      {editing ? (
        <input className="tl-head__rename" autoFocus value={name} maxLength={60} aria-label="Nama jalur"
          onChange={(e) => setName(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditing(false); }} />
      ) : (
        <button className="tl-head__name" title="Klik dua kali untuk mengganti nama" onDoubleClick={() => { setName(t.name); setEditing(true); }}>{trackName(t)}</button>
      )}
      <div className="tl-head__toggles">
        <Toggle on={t.locked} icon={t.locked ? "lock" : "unlock"} label={t.locked ? "Buka kunci" : "Kunci"} name={trackName(t)} onClick={() => toggle("locked")} />
        {t.kind === "audio" ? (
          <>
            <Toggle on={!!t.muted} icon={t.muted ? "mute" : "sound"} label={t.muted ? "Bunyikan" : "Bisukan"} name={trackName(t)} onClick={() => toggle("muted")} />
            <button className={"btn btn--icon btn--sm solo" + (t.solo ? " is-on" : "")} aria-pressed={!!t.solo} onClick={() => toggle("solo")}
              aria-label={`Dengar jalur ${trackName(t)} saja`} title="Dengar jalur ini saja">S</button>
          </>
        ) : (
          <Toggle on={t.hidden} icon={t.hidden ? "eyeOff" : "eye"} label={t.hidden ? "Tampilkan" : "Sembunyikan"} name={trackName(t)} onClick={() => toggle("hidden")} />
        )}
      </div>
      <div className="tl-head__resize" onPointerDown={onResize} aria-hidden="true" title="Seret untuk mengubah tinggi track" />
    </div>
  );
}

function Toggle({ on, icon, label, name, onClick }: { on: boolean; icon: IconName; label: string; name: string; onClick: () => void }) {
  return (
    <button className={"btn btn--icon btn--sm" + (on ? " is-on" : "")} aria-pressed={on} onClick={onClick} aria-label={`${label} jalur ${name}`} title={label}>
      <Icon name={icon} />
    </button>
  );
}

const ClipView = memo(function ClipView({ c, m, job, kind, ppf, fps, h, selected, ghost }: {
  c: Clip; m?: Media; job?: JobStatus; kind: TrackKind; ppf: number; fps: number; h: number; selected: boolean; ghost: boolean;
}) {
  const len = clipLen(c, fps);
  const w = len * ppf;
  const stage = job?.stage;
  return (
    <div data-clip={c.id}
      className={`clip clip--${kind}` + (selected ? " is-selected" : "") + (c.enabled ? "" : " is-disabled") + (ghost ? " is-ghost" : "")}
      style={{ left: c.start * ppf, width: Math.max(2, w) }}>
      {m && kind === "video" && (stage === "waveform" || stage === "siap") && w > 8 && <Strip c={c} m={m} ppf={ppf} fps={fps} w={w} h={h - 2} />}
      {m && kind === "audio" && stage === "siap" && w > 4 && <Wave c={c} m={m} w={w} h={h - 2} />}
      {kind === "audio" && c.fadeIn > 0 && <span className="clip__fade clip__fade--in" style={{ width: c.fadeIn * ppf }} />}
      {kind === "audio" && c.fadeOut > 0 && <span className="clip__fade clip__fade--out" style={{ width: c.fadeOut * ppf }} />}
      {w > 36 && (
        <span className="clip__label">
          {m?.name ?? "File hilang"}
          {c.gainDb !== 0 && kind === "audio" && <span className="clip__gain mono">{c.gainDb > 0 ? "+" : ""}{c.gainDb} dB</span>}
        </span>
      )}
    </div>
  );
});

function Strip({ c, m, ppf, fps, w, h }: { c: Clip; m: Media; ppf: number; fps: number; w: number; h: number }) {
  const t = thumbPlan(m);
  const tw = (t.tileW * h) / t.tileH;
  const n = Math.min(200, Math.ceil(w / tw));
  const url = `url(${mediaUrl(m.id, "thumbs")})`;
  return (
    <div className="clip__strip" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const sec = c.srcIn + (i * tw) / ppf / fps;
        const idx = Math.min(t.count - 1, Math.floor(sec / t.interval));
        return <span key={i} style={{ left: i * tw, width: tw, backgroundImage: url, backgroundSize: `${t.count * tw}px ${h}px`, backgroundPosition: `${-idx * tw}px 0` }} />;
      })}
    </div>
  );
}

const peaksCache = new Map<string, Promise<Uint8Array>>();
const getPeaks = (id: string) => {
  if (!peaksCache.has(id)) peaksCache.set(id, fetch(mediaUrl(id, "peaks")).then((r) => (r.ok ? r.arrayBuffer() : new ArrayBuffer(0))).then((b) => new Uint8Array(b)));
  return peaksCache.get(id)!;
};

function Wave({ c, m, w, h }: { c: Clip; m: Media; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cw = Math.min(4096, Math.max(1, Math.round(w)));
  useEffect(() => {
    let live = true;
    getPeaks(m.id).then((peaks) => {
      const cv = ref.current;
      if (!live || !cv || !peaks.length) return;
      const g = cv.getContext("2d")!;
      const ch = Math.max(1, Math.round(h));
      cv.width = cw; cv.height = ch;
      g.clearRect(0, 0, cw, ch);
      g.fillStyle = "rgba(255, 214, 170, 0.75)";
      const perSec = peaks.length / m.duration;
      for (let x = 0; x < cw; x++) {
        const a = Math.floor((c.srcIn + ((c.srcOut - c.srcIn) * x) / cw) * perSec);
        const b = Math.max(a + 1, Math.floor((c.srcIn + ((c.srcOut - c.srcIn) * (x + 1)) / cw) * perSec));
        let v = 0;
        for (let k = a; k < b && k < peaks.length; k++) if (peaks[k] > v) v = peaks[k];
        const bar = Math.max(1, (v / 255) * (ch - 4));
        g.fillRect(x, (ch - bar) / 2, 1, bar);
      }
    });
    return () => { live = false; };
  }, [m.id, m.duration, c.srcIn, c.srcOut, cw, h]);
  return <canvas ref={ref} className="clip__wave" aria-hidden="true" />;
}

/** Nama jalur bawaan dari proyek lama ditampilkan dengan istilah sehari-hari. */
const OLD_NAMES: Record<string, string> = { Scene: "Bagian", Aset: "Elemen", Caption: "Subtitle", Footage: "Video", SFX: "Efek suara" };
const trackName = (t: Track) => OLD_NAMES[t.name] ?? t.name;

export const toolForKey = (key: string): Tool | null => TOOLS.find((t) => t.key.toLowerCase() === key)?.id ?? null;

/** Scene, aset, caption, dan wilayah potongan pada satu lane. */
function Items({ t, p, ppf }: { t: Track; p: Project; ppf: number }) {
  const ed = useEd();
  const sel = (id: string) => (ed.selection.has(id) ? " is-selected" : "");
  const names = new Map((ed.lib?.assets ?? []).map((d) => [d.id, d.name]));
  if (t.kind === "scene") {
    return <>{p.scenes.map((s, i) => (
      <div key={s.id} data-item={s.id} className={"item item--scene" + sel(s.id) + (s.status === "dikunci" ? " is-locked" : "")}
        style={{ left: s.start * ppf, width: Math.max(2, (s.end - s.start) * ppf), "--beat": beatColor(s.beat || "x") } as React.CSSProperties}
        title={`${i + 1}. ${s.title}${s.beat ? ` · ${s.beat}` : ""}\nSeret tepinya untuk menggeser batas bagian`}>
        {(s.end - s.start) * ppf > 40 && <span className="item__label">{i + 1}. {s.title}</span>}
      </div>
    ))}</>;
  }
  if (t.kind === "caption") {
    return <>{p.captions.filter((c) => c.trackId === t.id).map((c) => (
      <div key={c.id} data-item={c.id} className={"item item--caption" + sel(c.id)} style={{ left: c.start * ppf, width: Math.max(2, (c.end - c.start) * ppf) }}
        title={c.words.map((w) => w.text).join(" ")}>
        {c.words.map((w, i) => ((w.end - w.start) * ppf > 12 ? (
          <span key={i} data-word={i} className={"word-box" + (w.style !== "normal" ? ` word-box--${w.style}` : "")}
            style={{ left: (w.start - c.start) * ppf, width: (w.end - w.start) * ppf }}>{(w.end - w.start) * ppf > 26 ? w.text : ""}</span>
        ) : null))}
      </div>
    ))}</>;
  }
  if (t.kind === "video") {
    const cuts = t.id === "V1" ? p.cuts.filter((c) => c.state !== "applied") : [];
    return <>
      {p.assets.filter((a) => a.trackId === t.id).map((a) => (
        <div key={a.id} data-item={a.id} className={"item item--asset" + sel(a.id) + (a.hidden ? " is-off" : "") + (a.locked ? " is-locked" : "")}
          style={{ left: a.start * ppf, width: Math.max(2, a.duration * ppf) }} title={a.defId ? names.get(a.defId) ?? "Elemen" : "Teks bebas"}>
          {a.duration * ppf > 36 && <span className="item__label">{a.defId ? names.get(a.defId) ?? "Elemen" : String(a.params.text ?? "Teks")}</span>}
        </div>
      ))}
      {cuts.map((c) => {
        const s = srcToSeq(p, c.mediaId, c.srcStart), e = srcToSeq(p, c.mediaId, Math.max(c.srcStart, c.srcEnd - 0.001));
        if (s === null || e === null) return null;
        return <div key={c.id} className={`cutmark cutmark--${c.kind === "jeda" ? "red" : "yellow"}` + (c.state === "rejected" ? " is-off" : "")}
          style={{ left: s * ppf, width: Math.max(2, (e - s + 1) * ppf) }} title={c.reason ?? "Jeda tanpa suara"} />;
      })}
    </>;
  }
  return null;
}

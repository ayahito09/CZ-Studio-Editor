import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import type { PlayerRef } from "@remotion/player";
import { clipEnd, type NewClip, type Op, type Project } from "@cz/core";
import { api, type Library, type SessionState, type State } from "./api.ts";
import type { Run } from "./App.tsx";
import { AssetsPanel } from "./AssetsPanel.tsx";
import { ClaudePanel, ClaudePill } from "./ClaudePanel.tsx";
import { CutsPanel } from "./CutsPanel.tsx";
import { EdContext, itemKind, MODES, useEd, type Ed, type InOut, type Mode, type Tool } from "./ed.ts";
import { PlanPanel, SceneList } from "./PlanPanel.tsx";
import { RenderPanel, RenderSummary } from "./RenderPanel.tsx";
import { SettingsDialog } from "./SettingsDialog.tsx";
import { Icon } from "./icons.tsx";
import { Inspector } from "./Inspector.tsx";
import { MediaPanel, useUploader } from "./MediaPanel.tsx";
import { PreviewPlayer } from "./Player.tsx";
import { createStore, loadLocal, saveLocal } from "./store.ts";
import { Timeline, toolForKey } from "./Timeline.tsx";
import { Shortcuts } from "./Shortcuts.tsx";

const LAYOUT_KEY = "cz.layout";
const DEFAULT_LAYOUT = { left: 264, right: 288, timeline: 300 };

export function Editor({ s, g, run }: { s: SessionState; g: State; run: Run }) {
  const project = s.project;
  const [mode, setModeState] = useState<Mode>(() => loadLocal("cz.mode", { m: "media" as Mode }).m);
  const setMode = (m: Mode) => { setModeState(m); saveLocal("cz.mode", { m }); };
  const [lib, setLib] = useState<Library | null>(null);
  const [libTick, setLibTick] = useState(0);
  const [preview, setPreview] = useState<Project | null>(null);
  const [claudeOpen, setClaudeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const skillKey = project.skill ? `${project.skill.id}@${project.skill.version}` : "";
  // Pustaka skill dimuat ulang saat proyek ganti skill, atau setelah tugas Claude selesai (template bisa berubah).
  const doneTasks = s.claude.tasks.filter((t) => t.state === "selesai").length;
  useEffect(() => {
    let live = true;
    if (!skillKey) { setLib(null); return; }
    api.reloadLibrary().then(api.library).then((l) => live && setLib(l)).catch(() => live && setLib(null));
    return () => { live = false; };
  }, [skillKey, libTick, doneTasks]);
  const reloadLib = useCallback(() => setLibTick((t) => t + 1), []);
  const fps = project.sequence.fps;
  const playhead = useMemo(() => createStore(0), []);
  const playing = useMemo(() => createStore(false), []);
  const player = useRef<PlayerRef | null>(null);
  const clipboard = useRef<NewClip[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [tool, setTool] = useState<Tool>("select");
  const [snap, setSnap] = useState(true);
  const [pps, setPps] = useState(60);
  const [inOut, setInOut] = useState<InOut>({ in: null, out: null });
  const [loop, setLoop] = useState(false);
  const [layout, setLayout] = useState(() => loadLocal(LAYOUT_KEY, DEFAULT_LAYOUT));
  const [dropping, setDropping] = useState(false);
  const [help, setHelp] = useState(false);

  const itemIds = useMemo(() => new Set([...project.clips, ...project.assets, ...project.captions, ...project.scenes].map((x) => x.id)), [project]);
  const ed: Ed = {
    s, g, project, run, mode, setMode, lib, reloadLib, preview, setPreview, claudeOpen, setClaudeOpen,
    op: (op: Op) => run(() => api.op(op)),
    playhead, playing, player,
    seek: (f) => {
      const frame = Math.max(0, Math.min(Math.max(0, project.sequence.durationFrames - 1), Math.round(f)));
      player.current?.seekTo(frame);
      playhead.set(frame);
    },
    selection: new Set([...selection].filter((id) => itemIds.has(id))),
    select: (ids) => setSelection(new Set(ids)),
    tool, setTool, snap, setSnap, pps, setPps, inOut, setInOut, loop, setLoop, clipboard,
  };
  const edRef = useRef(ed);
  edRef.current = ed;
  const uploader = useUploader(run);

  useEffect(() => { saveLocal(LAYOUT_KEY, layout); }, [layout]);

  // Pintasan mengikuti Premiere (SPEC: Timeline lengkap > Pintasan).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || e.defaultPrevented) return;
      const ed = edRef.current;
      const p = ed.project;
      const f = ed.playhead.get();
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      const all = [...ed.selection];
      const sel = all.filter((id) => itemKind(id) === "clip");
      const assetSel = all.filter((id) => itemKind(id) === "asset");
      const capSel = all.filter((id) => itemKind(id) === "caption");
      const unlocked = new Set(p.tracks.filter((x) => !x.locked).map((x) => x.id));
      const handled = () => { e.preventDefault(); e.stopPropagation(); };
      const underPlayhead = () => {
        // Satu klip per grup link supaya trim tidak diterapkan dua kali.
        const seen = new Set<string>();
        return p.clips.filter((c) => unlocked.has(c.trackId) && c.start < f && clipEnd(c, fps) > f && (!c.linkId || !seen.has(c.linkId)) && (c.linkId ? seen.add(c.linkId) : true));
      };

      // Lapisan aset: Ctrl+[ / Ctrl+].
      if (mod && (k === "[" || k === "]") && assetSel.length === 1) { handled(); ed.op({ type: "reorderAsset", id: assetSel[0], dir: k === "]" ? 1 : -1 }); return; }
      if (mod && k === "k") { handled(); ed.op({ type: "split", frame: f, clipIds: sel.length ? sel : undefined }); return; }
      if (mod && k === "a") { handled(); ed.select(p.clips.map((c) => c.id)); return; }
      if (mod && (k === "c" || k === "x")) {
        if (!sel.length) return;
        handled();
        const clips = p.clips.filter((c) => ed.selection.has(c.id));
        const min = Math.min(...clips.map((c) => c.start));
        clipboard.current = clips.map((c) => ({ trackId: c.trackId, mediaId: c.mediaId, srcIn: c.srcIn, srcOut: c.srcOut, start: c.start - min, link: c.linkId ?? undefined, gainDb: c.gainDb, enabled: c.enabled, fadeIn: c.fadeIn, fadeOut: c.fadeOut }));
        if (k === "x") ed.op({ type: "deleteClips", clipIds: sel, ripple: false });
        return;
      }
      if (mod && k === "v") {
        if (!clipboard.current.length) return;
        handled();
        ed.op({ type: "addClips", clips: clipboard.current.map((c) => ({ ...c, start: c.start + f })) });
        return;
      }
      if (mod && k === "l") {
        if (!sel.length) return;
        handled();
        const linked = p.clips.some((c) => ed.selection.has(c.id) && c.linkId);
        ed.op(linked ? { type: "unlink", clipIds: sel } : { type: "link", clipIds: sel });
        return;
      }
      if (mod) return; // Ctrl+Z/Y/S ditangani App

      if ((k === "delete" || k === "backspace") && (assetSel.length || capSel.length)) {
        handled();
        const ops: Op[] = [];
        if (assetSel.length) ops.push({ type: "removeAssets", ids: assetSel });
        if (capSel.length) ops.push({ type: "removeCaptions", ids: capSel });
        if (sel.length) ops.push({ type: "deleteClips", clipIds: sel, ripple: e.shiftKey });
        ed.op(ops.length === 1 ? ops[0] : { type: "batch", label: "Hapus item", ops });
        return;
      }
      if ((k === "delete" || k === "backspace") && sel.length) { handled(); ed.op({ type: "deleteClips", clipIds: sel, ripple: e.shiftKey }); return; }
      if (e.shiftKey && k === "e" && sel.length) {
        handled();
        const allOn = p.clips.filter((c) => ed.selection.has(c.id)).every((c) => c.enabled);
        ed.op({ type: "setClips", clipIds: sel, changes: { enabled: !allOn } });
        return;
      }
      if (k === "q" || k === "w") {
        const clips = underPlayhead();
        if (!clips.length) return;
        handled();
        ed.op({
          type: "batch", label: k === "q" ? "Pangkas awal sampai posisi sekarang" : "Pangkas akhir sampai posisi sekarang",
          ops: clips.map((c) => (k === "q"
            ? { type: "trimClip", clipId: c.id, edge: "in", delta: f - c.start, ripple: true }
            : { type: "trimClip", clipId: c.id, edge: "out", delta: f - clipEnd(c, fps), ripple: true })),
        });
        if (k === "q") ed.seek(Math.min(...clips.map((c) => c.start)));
        return;
      }
      if (k === ";" || k === "'") {
        const { in: i, out: o } = ed.inOut;
        if (i === null || o === null || o <= i) return;
        handled();
        ed.op({ type: "deleteRange", start: i, end: o, ripple: k === "'" });
        return;
      }
      if (k === " ") { handled(); player.current?.toggle(); return; }
      if (k === "j" || k === "k" || k === "l") { handled(); dispatchEvent(new CustomEvent("cz:shuttle", { detail: k === "j" ? -1 : k === "k" ? 0 : 1 })); return; }
      // Aset terpilih di mode Edit: panah menggeser 1 px (Shift = 10 px).
      if (k.startsWith("arrow") && assetSel.length && ed.mode === "edit") {
        handled();
        const step = e.shiftKey ? 10 : 1;
        const dx = k === "arrowleft" ? -step : k === "arrowright" ? step : 0, dy = k === "arrowup" ? -step : k === "arrowdown" ? step : 0;
        const ops: Op[] = p.assets.filter((a) => assetSel.includes(a.id) && !a.locked).map((a) => ({ type: "updateAsset", id: a.id, changes: { transform: { x: a.transform.x + dx, y: a.transform.y + dy } } }));
        if (ops.length) ed.op(ops.length === 1 ? ops[0] : { type: "batch", label: "Geser elemen", ops });
        return;
      }
      if (k === "arrowleft" || k === "arrowright") { handled(); player.current?.pause(); ed.seek(f + (k === "arrowleft" ? -1 : 1) * (e.shiftKey ? 5 : 1)); return; }
      if (k === "arrowup" || k === "arrowdown") {
        handled();
        const edits = [...new Set(p.clips.flatMap((c) => [c.start, clipEnd(c, fps)]))].sort((a, b) => a - b);
        const next = k === "arrowdown" ? edits.find((x) => x > f) : [...edits].reverse().find((x) => x < f);
        if (next !== undefined) ed.seek(next);
        return;
      }
      if (k === "home") { handled(); ed.seek(0); return; }
      if (k === "end") { handled(); ed.seek(p.sequence.durationFrames - 1); return; }
      if (k === "i") { handled(); ed.setInOut(e.altKey ? { ...ed.inOut, in: null } : { ...ed.inOut, in: f }); return; }
      if (k === "o") { handled(); ed.setInOut(e.altKey ? { ...ed.inOut, out: null } : { ...ed.inOut, out: f + 1 }); return; }
      if (k === "m") { handled(); ed.op({ type: "addMarker", frame: f }); return; }
      if (k === "s") { handled(); ed.setSnap(!ed.snap); return; }
      if (k === "=" || k === "+") { handled(); dispatchEvent(new CustomEvent("cz:zoom", { detail: "in" })); return; }
      if (k === "-") { handled(); dispatchEvent(new CustomEvent("cz:zoom", { detail: "out" })); return; }
      if (k === "\\") { handled(); dispatchEvent(new CustomEvent("cz:zoom", { detail: "fit" })); return; }
      if (k === "escape") { ed.select([]); return; }
      if (k === "?") { handled(); setHelp((h) => !h); return; }
      const tl = toolForKey(k);
      if (tl) { handled(); ed.setTool(tl); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [fps]);

  // Seret file video dari Explorer ke mana pun di editor.
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  const style = { "--left-w": `${layout.left}px`, "--right-w": `${layout.right}px`, "--tl-h": `${layout.timeline}px` } as CSSProperties;

  const splitter = (key: "left" | "right" | "timeline", sign: 1 | -1, min: number, max: number) => (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const start = key === "timeline" ? e.clientY : e.clientX;
    const v0 = layout[key];
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    el.classList.add("is-dragging");
    const move = (ev: PointerEvent) => {
      const pos = key === "timeline" ? ev.clientY : ev.clientX;
      setLayout((l) => ({ ...l, [key]: Math.min(max, Math.max(min, v0 + sign * (pos - start))) }));
    };
    const up = () => { el.classList.remove("is-dragging"); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <EdContext.Provider value={ed}>
      <div className="editor" style={style}
        onDragEnter={(e) => hasFiles(e) && setDropping(true)}
        onDragOver={(e) => {
          if (!hasFiles(e)) return;
          // Di atas area gaya edit, file ditangani panel itu; jangan tampilkan ajakan impor video.
          const skillArea = !!(e.target as HTMLElement).closest("[data-skill-drop]");
          setDropping(!skillArea);
          if (!skillArea) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }
        }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false); }}
        onDrop={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setDropping(false);
          uploader.start([...e.dataTransfer.files]);
        }}>
        <TopBar onHelp={() => setHelp(true)} onSettings={() => setSettingsOpen(true)} />
        {mode === "media" && <MediaPanel uploader={uploader} />}
        {mode === "edit" && <AssetsPanel />}
        {mode === "plan" && <SceneList />}
        {mode === "render" && <RenderSummary />}
        <div className="split split--v split--left" onPointerDown={splitter("left", 1, 200, 480)} role="separator" aria-orientation="vertical" aria-label="Ubah lebar panel kiri" />
        <PreviewPlayer />
        <div className="split split--v split--right" onPointerDown={splitter("right", -1, 240, 460)} role="separator" aria-orientation="vertical" aria-label="Ubah lebar panel kanan" />
        {mode === "media" && <CutsPanel />}
        {mode === "edit" && <Inspector />}
        {mode === "plan" && <PlanPanel />}
        {mode === "render" && <RenderPanel />}
        {claudeOpen && <ClaudePanel />}
        <AutoCard />
        <div className="split split--h" onPointerDown={splitter("timeline", -1, 180, 640)} role="separator" aria-orientation="horizontal" aria-label="Ubah tinggi linimasa" />
        <Timeline />
        {dropping && (
          <div className="dropzone" aria-hidden="true">
            <div className="dropzone__card"><Icon name="upload" /><strong>Lepas untuk mengimpor</strong><span>Video disalin ke folder proyek, lalu ditaruh di akhir linimasa</span></div>
          </div>
        )}
        {help && <Shortcuts onClose={() => setHelp(false)} />}
        {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      </div>
    </EdContext.Provider>
  );
}

/** Kemajuan rapikan otomatis setelah proyek dibuat. Bisa ditutup setelah selesai. */
function AutoCard() {
  const ed = useEd();
  const auto = ed.s.auto;
  const [closed, setClosed] = useState(false);
  useEffect(() => { if (auto?.running) setClosed(false); }, [auto?.running]);
  if (!auto || closed) return null;
  const MARK: Record<string, string> = { selesai: "✓", dilewati: "–", gagal: "!", menunggu: "", berjalan: "" };
  return (
    <aside className="autocard" aria-live="polite" aria-label="Rapikan otomatis">
      <div className="autocard__head">
        <strong>{auto.running ? "Merapikan video…" : "Rapikan otomatis selesai"}</strong>
        {!auto.running && <button className="btn btn--icon btn--sm" onClick={() => setClosed(true)} aria-label="Tutup"><Icon name="close" /></button>}
      </div>
      <ol>
        {auto.steps.map((st) => (
          <li key={st.id} className={`is-${st.state}`}>
            <span className="autocard__mark" aria-hidden="true">{st.state === "berjalan" ? <span className="spinner" /> : MARK[st.state]}</span>
            <span>{st.label}</span>
            {st.note && <small>{st.note}</small>}
          </li>
        ))}
      </ol>
      {!auto.running && auto.steps.some((x) => x.note === "Claude belum terhubung") && (
        <button className="btn btn--sm-text" onClick={() => ed.setClaudeOpen(true)}>Hubungkan Claude</button>
      )}
    </aside>
  );
}

function TopBar({ onHelp, onSettings }: { onHelp: () => void; onSettings: () => void }) {
  const ed = useEd();
  const s = ed.s;
  const [title, setTitle] = useState(s.project.title);
  useEffect(() => setTitle(s.project.title), [s.project.title]);
  const commit = () => {
    if (title.trim() && title.trim() !== s.project.title) ed.op({ type: "setTitle", title });
    else setTitle(s.project.title);
  };
  const busy = Object.values(s.jobs).filter((j) => j.stage !== "siap" && j.stage !== "gagal").length;

  return (
    <header className="topbar">
      <button className="btn btn--icon" onClick={() => ed.run(api.close)} aria-label="Kembali ke beranda" title="Beranda">
        <Icon name="home" />
      </button>
      <span className="mark" aria-hidden="true">CZ</span>
      <input className="title-input" aria-label="Judul proyek" value={title} maxLength={200}
        onChange={(e) => setTitle(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setTitle(s.project.title); e.currentTarget.blur(); } }} />
      <div className="modes" role="tablist" aria-label="Mode">
        {MODES.map((m) => (
          <button key={m.id} role="tab" aria-selected={ed.mode === m.id} className={"modes__btn" + (ed.mode === m.id ? " is-on" : "")} onClick={() => ed.setMode(m.id)}>{m.label}</button>
        ))}
      </div>
      <div className="topbar__spacer" />
      <ClaudePill />
      {ed.g.setup?.running && (() => {
        const cur = ed.g.setup.steps.find((x) => x.state === "mengunduh" || x.state === "memeriksa");
        return <span className="chip chip--busy" title="Alat ini dipasang sekali saja"><span className="spinner" aria-hidden="true" />Menyiapkan {cur?.label.split(" (")[0].toLowerCase() ?? "alat"}{cur?.state === "mengunduh" ? ` ${Math.round(cur.progress * 100)}%` : ""}</span>;
      })()}
      {busy > 0 && <span className="chip chip--busy"><span className="spinner" aria-hidden="true" />Menyiapkan {busy} video</span>}
      <div className="history" role="group" aria-label="Riwayat">
        <button className="btn btn--icon" disabled={!s.undo} onClick={() => ed.run(api.undo)}
          aria-label={s.undo ? `Batalkan: ${s.undo}` : "Batalkan"} data-tip={s.undo ? `Batalkan: ${s.undo} · Ctrl+Z` : "Tidak ada yang dibatalkan"}>
          <Icon name="undo" />
        </button>
        <button className="btn btn--icon" disabled={!s.redo} onClick={() => ed.run(api.redo)}
          aria-label={s.redo ? `Ulangi: ${s.redo}` : "Ulangi"} data-tip={s.redo ? `Ulangi: ${s.redo} · Ctrl+Shift+Z` : "Tidak ada yang diulang"}>
          <Icon name="redo" />
        </button>
      </div>
      <button className="btn btn--icon" onClick={onHelp} aria-label="Pintasan keyboard" data-tip="Pintasan · ?"><Icon name="keyboard" /></button>
      <button className="btn btn--icon" onClick={onSettings} aria-label="Pengaturan" data-tip="Pengaturan"><Icon name="settings" /></button>
      <button className={"save " + (s.dirty ? "save--dirty" : "")} onClick={() => ed.run(api.save)} data-tip="Simpan sekarang (Ctrl+S). Proyek juga tersimpan sendiri tiap 30 detik.">
        <span className="save__dot" aria-hidden="true" />
        {s.dirty ? "Belum disimpan" : "Tersimpan"}
      </button>
    </header>
  );
}


import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Player } from "@remotion/player";
import { CzComposition } from "@cz/composition";
import { mediaUrl } from "./api.ts";
import { useEd } from "./ed.ts";
import { Icon } from "./icons.tsx";
import { Overlay } from "./Overlay.tsx";
import { SkillOverlay } from "./SkillOverlay.tsx";
import { timecode, useStore } from "./store.ts";

const PROXY_READY = new Set(["thumbnail", "waveform", "siap"]);

export function PreviewPlayer() {
  const ed = useEd();
  const { s } = ed;
  // Pratinjau sementara (Putar dengan potongan, seret aset) memakai proyek hasil op di browser.
  const project = ed.preview ?? ed.project;
  const { width, height, fps, durationFrames } = project.sequence;
  const frameRef = useRef<HTMLDivElement>(null);
  const [rate, setRate] = useState(1);
  const [safe, setSafe] = useState(true);

  // Pratinjau memakai proxy 720p; render (F8) memakai file asli lewat komposisi yang sama.
  const readyKey = project.media.filter((m) => PROXY_READY.has(s.jobs[m.id]?.stage)).map((m) => m.id).join(",");
  const src = useMemo(() => Object.fromEntries(readyKey.split(",").filter(Boolean).map((id) => [id, mediaUrl(id, "proxy")])), [readyKey]);
  const lib = useMemo(() => (ed.lib ? { template: ed.lib.template, assets: ed.lib.assets, base: ed.lib.base, component: ed.lib.component, media: ed.lib.media } : null), [ed.lib]);
  const builtinSfx = useMemo(() => ({ base: "/api/builtin/", roles: ed.builtinSfx }), [ed.builtinSfx]);
  const inputProps = useMemo(() => ({ project, src, lib, output: { width, height }, subjects: ed.subjects, builtinSfx, packs: ed.packs }), [project, src, lib, width, height, ed.subjects, builtinSfx, ed.packs]);

  useEffect(() => {
    const p = ed.player.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => ed.playhead.set(e.detail.frame);
    const onPlay = () => ed.playing.set(true);
    const onPause = () => { ed.playing.set(false); setRate(1); };
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    return () => { p.removeEventListener("frameupdate", onFrame); p.removeEventListener("play", onPlay); p.removeEventListener("pause", onPause); };
  }, [ed.player, ed.playhead, ed.playing]);

  // J/K/L dari Editor mengirim event ini.
  useEffect(() => {
    const onShuttle = (e: Event) => {
      const dir = (e as CustomEvent<number>).detail;
      const p = ed.player.current;
      if (!p) return;
      if (dir === 0) { p.pause(); return; }
      const playing = p.isPlaying();
      const next = playing && Math.sign(rate) === dir ? Math.min(4, Math.abs(rate) * 2) * dir : dir;
      setRate(next);
      if (!playing) p.play();
    };
    addEventListener("cz:shuttle", onShuttle);
    return () => removeEventListener("cz:shuttle", onShuttle);
  }, [ed.player, rate]);

  const vertical = width * 16 === height * 9;
  const safeBox: CSSProperties = { top: `${(220 / 1920) * 100}%`, bottom: `${(400 / 1920) * 100}%`, left: `${(80 / 1080) * 100}%`, right: `${(80 / 1080) * 100}%` };
  const loopRange = ed.loop && ed.inOut.in !== null && ed.inOut.out !== null && ed.inOut.out > ed.inOut.in;
  const total = Math.max(1, durationFrames);

  return (
    <section className="player" aria-label="Pratinjau">
      <div className="player__stage">
        <span className="player__spec mono" aria-hidden="true">{width}×{height} · {fps} fps</span>
        <div className="player__frame" ref={frameRef} style={{ "--w": width, "--h": height } as CSSProperties}>
          <Player
            ref={ed.player}
            component={CzComposition}
            inputProps={inputProps}
            durationInFrames={total}
            compositionWidth={width}
            compositionHeight={height}
            fps={fps}
            playbackRate={rate}
            loop={ed.loop}
            inFrame={loopRange ? ed.inOut.in : null}
            outFrame={loopRange ? Math.min(total - 1, ed.inOut.out!) : null}
            clickToPlay={false}
            doubleClickToFullscreen
            style={{ width: "100%", height: "100%" }}
          />
          {vertical && safe && <div className="player__safe" style={safeBox} aria-hidden="true" />}
          {project.clips.length === 0 && <p className="player__empty">Seret video ke sini untuk mulai</p>}
          {(ed.mode === "edit" || ed.mode === "plan") && <Overlay frameRef={frameRef} />}
          {(ed.mode === "edit" || ed.mode === "plan") && ed.lib?.component && <SkillOverlay frameRef={frameRef} />}
          {ed.preview && ed.mode === "media" && <span className="player__badge">Pratinjau dengan potongan</span>}
        </div>
      </div>
      <Transport total={total} rate={rate} safe={safe} setSafe={setSafe} vertical={vertical} />
    </section>
  );
}

function Transport({ total, rate, safe, setSafe, vertical }: { total: number; rate: number; safe: boolean; setSafe: (v: boolean) => void; vertical: boolean }) {
  const ed = useEd();
  const frame = useStore(ed.playhead);
  const playing = useStore(ed.playing);
  const { fps, width, height } = ed.project.sequence;
  const step = (d: number) => { ed.player.current?.pause(); ed.seek(frame + d); };
  return (
    <div className="transport">
      <div className="transport__time mono">
        <span className="tc">{timecode(frame, fps)}</span>
        <span className="muted">/ {timecode(total, fps)}</span>
      </div>
      <div className="transport__controls" role="group" aria-label="Pemutaran">
        <button className="btn btn--icon" onClick={() => ed.seek(0)} aria-label="Ke awal" title="Ke awal (Home)"><Icon name="toStart" /></button>
        <button className="btn btn--icon" onClick={() => step(-1)} aria-label="Mundur sedikit" title="Mundur satu gambar (←)"><Icon name="stepBack" /></button>
        <button className="btn btn--play" onClick={() => ed.player.current?.toggle()} aria-label={playing ? "Jeda" : "Putar"} title="Putar / jeda (Spasi)">
          <Icon name={playing ? "pause" : "play"} />
        </button>
        <button className="btn btn--icon" onClick={() => step(1)} aria-label="Maju sedikit" title="Maju satu gambar (→)"><Icon name="stepFwd" /></button>
        <button className="btn btn--icon" onClick={() => ed.seek(total - 1)} aria-label="Ke akhir" title="Ke akhir (End)"><Icon name="toEnd" /></button>
      </div>
      <div className="transport__right">
        {rate !== 1 && <span className="chip mono">{rate}×</span>}
        <button className={"btn btn--icon" + (ed.loop ? " is-on" : "")} aria-pressed={ed.loop} onClick={() => ed.setLoop(!ed.loop)}
          title={ed.inOut.in !== null && ed.inOut.out !== null ? "Putar berulang di bagian bertanda" : "Putar berulang"} aria-label="Putar berulang">
          <Icon name="loop" />
        </button>
        {vertical && (
          <button className={"btn btn--icon" + (safe ? " is-on" : "")} aria-pressed={safe} onClick={() => setSafe(!safe)} title="Tampilkan batas aman (tidak tertutup tombol aplikasi media sosial)" aria-label="Batas aman">
            <Icon name="safe" />
          </button>
        )}
      </div>
    </div>
  );
}

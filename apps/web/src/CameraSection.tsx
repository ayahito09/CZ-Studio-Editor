// Kamera & gerak untuk klip terpilih: ubah per bagian yang tertimpa klip, manual (gaya + kekuatan), otomatis dari isi (mesin CZ), atau lewat Claude.
import { useState } from "react";
import type { Clip, CameraMove, Scene, SceneCamera } from "@cz/core";
import { clipLen } from "@cz/core";
import { api } from "./api.ts";
import { useClaudeAction } from "./ClaudePanel.tsx";
import { useEd } from "./ed.ts";
import { Icon } from "./icons.tsx";

type Style = "diam" | "dorong" | "geser" | "dalam";
const STYLES: { id: Style; label: string; hint: string }[] = [
  { id: "diam", label: "Diam", hint: "Tanpa gerak kamera" },
  { id: "dorong", label: "Dorong", hint: "Mendekat pelan ke wajah, lalu kembali" },
  { id: "geser", label: "Geser", hint: "Menyisir ke samping, lalu kembali" },
  { id: "dalam", label: "Dalam", hint: "Dorong lebih dekat, lalu kembali" },
];

/** Satu gerak masuk-tahan-keluar di tengah bagian; kekuatan = tambahan zoom (0.03-0.2). */
function cameraFor(style: Style, strength: number, frames: number, fps: number): SceneCamera {
  if (style === "diam") return { moves: [], drift: false };
  const inD = Math.round(0.8 * fps), outD = Math.round(0.8 * fps);
  const hold = Math.max(0, Math.round(frames * 0.35) - inD);
  const at = Math.max(Math.round(0.4 * fps), Math.round(frames * 0.2));
  if (at + inD + hold + outD > frames - Math.round(0.3 * fps)) return { moves: [], drift: true }; // bagian terlalu pendek
  const m: CameraMove = { at, dur: inD, hold, out: outD, ease: "move", zoom: style === "dalam" ? 1 + strength * 1.6 : 1 + strength };
  if (style === "geser") { m.zoom = 1 + strength * 0.6; m.x = 28; }
  return { moves: [m], drift: true };
}

export function CameraSection({ clips }: { clips: Clip[] }) {
  const ed = useEd();
  const claude = useClaudeAction();
  const p = ed.project;
  const fps = p.sequence.fps;
  const [style, setStyle] = useState<Style>("dorong");
  const [strength, setStrength] = useState(0.08);
  const ranges = clips.map((c) => [c.start, c.start + clipLen(c, fps)] as const);
  const scenes = p.scenes.filter((s) => ranges.some(([a, b]) => s.start < b && s.end > a));
  const own = scenes.filter((s) => !s.skill && s.status !== "dikunci");
  const skillOnly = scenes.length > 0 && !own.length && scenes.some((s) => s.skill);

  const apply = () => {
    const ops = own.map((s: Scene) => ({ type: "updateScene" as const, id: s.id, changes: { camera: cameraFor(style, strength, s.end - s.start, fps) } }));
    if (ops.length) void ed.op({ type: "batch", label: "Atur kamera", ops });
  };

  return (
    <div className="group camsec">
      <span className="group__label">Kamera & gerak</span>
      {!scenes.length ? (
        <p className="hint">Klip ini belum masuk bagian. Buat rencana di tahap Rencana.</p>
      ) : skillOnly ? (
        <p className="hint">Bagian ini digambar skill, kameranya diatur di tab Atur bagian itu.</p>
      ) : (
        <>
          <p className="hint">{own.length} bagian: {own.map((s) => s.title).join(", ").slice(0, 60)}</p>
          <div className="segs" role="radiogroup" aria-label="Gaya gerak">
            {STYLES.map((x) => (
              <button key={x.id} type="button" role="radio" aria-checked={style === x.id} title={x.hint} className={"segs__btn" + (style === x.id ? " is-on" : "")} onClick={() => setStyle(x.id)}>{x.label}</button>
            ))}
          </div>
          {style !== "diam" && (
            <label className="field"><span>Kekuatan <b className="mono">{Math.round(strength * 100)}%</b></span>
              <input type="range" min={0.03} max={0.2} step={0.01} value={strength} onChange={(e) => setStrength(Number(e.target.value))} aria-label="Kekuatan gerak" /></label>
          )}
          <button className="btn btn--sm-text" onClick={apply}>Terapkan</button>
          <div className="elem-acts">
            <button className="btn btn--sm-text" onClick={() => ed.run(() => api.autoCamera(own.map((s) => s.id)))} title="Gerak di kata penting, condong ke wajah (mesin CZ)">Sesuaikan isi</button>
            <button className="btn btn--sm-text" title="Claude menata kamera sesuai isi dan suasana bagian ini"
              onClick={() => claude("ask", `Atur kamera dan gerak untuk bagian: ${own.map((s) => `${s.id} "${s.title}"`).join("; ")}. Mulai dari cz_auto_camera, lalu sesuaikan dengan isi ucapannya. Setiap gerak harus masuk, tahan, dan keluar.`)}>
              <Icon name="wand" />Atur dengan AI
            </button>
          </div>
        </>
      )}
    </div>
  );
}

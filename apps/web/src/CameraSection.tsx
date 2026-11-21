// Kamera & gerak untuk klip terpilih, tidak terikat rencana: kamera dasar proyek di rentang klip, manual (gaya + kekuatan) atau otomatis dari isi (mesin CZ).
// Bagian rencana yang punya kamera sendiri tetap menang di rentangnya (diatur di tahap Rencana).
import { useState } from "react";
import type { Clip, CameraMove } from "@cz/core";
import { clipLen } from "@cz/core";
import { api } from "./api.ts";
import { useEd } from "./ed.ts";

type Style = "diam" | "dorong" | "geser" | "dalam";
const STYLES: { id: Style; label: string; hint: string }[] = [
  { id: "diam", label: "Diam", hint: "Tanpa gerak kamera" },
  { id: "dorong", label: "Dorong", hint: "Mendekat pelan ke wajah, lalu kembali" },
  { id: "geser", label: "Geser", hint: "Menyisir ke samping, lalu kembali" },
  { id: "dalam", label: "Dalam", hint: "Dorong lebih dekat, lalu kembali" },
];

/** Satu gerak masuk-tahan-keluar di tengah rentang (frame relatif awal rentang); kekuatan = tambahan zoom (0.03-0.2). */
function movesFor(style: Style, strength: number, frames: number, fps: number): CameraMove[] {
  if (style === "diam") return [];
  const inD = Math.round(0.8 * fps), outD = Math.round(0.8 * fps);
  const hold = Math.max(0, Math.round(frames * 0.35) - inD);
  const at = Math.max(Math.round(0.4 * fps), Math.round(frames * 0.2));
  if (at + inD + hold + outD > frames - Math.round(0.3 * fps)) return []; // rentang terlalu pendek
  const m: CameraMove = { at, dur: inD, hold, out: outD, ease: "move", zoom: style === "dalam" ? 1 + strength * 1.6 : 1 + strength };
  if (style === "geser") { m.zoom = 1 + strength * 0.6; m.x = 28; }
  return [m];
}

export function CameraSection({ clips }: { clips: Clip[] }) {
  const ed = useEd();
  const p = ed.project;
  const fps = p.sequence.fps;
  const [style, setStyle] = useState<Style>("dorong");
  const [strength, setStrength] = useState(0.08);
  const ranges = clips.map((c) => [c.start, c.start + clipLen(c, fps)] as [number, number]);
  const inside = (f: number) => ranges.some(([a, b]) => f >= a && f < b);
  const covering = p.scenes.filter((s) => ranges.some(([a, b]) => s.start < b && s.end > a));
  const overridden = covering.filter((s) => s.skill || s.camera).length;

  const apply = () => {
    const moves = [...(p.camera?.moves ?? []).filter((m) => !inside(m.at))];
    for (const [a, b] of ranges) moves.push(...movesFor(style, strength, b - a, fps).map((m) => ({ ...m, at: m.at + a })));
    void ed.op({ type: "setCamera", camera: { ...p.camera, moves: moves.sort((x, y) => x.at - y.at), drift: p.camera?.drift ?? true } });
  };

  return (
    <div className="group camsec">
      <span className="group__label">Kamera & gerak</span>
      {overridden > 0 && <p className="hint">{overridden} bagian rencana punya kamera sendiri dan menimpa kamera ini di rentangnya.</p>}
      <div className="segs" role="radiogroup" aria-label="Gaya gerak">
        {STYLES.map((x) => (
          <button key={x.id} type="button" role="radio" aria-checked={style === x.id} title={x.hint} className={"segs__btn" + (style === x.id ? " is-on" : "")} onClick={() => setStyle(x.id)}>{x.label}</button>
        ))}
      </div>
      {style !== "diam" && (
        <label className="field"><span>Kekuatan <b className="mono">{Math.round(strength * 100)}%</b></span>
          <input type="range" min={0.03} max={0.2} step={0.01} value={strength} onChange={(e) => setStrength(Number(e.target.value))} aria-label="Kekuatan gerak" /></label>
      )}
      <div className="elem-acts">
        <button className="btn btn--sm-text" onClick={apply}>Terapkan</button>
        <button className="btn btn--sm-text" onClick={() => ed.run(() => api.autoBaseCamera(ranges))} title="Gerak di kata penting, condong ke wajah (mesin CZ)">Sesuaikan isi</button>
      </div>
    </div>
  );
}

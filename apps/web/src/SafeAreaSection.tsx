// Area aman atas/bawah untuk klip terpilih: pelindung teks berupa gradasi gelap, blur, atau kontras, dengan kekuatan dan tinggi yang bisa diatur.
import { clipLen, EDGE_MODES, safeEdgesOf, type Clip, type Edge, type EdgeMode } from "@cz/core";
import { useEd } from "./ed.ts";

export function SafeAreaSection({ clips }: { clips: Clip[] }) {
  const ed = useEd();
  const fps = ed.project.sequence.fps;
  const ranges = clips.map((c) => [c.start, c.start + clipLen(c, fps)] as const);
  const scenes = ed.project.scenes.filter((s) => s.status !== "dikunci" && ranges.some(([a, b]) => s.start < b && s.end > a));
  if (!scenes.length) return null;
  const cur = safeEdgesOf(scenes[0].custom);

  const set = (side: "top" | "bottom", changes: Partial<Edge>) => {
    const ops = scenes.map((s) => {
      const e = safeEdgesOf(s.custom);
      const safe = { ...e, [side]: { ...e[side], ...changes } };
      return { type: "updateScene" as const, id: s.id, changes: { custom: { ...s.custom, safe } } };
    });
    void ed.op({ type: "batch", label: "Atur area aman", ops });
  };

  const Side = ({ side, label }: { side: "top" | "bottom"; label: string }) => {
    const e = cur[side];
    return (
      <div className="safeside">
        <strong>{label}</strong>
        <div className="segs segs--wrap" role="radiogroup" aria-label={`Pelindung ${label.toLowerCase()}`}>
          {EDGE_MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={e.mode === m.id} className={"segs__btn" + (e.mode === m.id ? " is-on" : "")} onClick={() => set(side, { mode: m.id as EdgeMode })}>{m.label}</button>
          ))}
        </div>
        {e.mode !== "mati" && (
          <>
            <label className="field"><span>{e.mode === "blur" ? "Kekuatan blur" : e.mode === "kontras" ? "Kekuatan kontras" : e.mode === "gelap" ? "Kegelapan" : "Gelap + blur"} <b className="mono">{Math.round(e.strength * 100)}%</b></span>
              <input type="range" min={0.05} max={1} step={0.05} defaultValue={e.strength} key={side + "s" + e.strength} aria-label="Kekuatan"
                onPointerUp={(ev) => set(side, { strength: Number(ev.currentTarget.value) })} onKeyUp={(ev) => set(side, { strength: Number(ev.currentTarget.value) })} /></label>
            <label className="field"><span>Tinggi <b className="mono">{Math.round(e.size * 100)}%</b></span>
              <input type="range" min={0.05} max={0.5} step={0.01} defaultValue={e.size} key={side + "h" + e.size} aria-label="Tinggi"
                onPointerUp={(ev) => set(side, { size: Number(ev.currentTarget.value) })} onKeyUp={(ev) => set(side, { size: Number(ev.currentTarget.value) })} /></label>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="group camsec">
      <span className="group__label">Area aman</span>
      <p className="hint">Pelindung di bawah teks dan elemen, supaya terbaca di atas video.</p>
      <Side side="top" label="Atas" />
      <Side side="bottom" label="Bawah" />
    </div>
  );
}

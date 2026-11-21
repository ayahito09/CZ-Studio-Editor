// Area aman atas/bawah, tidak terikat rencana: pelindung dasar untuk seluruh video (gradasi gelap, blur, atau kontras), diatur manual atau otomatis oleh mesin CZ.
// Bagian rencana yang punya pengaturan area aman sendiri tetap menang di rentangnya.
import { EDGE_AUTO, EDGE_MODES, safeEdgesOf, type Edge, type EdgeMode } from "@cz/core";
import { useEd } from "./ed.ts";

export function SafeAreaSection() {
  const ed = useEd();
  const p = ed.project;
  const cur = safeEdgesOf({ safe: p.safe });
  const overridden = p.scenes.filter((s) => s.custom && "safe" in s.custom).length;

  const save = (safe: typeof EDGE_AUTO | null) => void ed.op({ type: "setSafe", safe });
  const set = (side: "top" | "bottom", changes: Partial<Edge>) => save({ ...cur, [side]: { ...cur[side], ...changes } });

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
      <span className="group__label">Area aman (seluruh video)</span>
      <p className="hint">Pelindung di bawah teks dan elemen, supaya terbaca di atas video.</p>
      {overridden > 0 && <p className="hint">{overridden} bagian rencana punya area aman sendiri dan menimpa pengaturan ini di rentangnya.</p>}
      <Side side="top" label="Atas" />
      <Side side="bottom" label="Bawah" />
      <div className="elem-acts">
        <button className="btn btn--sm-text" onClick={() => save(EDGE_AUTO)} title="Gelap + blur setinggi area aman 9:16 (mesin CZ)">Sesuaikan otomatis</button>
        <button className="btn btn--sm-text" onClick={() => save(null)}>Matikan</button>
      </div>
    </div>
  );
}

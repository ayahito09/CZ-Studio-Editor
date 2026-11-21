// Transisi + SFX di sambungan footage, tanpa rencana dan tanpa Claude. Mesin CZ memasangnya otomatis saat proyek dibuat/diedit;
// di sini user mengganti jenis dan bunyinya (jadi milik user, tidak ditimpa mesin) atau mengembalikannya ke mesin.
import { useState } from "react";
import { autoTransitions, setTransitionsAt, TRANSITIONS, transSfxRole, videoJoins, type BaseTransition, type Clip, type TransitionKind } from "@cz/core";
import { useEd } from "./ed.ts";

export const TRANS_LABEL: Record<TransitionKind, string> = { cut: "Potong", blur: "Blur", whip: "Sapuan", zoom: "Zoom", flash: "Kilat", collapse: "Mengecil" };
const frames = (kind: TransitionKind, fps: number) => (kind === "cut" ? 0 : Math.max(2, Math.round(0.35 * fps)));

/** Di Inspector klip: jenis transisi di awal klip terpilih, manual atau dikembalikan ke mesin. */
export function TransitionSection({ clips }: { clips: Clip[] }) {
  const ed = useEd();
  const p = ed.project;
  const fps = p.sequence.fps;
  const [kind, setKind] = useState<TransitionKind>("blur");
  const all = videoJoins(p);
  const joins = clips.map((c) => c.start).filter((f) => all.includes(f));
  if (!joins.length) return null;
  const save = (transitions: BaseTransition[]) => void ed.op({ type: "setTransitions", transitions });

  return (
    <div className="group camsec">
      <span className="group__label">Transisi masuk</span>
      <div className="segs segs--wrap" role="radiogroup" aria-label="Jenis transisi">
        {TRANSITIONS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={"segs__btn" + (kind === k ? " is-on" : "")} onClick={() => setKind(k)}>{TRANS_LABEL[k]}</button>
        ))}
      </div>
      <div className="elem-acts">
        <button className="btn btn--sm-text" onClick={() => save(setTransitionsAt(p.transitions, joins, kind, fps))}>Terapkan</button>
        <button className="btn btn--sm-text" title="Kembalikan ke pilihan mesin CZ (jenis bergilir, jarak antar-transisi minimal 2 detik)"
          onClick={() => {
            const kept = (p.transitions ?? []).filter((t) => !joins.includes(t.at));
            save([...kept, ...autoTransitions(joins, fps, kept.map((t) => t.at)).map((t) => ({ ...t, auto: true }))].sort((a, b) => a.at - b.at));
          }}>Sesuaikan otomatis</button>
      </div>
    </div>
  );
}

/** Di Inspector saat penanda transisi/SFX di timeline dipilih. */
export function FxInspector({ t }: { t: BaseTransition }) {
  const ed = useEd();
  const fps = ed.project.sequence.fps;
  const roles = [...new Set([...ed.builtinSfx, ...Object.keys(ed.lib?.template?.sfx ?? {})])];
  const role = transSfxRole(t);
  const edit = (changes: Partial<BaseTransition>) => void ed.op({
    type: "setTransitions",
    transitions: (ed.project.transitions ?? []).map((x) => { if (x.at !== t.at) return x; const { auto: _auto, ...rest } = x; return { ...rest, ...changes }; }),
  });
  const sfxValue = t.sfx === undefined ? "" : t.sfx === null ? "__none" : t.sfx;

  return (
    <>
      <h2 id="insp-h" className="panel__title">Sambungan footage</h2>
      <p className="hint">{t.auto ? "Dipasang otomatis oleh mesin CZ. Ubah di bawah untuk menjadikannya pilihan Anda." : "Pilihan Anda; mesin tidak menimpanya."}</p>
      <div className="group">
        <span className="group__label">Transisi</span>
        <div className="segs segs--wrap" role="radiogroup" aria-label="Jenis transisi">
          {TRANSITIONS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={t.kind === k} className={"segs__btn" + (t.kind === k ? " is-on" : "")}
              onClick={() => edit({ kind: k, frames: frames(k, fps) })}>{TRANS_LABEL[k]}</button>
          ))}
        </div>
      </div>
      <label className="field field--inline"><span>Efek suara</span>
        <select value={sfxValue} aria-label="Efek suara sambungan"
          onChange={(e) => { const v = e.target.value; edit({ sfx: v === "" ? undefined : v === "__none" ? null : v }); }}>
          <option value="">{role && t.sfx === undefined ? `Bawaan jenis (${role})` : "Bawaan jenis (tanpa bunyi)"}</option>
          <option value="__none">Tanpa bunyi</option>
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      {!roles.length && <p className="hint">Efek suara bawaan belum terpasang. Jalankan cz install.</p>}
      <div className="actions">
        <button className="btn" onClick={() => ed.seek(Math.max(0, t.at - Math.round(fps * 0.6)))}>Putar dari sini</button>
      </div>
    </>
  );
}

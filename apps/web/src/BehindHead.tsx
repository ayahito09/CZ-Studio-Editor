// Tombol "Di belakang kepala" untuk elemen dan teks: kepala dan badan menutupi elemen. Butuh potongan subjek (mesin matte CZ), dibuat sekali per video.
import { useState } from "react";
import { clipLen } from "@cz/core";
import { api } from "./api.ts";
import { useEd } from "./ed.ts";

/** start/end = rentang item (frame). on = sedang aktif. onChange menyimpan penandanya (params.behindHead / style.behindHead). */
export function BehindHead({ start, end, on, locked, onChange }: { start: number; end: number; on: boolean; locked?: boolean; onChange: (v: boolean) => void }) {
  const ed = useEd();
  const fps = ed.project.sequence.fps;
  const [busy, setBusy] = useState(false);
  const clips = ed.project.clips.filter((c) => c.enabled && c.trackId === "V1" && c.start < end && c.start + clipLen(c, fps) > start);
  const missing = [...new Set(clips.map((c) => c.mediaId))].filter((id) => !ed.subjects[id]);

  const toggle = async (next: boolean) => {
    if (!next || !missing.length) { onChange(next); return; }
    setBusy(true);
    try {
      for (const id of missing) await api.makeSubject(id);
      ed.reloadSubjects();
      onChange(true);
    } catch (e) { alert((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="behind">
      <label className="switch">
        <input type="checkbox" role="switch" checked={on} disabled={locked || busy || !clips.length} onChange={(e) => void toggle(e.target.checked)} />
        <span className="switch__track" aria-hidden="true" />
        <span>Di belakang kepala</span>
      </label>
      {busy && <p className="hint"><span className="spinner" aria-hidden="true" /> Memisahkan orang dari latar… Beberapa menit, sekali saja per video.</p>}
      {!busy && on && missing.length > 0 && <p className="hint">Potongan subjek belum ada untuk video ini.</p>}
      {!busy && !on && !clips.length && <p className="hint">Tidak ada video di bagian ini.</p>}
    </div>
  );
}

import { useEffect, useRef } from "react";
import { api } from "./api.ts";
import { useEd } from "./ed.ts";
import { Icon } from "./icons.tsx";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const ed = useEd();
  const ref = useRef<HTMLDialogElement>(null);
  const st = ed.g.settings;
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="sheet sheet--narrow" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current.close()} aria-labelledby="set-h">
      <div className="sheet__head">
        <h2 id="set-h">Pengaturan</h2>
        <button className="btn btn--icon" onClick={() => ref.current?.close()} aria-label="Tutup"><Icon name="close" /></button>
      </div>
      <label className="switch">
        <input type="checkbox" role="switch" checked={st.reviewClaude} onChange={(e) => ed.run(() => api.settings({ reviewClaude: e.target.checked }))} />
        <span className="switch__track" aria-hidden="true" />
        <span>Tinjau dulu perubahan Claude</span>
      </label>
      <p className="hint">Bila aktif, perubahan dari Claude masuk sebagai usulan di panel Claude; kamu memilih Terima atau Tolak.</p>
      <label className="field">
        <span>Bahasa transkrip</span>
        <select value={st.txLang} onChange={(e) => ed.run(() => api.settings({ txLang: e.target.value }))}>
          <option value="auto">Otomatis</option>
          <option value="id">Indonesia</option>
          <option value="en">Inggris</option>
        </select>
      </label>
      <p className="hint">Transkrip dibuat di komputer ini; suaramu tidak dikirim ke mana pun.</p>
    </dialog>
  );
}

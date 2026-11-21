import { useEffect, useRef } from "react";
import { api, CLAUDE_EFFORTS, CLAUDE_MODELS } from "./api.ts";
import { useEd } from "./ed.ts";
import { Icon } from "./icons.tsx";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const ed = useEd();
  const ref = useRef<HTMLDialogElement>(null);
  const st = ed.g.settings;
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="sheet sheet--narrow settings" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current.close()} aria-labelledby="set-h">
      <div className="sheet__head">
        <h2 id="set-h">Pengaturan</h2>
        <button className="btn btn--icon" onClick={() => ref.current?.close()} aria-label="Tutup"><Icon name="close" /></button>
      </div>
      <div className="settings__body">
        <section className="settings__group" aria-labelledby="set-claude">
          <h3 id="set-claude">Claude</h3>
          <fieldset className="settings__models">
            <legend>Model</legend>
            {CLAUDE_MODELS.map((m) => (
              <label key={m.id} className={"settings__model" + ((st.claudeModel ?? "") === m.id ? " is-on" : "")}>
                <input type="radio" name="model" value={m.id} checked={(st.claudeModel ?? "") === m.id} onChange={() => ed.run(() => api.settings({ claudeModel: m.id }))} />
                <b>{m.name}</b>
                <small>{m.hint}</small>
              </label>
            ))}
          </fieldset>
          <fieldset className="settings__models settings__models--effort">
            <legend>Effort</legend>
            {CLAUDE_EFFORTS.map((m) => (
              <label key={m.id} className={"settings__model" + ((st.claudeEffort ?? "") === m.id ? " is-on" : "")}>
                <input type="radio" name="effort" value={m.id} checked={(st.claudeEffort ?? "") === m.id} onChange={() => ed.run(() => api.settings({ claudeEffort: m.id }))} />
                <b>{m.name}</b>
                <small>{m.hint}</small>
              </label>
            ))}
          </fieldset>
          <p className="hint">Dipakai untuk semua tugas Claude: gaya edit, tata otomatis, dan permintaanmu. Berlaku mulai tugas berikutnya. Effort lebih tinggi lebih teliti tetapi memakai lebih banyak kuota Claude-mu.</p>
          <label className="settings__row">
            <span>
              <b>Tinjau dulu perubahan Claude</b>
              <small>Perubahan masuk sebagai usulan di panel Claude; kamu memilih Terima atau Tolak.</small>
            </span>
            <span className="switch">
              <input type="checkbox" role="switch" checked={st.reviewClaude} onChange={(e) => ed.run(() => api.settings({ reviewClaude: e.target.checked }))} />
              <span className="switch__track" aria-hidden="true" />
            </span>
          </label>
        </section>
        <section className="settings__group" aria-labelledby="set-tx">
          <h3 id="set-tx">Transkrip</h3>
          <label className="settings__row">
            <span>
              <b>Bahasa</b>
              <small>Dibuat di komputer ini; suaramu tidak dikirim ke mana pun.</small>
            </span>
            <select value={st.txLang} onChange={(e) => ed.run(() => api.settings({ txLang: e.target.value }))}>
              <option value="auto">Otomatis</option>
              <option value="id">Indonesia</option>
              <option value="en">Inggris</option>
            </select>
          </label>
        </section>
      </div>
    </dialog>
  );
}

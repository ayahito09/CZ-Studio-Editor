import { useEffect, useState, type CSSProperties } from "react";
import { clipLen, FPS_CHOICES, SEQUENCE_PRESETS, type Clip } from "@cz/core";
import { useEd } from "./ed.ts";
import { Icon } from "./icons.tsx";
import { AssetInspector, CaptionInspector } from "./ItemInspector.tsx";
import { timecode } from "./store.ts";

export function Inspector() {
  const ed = useEd();
  const selected = ed.project.clips.filter((c) => ed.selection.has(c.id));
  const asset = ed.project.assets.find((a) => ed.selection.has(a.id));
  const caption = ed.project.captions.find((c) => ed.selection.has(c.id));
  return (
    <aside className="panel inspector" aria-labelledby="insp-h">
      {asset ? <AssetInspector key={asset.id} a={asset} /> : caption ? <CaptionInspector key={caption.id} c={caption} /> : selected.length === 0 ? <SequenceInspector /> : selected.length === 1 ? <ClipInspector c={selected[0]} /> : <MultiInspector clips={selected} />}
    </aside>
  );
}

function SequenceInspector() {
  const ed = useEd();
  const seq = ed.project.sequence;
  return (
    <>
      <h2 id="insp-h" className="panel__title">Pengaturan video</h2>
      <div className="group">
        <span className="group__label" id="preset-l">Bentuk layar</span>
        <div className="seg" role="group" aria-labelledby="preset-l">
          {SEQUENCE_PRESETS.map((p) => {
            const on = p.width === seq.width && p.height === seq.height;
            return (
              <button key={p.id} className={"seg__btn" + (on ? " is-on" : "")} aria-pressed={on}
                onClick={() => !on && ed.op({ type: "setSequence", width: p.width, height: p.height, fps: seq.fps })}>
                <span className="seg__ratio" style={{ "--w": p.width, "--h": p.height } as CSSProperties} aria-hidden="true" />
                {p.id}
              </button>
            );
          })}
        </div>
      </div>
      <label className="field">
        <span>Kehalusan gerak</span>
        <select value={seq.fps} onChange={(e) => ed.op({ type: "setSequence", width: seq.width, height: seq.height, fps: Number(e.target.value) })}>
          {[...new Set([...FPS_CHOICES, seq.fps])].sort((a, b) => a - b).map((f) => <option key={f} value={f}>{f} gambar per detik</option>)}
        </select>
      </label>
      <dl className="meta">
        <dt>Ukuran</dt><dd className="mono">{seq.width}×{seq.height}</dd>
        <dt>Durasi</dt><dd>{dur(seq.durationFrames / seq.fps)}</dd>
        <dt>Klip</dt><dd>{ed.project.clips.length}</dd>
      </dl>

      <h2 className="panel__title panel__title--sub">Proyek</h2>
      <dl className="meta">
        <dt>Folder</dt><dd className="mono" title={ed.s.folder}>{ed.s.folder}</dd>
        <dt>Disimpan</dt><dd>{new Date(ed.s.savedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</dd>
      </dl>
      <p className="hint">Klik klip di linimasa untuk mengatur volumenya.</p>
    </>
  );
}

/** Durasi untuk dibaca orang: "3,6 detik" atau "1 menit 12 detik". */
const dur = (sec: number) => (sec < 60 ? `${sec.toFixed(1).replace(".", ",")} detik` : `${Math.floor(sec / 60)} menit ${Math.round(sec % 60)} detik`);

/** Volume dalam persen (100% = asli) untuk user; disimpan sebagai dB. */
const dbToPct = (db: number) => Math.round(Math.pow(10, db / 20) * 100);
const pctToDb = (pct: number) => (pct <= 0 ? -60 : Math.max(-60, Math.min(24, Math.round(20 * Math.log10(pct / 100) * 10) / 10)));

/** Kolom angka yang baru mengirim op saat selesai diketik (Enter/blur), bukan tiap ketukan. */
function NumberField({ label, value, min, max, step, suffix, onCommit }: {
  label: string; value: number; min: number; max: number; step: number; suffix: string; onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = Math.min(max, Math.max(min, Number(text.replace(",", "."))));
    if (Number.isFinite(v) && v !== value) onCommit(v); else setText(String(value));
  };
  return (
    <label className="field field--inline">
      <span>{label}</span>
      <span className="num">
        <input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setText(String(value)); e.currentTarget.blur(); } }} />
        <span className="num__suffix">{suffix}</span>
      </span>
    </label>
  );
}

function ClipInspector({ c }: { c: Clip }) {
  const ed = useEd();
  const fps = ed.project.sequence.fps;
  const m = ed.project.media.find((x) => x.id === c.mediaId);
  const track = ed.project.tracks.find((t) => t.id === c.trackId);
  const audio = track?.kind === "audio";
  const len = clipLen(c, fps);
  const partners = c.linkId ? ed.project.clips.filter((x) => x.linkId === c.linkId && x.id !== c.id) : [];
  const set = (changes: Partial<Pick<Clip, "enabled" | "gainDb" | "fadeIn" | "fadeOut">>) => ed.op({ type: "setClips", clipIds: [c.id], changes });

  return (
    <>
      <h2 id="insp-h" className="panel__title">Klip {audio ? "audio" : "video"}</h2>
      <div className="clip-card">
        <span className={`clip-card__swatch clip-card__swatch--${track?.kind}`} aria-hidden="true" />
        <div>
          <strong>{m?.name ?? "File hilang"}</strong>
          <span className="muted">{audio ? "Suara" : "Gambar"}</span>
        </div>
      </div>
      <dl className="meta">
        <dt>Mulai</dt><dd>detik {(c.start / fps).toFixed(1)}</dd>
        <dt>Durasi</dt><dd>{dur(len / fps)}</dd>
        <dt>Dari video asli</dt><dd>detik {c.srcIn.toFixed(1)} sampai {c.srcOut.toFixed(1)}</dd>
        <dt>Gambar dan suara</dt><dd>{partners.length ? "Tergabung" : "Terpisah"}</dd>
      </dl>

      <label className="switch">
        <input type="checkbox" role="switch" checked={c.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span className="switch__track" aria-hidden="true" />
        <span>Klip aktif</span>
      </label>

      {audio && (
        <div className="group">
          <span className="group__label">Suara</span>
          <div className="slider">
            <input type="range" min={-30} max={12} step={0.5} defaultValue={c.gainDb} key={c.id + c.gainDb} aria-label="Volume"
              onPointerUp={(e) => set({ gainDb: Number(e.currentTarget.value) })} onKeyUp={(e) => set({ gainDb: Number(e.currentTarget.value) })} />
          </div>
          <NumberField label="Volume" value={dbToPct(c.gainDb)} min={0} max={400} step={5} suffix="%" onCommit={(v) => set({ gainDb: pctToDb(v) })} />
          {c.gainDb > 0 && <p className="hint">Volume di atas 100% baru terdengar penuh di hasil ekspor.</p>}
          <NumberField label="Muncul perlahan" value={Math.round((c.fadeIn / fps) * 10) / 10} min={0} max={len / fps} step={0.1} suffix="dtk" onCommit={(v) => set({ fadeIn: Math.round(v * fps) })} />
          <NumberField label="Hilang perlahan" value={Math.round((c.fadeOut / fps) * 10) / 10} min={0} max={len / fps} step={0.1} suffix="dtk" onCommit={(v) => set({ fadeOut: Math.round(v * fps) })} />
        </div>
      )}

      <div className="actions">
        <button className="btn" onClick={() => ed.op(c.linkId ? { type: "unlink", clipIds: [c.id] } : { type: "link", clipIds: [...ed.selection] })} disabled={!c.linkId}>
          <Icon name="link" />{c.linkId ? "Pisahkan gambar dan suara" : "Gambar dan suara terpisah"}
        </button>
        <button className="btn" onClick={() => ed.op({ type: "deleteClips", clipIds: [c.id], ripple: true })} title="Shift+Delete">
          <Icon name="trash" />Hapus dan rapatkan
        </button>
      </div>
    </>
  );
}

function MultiInspector({ clips }: { clips: Clip[] }) {
  const ed = useEd();
  const ids = clips.map((c) => c.id);
  const allOn = clips.every((c) => c.enabled);
  return (
    <>
      <h2 id="insp-h" className="panel__title">{clips.length} klip dipilih</h2>
      <label className="switch">
        <input type="checkbox" role="switch" checked={allOn} onChange={(e) => ed.op({ type: "setClips", clipIds: ids, changes: { enabled: e.target.checked } })} />
        <span className="switch__track" aria-hidden="true" />
        <span>Semua aktif</span>
      </label>
      <div className="actions">
        <button className="btn" onClick={() => ed.op({ type: "link", clipIds: ids })} title="Ctrl+L"><Icon name="link" />Gabungkan</button>
        <button className="btn" onClick={() => ed.op({ type: "unlink", clipIds: ids })}>Pisahkan</button>
        <button className="btn" onClick={() => ed.op({ type: "deleteClips", clipIds: ids, ripple: false })} title="Delete"><Icon name="trash" />Hapus</button>
      </div>
    </>
  );
}

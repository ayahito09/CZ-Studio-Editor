import { useRef, useState } from "react";
import { SEQUENCE_PRESETS } from "@cz/core";
import { api, type RenderJob } from "./api.ts";
import { useClaudeAction } from "./ClaudePanel.tsx";
import { useEd } from "./ed.ts";
import { Icon } from "./icons.tsx";
import { timecode } from "./store.ts";

const SCENE_STATUS: Record<string, string> = { draft: "konsep", diubah: "diubah", disetujui: "disetujui", dikunci: "dikunci" };
const STATE: Record<RenderJob["state"], string> = { antre: "Menunggu", menyiapkan: "Menyiapkan", render: "Mengekspor", audio: "Merapikan suara", selesai: "Selesai", gagal: "Gagal", batal: "Dibatalkan" };

export function RenderPanel() {
  const ed = useEd();
  const p = ed.project;
  const seq = p.sequence;
  const [preset, setPreset] = useState("sequence");
  const [fps, setFps] = useState(seq.fps);
  const [codec, setCodec] = useState("h264");
  const [crf, setCrf] = useState(18);
  const [normalize, setNormalize] = useState(true);
  const [range, setRange] = useState<"all" | "inout" | "scene">("all");
  const [sceneId, setSceneId] = useState(p.scenes[0]?.id ?? "");
  const [outDir, setOutDir] = useState("");
  const [issues, setIssues] = useState<string[] | null>(null);
  const claude = useClaudeAction();
  const size = preset === "sequence" ? seq : SEQUENCE_PRESETS.find((x) => x.id === preset)!;
  const io = ed.inOut;
  const ioOk = io.in !== null && io.out !== null && io.out > io.in;

  const settings = () => ({
    width: size.width, height: size.height, fps, codec, crf, normalize, range: range === "inout" && !ioOk ? "all" : range,
    inFrame: io.in ?? undefined, outFrame: io.out ?? undefined, sceneId: range === "scene" ? sceneId : undefined, outDir: outDir.trim() || undefined,
  });
  const check = async () => { try { setIssues((await api.precheck()).issues); } catch (e) { alert((e as Error).message); } };
  const panel = useRef<HTMLElement>(null);
  const start = async () => { setIssues(null); if (await ed.run(() => api.render(settings()))) panel.current?.scrollTo({ top: 0, behavior: "smooth" }); };
  const jobs = ed.g.renders.filter((j) => j.folder === ed.s.folder).slice().reverse();

  return (
    <aside className="panel inspector" aria-labelledby="render-h" ref={panel}>
      {jobs.length > 0 && <h2 className="panel__title">Antrean</h2>}
      <ul className="plain stack">
        {jobs.map((j) => (
          <li key={j.id} className={`job job--${j.state}`}>
            <div className="row row--between">
              <strong>{j.settings.range === "scene" ? `${j.title} · satu bagian` : j.title}</strong>
              <span className="muted">{STATE[j.state]}{j.eta !== null && j.state === "render" ? ` · sisa ${j.eta} dtk` : ""}</span>
            </div>
            {j.note && <span className="hint">{j.note}</span>}
            {!["selesai", "gagal", "batal"].includes(j.state) && (
              <div className="row">
                <div className="bar bar--grow"><div className="bar__fill" style={{ width: `${Math.round(j.progress * 100)}%` }} /></div>
                <span className="mono">{Math.round(j.progress * 100)}%</span>
                <button className="btn btn--sm-text" onClick={() => ed.run(() => api.stopRender(j.id))}>Batal</button>
              </div>
            )}
            {j.error && <span className="media-item__error">{j.error}</span>}
            {j.state === "selesai" && (
              <>
                <video className="job__video" src={`/api/render/${j.id}/file`} controls preload="metadata" />
                <div className="row row--wrap">
                  <button className="btn btn--sm-text" onClick={() => api.reveal(j.id, true)}>Buka file</button>
                  <button className="btn btn--sm-text" onClick={() => api.reveal(j.id, false)}>Tampilkan di folder</button>
                  <button className="btn btn--sm-text" onClick={() => claude("check-render")}><Icon name="wand" />Minta Claude memeriksa</button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      <h2 id="render-h" className={"panel__title" + (jobs.length ? " panel__title--sub" : "")}>Ekspor video</h2>
      <label className="field"><span>Bentuk layar</span>
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="sequence">Sama seperti proyek</option>
          {SEQUENCE_PRESETS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select></label>
      <div className="grid2">
        <label className="field"><span>Kehalusan gerak</span>
          <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
            {[...new Set([seq.fps, 24, 25, 30, 60])].map((f) => <option key={f} value={f}>{f === seq.fps ? "Sama seperti proyek" : `${f} gambar/detik`}</option>)}
          </select></label>
        <label className="field"><span>Jenis file</span>
          <select value={codec} onChange={(e) => setCodec(e.target.value)}>
            <option value="h264">MP4, paling umum</option><option value="h265">MP4, lebih kecil</option><option value="prores">MOV untuk disunting lagi</option>
          </select></label>
      </div>
      {codec !== "prores" && (
        <label className="field"><span>Kualitas</span>
          <select value={crf} onChange={(e) => setCrf(Number(e.target.value))}>
            <option value={16}>Sangat tinggi</option><option value={18}>Tinggi</option><option value={23}>Sedang</option><option value={28}>Hemat ukuran</option>
          </select></label>
      )}
      <label className="check"><input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} /><span>Ratakan volume suara supaya pas di media sosial</span></label>
      <label className="field"><span>Yang diekspor</span>
        <select value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
          <option value="all">Seluruh video</option>
          <option value="inout" disabled={!ioOk}>Bagian bertanda{ioOk ? ` (${timecode(io.out! - io.in!, seq.fps)})` : ""}</option>
          <option value="scene" disabled={!p.scenes.length}>Satu bagian rencana</option>
        </select></label>
      {range === "scene" && (
        <select value={sceneId} onChange={(e) => setSceneId(e.target.value)} aria-label="Bagian">
          {p.scenes.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.title}</option>)}
        </select>
      )}
      <label className="field"><span>Simpan ke folder (kosongkan untuk folder proyek)</span>
        <input className="mono" value={outDir} onChange={(e) => setOutDir(e.target.value)} placeholder="D:\Hasil" /></label>

      {issues === null ? (
        <button className="btn btn--primary" onClick={check} disabled={!p.clips.length}><Icon name="render" />Ekspor video</button>
      ) : (
        <div className={"notice" + (issues.length ? " notice--warn" : "")}>
          {issues.length ? <><strong>Periksa dulu</strong><ul>{issues.map((x, i) => <li key={i}>{x}</li>)}</ul></> : <strong>Siap diekspor.</strong>}
          <div className="row">
            <button className="btn btn--primary" onClick={start}>{issues.length ? "Tetap ekspor" : "Mulai ekspor"}</button>
            <button className="btn btn--ghost" onClick={() => setIssues(null)}>{issues.length ? "Perbaiki dulu" : "Batal"}</button>
          </div>
        </div>
      )}
      <p className="hint">Hasil ekspor sama persis dengan pratinjau. Kamu tetap bisa menyunting selama ekspor berjalan. Ekspor pertama mengunduh alat tambahan sekali (sekitar 130 MB).</p>

    </aside>
  );
}

/** Ringkasan perubahan per scene: opsi, ubahan, dan status catatan. Menjadi daftar periksa sebelum render. */
export function RenderSummary() {
  const ed = useEd();
  const p = ed.project;
  const presets = ed.lib?.template?.stylePresets ?? [];
  const openAll = p.notes.filter((n) => n.status !== "selesai").length;
  return (
    <aside className="panel media" aria-labelledby="sum-h">
      <div className="panel__head"><h2 id="sum-h" className="panel__title">Daftar periksa</h2></div>
      <ul className="checklist">
        <li className={p.cuts.some((c) => c.state === "proposed") ? "" : "is-ok"}>Usulan potongan ditinjau</li>
        <li className={p.captions.length ? "is-ok" : ""}>Subtitle ({p.captions.length})</li>
        <li className={openAll ? "" : "is-ok"}>Catatan selesai{openAll ? ` (${openAll} terbuka)` : ""}</li>
        <li className={ed.s.pending.length ? "" : "is-ok"}>Usulan Claude ditinjau{ed.s.pending.length ? ` (${ed.s.pending.length})` : ""}</li>
      </ul>
      <ol className="scene-list">
        {p.scenes.map((s, i) => {
          const opt = s.options.find((o) => o.id === s.choice);
          const edited = p.assets.filter((a) => a.sceneId === s.id && a.edited).length;
          const notes = p.notes.filter((n) => n.sceneId === s.id);
          return (
            <li key={s.id} className="summary-item">
              <button className="link-btn" onClick={() => { ed.seek(s.start); ed.select([s.id]); }}><strong>{i + 1}. {s.title}</strong></button>
              <span className="muted">Tampilan: {opt ? presets.find((x) => x.id === opt.presetId)?.name ?? "lainnya" : "belum dipilih"}{edited ? ` · ${edited} elemen diubah` : ""}</span>
              <span className="muted">{notes.length ? `${notes.filter((n) => n.status === "selesai").length} dari ${notes.length} catatan selesai` : "Tanpa catatan"} · {SCENE_STATUS[s.status]}</span>
            </li>
          );
        })}
        {!p.scenes.length && <li className="muted">Belum ada rencana per bagian.</li>}
      </ol>
    </aside>
  );
}

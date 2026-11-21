import { useRef, useState } from "react";
import { SEQUENCE_PRESETS, filledRange } from "@cz/core";
import { api, type RenderJob } from "./api.ts";
import { useClaudeAction } from "./ClaudePanel.tsx";
import { useEd } from "./ed.ts";
import { Icon } from "./icons.tsx";
import { Progress } from "./Progress.tsx";
import { Section } from "./Section.tsx";
import { timecode } from "./store.ts";

const SCENE_STATUS: Record<string, string> = { draft: "konsep", diubah: "diubah", disetujui: "disetujui", dikunci: "dikunci" };
const STAGES: { id: RenderJob["state"]; label: string }[] = [
  { id: "menyiapkan", label: "Siapkan" }, { id: "render", label: "Ekspor" }, { id: "audio", label: "Suara" }, { id: "selesai", label: "Selesai" },
];
const STATE: Record<RenderJob["state"], string> = { antre: "Menunggu giliran", menyiapkan: "Menyiapkan", render: "Mengekspor", audio: "Merapikan suara", selesai: "Selesai", gagal: "Gagal", batal: "Dibatalkan" };

/** Tombol segmen: satu pilihan dari beberapa, terlihat semua sekaligus (pengganti dropdown). */
function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; t: string; hint?: string; off?: boolean }[]; onChange: (v: T) => void }) {
  return (
    <div className="field"><span>{label}</span>
      <div className="segs" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.v)} type="button" role="radio" aria-checked={o.v === value} disabled={o.off} title={o.hint}
            className={"segs__btn" + (o.v === value ? " is-on" : "")} onClick={() => onChange(o.v)}>{o.t}</button>
        ))}
      </div>
    </div>
  );
}

/** Kotak rasio layar: bentuk persegi panjang sesuai ukuran keluaran. */
function Shape({ w, h }: { w: number; h: number }) {
  const s = 26 / Math.max(w, h);
  return <span className="shape" aria-hidden="true"><i style={{ width: w * s, height: h * s }} /></span>;
}

export function RenderPanel() {
  const ed = useEd();
  const p = ed.project;
  const seq = p.sequence;
  const [preset, setPreset] = useState("sequence");
  const [fps, setFps] = useState(seq.fps);
  const [codec, setCodec] = useState("h264");
  const [crf, setCrf] = useState(18);
  const [normalize, setNormalize] = useState(true);
  const [motionBlur, setMotionBlur] = useState(5);
  const [range, setRange] = useState<"all" | "inout" | "scene">("all");
  const [sceneId, setSceneId] = useState(p.scenes[0]?.id ?? "");
  const [outDir, setOutDir] = useState("");
  const [issues, setIssues] = useState<string[] | null>(null);
  const claude = useClaudeAction();
  const size = preset === "sequence" ? seq : SEQUENCE_PRESETS.find((x) => x.id === preset)!;
  const io = ed.inOut;
  const ioOk = io.in !== null && io.out !== null && io.out > io.in;
  const scene = p.scenes.find((s) => s.id === sceneId);
  const frames = range === "inout" && ioOk ? io.out! - io.in! : range === "scene" && scene ? scene.end - scene.start : (([a, b]) => b - a)(filledRange(p) ?? [0, 0]);
  const dirOk = !outDir.trim() || /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(outDir.trim());

  const settings = () => ({
    width: size.width, height: size.height, fps, codec, crf, normalize, motionBlur, range: range === "inout" && !ioOk ? "all" : range,
    inFrame: io.in ?? undefined, outFrame: io.out ?? undefined, sceneId: range === "scene" ? sceneId : undefined, outDir: outDir.trim() || undefined,
  });
  const check = async () => { try { setIssues((await api.precheck()).issues); } catch (e) { alert((e as Error).message); } };
  const panel = useRef<HTMLElement>(null);
  const start = async () => { setIssues(null); if (await ed.run(() => api.render(settings()))) panel.current?.scrollTo({ top: 0, behavior: "smooth" }); };
  const jobs = ed.g.renders.filter((j) => j.folder === ed.s.folder).slice().reverse();

  return (
    <aside className="panel inspector render" aria-labelledby="render-h" ref={panel}>
      {jobs.length > 0 && (
        <Section title="Hasil ekspor" count={jobs.length}>
          <ul className="plain stack">{jobs.map((j) => <Job key={j.id} j={j} onCheck={() => claude("check-render")} />)}</ul>
        </Section>
      )}
      <h2 id="render-h" className="sr-only">Ekspor video</h2>
      <Section title="Format">
        <div className="shapes" role="radiogroup" aria-label="Bentuk layar">
          {[{ id: "sequence", label: "Proyek", width: seq.width, height: seq.height }, ...SEQUENCE_PRESETS.map((x) => ({ id: x.id, label: x.id, width: x.width, height: x.height }))]
            .filter((x, i, all) => x.id === "sequence" || !(x.width === seq.width && x.height === seq.height && all[0].id === "sequence"))
            .map((x) => (
              <button key={x.id} type="button" role="radio" aria-checked={preset === x.id} className={"shapes__btn" + (preset === x.id ? " is-on" : "")} onClick={() => setPreset(x.id)}
                title={SEQUENCE_PRESETS.find((s) => s.id === x.id)?.label ?? "Sama seperti proyek"}>
                <Shape w={x.width} h={x.height} />
                <b>{x.label}</b>
                <small className="mono">{x.width}×{x.height}</small>
              </button>
            ))}
        </div>
        <Seg label="Jenis file" value={codec} onChange={setCodec} options={[
          { v: "h264", t: "MP4", hint: "Paling umum, bisa diunggah ke mana saja" },
          { v: "h265", t: "MP4 kecil", hint: "Ukuran lebih kecil, sebagian perangkat lama tidak bisa memutar" },
          { v: "prores", t: "MOV", hint: "ProRes untuk disunting lagi di aplikasi lain" },
        ]} />
        {codec !== "prores" && (
          <Seg label="Kualitas" value={crf} onChange={setCrf} options={[
            { v: 28, t: "Hemat" }, { v: 23, t: "Sedang" }, { v: 18, t: "Tinggi" }, { v: 16, t: "Maksimal" },
          ]} />
        )}
      </Section>

      <Section title="Yang diekspor">
        <Seg label="Rentang" value={range} onChange={setRange} options={[
          { v: "all", t: "Semua" },
          { v: "inout", t: "Bertanda", off: !ioOk, hint: ioOk ? undefined : "Tandai masuk (I) dan keluar (O) di linimasa dulu" },
          { v: "scene", t: "Satu bagian", off: !p.scenes.length, hint: p.scenes.length ? undefined : "Belum ada bagian rencana" },
        ]} />
        {range === "scene" && (
          <select value={sceneId} onChange={(e) => setSceneId(e.target.value)} aria-label="Bagian">
            {p.scenes.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.title}</option>)}
          </select>
        )}
      </Section>

      <Section title="Gerak & suara" open={false}>
        <Seg label="Gambar per detik" value={fps} onChange={setFps} options={[...new Set([seq.fps, 24, 30, 60])].sort((a, b) => a - b).map((f) => ({ v: f, t: f === seq.fps ? `${f} · proyek` : String(f) }))} />
        <Seg label="Motion blur" value={motionBlur} onChange={setMotionBlur} options={[
          { v: 0, t: "Mati", hint: "Render paling cepat" }, { v: 5, t: "Halus" }, { v: 9, t: "Maksimal", hint: "Render lebih lama" },
        ]} />
        <label className="check"><input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} /><span>Ratakan volume suara (−14 LUFS, pas untuk media sosial)</span></label>
      </Section>

      <Section title="Simpan ke" open={!!outDir}>
        <label className="field"><span>Folder (kosongkan untuk folder render di proyek)</span>
          <input className="mono" value={outDir} onChange={(e) => setOutDir(e.target.value)} placeholder="D:\Hasil" aria-invalid={!dirOk} />
          {!dirOk && <small className="field__err">Tulis path lengkap, mis. D:\Hasil</small>}
        </label>
      </Section>

      <div className="render__go">
        <div className="render__sum mono">
          <span>{size.width}×{size.height}</span><span>{fps} fps</span><span>{codec === "prores" ? "MOV" : "MP4"}</span><span>{timecode(frames, seq.fps)}</span>
        </div>
        {issues === null ? (
          <button className="btn btn--primary render__btn" onClick={check} disabled={!p.clips.length || !dirOk}><Icon name="render" />Ekspor video</button>
        ) : (
          <div className={"notice" + (issues.length ? " notice--warn" : "")}>
            {issues.length ? <><strong>Periksa dulu</strong><ul>{issues.map((x, i) => <li key={i}>{x}</li>)}</ul></> : <strong>Semua siap.</strong>}
            <div className="row">
              <button className="btn btn--primary" onClick={start}>{issues.length ? "Tetap ekspor" : "Mulai ekspor"}</button>
              <button className="btn btn--ghost" onClick={() => setIssues(null)}>{issues.length ? "Perbaiki dulu" : "Batal"}</button>
            </div>
          </div>
        )}
        {!p.clips.length && <p className="hint">Belum ada klip di linimasa.</p>}
      </div>
    </aside>
  );
}

/** Satu job ekspor: tahap berjalan, kemajuan, hasil yang bisa diputar, atau error lengkap dengan coba lagi. */
function Job({ j, onCheck }: { j: RenderJob; onCheck: () => void }) {
  const ed = useEd();
  const active = !["selesai", "gagal", "batal"].includes(j.state);
  const at = STAGES.findIndex((s) => s.id === j.state);
  const took = j.startedAt && j.endedAt ? Math.round((j.endedAt - j.startedAt) / 1000) : null;
  return (
    <li className={`job job--${j.state}`}>
      <div className="row row--between">
        <strong>{j.settings.range === "scene" ? "Satu bagian" : j.settings.range === "inout" ? "Bagian bertanda" : "Seluruh video"}</strong>
        <span className={"job__state job__state--" + j.state}>{STATE[j.state]}</span>
      </div>
      <span className="hint mono">{j.settings.width}×{j.settings.height} · {j.settings.fps} fps · {j.settings.codec === "prores" ? "MOV" : "MP4"}{took !== null && j.state === "selesai" ? ` · ${took} dtk` : ""}</span>
      {active && (
        <>
          <ol className="job__steps" aria-label="Tahap ekspor">
            {STAGES.map((s, i) => <li key={s.id} className={i < at ? "is-done" : i === at ? "is-now" : ""}>{s.label}</li>)}
          </ol>
          {j.note && <span className="hint">{j.note}</span>}
          <div className="row">
            <div className="bar--grow"><Progress value={j.state === "antre" ? null : j.state === "menyiapkan" ? null : j.progress} eta={j.state === "render" ? j.eta : null} /></div>
            <button className="btn btn--sm-text" onClick={() => ed.run(() => api.stopRender(j.id))}>Batal</button>
          </div>
        </>
      )}
      {j.state === "gagal" && (
        <div className="job__err" role="alert">
          <Icon name="alert" /><span>{j.error ?? "Ekspor berhenti tanpa pesan."}</span>
        </div>
      )}
      {(j.state === "gagal" || j.state === "batal") && (
        <button className="btn btn--sm-text" onClick={() => ed.run(() => api.render(j.settings))}><Icon name="loop" />Coba lagi</button>
      )}
      {j.state === "selesai" && (
        <>
          <video className="job__video" src={`/api/render/${j.id}/file`} controls preload="metadata" />
          <div className="row row--wrap">
            <button className="btn btn--sm-text" onClick={() => api.reveal(j.id, true)}>Buka file</button>
            <button className="btn btn--sm-text" onClick={() => api.reveal(j.id, false)}>Tampilkan di folder</button>
            <button className="btn btn--sm-text" onClick={onCheck}><Icon name="wand" />Minta Claude memeriksa</button>
          </div>
        </>
      )}
    </li>
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
              <span className="muted">Tampilan: {s.skill ? "skill" : opt ? presets.find((x) => x.id === opt.presetId)?.name ?? "lainnya" : "belum dipilih"}{edited ? ` · ${edited} elemen diubah` : ""}</span>
              <span className="muted">{notes.length ? `${notes.filter((n) => n.status === "selesai").length} dari ${notes.length} catatan selesai` : "Tanpa catatan"} · {SCENE_STATUS[s.status]}</span>
            </li>
          );
        })}
        {!p.scenes.length && <li className="muted">Belum ada rencana per bagian.</li>}
      </ol>
    </aside>
  );
}

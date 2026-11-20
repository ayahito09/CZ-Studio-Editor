import { useEffect, useMemo, useState } from "react";
import { applyOp, DEFAULT_SILENCE, srcToSeq, wordFrames, type Cut, type Op, type Word } from "@cz/core";
import { api } from "./api.ts";
import { useClaudeAction } from "./ClaudePanel.tsx";
import { useEd } from "./ed.ts";
import { Icon } from "./icons.tsx";
import { timecode } from "./store.ts";

export function CutsPanel() {
  const [tab, setTab] = useState<"jeda" | "teks">("jeda");
  return (
    <aside className="panel inspector" aria-label="Potong jeda dan transkrip">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "jeda"} className={"tabs__btn" + (tab === "jeda" ? " is-on" : "")} onClick={() => setTab("jeda")}>Potong jeda</button>
        <button role="tab" aria-selected={tab === "teks"} className={"tabs__btn" + (tab === "teks" ? " is-on" : "")} onClick={() => setTab("teks")}>Transkrip</button>
      </div>
      {tab === "jeda" ? <Silence /> : <Transcript />}
    </aside>
  );
}

const KIND_LABEL: Record<string, string> = { jeda: "Jeda", isian: "Kata pengisi", ulangan: "Kata diulang", teks: "Dihapus dari teks", claude: "Saran Claude" };

function Silence() {
  const ed = useEd();
  const p = ed.project;
  const fps = p.sequence.fps;
  const [opts, setOpts] = useState({ minGap: DEFAULT_SILENCE.minGap, padding: DEFAULT_SILENCE.padding, thresholdDb: null as number | null });
  const [threshold, setThreshold] = useState<number | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const claude = useClaudeAction();
  const open = p.cuts.filter((c) => c.state !== "applied");
  const active = open.filter((c) => c.state === "proposed");

  // Hasil bila diterapkan, dihitung di browser dengan fungsi core yang sama dengan server.
  const after = useMemo(() => {
    if (!active.length) return null;
    try { return applyOp(p, { type: "applyCuts", cutIds: active.map((c) => c.id) })[0]; } catch { return null; }
  }, [p, active.map((c) => c.id).join()]);
  const previewing = !!ed.preview && ed.preview === after;
  useEffect(() => () => ed.setPreview(null), []);

  const detect = async () => {
    setBusy(true);
    await ed.run(async () => { const r = await api.detectCuts(opts); setThreshold(r.detect.threshold); return r; });
    setBusy(false);
  };
  const apply = async () => {
    ed.setPreview(null);
    await ed.run(async () => { const r = await api.applyCuts(active.map((c) => c.id)); setProblems(r.problems.map((x) => x.detail)); return r; });
  };
  const toggle = (c: Cut) => ed.op({ type: "setCutState", cutIds: [c.id], state: c.state === "proposed" ? "rejected" : "proposed" });
  const seqFrame = (c: Cut) => srcToSeq(p, c.mediaId, c.srcStart);

  return (
    <div className="stack">
      <div className="group">
        <NumberRow label="Potong jeda lebih dari" value={opts.minGap} step={0.05} suffix="dtk" onChange={(v) => setOpts({ ...opts, minGap: v })} />
        <NumberRow label="Sisakan napas" value={opts.padding} step={0.05} suffix="dtk" onChange={(v) => setOpts({ ...opts, padding: v })} />
        <label className="field field--inline">
          <span>Kepekaan suara</span>
          <select value={opts.thresholdDb === null ? "auto" : "manual"} onChange={(e) => setOpts({ ...opts, thresholdDb: e.target.value === "auto" ? null : threshold ?? -40 })}>
            <option value="auto">Otomatis</option>
            <option value="manual">Atur sendiri</option>
          </select>
        </label>
        {opts.thresholdDb !== null && <>
          <NumberRow label="Batas suara pelan" value={opts.thresholdDb} step={1} suffix="" onChange={(v) => setOpts({ ...opts, thresholdDb: v })} />
          <p className="hint">Makin kecil angkanya, makin pelan suara yang masih dianggap bicara.</p>
        </>}
        <div className="row">
          <button className="btn btn--primary" onClick={detect} disabled={busy || !p.clips.length}>{busy ? <span className="spinner" /> : <Icon name="scissors" />}Cari jeda</button>
          <button className="btn" onClick={() => claude("cuts")} title="Claude membaca transkrip dan menandai ulangan, awal kalimat salah, dan bagian bertele-tele">Minta saran Claude</button>
        </div>
      </div>

      {open.length > 0 && (
        <>
          <div className="summary">
            <span className="mono">{timecode(p.sequence.durationFrames, fps)} → {after ? timecode(after.sequence.durationFrames, fps) : "—"}</span>
            <span>{active.length} dari {open.length} potongan dipilih</span>
          </div>
          <div className="row">
            <button className={"btn" + (previewing ? " is-on" : "")} disabled={!after} onClick={() => {
              if (previewing) { ed.setPreview(null); return; }
              ed.setPreview(after); ed.seek(0); setTimeout(() => ed.player.current?.play(), 50);
            }}><Icon name="play" />{previewing ? "Kembali ke video asli" : "Putar dengan potongan"}</button>
            <button className="btn btn--primary" disabled={!active.length} onClick={apply}>Potong sekarang</button>
          </div>
          <ul className="cut-list">
            {open.map((c) => {
              const f = seqFrame(c);
              return (
                <li key={c.id} className={`cut cut--${c.kind === "jeda" ? "red" : "yellow"}` + (c.state === "rejected" ? " is-off" : "")}>
                  <input type="checkbox" checked={c.state === "proposed"} onChange={() => toggle(c)} aria-label="Pilih potongan ini" />
                  <button className="cut__body" onClick={() => f !== null && ed.seek(f)}>
                    <span className="cut__kind">{KIND_LABEL[c.kind]}</span>
                    <span className="mono">{f !== null ? timecode(f, fps) : "—"} · {(c.srcEnd - c.srcStart).toFixed(2)} dtk</span>
                    {c.reason && <span className="cut__reason">{c.reason}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="hint">Merah: jeda tanpa suara, langsung dipilih. Kuning: kata pengisi seperti "eh", kata yang diulang, dan saran Claude; pilih sendiri bila setuju. Semua bisa dibatalkan dengan Ctrl+Z.</p>
        </>
      )}
      {problems.length > 0 && (
        <div className="notice notice--warn">
          <strong>Periksa titik ini</strong>
          <ul>{problems.map((x, i) => <li key={i}>{x}</li>)}</ul>
          <p className="hint">Sudah ditandai di linimasa.</p>
        </div>
      )}
      {p.cuts.some((c) => c.state === "applied") && <p className="hint">{p.cuts.filter((c) => c.state === "applied").length} potongan sudah dibuat. Ujung tiap klip masih bisa ditarik di linimasa.</p>}
    </div>
  );
}

function NumberRow({ label, value, step, suffix, onChange }: { label: string; value: number; step: number; suffix: string; onChange: (v: number) => void }) {
  return (
    <label className="field field--inline">
      <span>{label}</span>
      <span className="num">
        <input type="number" step={step} value={value} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(e.target.valueAsNumber)} />
        <span className="num__suffix">{suffix}</span>
      </span>
    </label>
  );
}

function Transcript() {
  const ed = useEd();
  const p = ed.project;
  const fps = p.sequence.fps;
  const [engine, setEngine] = useState<{ ready: boolean } | null>(null);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => { api.engine().then(setEngine).catch(() => setEngine({ ready: false })); }, []);
  const frames = useMemo(() => wordFrames(p), [p]);
  const words = useMemo(() => p.transcript.words.filter((w) => frames.has(w.id)).sort((x, y) => frames.get(x.id)!.start - frames.get(y.id)!.start), [p, frames]);
  const cutCount = p.transcript.words.length - words.length;
  const txs = Object.entries(ed.s.tx);
  const range = sel ? words.slice(Math.min(sel.a, sel.b), Math.max(sel.a, sel.b) + 1) : [];

  /** Hapus kata = potong video di bagian itu (per rentang berurutan per media). */
  const deleteWords = () => {
    if (!range.length) return;
    const cuts: { kind: "teks"; mediaId: string; srcStart: number; srcEnd: number }[] = [];
    for (const w of range) {
      const last = cuts.at(-1);
      if (last && last.mediaId === w.mediaId && w.srcStart - last.srcEnd < 0.6) last.srcEnd = w.srcEnd;
      else cuts.push({ kind: "teks", mediaId: w.mediaId, srcStart: w.srcStart, srcEnd: w.srcEnd });
    }
    ed.op({ type: "addCuts", cuts, apply: true });
    setSel(null);
  };
  const nudge = (w: Word, edge: "srcStart" | "srcEnd", d: number) => ed.op({ type: "updateWord", id: w.id, [edge]: Math.round((w[edge] + d / fps) * 1000) / 1000 } as Op);

  return (
    <div className="stack">
      {!engine?.ready && (
        <div className="notice">
          <p>Alat pembuat transkrip belum dipasang. Pasang sekali: buka Terminal, lalu ketik</p>
          <pre className="mono">cz models install</pre>
          <p className="hint">Transkrip dibuat di komputer ini. Suaramu tidak dikirim ke internet, juga tidak ke Claude.</p>
        </div>
      )}
      <div className="row">
        <button className="btn btn--primary" disabled={!engine?.ready || !p.media.length} onClick={() => ed.run(() => api.transcribe())}>
          <Icon name="text" />{p.transcript.words.length ? "Buat ulang transkrip" : "Buat transkrip"}
        </button>
        <span className="muted">Bahasa: {{ auto: "otomatis", id: "Indonesia", en: "Inggris" }[ed.g.settings.txLang] ?? ed.g.settings.txLang}</span>
      </div>
      {txs.filter(([, t]) => t.stage !== "siap").map(([id, t]) => (
        <div key={id} className="media-item__job">
          <span>{p.media.find((m) => m.id === id)?.name}: {t.stage === "gagal" ? t.error : t.stage === "menunggu" ? "menunggu" : "sedang ditulis"}</span>
          {t.stage !== "gagal" && <div className="bar"><div className="bar__fill" style={{ width: `${Math.round(t.progress * 100)}%` }} /></div>}
        </div>
      ))}

      {range.length > 0 && (
        <div className="toolbar-mini">
          <span>{range.length} kata</span>
          <button className="btn btn--sm-text" onClick={deleteWords} title="Bagian video saat kata ini diucapkan ikut terpotong. File aslimu tetap utuh."><Icon name="trash" />Hapus kata</button>
          {range.length === 1 && (
            <>
              <span className="muted">Awal</span>
              <button className="btn btn--icon btn--sm" onClick={() => nudge(range[0], "srcStart", -1)} aria-label="Awal kata lebih cepat">−</button>
              <button className="btn btn--icon btn--sm" onClick={() => nudge(range[0], "srcStart", 1)} aria-label="Awal kata lebih lambat">+</button>
              <span className="muted">Akhir</span>
              <button className="btn btn--icon btn--sm" onClick={() => nudge(range[0], "srcEnd", -1)} aria-label="Akhir kata lebih cepat">−</button>
              <button className="btn btn--icon btn--sm" onClick={() => nudge(range[0], "srcEnd", 1)} aria-label="Akhir kata lebih lambat">+</button>
            </>
          )}
          <button className="btn btn--icon btn--sm" onClick={() => setSel(null)} aria-label="Batal pilih"><Icon name="close" /></button>
        </div>
      )}

      {words.length > 0 ? (
        <p className="transcript" aria-label="Transkrip">
          {words.map((w, i) => {
            const on = range.includes(w);
            return editing === w.id ? (
              <input key={w.id} className="transcript__edit" autoFocus defaultValue={w.text}
                onBlur={(e) => { setEditing(null); if (e.target.value.trim() && e.target.value !== w.text) ed.op({ type: "updateWord", id: w.id, text: e.target.value.trim() }); }}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditing(null); }} />
            ) : (
              <span key={w.id} role="button" tabIndex={0} className={"word" + (on ? " is-sel" : "") + (w.estimated ? " is-est" : "")}
                title={`${timecode(frames.get(w.id)!.start, fps)}${w.estimated ? " · waktunya perkiraan" : ""}\nKlik untuk lompat · Shift+klik untuk memilih beberapa kata · klik dua kali untuk membetulkan tulisan`}
                onClick={(e) => { ed.seek(frames.get(w.id)!.start); setSel(e.shiftKey && sel ? { a: sel.a, b: i } : { a: i, b: i }); }}
                onDoubleClick={() => setEditing(w.id)}
                onKeyDown={(e) => { if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); e.stopPropagation(); deleteWords(); } }}>
                {w.text}{" "}
              </span>
            );
          })}
        </p>
      ) : p.transcript.words.length === 0 && <p className="muted">Belum ada transkrip.</p>}
      {cutCount > 0 && <p className="hint">{cutCount} kata sudah terpotong dan disembunyikan.</p>}
    </div>
  );
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type ClaudeTask } from "./api.ts";
import { useEd } from "./ed.ts";
import { Icon } from "./icons.tsx";

const STATUS: Record<string, { label: string; cls: string }> = {
  "terhubung": { label: "Claude", cls: "ok" },
  "belum-login": { label: "Claude belum masuk", cls: "warn" },
  "tidak-terpasang": { label: "Claude belum dipasang", cls: "bad" },
  "memeriksa": { label: "Memeriksa Claude…", cls: "idle" },
};

/** Pil status Claude di bilah atas; klik membuka panel Claude. */
export function ClaudePill() {
  const ed = useEd();
  const c = ed.g.claude;
  const st = STATUS[c.state];
  const running = ed.s.claude.tasks.some((t) => t.state === "berjalan");
  const pending = ed.s.pending.length;
  return (
    <button className={`pill pill--${st.cls}` + (ed.claudeOpen ? " is-on" : "")} onClick={() => ed.setClaudeOpen(!ed.claudeOpen)}
      aria-expanded={ed.claudeOpen} data-tip={c.state === "terhubung" ? "Claude siap, memakai akun Claude-mu" : st.label}>
      <span className="pill__dot" aria-hidden="true" />
      {running ? <><span className="spinner" aria-hidden="true" />Claude bekerja</> : st.label}
      {pending > 0 && <span className="count">{pending}</span>}
    </button>
  );
}

/** Aksi Claude yang dipakai dari panel lain: tampilkan perkiraan ukuran tugas dulu (kuota milik user). */
export function useClaudeAction() {
  const ed = useEd();
  return async (action: string, text = "") => {
    if (ed.g.claude.state === "tidak-terpasang") { ed.setClaudeOpen(true); return false; }
    const est = await api.claudeEstimate(action).catch(() => ({ text: "" }));
    if (action !== "ask" && !confirm(`Minta Claude mengerjakan ini?\nPerkiraan besar pekerjaan: ${est.text}`)) return false;
    ed.setClaudeOpen(true);
    return ed.run(() => api.claudeRun(action, text));
  };
}

export function ClaudePanel() {
  const ed = useEd();
  const c = ed.g.claude;
  const { tasks } = ed.s.claude;
  const [text, setText] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const runAction = useClaudeAction();
  const last = tasks.at(-1);
  const logLen = last?.log.length ?? 0;
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [logLen, tasks.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (text.trim() && (await runAction("ask", text))) setText("");
  };

  return (
    <aside className="claude" aria-labelledby="claude-h">
      <div className="panel__head">
        <h2 id="claude-h" className="panel__title">Claude</h2>
        <button className="btn btn--sm-text" onClick={() => ed.run(api.claudeNewSession)} title="Claude melupakan obrolan sebelumnya tentang proyek ini">Percakapan baru</button>
        <button className="btn btn--icon" onClick={() => ed.setClaudeOpen(false)} aria-label="Tutup panel Claude"><Icon name="close" /></button>
      </div>

      {c.state !== "terhubung" && (
        <div className="notice">
          {c.state === "tidak-terpasang" && <p>Claude belum dipasang di komputer ini. Pasang Claude Code dari <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer">claude.com/claude-code</a>, lalu masuk dengan akun Claude-mu.</p>}
          {c.state === "belum-login" && <>
            <p>Claude sudah terpasang tapi belum masuk ke akunmu.</p>
            <ol className="steps">
              <li>Tekan <b>Masuk ke Claude</b>. Halaman masuk terbuka di browser.</li>
              <li>Masuk dengan akun Claude yang sama, lalu izinkan.</li>
              <li>Kembali ke sini dan tekan <b>Cek ulang</b>.</li>
            </ol>
            <p className="hint">Login aplikasi Claude di desktop tidak otomatis ikut; cukup sekali ini saja.</p>
            <button className="btn btn--primary" onClick={() => api.claudeLogin().catch((e) => alert((e as Error).message))}>Masuk ke Claude</button>
          </>}
          {c.state === "memeriksa" && <p>Memeriksa Claude…</p>}
          <button className="btn btn--sm-text" onClick={() => api.claudeStatus(true).then(() => ed.run(api.state))}>Cek ulang</button>
          <p className="hint">Mengimpor, memotong, menyunting, dan mengekspor video tetap bisa tanpa Claude.</p>
        </div>
      )}

      {ed.s.pending.length > 0 && (
        <section className="pending" aria-label="Usulan Claude">
          <div className="row row--between">
            <strong>{ed.s.pending.length} usulan menunggu</strong>
            <span className="row">
              <button className="btn btn--sm-text" onClick={() => ed.run(() => api.settle("all", true))}>Terima semua</button>
              <button className="btn btn--sm-text" onClick={() => ed.run(() => api.settle("all", false))}>Tolak semua</button>
            </span>
          </div>
          <ul>
            {ed.s.pending.map((u) => (
              <li key={u.id} className="pending__item">
                <span>{u.label}</span>
                <button className="btn btn--icon btn--sm" onClick={() => ed.run(() => api.settle([u.id], true))} aria-label={`Terima ${u.label}`} title="Terima"><Icon name="check" /></button>
                <button className="btn btn--icon btn--sm" onClick={() => ed.run(() => api.settle([u.id], false))} aria-label={`Tolak ${u.label}`} title="Tolak"><Icon name="close" /></button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="claude__log" ref={logRef} aria-live="polite">
        {tasks.length === 0 && <p className="muted">Minta Claude membantu: usulkan potongan, buat rencana, kerjakan catatanmu, atau tanya apa saja tentang video ini.</p>}
        {tasks.map((t) => <TaskView key={t.id} t={t} />)}
      </div>

      <div className="claude__quick">
        {[["cuts", "Usulkan potongan"], ["plan", "Buat rencana"], ["revise", "Kerjakan catatan"], ["auto-assets", "Pasang elemen sesuai ucapan"]].map(([a, l]) => (
          <button key={a} className="btn btn--chip" onClick={() => runAction(a)}>{l}</button>
        ))}
      </div>
      <form className="claude__input" onSubmit={send}>
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Tulis permintaan…  (Ctrl+Enter kirim)" aria-label="Pesan ke Claude"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(e); }} />
        {last && (last.state === "berjalan" || last.state === "antre")
          ? <button type="button" className="btn" onClick={() => ed.run(() => api.claudeStop())}><Icon name="stop" />Hentikan</button>
          : <button type="submit" className="btn btn--primary" disabled={!text.trim()}><Icon name="send" />Kirim</button>}
      </form>
    </aside>
  );
}

/** Nama alat Claude diganti kalimat biasa; isi teknisnya tidak ditampilkan. */
const TOOL_LABEL: Record<string, string> = {
  cz_get_project: "Membaca proyek", cz_get_timeline: "Membaca linimasa", cz_get_transcript: "Membaca transkrip", cz_get_frame: "Melihat gambar dari video",
  cz_propose_cuts: "Mengusulkan potongan", cz_apply_cuts: "Memotong video", cz_set_scenes: "Menyusun rencana", cz_update_scene: "Mengubah bagian",
  cz_list_assets: "Melihat pilihan elemen", cz_add_asset: "Menambah elemen", cz_update_asset: "Mengubah elemen", cz_remove_asset: "Menghapus elemen",
  cz_set_caption: "Mengatur subtitle", cz_save_template: "Menyimpan gaya edit", cz_save_asset_def: "Menyimpan elemen gaya", cz_reply_note: "Membalas catatan",
  cz_add_note: "Menambah catatan", cz_set_note_status: "Menandai catatan", cz_render: "Memulai ekspor", cz_set_status: "Melaporkan kemajuan",
  Read: "Membaca panduan gaya", Glob: "Membaca panduan gaya", Grep: "Membaca panduan gaya",
};
const toolLabel = (text: string) => TOOL_LABEL[text.split(" ")[0]] ?? "Bekerja";

function TaskView({ t }: { t: ClaudeTask }) {
  const stateLabel = { antre: "Antre", berjalan: "Berjalan", selesai: "Selesai", gagal: "Gagal", dihentikan: "Dihentikan" }[t.state];
  return (
    <article className={`task task--${t.state}`}>
      <header className="task__head">
        <strong>{t.label}</strong>
        <span className="task__state">{t.state === "berjalan" && <span className="spinner" aria-hidden="true" />}{stateLabel}</span>
      </header>
      {t.log.filter((l) => l.kind !== "user").map((l, i) => (
        <p key={i} className={`log log--${l.kind}`}>
          {l.kind === "tool" && <Icon name="wand" />}
          {l.kind === "frame" && <Icon name="image" />}
          <span>{l.kind === "tool" ? toolLabel(l.text) : l.text}</span>
        </p>
      ))}
    </article>
  );
}

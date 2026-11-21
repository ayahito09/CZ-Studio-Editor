import { useEffect, useState } from "react";
import { wordFrames, type Note, type Scene, type SceneStatus } from "@cz/core";
import { api, noteImageUrl, uploadNoteImage } from "./api.ts";
import { useClaudeAction } from "./ClaudePanel.tsx";
import { useEd } from "./ed.ts";
import { Icon } from "./icons.tsx";
import { Section } from "./Section.tsx";
import { SkillControlsTab } from "./SkillControlsTab.tsx";
import { SkillSceneTab } from "./SkillSceneTab.tsx";
import { timecode, useStore } from "./store.ts";

const STATUS: { id: SceneStatus; label: string }[] = [
  { id: "draft", label: "Konsep" }, { id: "diubah", label: "Diubah" }, { id: "disetujui", label: "Disetujui" }, { id: "dikunci", label: "Dikunci" },
];
const BEAT_HUE: Record<string, number> = { hook: 18, konteks: 210, isi: 150, bukti: 280, cta: 340 };
export const beatColor = (beat: string) => `hsl(${BEAT_HUE[beat.toLowerCase()] ?? (([...beat].reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360)} 70% 60%)`;

/** Scene yang dipilih, atau scene di bawah playhead. */
function useScene(): Scene | null {
  const ed = useEd();
  const f = useStore(ed.playhead);
  return ed.project.scenes.find((s) => ed.selection.has(s.id)) ?? ed.project.scenes.find((s) => f >= s.start && f < s.end) ?? null;
}

export function SceneList() {
  const ed = useEd();
  const p = ed.project;
  const fps = p.sequence.fps;
  const claude = useClaudeAction();
  const cur = useScene();

  // Tambah scene: pecah scene di bawah playhead (atau buat satu scene untuk seluruh video).
  const split = () => {
    const f = ed.playhead.get();
    if (!p.scenes.length) { ed.op({ type: "setScenes", scenes: [{ title: "Scene 1", start: 0, end: Math.max(1, p.sequence.durationFrames) }] }); return; }
    const s = p.scenes.find((x) => f > x.start && f < x.end);
    if (!s) return;
    const list = p.scenes.flatMap((x) => (x === s ? [{ ...x, end: f }, { ...x, id: undefined, title: `${x.title} (2)`, start: f, choice: null, options: [], camera: null, status: "draft" as const }] : [x]));
    ed.op({ type: "setScenes", scenes: list });
  };

  return (
    <aside className="panel media" aria-labelledby="scenes-h">
      <div className="panel__head">
        <h2 id="scenes-h" className="panel__title">Bagian <span className="count">{p.scenes.length || ""}</span></h2>
        <button className="btn btn--sm-text" onClick={split} title="Bagi di posisi sekarang"><Icon name="plus" />Bagi</button>
      </div>
      <button className="btn btn--primary" onClick={() => claude("plan")} disabled={!p.transcript.words.length} title={p.transcript.words.length ? "" : "Buat transkrip dulu di tahap Bahan"}>
        <Icon name="wand" />{p.scenes.length ? "Buat ulang rencana dengan Claude" : "Buat rencana dengan Claude"}
      </button>
      {!p.skill && <p className="hint">Pilih gaya edit di tahap Sunting supaya tiap bagian punya pilihan tampilan.</p>}
      <ol className="scene-list">
        {p.scenes.map((s, i) => {
          const open = p.notes.filter((n) => n.sceneId === s.id && n.status !== "selesai").length;
          return (
            <li key={s.id}>
              <button className={"scene-item" + (cur?.id === s.id ? " is-on" : "")} onClick={() => { ed.select([s.id]); ed.seek(s.start); }}>
                <span className="scene-item__beat" style={{ background: beatColor(s.beat || "x") }} aria-hidden="true" />
                <span className="scene-item__body">
                  <strong>{i + 1}. {s.title}</strong>
                  <span className="muted">Mulai detik {(s.start / fps).toFixed(1).replace(".", ",")} · {((s.end - s.start) / fps).toFixed(1).replace(".", ",")} detik{s.beat ? ` · ${s.beat}` : ""}</span>
                </span>
                <span className={`badge badge--${s.status}`}>{STATUS.find((x) => x.id === s.status)?.label}</span>
                {open > 0 && <span className="count" title={`${open} catatan terbuka`}>{open}</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {p.notes.some((n) => n.status !== "selesai") && (
        <button className="btn" onClick={() => claude("revise")}><Icon name="wand" />Kerjakan catatan dengan Claude</button>
      )}
    </aside>
  );
}

// Tiga kelompok fungsi: tampilan bagian (gaya, atur, kamera), isinya (teks, efek suara), dan catatan revisi (+ riwayat).
type Tab = "tampilan" | "isi" | "catatan";
const TABS: { id: Tab; label: string }[] = [
  { id: "tampilan", label: "Tampilan" }, { id: "isi", label: "Teks & suara" }, { id: "catatan", label: "Catatan" },
];

export function PlanPanel() {
  const ed = useEd();
  const s = useScene();
  const [tab, setTab] = useState<Tab>("tampilan");
  if (!s) return <aside className="panel inspector"><h2 className="panel__title">Rencana</h2><p className="muted">Belum ada bagian. Buat rencana dengan Claude, atau tekan Bagi untuk membaginya sendiri.</p></aside>;
  const locked = s.status === "dikunci";
  const set = (changes: Partial<Scene>) => ed.op({ type: "updateScene", id: s.id, changes });
  const notes = ed.project.notes.filter((n) => n.sceneId === s.id);
  return (
    <aside className="panel inspector" aria-labelledby="scene-h">
      <input id="scene-h" className="title-input title-input--panel" defaultValue={s.title} key={s.id + s.title} aria-label="Judul bagian" disabled={locked}
        onBlur={(e) => e.target.value.trim() && e.target.value !== s.title && set({ title: e.target.value.trim() })} />
      <div className="row scene-meta">
        <input className="short" defaultValue={s.beat} key={s.id + s.beat} placeholder="Peran, mis. pembuka" aria-label="Peran bagian" disabled={locked} onBlur={(e) => e.target.value !== s.beat && set({ beat: e.target.value })} />
        <select value={s.status} onChange={(e) => set({ status: e.target.value as SceneStatus })} aria-label="Status bagian">
          {STATUS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </div>
      {s.summary && <p className="scene-summary">{s.summary}</p>}
      {s.reason && <p className="hint">Alasan dipisah di sini: {s.reason}</p>}
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={"tabs__btn" + (tab === t.id ? " is-on" : "")} onClick={() => setTab(t.id)}>
            {t.label}{t.id === "catatan" && notes.some((n) => n.status !== "selesai") ? <span className="count">{notes.filter((n) => n.status !== "selesai").length}</span> : null}
          </button>
        ))}
      </div>
      {locked && tab !== "catatan" && <p className="hint">Dikunci. Ubah status untuk membuka.</p>}
      {tab === "tampilan" && <>
        <Section title="Gaya">{s.skill ? <SkillSceneTab s={s} /> : <StyleTab s={s} />}</Section>
        <Section title={s.skill ? "Atur" : "Atur & kamera"}>{s.skill ? <SkillControlsTab s={s} /> : <CustomTab s={s} />}</Section>
      </>}
      {tab === "isi" && <>
        <Section title="Teks">{<TextTab s={s} />}</Section>
        <Section title="Efek suara">{<SfxTab s={s} />}</Section>
      </>}
      {tab === "catatan" && <>
        <Section title="Catatan" count={notes.filter((n) => n.status !== "selesai").length}><NotesTab s={s} notes={notes} /></Section>
        <Section title="Riwayat" open={false}><HistoryTab /></Section>
      </>}
    </aside>
  );
}

function StyleTab({ s }: { s: Scene }) {
  const ed = useEd();
  const presets = ed.lib?.template?.stylePresets ?? [];
  const choose = (optionId: string) => {
    const edited = ed.project.assets.some((a) => a.sceneId === s.id && a.edited && !a.locked);
    if (edited && !confirm("Elemen di bagian ini sudah kamu ubah. Ganti dengan elemen dari pilihan baru?\n(Elemen yang dikunci tetap ada; bisa dibatalkan dengan Ctrl+Z.)")) return;
    ed.run(() => api.choose(s.id, optionId));
  };
  const addPreset = (presetId: string) => {
    const id = String.fromCharCode(65 + s.options.length);
    ed.op({ type: "updateScene", id: s.id, changes: { options: [...s.options, { id, presetId, star: s.options.length === 0 }] } });
  };
  const unused = presets.filter((p) => !s.options.some((o) => o.presetId === p.id));
  /** Tampilan yang sama di semua bagian lain yang tidak dikunci: pakai opsi yang sudah ada, atau tambahkan dulu. */
  const applyAll = (presetId: string) => {
    if (!confirm("Pakai tampilan ini di semua bagian yang tidak dikunci? Elemen tiap bagian ikut diganti (bisa dibatalkan dengan Ctrl+Z).")) return;
    ed.run(async () => {
      let st = await api.state();
      for (const x of ed.project.scenes) {
        if (x.id === s.id || x.status === "dikunci") continue;
        let opt = x.options.find((o) => o.presetId === presetId);
        if (!opt) {
          opt = { id: String.fromCharCode(65 + x.options.length), presetId, star: false };
          await ed.op({ type: "updateScene", id: x.id, changes: { options: [...x.options, opt] } });
        }
        st = await api.choose(x.id, opt.id);
      }
      return st;
    });
  };
  return (
    <div className="stack">
      {s.options.length === 0 && <p className="muted">Belum ada pilihan tampilan. Buat rencana dengan Claude, atau tambahkan di bawah.</p>}
      {s.options.map((o) => {
        const pr = presets.find((x) => x.id === o.presetId);
        const on = s.choice === o.id;
        return (
          <div key={o.id} className={"option" + (on ? " is-on" : "")}>
            <div className="option__head">
              <strong>{o.id}. {pr?.name ?? o.presetId}{o.star ? " ★" : ""}</strong>
              <button className={"btn btn--sm-text" + (on ? " is-on" : "")} disabled={s.status === "dikunci"} onClick={() => choose(o.id)}>{on ? "Dipakai · pasang lagi" : "Pakai"}</button>
            </div>
            {pr && <button className="btn btn--sm-text style-row__all" onClick={() => applyAll(o.presetId)} title="Pakai tampilan ini di semua bagian yang tidak dikunci">Terapkan ke semua</button>}
            {pr?.description && <p className="hint">{pr.description}</p>}
            {o.why && <p className="option__why">{o.why}</p>}
            {!pr && <p className="hint">Tampilan ini tidak ada di gaya edit yang dipakai.</p>}
          </div>
        );
      })}
      {unused.length > 0 && s.options.length < 6 && (
        <label className="field"><span>Tambah pilihan tampilan</span>
          <select value="" onChange={(e) => e.target.value && addPreset(e.target.value)} disabled={s.status === "dikunci"}>
            <option value="">Pilih tampilan…</option>{unused.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
      )}
    </div>
  );
}

/** Kamera sesuai isi ucapan: tiap gerak masuk, tahan, lalu keluar ke bingkai awal. */
function CameraBlock({ s }: { s: Scene }) {
  const ed = useEd();
  const locked = s.status === "dikunci";
  const moves = s.camera?.moves ?? [];
  return (
    <div className="group">
      <span className="group__label">Kamera</span>
      <p className="hint">{moves.length ? `${moves.length} gerak · masuk, tahan, keluar` : "Belum ada gerak kamera."}</p>
      <div className="row">
        <button type="button" className="btn btn--sm-text" disabled={locked} onClick={() => ed.run(() => api.autoCamera([s.id]))} title="Gerak di kata penting, condong ke wajah">Atur otomatis</button>
        <button type="button" className="btn btn--sm-text" onClick={() => ed.run(() => api.autoCamera())}>Semua bagian</button>
      </div>
    </div>
  );
}

function CustomTab({ s }: { s: Scene }) {
  const ed = useEd();
  const controls = ed.lib?.template?.controls ?? [];
  if (!controls.length) return <div className="stack"><CameraBlock s={s} /><p className="muted">Gaya edit ini tidak punya pengaturan tambahan.</p></div>;
  const val = (id: string, d: unknown) => (id in s.custom ? s.custom[id] : d);
  const set = (id: string, v: unknown) => ed.op({ type: "updateScene", id: s.id, changes: { custom: { ...s.custom, [id]: v } } });
  const groups = [...new Set(controls.map((c) => c.group ?? ""))];
  return (
    <div className="stack">
      <CameraBlock s={s} />
      {groups.map((g) => (
        <div key={g} className="group">
          {g && <span className="group__label">{g}</span>}
          {controls.filter((c) => (c.group ?? "") === g).map((c) => (
            c.type === "toggle" ? <label key={c.id} className="check"><input type="checkbox" checked={!!val(c.id, c.default)} onChange={(e) => set(c.id, e.target.checked)} disabled={s.status === "dikunci"} /><span>{c.label}</span></label>
              : c.type === "slider" ? (
                <label key={c.id} className="field"><span>{c.label}: <b className="mono">{String(val(c.id, c.default ?? c.min ?? 0))}</b></span>
                  <input type="range" min={c.min ?? 0} max={c.max ?? 100} defaultValue={Number(val(c.id, c.default ?? 0))} key={s.id + String(val(c.id, c.default))} disabled={s.status === "dikunci"}
                    onPointerUp={(e) => set(c.id, Number(e.currentTarget.value))} onKeyUp={(e) => set(c.id, Number(e.currentTarget.value))} /></label>
              ) : (
                <label key={c.id} className="field field--inline"><span>{c.label}</span>
                  <select value={String(val(c.id, c.default ?? ""))} onChange={(e) => set(c.id, e.target.value)} disabled={s.status === "dikunci"}>
                    {c.options?.map((o) => <option key={o}>{o}</option>)}
                  </select></label>
              )
          ))}
        </div>
      ))}
      <p className="hint">Pengaturan ini disimpan untuk bagian ini dan dipakai Claude saat merapikan.</p>
    </div>
  );
}

function TextTab({ s }: { s: Scene }) {
  const ed = useEd();
  const frames = wordFrames(ed.project);
  const words = ed.project.transcript.words.filter((w) => { const f = frames.get(w.id); return f && f.start >= s.start && f.start < s.end; });
  const caps = ed.project.captions.filter((c) => c.start < s.end && c.end > s.start);
  return (
    <div className="stack">
      <p className="transcript">{words.length ? words.map((w) => <span key={w.id} className="word" onClick={() => ed.seek(frames.get(w.id)!.start)}>{w.text} </span>) : <span className="muted">Tidak ada ucapan di bagian ini.</span>}</p>
      <p className="hint">{caps.length} subtitle di bagian ini. Ubah teks dan tampilannya di tahap Sunting (klik dua kali di pratinjau).</p>
      {caps.length > 0 && (
        <div className="elem-acts">
          <button className="btn btn--sm-text" onClick={() => { ed.select([caps[0].id]); ed.setMode("edit"); }}>Buka subtitle</button>
          <button className="btn btn--sm-text" disabled={ed.project.captions.length < 2} title="Samakan gaya dan posisi semua subtitle dengan subtitle pertama di bagian ini"
            onClick={() => ed.op({ type: "batch", label: "Samakan gaya semua subtitle", ops: ed.project.captions.filter((x) => x.id !== caps[0].id).map((x) => ({ type: "updateCaption" as const, id: x.id, changes: { style: { ...caps[0].style }, position: { ...caps[0].position } } })) })}>Gaya ke semua</button>
        </div>
      )}
    </div>
  );
}

function SfxTab({ s }: { s: Scene }) {
  const ed = useEd();
  const roles = Object.keys(ed.lib?.template?.sfx ?? {});
  const assets = ed.project.assets.filter((a) => a.start < s.end && a.start + a.duration > s.start);
  if (!assets.length) return <p className="muted">Belum ada elemen di bagian ini.</p>;
  return (
    <ul className="plain stack">
      {assets.map((a) => {
        const name = ed.assetDefs.find((d) => d.id === a.defId)?.name ?? "Teks bebas";
        return (
          <li key={a.id} className="row row--between">
            <button className="link-btn" onClick={() => { ed.select([a.id]); ed.seek(a.start); }}>{name}</button>
            <select value={a.sfx.in ?? ""} aria-label={`Efek suara ${name}`} disabled={!roles.length || a.locked || s.status === "dikunci"}
              onChange={(e) => ed.op({ type: "updateAsset", id: a.id, changes: { sfx: { in: e.target.value || null } } })}>
              <option value="">Tanpa bunyi</option>{roles.map((r) => <option key={r}>{r}</option>)}
            </select>
          </li>
        );
      })}
      {assets.length > 0 && (
        <li><button className="btn btn--sm-text" disabled={!roles.length || s.status === "dikunci"} title="Pakai efek suara elemen pertama di bagian ini untuk semua elemen di proyek"
          onClick={() => ed.op({ type: "batch", label: "Samakan efek suara", ops: ed.project.assets.filter((x) => !x.locked).map((x) => ({ type: "updateAsset" as const, id: x.id, changes: { sfx: { in: assets[0].sfx.in ?? null } } })) })}>Efek suara ke semua elemen</button></li>
      )}
    </ul>
  );
}

function NotesTab({ s, notes }: { s: Scene; notes: Note[] }) {
  const ed = useEd();
  const fps = ed.project.sequence.fps;
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const claude = useClaudeAction();
  const add = async () => {
    if (!text.trim() && !images.length) return;
    const f = Math.min(s.end - 1, Math.max(s.start, ed.playhead.get()));
    if (await ed.op({ type: "addNote", note: { sceneId: s.id, frame: f, text: text.trim(), images } })) { setText(""); setImages([]); }
  };
  const pick = async (files: FileList | null) => {
    if (!files) return;
    setBusy(true);
    try { for (const f of [...files].slice(0, 6 - images.length)) { const p = await uploadNoteImage(f); setImages((xs) => [...xs, p].slice(0, 6)); } }
    catch (e) { alert((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="stack">
      {notes.map((n) => (
        <article key={n.id} className={`note note--${n.status}`}>
          <header className="row row--between">
            <button className="link-btn mono" onClick={() => ed.seek(n.frame)}>{timecode(n.frame, fps)}</button>
            <select value={n.status} onChange={(e) => ed.op({ type: "updateNote", id: n.id, changes: { status: e.target.value as Note["status"] } })} aria-label="Status catatan">
              <option value="terbuka">Terbuka</option><option value="selesai">Selesai</option><option value="konflik">Konflik</option>
            </select>
          </header>
          <p>{n.text}</p>
          {n.images.length > 0 && <div className="note__imgs">{n.images.map((im) => <a key={im} href={noteImageUrl(im)} target="_blank" rel="noreferrer"><img src={noteImageUrl(im)} alt="Gambar catatan" /></a>)}</div>}
          {n.replies.map((r, i) => <p key={i} className={`reply reply--${r.by}`}><b>{r.by === "claude" ? "Claude" : "Kamu"}:</b> {r.text}</p>)}
          <button className="link-btn" onClick={() => ed.op({ type: "removeNote", id: n.id })}>Hapus</button>
        </article>
      ))}
      <label className="field"><span>Catatan baru di {timecode(Math.min(s.end - 1, Math.max(s.start, ed.playhead.get())), fps)}</span>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="mis. caption lebih besar, kartu harga pakai warna aksen" /></label>
      {images.length > 0 && <div className="note__imgs">{images.map((im) => <img key={im} src={noteImageUrl(im)} alt="Lampiran" />)}</div>}
      <div className="row row--wrap">
        <label className="btn btn--sm-text"><Icon name="image" />{busy ? "Mengunggah…" : `Gambar (${images.length}/6)`}
          <input type="file" accept="image/*" multiple hidden disabled={images.length >= 6} onChange={(e) => { pick(e.target.files); e.target.value = ""; }} /></label>
        <button className="btn btn--primary" onClick={add} disabled={!text.trim() && !images.length}><Icon name="note" />Tambah catatan</button>
      </div>
      {notes.some((n) => n.status !== "selesai") && <button className="btn" onClick={() => claude("revise")}><Icon name="wand" />Kerjakan catatan dengan Claude</button>}
    </div>
  );
}

function HistoryTab() {
  const ed = useEd();
  const [items, setItems] = useState<{ label: string; source: string; at: number }[]>([]);
  useEffect(() => { api.history().then((h) => setItems(h.done.slice().reverse())).catch(() => {}); }, [ed.project]);
  const SRC: Record<string, string> = { manual: "Kamu", claude: "Claude", catatan: "Catatan" };
  return (
    <ol className="history-list">
      {items.map((x, i) => (
        <li key={i}><span className={`src src--${x.source}`}>{SRC[x.source] ?? x.source}</span>{x.label}<span className="muted mono">{new Date(x.at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span></li>
      ))}
      {!items.length && <li className="muted">Belum ada perubahan.</li>}
    </ol>
  );
}

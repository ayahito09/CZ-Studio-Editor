import { useEffect, useMemo, useRef, useState } from "react";
import { Thumbnail } from "@remotion/player";
import { buildCaptions, instantiate, type AssetDef, type NewAsset } from "@cz/core";
import { AssetPreview } from "@cz/composition";
import { api, uploadSkill, type SkillMeta } from "./api.ts";
import { useClaudeAction } from "./ClaudePanel.tsx";
import { useEd, type Ed } from "./ed.ts";
import { Icon } from "./icons.tsx";

export const ASSET_DRAG = "application/x-cz-asset";
export const FREE_TEXT = "__teks__";

/** Instans baru dari definisi (atau teks bebas) di frame dan posisi tertentu. */
export function newAssetFor(ed: Ed, defId: string, start: number, at?: { x: number; y: number }): NewAsset {
  const p = ed.project;
  const def = ed.lib?.assets.find((d) => d.id === defId);
  const base: NewAsset = def
    ? instantiate(def, ed.lib?.template?.tokens ?? {}, { start, fps: p.sequence.fps, seq: p.sequence })
    : { defId: null, start, duration: p.sequence.fps * 3, params: { text: "Teks baru" }, anim: { in: "blurRise", out: "blurFade" } };
  return at ? { ...base, transform: { ...(base.transform ?? { scale: 1, rotation: 0, opacity: 1 }), x: Math.round(at.x), y: Math.round(at.y) } as NewAsset["transform"] } : base;
}

export function AssetsPanel() {
  const ed = useEd();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("semua");
  const claude = useClaudeAction();
  const defs = ed.lib?.assets ?? [];
  const cats = ["semua", ...new Set(defs.map((d) => d.category))];
  const shown = defs.filter((d) => (cat === "semua" || d.category === cat) && (!q || (d.name + d.id).toLowerCase().includes(q.toLowerCase())));
  const addAt = (defId: string) => ed.op({ type: "addAssets", assets: [newAssetFor(ed, defId, ed.playhead.get())] });

  return (
    <aside className="panel media" aria-labelledby="assets-h">
      <SkillBox />
      <div className="panel__head">
        <h2 id="assets-h" className="panel__title">Elemen <span className="count">{defs.length || ""}</span></h2>
      </div>
      <div className="row row--wrap">
        <button className="btn btn--sm-text" disabled={!ed.project.transcript.words.length}
          onClick={() => ed.op({ type: "setCaptions", captions: buildCaptions(ed.project, ed.lib?.template?.caption.wordsPerLine ?? 4) })}
          title={ed.project.captions.length ? "Mengganti subtitle yang ada" : "Subtitle per kata, mengikuti ucapan"}>
          <Icon name="text" />{ed.project.captions.length ? "Buat ulang subtitle" : "Buat subtitle"}
        </button>
        <button className="btn btn--sm-text" disabled={!defs.length} onClick={() => claude("auto-assets")}><Icon name="wand" />Pasang sesuai ucapan</button>
      </div>
      {defs.length > 6 && (
        <div className="row">
          <input className="search" placeholder="Cari elemen" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari elemen" />
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Kategori">{cats.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
      )}
      <ul className="asset-grid">
        <li>
          <button className="asset-card asset-card--free" draggable onDragStart={(e) => e.dataTransfer.setData(ASSET_DRAG, FREE_TEXT)} onClick={() => addAt(FREE_TEXT)}
            title="Teks bebas · seret ke pratinjau atau linimasa, atau klik untuk menaruh di posisi sekarang">
            <span className="asset-card__thumb asset-card__thumb--free">Aa</span>
            <span className="asset-card__name">Teks bebas</span>
          </button>
        </li>
        {shown.map((d) => <AssetCard key={d.id} def={d} onAdd={() => addAt(d.id)} />)}
      </ul>
      {!ed.lib && <p className="hint">Pilih gaya edit di atas supaya pilihan elemennya muncul.</p>}
    </aside>
  );
}

function AssetCard({ def, onAdd }: { def: AssetDef; onAdd: () => void }) {
  const ed = useEd();
  const lib = useMemo(() => (ed.lib ? { template: ed.lib.template, assets: ed.lib.assets, base: ed.lib.base } : null), [ed.lib]);
  const props = useMemo(() => ({ def, lib, width: 1080, height: 1080 }), [def, lib]);
  return (
    <li>
      <button className="asset-card" draggable onDragStart={(e) => { e.dataTransfer.setData(ASSET_DRAG, def.id); e.dataTransfer.effectAllowed = "copy"; }}
        onClick={onAdd} title={`${def.name}${def.trigger ? `\nDipakai saat: ${def.trigger}` : ""}${def.license ? `\nLisensi: ${def.license}` : ""}\nSeret ke pratinjau atau linimasa, atau klik untuk menaruh di posisi sekarang`}>
        <span className="asset-card__thumb">
          <Thumbnail component={AssetPreview} inputProps={props} compositionWidth={1080} compositionHeight={1080} durationInFrames={90} fps={30}
            frameToDisplay={30} style={{ width: "100%", height: "100%" }} />
        </span>
        <span className="asset-card__name">{def.name}</span>
        <span className="asset-card__cat">{def.category}</span>
      </button>
    </li>
  );
}

/** Folder yang tidak perlu ikut disalin. */
export const skipped = (path: string) => /(^|\/)(\.git|node_modules|__pycache__)(\/|$)/.test(path);

/** Semua file dari seret-lepas, termasuk isi folder (beserta subfoldernya). */
export async function filesFromDrop(dt: DataTransfer) {
  const out: { path: string; file: File }[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    const path = prefix + entry.name;
    if (skipped(path) || out.length > 3000) return;
    if (entry.isFile) {
      out.push({ path, file: await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)) });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, path + "/");
      }
    }
  };
  // Ambil semua entri dulu: DataTransfer kosong lagi setelah await pertama.
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry()).filter((e): e is FileSystemEntry => !!e);
  for (const e of entries) await walk(e, "");
  return out;
}

/** Skill proyek: pilih, tambah, generate template lewat Claude, tinjau, dan ubah. */
function SkillBox() {
  const ed = useEd();
  const [skills, setSkills] = useState<SkillMeta[] | null>(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const [editText, setEditText] = useState("");
  const [review, setReview] = useState(false);
  const cur = ed.project.skill;
  const running = ed.s.claude.tasks.some((t) => t.state === "berjalan" || t.state === "antre");
  const load = () => api.skills().then(setSkills).catch(() => setSkills([]));
  useEffect(() => { load(); }, [running, ed.lib]);
  const meta = skills?.find((x) => x.id === cur?.id);
  const generated = cur && meta?.generated[cur.version];

  /** Unggah lalu langsung pakai gaya edit itu di proyek ini. */
  const install = async (files: { path: string; file: File }[]) => {
    if (!files.length) return;
    if (files.length > 3000) { alert("Folder ini terlalu besar untuk gaya edit (lebih dari 3000 file)."); return; }
    setProgress("Menyalin…");
    try {
      const r = await uploadSkill(files, (d, t) => setProgress(t > 1 ? `Menyalin ${d} dari ${t} file…` : "Menyalin…"));
      setSkills(r.skills);
      await ed.run(() => api.useSkill(r.meta.id, Math.max(...r.meta.versions)));
    } catch (err) { alert((err as Error).message); }
    setProgress(null);
  };
  const fromInput = (list: FileList | null) => install([...(list ?? [])].map((f) => ({ path: f.webkitRelativePath || f.name, file: f })).filter((x) => !skipped(x.path)));
  const generate = async () => {
    if (!cur || !confirm("Siapkan gaya edit dengan Claude?\nPerkiraan besar pekerjaan: besar (Claude membaca seluruh panduan gaya lalu membuat elemennya).")) return;
    ed.setClaudeOpen(true);
    await ed.run(() => api.generateSkill(cur.id, cur.version));
  };

  return (
    <section className="skillbox" aria-labelledby="skill-h">
      <div className="panel__head">
        <h2 id="skill-h" className="panel__title">Gaya edit</h2>
      </div>
      <div data-skill-drop className={"skill-drop" + (over ? " is-over" : "")}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
        onDrop={async (e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault(); e.stopPropagation(); setOver(false);
          install(await filesFromDrop(e.dataTransfer));
        }}>
        {progress ? <span className="skill-drop__busy"><span className="spinner" aria-hidden="true" />{progress}</span> : (
          <>
            <Icon name="upload" />
            <span>Seret folder gaya edit atau file .zip ke sini</span>
            <span className="skill-drop__pick">
              <button type="button" className="link-btn" onClick={() => folderInput.current?.click()}>Pilih folder</button>
              <span aria-hidden="true">·</span>
              <button type="button" className="link-btn" onClick={() => zipInput.current?.click()}>Pilih .zip</button>
            </span>
          </>
        )}
        <input ref={folderInput} type="file" hidden {...{ webkitdirectory: "", directory: "" }} onChange={(e) => { fromInput(e.target.files); e.target.value = ""; }} />
        <input ref={zipInput} type="file" accept=".zip" hidden onChange={(e) => { fromInput(e.target.files); e.target.value = ""; }} />
      </div>
      <select value={cur ? `${cur.id}@${cur.version}` : ""} aria-label="Gaya edit proyek"
        onChange={(e) => { const [id, v] = e.target.value.split("@"); ed.run(() => api.useSkill(id || null, Number(v))); }}>
        <option value="">Tanpa gaya edit</option>
        {skills?.flatMap((sk) => sk.versions.map((v) => <option key={sk.id + v} value={`${sk.id}@${v}`}>{sk.name}{sk.versions.length > 1 ? ` · versi ${v}` : ""}{sk.generated[v] ? "" : " (belum disiapkan)"}</option>))}
      </select>
      {cur && meta && Math.max(...meta.versions) > cur.version && <p className="hint">Ada versi lebih baru (versi {Math.max(...meta.versions)}). Proyek ini tetap memakai versi {cur.version} sampai kamu menggantinya.</p>}
      {cur && !generated && (
        <button className="btn btn--primary" onClick={generate} disabled={running}><Icon name="wand" />Siapkan gaya dengan Claude</button>
      )}
      {cur && generated && (
        <div className="row row--wrap">
          <button className="btn btn--sm-text" onClick={() => setReview(!review)}>{review ? "Tutup" : "Lihat isi gaya"}</button>
          <button className="btn btn--sm-text" onClick={generate} disabled={running}>Siapkan ulang</button>
        </div>
      )}
      {review && ed.lib && (
        <div className="template-review">
          {ed.lib.warnings.length > 0 && <div className="notice notice--warn"><strong>Peringatan</strong><ul>{ed.lib.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
          <strong>Pilihan tampilan</strong>
          <ul className="plain">{ed.lib.template?.stylePresets.map((p) => <li key={p.id}><b>{p.name}</b>{p.description ? ` — ${p.description}` : ""}</li>)}</ul>
          {!!ed.lib.template?.controls?.length && <><strong>Pengaturan tambahan</strong><ul className="plain">{ed.lib.template.controls.map((c) => <li key={c.id}>{c.group ? `${c.group} · ` : ""}{c.label}</li>)}</ul></>}
          <form className="path-form" onSubmit={(e) => { e.preventDefault(); if (cur && editText.trim()) { ed.setClaudeOpen(true); ed.run(() => api.editSkill(cur.id, cur.version, editText)).then(() => setEditText("")); } }}>
            <label className="field"><span>Minta Claude mengubah gaya (disimpan sebagai versi baru)</span>
              <input value={editText} onChange={(e) => setEditText(e.target.value)} placeholder="buat kartu harga lebih bulat" /></label>
          </form>
        </div>
      )}
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Player, Thumbnail } from "@remotion/player";
import { buildCaptions, instantiate, type AssetDef, type NewAsset } from "@cz/core";
import { AssetPreview } from "@cz/composition";
import { api, uploadSkill, type SkillMeta } from "./api.ts";
import { useClaudeAction } from "./ClaudePanel.tsx";
import { useEd, type Ed } from "./ed.ts";
import { Icon } from "./icons.tsx";

export const ASSET_DRAG = "application/x-cz-asset";
export const FREE_TEXT = "__teks__";

/** Instans baru dari definisi di frame dan posisi tertentu. Teks bebas = Judul bergerak (kode), bukan teks diam. */
export function newAssetFor(ed: Ed, defId: string, start: number, at?: { x: number; y: number }): NewAsset {
  const p = ed.project;
  const def = ed.assetDefs.find((d) => d.id === (defId === FREE_TEXT ? "cz.teks" : defId)) ?? ed.assetDefs[0];
  const base = instantiate(def, ed.lib?.template?.tokens ?? {}, { start, fps: p.sequence.fps, seq: p.sequence });
  // Param video (b-roll) langsung diisi video pertama proyek supaya langsung terlihat bergerak.
  // Hanya slot "media" (B-roll/video isi) yang langsung diisi video pertama; slot foto (profil, galeri, logo) dibiarkan kosong untuk diunggah.
  const video = p.media.find((m) => m.kind !== "image");
  if (def.params.media?.type === "media" && video) base.params = { ...base.params, media: video.id };
  return at ? { ...base, transform: { ...(base.transform ?? { scale: 1, rotation: 0, opacity: 1 }), x: Math.round(at.x), y: Math.round(at.y) } as NewAsset["transform"] } : base;
}

export function AssetsPanel() {
  const ed = useEd();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("semua");
  const claude = useClaudeAction();
  const defs = ed.assetDefs;
  const cats = ["semua", ...new Set(defs.map((d) => d.category))];
  const shown = defs.filter((d) => (cat === "semua" || d.category === cat) && (!q || (d.name + d.id).toLowerCase().includes(q.toLowerCase())));
  const addAt = (defId: string) => ed.op({ type: "addAssets", assets: [newAssetFor(ed, defId, ed.playhead.get())] });

  return (
    <aside className="panel media" aria-labelledby="assets-h">
      <SkillBox />
      <div className="panel__head">
        <h2 id="assets-h" className="panel__title">Elemen <span className="count">{defs.length || ""}</span></h2>
      </div>
      <div className="elem-acts">
        <button className="btn btn--sm-text" disabled={!ed.project.transcript.words.length}
          onClick={() => ed.op({ type: "setCaptions", captions: buildCaptions(ed.project, ed.lib?.template?.caption.wordsPerLine ?? 4) })}
          title={ed.project.captions.length ? "Mengganti subtitle yang ada" : "Subtitle per kata, mengikuti ucapan"}>
          <Icon name="text" />{ed.project.captions.length ? "Ulang subtitle" : "Buat subtitle"}
        </button>
        <button className="btn btn--sm-text" disabled={!ed.project.transcript.words.length} title="Claude memasang elemen bergerak di kata pemicunya"
          onClick={() => claude("auto-assets")}><Icon name="wand" />Pasang AI</button>
      </div>
      {defs.length > 6 && (
        <div className="elem-find">
          <input className="search" placeholder="Cari elemen" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari elemen" />
        </div>
      )}
      {cats.length > 2 && (
        <div className="cat-chips" role="radiogroup" aria-label="Kategori">
          {cats.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={cat === c} className={"cat-chip" + (cat === c ? " is-on" : "")} onClick={() => setCat(c)}>
              {c === "semua" ? "Semua" : c}
              <span className="cat-chip__n">{c === "semua" ? defs.length : defs.filter((d) => d.category === c).length}</span>
            </button>
          ))}
        </div>
      )}
      <ul className="asset-grid">
        {shown.map((d) => <AssetCard key={d.id} def={d} onAdd={() => addAt(d.id)} />)}
      </ul>
      {!ed.lib && <p className="hint">Elemen skill (kartu, mockup, ilustrasi khas skill) muncul di sini setelah kamu memilih skill.</p>}
    </aside>
  );
}

/** Kartu aset: diam di pose tengahnya, dan bergerak (berulang) saat disorot supaya geraknya terlihat sebelum dipasang. */
function AssetCard({ def, onAdd }: { def: AssetDef; onAdd: () => void }) {
  const ed = useEd();
  const [hover, setHover] = useState(false);
  const lib = useMemo(() => (ed.lib ? { template: ed.lib.template, assets: ed.lib.assets, base: ed.lib.base } : null), [ed.lib]);
  const props = useMemo(() => ({ def, lib, width: 1080, height: 1080, reg: ed.skillReg, packs: ed.packs }), [def, lib, ed.skillReg, ed.packs]);
  const dur = Math.max(30, Math.round((def.duration ?? 3) * 30));
  return (
    <li>
      <button className="asset-card" draggable onDragStart={(e) => { e.dataTransfer.setData(ASSET_DRAG, def.id); e.dataTransfer.effectAllowed = "copy"; }}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}
        onClick={onAdd} title={`${def.name}${def.description ? `\n${def.description}` : ""}${def.trigger ? `\nDipakai saat: ${def.trigger}` : ""}${def.license ? `\nLisensi: ${def.license}` : ""}\nSeret ke pratinjau atau linimasa, atau klik untuk menaruh di posisi sekarang`}>
        <span className="asset-card__thumb">
          {hover
            ? <Player component={AssetPreview} inputProps={props} compositionWidth={1080} compositionHeight={1080} durationInFrames={dur} fps={30}
                autoPlay loop controls={false} clickToPlay={false} style={{ width: "100%", height: "100%" }} />
            : <Thumbnail component={AssetPreview} inputProps={props} compositionWidth={1080} compositionHeight={1080} durationInFrames={dur} fps={30}
                frameToDisplay={Math.round(dur * 0.55)} style={{ width: "100%", height: "100%" }} />}
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

  /** Unggah lalu langsung pakai skill itu di proyek ini. */
  const install = async (files: { path: string; file: File }[]) => {
    if (!files.length) return;
    if (files.length > 3000) { alert("Folder ini terlalu besar untuk skill (lebih dari 3000 file)."); return; }
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
    if (!cur || !confirm("Siapkan skill dengan Claude?\nPerkiraan besar pekerjaan: besar (Claude membaca seluruh panduan gaya lalu menulis mesin skill dalam kode: setiap elemen beranimasi, bukan gambar diam).")) return;
    ed.setClaudeOpen(true);
    await ed.run(() => api.generateSkill(cur.id, cur.version));
  };

  return (
    <section className="skillbox" aria-labelledby="skill-h">
      <div className="panel__head">
        <h2 id="skill-h" className="panel__title">Skill</h2>
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
            <span title="Folder, .zip, .skill, .plugin, atau .md">Seret skill ke sini</span>
            <span className="skill-drop__pick">
              <button type="button" className="link-btn" onClick={() => folderInput.current?.click()}>Pilih folder</button>
              <span aria-hidden="true">·</span>
              <button type="button" className="link-btn" onClick={() => zipInput.current?.click()}>Pilih file</button>
            </span>
          </>
        )}
        <input ref={folderInput} type="file" hidden {...{ webkitdirectory: "", directory: "" }} onChange={(e) => { fromInput(e.target.files); e.target.value = ""; }} />
        <input ref={zipInput} type="file" accept=".zip,.skill,.plugin,.md" hidden onChange={(e) => { fromInput(e.target.files); e.target.value = ""; }} />
      </div>
      <select value={cur ? `${cur.id}@${cur.version}` : ""} aria-label="Skill proyek"
        onChange={(e) => { const [id, v] = e.target.value.split("@"); ed.run(() => api.useSkill(id || null, Number(v))); }}>
        <option value="">Tanpa skill</option>
        {skills?.flatMap((sk) => sk.versions.map((v) => <option key={sk.id + v} value={`${sk.id}@${v}`}>{sk.name}{sk.versions.length > 1 ? ` · versi ${v}` : ""}{sk.generated[v] ? "" : " (belum disiapkan)"}</option>))}
      </select>
      {cur && meta && Math.max(...meta.versions) > cur.version && <p className="hint">Ada versi lebih baru (versi {Math.max(...meta.versions)}). Proyek ini tetap memakai versi {cur.version} sampai kamu menggantinya.</p>}
      {cur && !generated && (
        <button className="btn btn--primary" onClick={generate} disabled={running}><Icon name="wand" />Siapkan gaya dengan Claude</button>
      )}
      {cur && generated && (
        <div className="row row--wrap">
          <button className="btn btn--sm-text" onClick={() => setReview(!review)}>{review ? "Tutup" : "Lihat isi gaya"}</button>
        </div>
      )}
      {review && ed.lib && (
        <div className="template-review">
          {ed.lib.warnings.length > 0 && <div className="notice notice--warn"><strong>Peringatan</strong><ul>{ed.lib.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
          <strong>Pilihan tampilan</strong>
          <ul className="plain">{ed.lib.styleOptions.map((o) => <li key={o.label}><b>{o.label}</b> — {o.ids.join(", ")}</li>)}</ul>
          <form className="path-form" onSubmit={(e) => { e.preventDefault(); if (cur && editText.trim()) { ed.setClaudeOpen(true); ed.run(() => api.editSkill(cur.id, cur.version, editText)).then(() => setEditText("")); } }}>
            <label className="field"><span>Minta Claude mengubah gaya (disimpan sebagai versi baru)</span>
              <input value={editText} onChange={(e) => setEditText(e.target.value)} placeholder="buat kartu harga lebih bulat" /></label>
          </form>
        </div>
      )}
    </section>
  );
}

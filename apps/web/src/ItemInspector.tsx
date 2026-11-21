import { BehindHead } from "./BehindHead.tsx";
import { useEffect, useRef, useState } from "react";
import { CAPTION_LAYOUTS, fullScale, instantiate, KEY_ACCENTS, paramValues, placementY, type Placement, type AssetDef, type AssetInstance, type Caption, type CaptionStyle, type Op, type ParamDef, type WordStyle } from "@cz/core";
import { ANIM_PRESETS, AnimPreview, CaptionPreview, transformAt } from "@cz/composition";

/** Nama gerakan untuk user. */
export const ANIM_LABEL: Record<string, string> = {
  fade: "Memudar", blurRise: "Naik dari buram", blurFade: "Buram memudar", pop: "Meletup", slideUp: "Masuk dari bawah",
  slideDown: "Masuk dari atas", slideLeft: "Masuk dari kanan", slideRight: "Masuk dari kiri", scaleIn: "Membesar", wipe: "Tersapu",
};
const animChoices = (dir: "in" | "out"): Choice[] => [{ id: "", label: "Tidak ada" },
  ...ANIM_PRESETS.map((p) => ({ id: p, label: ANIM_LABEL[p] ?? p, preview: miniPlayer(AnimPreview, { preset: p, dir, width: 320, height: 180 }) }))];
const ANIM_CHOICES = { in: animChoices("in"), out: animChoices("out") };
const capPreview = (p: Partial<{ activeEffect: string; inPreset: string }>) => miniPlayer(CaptionPreview, { ...p, width: 640, height: 360 } as never);
const HIGHLIGHT_CHOICES: Choice[] = [
  ["pil", "Pil"], ["garis", "Garis bawah"], ["glow", "Glow"], ["warna", "Berwarna"], ["skala", "Membesar"], ["tidak", "Tidak ditandai"],
].map(([id, label]) => ({ id, label, preview: capPreview({ activeEffect: id }) }));
const CAPTION_IN_CHOICES: Choice[] = [["springRise", "Pegas naik"], ...ANIM_PRESETS.map((p) => [p, ANIM_LABEL[p] ?? p]), ["none", "Langsung"]]
  .map(([id, label]) => ({ id, label, preview: capPreview({ inPreset: id, activeEffect: "tidak" }) }));
const LAYOUT_CHOICES: Choice[] = CAPTION_LAYOUTS.map((l) => ({ id: l.id, label: l.label, preview: miniPlayer(CaptionPreview, { layout: l.id, width: 640, height: 360 }) }));
const ACCENT_CHOICES: Choice[] = [{ id: "", label: "Ikuti gaya per kata" },
  ...KEY_ACCENTS.map((a) => ({ id: a.id, label: a.label, preview: miniPlayer(CaptionPreview, { keyAccent: a.id, width: 640, height: 360 }) }))];
/** Nama isi elemen yang umum dalam bahasa sehari-hari; selain itu dipakai apa adanya. */
const PARAM_LABEL: Record<string, string> = {
  title: "Judul", subtitle: "Subjudul", text: "Teks", lines: "Baris", items: "Daftar", width: "Lebar", height: "Tinggi", size: "Ukuran",
  color: "Warna", accent: "Warna aksen", image: "Gambar", icon: "Ikon", price: "Harga", label: "Label", value: "Angka", number: "Angka",
  name: "Nama", messages: "Pesan", caption: "Keterangan", url: "Alamat",
};
const paramLabel = (name: string, def: ParamDef) => def.label ?? PARAM_LABEL[name] ?? name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
import { mediaUrl, upload } from "./api.ts";
import { useEd } from "./ed.ts";
import { EffectPicker, miniPlayer, type Choice } from "./EffectPicker.tsx";
import { Icon } from "./icons.tsx";
import { timecode } from "./store.ts";

/** Kolom yang baru mengirim op saat selesai diubah (Enter/blur). */
function Field({ label, value, onCommit, type = "text", min, max, step, suffix }: {
  label: string; value: string | number; onCommit: (v: string) => void; type?: "text" | "number"; min?: number; max?: number; step?: number; suffix?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => { if (text !== String(value)) onCommit(text); };
  return (
    <label className={type === "text" ? "field field--text" : "field field--inline"}>
      <span>{label}</span>
      <span className="num">
        <input type={type} min={min} max={max} step={step} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setText(String(value)); e.currentTarget.blur(); } }} />
        {suffix && <span className="num__suffix">{suffix}</span>}
      </span>
    </label>
  );
}
const num = (s: string, d: number) => { const v = Number(s.replace(",", ".")); return Number.isFinite(v) ? v : d; };
/** Salinan aset untuk addAssets (id dan status edited dibuat ulang oleh core). */
export const withoutId = ({ id: _id, edited: _e, ...rest }: AssetInstance) => rest;

function ParamField({ name, def, value, onChange }: { name: string; def: ParamDef; value: unknown; onChange: (v: unknown) => void }) {
  const label = paramLabel(name, def);
  switch (def.type) {
    case "list":
      return (
        <label className="field"><span>{label} (satu per baris)</span>
          <textarea rows={3} defaultValue={Array.isArray(value) ? value.join("\n") : ""} key={JSON.stringify(value)}
            onBlur={(e) => onChange(e.target.value.split("\n").map((x) => x.trim()).filter(Boolean))} /></label>
      );
    case "color":
      return (
        <label className="field field--inline"><span>{label}</span>
          <span className="row">
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : "#143bff"} onChange={(e) => onChange(e.target.value)} aria-label={label} />
            <input className="mono short" defaultValue={String(value ?? "")} key={String(value)} onBlur={(e) => e.target.value !== value && onChange(e.target.value)} aria-label={`${label} (teks)`} />
          </span></label>
      );
    case "number":
      return <Field label={label} type="number" value={Number(value ?? 0)} min={def.min} max={def.max} step={def.step ?? 1} onCommit={(v) => onChange(Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, num(v, Number(value ?? 0)))))} />;
    case "bool":
      return <label className="check"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /><span>{label}</span></label>;
    case "select":
      return <label className="field field--inline"><span>{label}</span><select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>{def.options?.map((o) => <option key={o}>{o}</option>)}</select></label>;
    case "media":
      return <MediaField label={label} value={String(value ?? "")} onChange={onChange} />;
    default:
      return <Field label={label} value={String(value ?? "")} onCommit={onChange} />;
  }
}

/** Slot foto/video elemen: unggah file baru (masuk pustaka media, tidak ke timeline), pilih yang sudah ada, atau kosongkan (kembali ke gambar contoh). */
function MediaField({ label, value, onChange }: { label: string; value: string; onChange: (v: unknown) => void }) {
  const ed = useEd();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const cur = ed.project.media.find((m) => m.id === value);
  const pick = async (file: File) => {
    setBusy(true);
    let id: string | undefined;
    const ok = await ed.run(async () => { const r = await upload(file, () => {}, true); id = r.mediaId; return r; });
    setBusy(false);
    if (ok && id) onChange(id);
  };
  return (
    <div className="field mslot">
      <span>{label}</span>
      <div className="mslot__row">
        <span className="mslot__thumb" aria-hidden="true">
          {cur ? (cur.kind === "image" ? <img src={mediaUrl(cur.id, "proxy")} alt="" /> : <video src={mediaUrl(cur.id, "proxy")} muted preload="metadata" />) : <span>contoh</span>}
        </span>
        <div className="mslot__acts">
          <button type="button" className="btn btn--sm-text" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Mengunggah…" : cur ? "Ganti" : "Unggah foto/video"}</button>
          {cur && <button type="button" className="btn btn--sm-text" onClick={() => onChange("")}>Kosongkan</button>}
        </div>
        <input ref={input} type="file" accept="image/*,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f); }} />
      </div>
      {ed.project.media.length > 0 && (
        <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label}: pilih dari proyek`}>
          <option value="">Pilih dari proyek…</option>
          {ed.project.media.map((m) => <option key={m.id} value={m.id}>{m.kind === "image" ? "Foto" : "Video"}: {m.name}</option>)}
        </select>
      )}
    </div>
  );
}

export function AssetInspector({ a }: { a: AssetInstance }) {
  const ed = useEd();
  const fps = ed.project.sequence.fps;
  const def = a.defId ? ed.assetDefs.find((d) => d.id === a.defId) : undefined;
  const params = paramValues(def, a.params);
  const set = (changes: Record<string, unknown>) => ed.op({ type: "updateAsset", id: a.id, changes } as Op);
  const schema: Record<string, ParamDef> = def?.params ?? { text: { type: "text", label: "Teks" } };
  const sfxRoles = Object.keys(ed.lib?.template?.sfx ?? {});
  const word = a.anchorWordId ? ed.project.transcript.words.find((w) => w.id === a.anchorWordId) : null;
  const rel = ed.playhead.get() - a.start;
  const sec = (f: number) => Math.round((f / fps) * 10) / 10;

  return (
    <>
      <h2 id="insp-h" className="panel__title">{def?.name ?? (a.defId ? "Elemen ini sudah tidak ada di skill" : "Teks bebas")}</h2>
      <BehindHead start={a.start} end={a.start + a.duration} on={a.params.behindHead === true} locked={a.locked}
        onChange={(v) => set({ params: { ...a.params, behindHead: v || undefined } })} />
      <div className="row row--wrap">
        <button className={"btn btn--chip" + (a.locked ? " is-on" : "")} aria-pressed={a.locked} onClick={() => set({ locked: !a.locked })} title="Dikunci: Claude tidak akan mengubahnya">
          <Icon name={a.locked ? "lock" : "unlock"} />{a.locked ? "Terkunci" : "Kunci"}</button>
        <button className={"btn btn--chip" + (a.hidden ? " is-on" : "")} aria-pressed={a.hidden} onClick={() => set({ hidden: !a.hidden })}>
          <Icon name={a.hidden ? "eyeOff" : "eye"} />{a.hidden ? "Tersembunyi" : "Sembunyikan"}</button>
        {def && (a.detached
          ? <button className="btn btn--chip" onClick={() => set({ detached: false })} title="Ikutkan lagi saat skill diubah">Tidak ikut skill</button>
          : <button className="btn btn--chip is-on" onClick={() => set({ detached: true, params })} title="Klik supaya elemen ini tidak berubah saat skill diubah">Ikut skill</button>)}
      </div>

      <div className="group">
        <span className="group__label">Isi</span>
        {Object.entries(schema).map(([k, pd]) => (
          <ParamField key={k} name={k} def={pd} value={params[k]} onChange={(v) => set({ params: { ...a.params, [k]: v } })} />
        ))}
        {def && Object.keys(a.params).length > 0 && <button className="link-btn" onClick={() => set({ params: {} })}>Kembalikan ke bawaan</button>}
      </div>

      <QuickPlace a={a} def={def} />

      <div className="group">
        <span className="group__label">Posisi dan ukuran</span>
        <div className="grid2">
          <Field label="Kiri–kanan" type="number" value={Math.round(a.transform.x)} onCommit={(v) => set({ transform: { x: num(v, a.transform.x) } })} />
          <Field label="Atas–bawah" type="number" value={Math.round(a.transform.y)} onCommit={(v) => set({ transform: { y: num(v, a.transform.y) } })} />
          <Field label="Ukuran" type="number" step={5} value={Math.round(a.transform.scale * 100)} onCommit={(v) => set({ transform: { scale: Math.max(0.05, num(v, 100) / 100) } })} suffix="%" />
          <Field label="Putar" type="number" value={a.transform.rotation} onCommit={(v) => set({ transform: { rotation: num(v, 0) } })} suffix="°" />
          <Field label="Kejelasan" type="number" step={5} min={0} max={100} value={Math.round(a.transform.opacity * 100)} onCommit={(v) => set({ transform: { opacity: Math.min(1, Math.max(0, num(v, 100) / 100)) } })} suffix="%" />
        </div>
        <p className="hint">Paling mudah: seret dan tarik langsung di pratinjau.</p>
      </div>

      <div className="group">
        <span className="group__label">Waktu</span>
        <div className="grid2">
          <Field label="Mulai" type="number" step={0.1} value={sec(a.start)} onCommit={(v) => set({ start: Math.max(0, Math.round(num(v, 0) * fps)) })} suffix="dtk" />
          <Field label="Lama tampil" type="number" step={0.1} value={sec(a.duration)} onCommit={(v) => set({ duration: Math.max(1, Math.round(num(v, 0) * fps)) })} suffix="dtk" />
        </div>
        <p className="hint mono">{timecode(a.start, fps)} – {timecode(a.start + a.duration, fps)}</p>
        {word
          ? <p className="hint">Terikat ke kata “{word.text}” (ikut bergeser bila video dipotong). <button className="link-btn" onClick={() => set({ anchorWordId: null })}>Lepas</button></p>
          : <AnchorButton a={a} />}
      </div>

      <div className="group">
        <span className="group__label">Gerakan</span>
        {(["in", "out"] as const).map((k) => (
          <EffectPicker key={k} label={k === "in" ? "Masuk" : "Keluar"} choices={ANIM_CHOICES[k]} value={a.anim[k] ?? ""} onPick={(v) => set({ anim: { ...a.anim, [k]: v || null } })} />
        ))}
        <div className="row row--between">
          <span className="muted">{a.keyframes.length ? `${a.keyframes.length} titik gerak` : "Belum ada titik gerak"}</span>
          <button className="btn btn--sm-text" disabled={rel < 0 || rel >= a.duration} title="Atur posisi elemen, lalu simpan di sini. Di antara dua titik, elemen bergerak halus."
            onClick={() => { const t = transformAt(a, rel); set({ keyframes: [...a.keyframes.filter((k) => k.frame !== rel), { frame: rel, x: t.x, y: t.y, scale: t.scale, rotation: t.rotation, opacity: t.opacity }] }); }}>
            <Icon name="plus" />Simpan titik gerak di sini</button>
        </div>
        {a.keyframes.length > 0 && (
          <ul className="plain">
            {[...a.keyframes].sort((x, y) => x.frame - y.frame).map((k) => (
              <li key={k.frame} className="row row--between">
                <button className="link-btn mono" onClick={() => ed.seek(a.start + k.frame)}>{timecode(a.start + k.frame, fps)}</button>
                <button className="btn btn--icon btn--sm" aria-label="Hapus titik gerak" onClick={() => set({ keyframes: a.keyframes.filter((x) => x.frame !== k.frame) })}><Icon name="trash" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {sfxRoles.length > 0 && (
        <div className="group">
          <span className="group__label">Efek suara</span>
          <div className="grid2">
            {(["in", "out"] as const).map((k) => (
              <label key={k} className="field"><span>{k === "in" ? "Saat masuk" : "Saat keluar"}</span>
                <select value={a.sfx[k] ?? ""} onChange={(e) => set({ sfx: { [k]: e.target.value || null } })}>
                  <option value="">Tanpa bunyi</option>{sfxRoles.map((r) => <option key={r}>{r}</option>)}
                </select></label>
            ))}
          </div>
          <Field label="Volume" type="number" step={5} min={0} max={100} value={Math.round(a.sfx.volume * 100)} onCommit={(v) => set({ sfx: { volume: Math.min(1, Math.max(0, num(v, 100) / 100)) } })} suffix="%" />
        </div>
      )}

      <div className="actions">
        <button className="btn" onClick={() => ed.op({ type: "addAssets", assets: [{ ...withoutId(a), start: a.start + a.duration, locked: false }] })}><Icon name="plus" />Gandakan</button>
        <button className="btn" onClick={() => ed.op({ type: "reorderAsset", id: a.id, dir: 1 })} title="Ctrl+]">Ke depan</button>
        <button className="btn" onClick={() => ed.op({ type: "reorderAsset", id: a.id, dir: -1 })} title="Ctrl+[">Ke belakang</button>
        <button className="btn" onClick={() => ed.op({ type: "removeAssets", ids: [a.id] })} title="Delete"><Icon name="trash" />Hapus</button>
      </div>
    </>
  );
}

const SIZES: { label: string; scale: number }[] = [{ label: "Kecil", scale: 0.75 }, { label: "Sedang", scale: 1 }, { label: "Besar", scale: 1.3 }];

/** Tata letak cepat: taruh elemen di atas/tengah/bawah area aman, jadikan B-roll (latar grid putih di belakangnya), dan pilih ukuran. */
function QuickPlace({ a, def }: { a: AssetInstance; def: AssetDef | undefined }) {
  const ed = useEd();
  const seq = ed.project.sequence;
  const boxH = typeof def?.layout.h === "number" ? def.layout.h : 400;
  const set = (transform: Partial<AssetInstance["transform"]>) => ed.op({ type: "updateAsset", id: a.id, changes: { transform } } as Op);
  const y = (w: Placement, scale = a.transform.scale) => placementY(w, boxH, scale, seq.height);
  const at = (["atas", "tengah", "bawah"] as const).find((w) => Math.abs(a.transform.y - y(w)) < 4 && Math.abs(a.transform.x - seq.width / 2) < 4);
  const latarDef = ed.assetDefs.find((d) => d.id === "cz.latar"); // dari paket elemen lokal; tanpa paket tombol latar tidak tampil
  const behind = ed.project.assets.some((x) => x.defId === "cz.latar" && x.start <= a.start && x.start + x.duration >= a.start + a.duration);
  const boxW = typeof def?.layout.w === "number" ? def.layout.w : 900;
  const full = fullScale(boxW, boxH, seq);
  const isFull = Math.abs(a.transform.scale - full) < 0.01 && Math.abs(a.transform.y - seq.height / 2) < 4;
  // latar disisipkan di bawah elemen: elemen dipasang ulang sesudah latar (urutan aset = urutan lapisan)
  const withBackdrop = (label: string, gaya: string, scale: number) => {
    if (!latarDef) return;
    const bg = instantiate(latarDef, {}, { start: a.start, fps: seq.fps, seq }, { duration: a.duration, params: { gaya } });
    ed.op({ type: "batch", label, ops: [
      { type: "removeAssets", ids: [a.id] },
      { type: "addAssets", assets: [...(behind ? [] : [bg]), { ...withoutId(a), transform: { ...a.transform, x: seq.width / 2, y: seq.height / 2, scale } }] },
    ] } as Op);
  };
  const broll = () => withBackdrop("Jadikan B-roll", "grid-putih", a.transform.scale);
  const fullscreen = () => withBackdrop("Jadikan layar penuh", "biru", full);
  if (a.defId === "cz.latar") return null;
  return (
    <div className="group">
      <span className="group__label">Penempatan</span>
      <div className="seg">
        {(["atas", "tengah", "bawah"] as const).map((w) => (
          <button key={w} className={"seg__btn" + (at === w ? " is-on" : "")} disabled={a.locked} onClick={() => set({ x: seq.width / 2, y: y(w) })}>{w[0].toUpperCase() + w.slice(1)}</button>
        ))}
        {latarDef && <button className={"seg__btn" + (behind && !isFull ? " is-on" : "")} disabled={a.locked || behind} onClick={broll} title="Taruh di tengah dengan latar putih bergrid di belakangnya">B-roll</button>}
        {latarDef && <button className={"seg__btn" + (isFull ? " is-on" : "")} disabled={a.locked || isFull} onClick={fullscreen} title="Besarkan sampai memenuhi layar, dengan latar biru di belakangnya (latar bisa diganti di elemen Latar layar penuh)">Layar penuh</button>}
      </div>
      <span className="group__label">Ukuran</span>
      <div className="seg">
        {SIZES.map((z) => (
          <button key={z.label} className={"seg__btn" + (Math.abs(a.transform.scale - z.scale) < 0.01 ? " is-on" : "")} disabled={a.locked}
            onClick={() => set({ scale: z.scale, ...(at ? { y: y(at, z.scale) } : {}) })}>{z.label}</button>
        ))}
      </div>
    </div>
  );
}

function AnchorButton({ a }: { a: AssetInstance }) {
  const ed = useEd();
  const p = ed.project;
  // Kata yang sedang diucapkan di awal aset.
  const fps = p.sequence.fps;
  const word = p.transcript.words.find((w) => {
    const c = p.clips.find((x) => x.trackId === "V1" && x.mediaId === w.mediaId && x.srcIn <= w.srcStart && x.srcOut > w.srcStart);
    if (!c) return false;
    const f = c.start + Math.round((w.srcStart - c.srcIn) * fps);
    return Math.abs(f - a.start) <= fps / 2;
  });
  if (!word) return null;
  return <button className="link-btn" onClick={() => ed.op({ type: "updateAsset", id: a.id, changes: { anchorWordId: word.id } })}>Ikat ke kata “{word.text}”</button>;
}

const STYLES: { id: WordStyle; label: string }[] = [{ id: "normal", label: "Normal" }, { id: "tebal", label: "Tebal" }, { id: "serif", label: "Serif" }, { id: "aksen", label: "Aksen" }];

export function CaptionInspector({ c }: { c: Caption }) {
  const ed = useEd();
  const [wi, setWi] = useState<number | null>(null);
  const tpl = ed.lib?.template?.caption ?? {};
  const st = { ...tpl, ...(c.style as CaptionStyle) };
  const setStyle = (k: string, v: unknown) => ed.op({ type: "updateCaption", id: c.id, changes: { style: { ...c.style, [k]: v } } });
  const setWord = (i: number, changes: Record<string, unknown>) => ed.op({ type: "updateCaption", id: c.id, changes: { words: c.words.map((w, j) => (j === i ? { ...w, ...changes } : w)) } });
  const w = wi !== null ? c.words[wi] : null;

  return (
    <>
      <h2 id="insp-h" className="panel__title">Subtitle</h2>
      <BehindHead start={c.start} end={c.end} on={(c.style as Record<string, unknown>).behindHead === true} onChange={(v) => setStyle("behindHead", v || undefined)} />
      <div className="word-chips" role="group" aria-label="Kata di blok ini">
        {c.words.map((x, i) => (
          <button key={i} className={"chipword" + (i === wi ? " is-on" : "") + (x.style !== "normal" ? ` chipword--${x.style}` : "")} onClick={() => setWi(i === wi ? null : i)}>{x.text}</button>
        ))}
      </div>
      {w && wi !== null && (
        <div className="toolbar-mini">
          <div className="seg">{STYLES.map((s) => <button key={s.id} className={"seg__btn" + (w.style === s.id ? " is-on" : "")} onClick={() => setWord(wi, { style: s.id })}>{s.label}</button>)}</div>
          <input type="color" value={w.color ?? "#ffffff"} onChange={(e) => setWord(wi, { color: e.target.value })} aria-label="Warna kata" />
          {w.color && <button className="link-btn" onClick={() => setWord(wi, { color: undefined })}>Warna bawaan</button>}
          <Field label="Teks" value={w.text} onCommit={(v) => v.trim() && setWord(wi, { text: v.trim() })} />
          {wi > 0 && <button className="btn btn--sm-text" onClick={() => { ed.op({ type: "splitCaption", id: c.id, index: wi }); setWi(null); }}>Pisah mulai kata ini</button>}
        </div>
      )}
      <button className="btn btn--sm-text" onClick={() => ed.op({ type: "mergeCaption", id: c.id })}>Gabung dengan subtitle berikutnya</button>

      <div className="group">
        <span className="group__label">Posisi</span>
        <div className="seg">
          {(["atas", "dada", "bawah"] as const).map((p) => (
            <button key={p} className={"seg__btn" + (c.position.preset === p && c.position.y === undefined ? " is-on" : "")}
              onClick={() => ed.op({ type: "updateCaption", id: c.id, changes: { position: { preset: p } } })}>{p}</button>
          ))}
        </div>
      </div>

      <div className="group">
        <span className="group__label">Gaya</span>
        <Field label="Huruf" value={String(st.font ?? "")} onCommit={(v) => setStyle("font", v || undefined)} />
        <div className="grid2">
          <Field label="Ukuran" type="number" value={st.size ?? 68} onCommit={(v) => setStyle("size", num(v, 68))} />
          <label className="field"><span>Ketebalan</span>
            <select value={st.weight ?? 700} onChange={(e) => setStyle("weight", Number(e.target.value))}>
              <option value={400}>Normal</option><option value={600}>Agak tebal</option><option value={700}>Tebal</option><option value={900}>Sangat tebal</option>
            </select></label>
          <Field label="Jarak baris" type="number" step={0.05} value={st.lineHeight ?? 1.15} onCommit={(v) => setStyle("lineHeight", num(v, 1.15))} />
        </div>
        <label className="check"><input type="checkbox" checked={!!st.uppercase} onChange={(e) => setStyle("uppercase", e.target.checked)} /><span>Kapital semua</span></label>
        <EffectPicker label="Gaya subtitle" choices={LAYOUT_CHOICES} value={st.layout ?? "kata"} onPick={(v) => setStyle("layout", v === "kata" ? undefined : v)} />
        <EffectPicker label="Aksen kata kunci" choices={ACCENT_CHOICES} value={st.keyAccent ?? ""} onPick={(v) => setStyle("keyAccent", v || undefined)} />
        <EffectPicker label="Sorotan kata yang diucapkan" choices={HIGHLIGHT_CHOICES} value={st.activeEffect === "latar" ? "pil" : st.activeEffect ?? "pil"} onPick={(v) => setStyle("activeEffect", v === "pil" ? undefined : v)} />
        <EffectPicker label="Masuk (per kata)" choices={CAPTION_IN_CHOICES} value={st.in ?? "springRise"} onPick={(v) => setStyle("in", v === "springRise" ? undefined : v)} />
        <EffectPicker label="Keluar" choices={ANIM_CHOICES.out} value={st.out ?? ""} onPick={(v) => setStyle("out", v || undefined)} />
      </div>

      <div className="actions">
        <button className="btn" onClick={() => ed.op({ type: "batch", label: "Samakan gaya semua subtitle", ops: ed.project.captions.filter((x) => x.id !== c.id).map((x) => ({ type: "updateCaption", id: x.id, changes: { style: { ...c.style }, position: { ...c.position } } })) })}
          disabled={ed.project.captions.length < 2}>Pakai untuk semua subtitle</button>
        <button className="btn" onClick={() => ed.op({ type: "updateCaption", id: c.id, changes: { style: {} } })} disabled={!Object.keys(c.style).length}>Kembalikan ke bawaan</button>
        <button className="btn" onClick={() => ed.op({ type: "removeCaptions", ids: [c.id] })}><Icon name="trash" />Hapus</button>
      </div>
    </>
  );
}

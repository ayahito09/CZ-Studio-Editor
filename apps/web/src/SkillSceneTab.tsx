// Gaya scene yang digambar komponen skill: pilihan gaya dari katalog SKILL.md, teks, waktu, dan penyesuaian lapisan.
// Semua tersimpan sebagai props scene (data), jadi pratinjau dan render memakai nilai yang sama.
import { useEffect, useState } from "react";
import type { Scene } from "@cz/core";
import { useEd } from "./ed.ts";
import { EffectPicker } from "./EffectPicker.tsx";
import { adjustOf, adjustOp, skillLayer, type LayerAdjust } from "./SkillOverlay.tsx";
import { useStore } from "./store.ts";

type Props = Record<string, unknown>;

function TextField({ label, value, onCommit, area, disabled }: { label: string; value: string; onCommit: (v: string) => void; area?: boolean; disabled?: boolean }) {
  const [t, setT] = useState(value);
  useEffect(() => setT(value), [value]);
  const commit = () => { if (t !== value) onCommit(t); };
  return (
    <label className="field"><span>{label}</span>
      {area
        ? <textarea rows={3} value={t} disabled={disabled} onChange={(e) => setT(e.target.value)} onBlur={commit} />
        : <input value={t} disabled={disabled} onChange={(e) => setT(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />}
    </label>
  );
}

function Num({ label, value, step, onCommit, disabled, placeholder }: { label: string; value: number | null; step: number; onCommit: (v: number | null) => void; disabled?: boolean; placeholder?: string }) {
  const [t, setT] = useState(value === null ? "" : String(value));
  useEffect(() => setT(value === null ? "" : String(value)), [value]);
  const commit = () => {
    const v = t.trim() === "" ? null : Number(t.replace(",", "."));
    if (v === null || Number.isFinite(v)) { if (v !== value) onCommit(v); } else setT(value === null ? "" : String(value));
  };
  return (
    <label className="field field--inline"><span>{label}</span>
      <span className="num"><input inputMode="decimal" step={step} value={t} placeholder={placeholder} disabled={disabled} onChange={(e) => setT(e.target.value)} onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} /></span>
    </label>
  );
}

/** Pilihan gaya berupa kotak; hover memutar efek asli bagian ini di pratinjau tanpa menyimpan apa pun. */
function StylePicker({ s, label, ids, value, disabled, withId, onPick }: {
  s: Scene; label: string; ids: string[]; value: string; disabled: boolean; withId: (id: string) => Props; onPick: (id: string) => void;
}) {
  const ed = useEd();
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    if (!hover) return;
    const p = ed.player.current;
    const back = ed.playhead.get();
    ed.setPreview({ ...ed.project, scenes: ed.project.scenes.map((x) => (x.id === s.id ? { ...x, skill: { component: x.skill!.component, props: withId(hover) } } : x)) });
    ed.seek(s.start);
    p?.play();
    // Putar ulang bagian ini selama kotak di-hover.
    const onFrame = (e: { detail: { frame: number } }) => { if (e.detail.frame >= s.end - 1 || e.detail.frame < s.start) p?.seekTo(s.start); };
    p?.addEventListener("frameupdate", onFrame);
    return () => { p?.removeEventListener("frameupdate", onFrame); p?.pause(); ed.setPreview(null); ed.seek(back); };
  }, [hover]);
  return <EffectPicker label={label} value={value} disabled={disabled} onPick={onPick} onHover={setHover}
    choices={ids.map((id) => ({ id, label: id.replace(/-/g, " "), }))} />;
}

export function SkillSceneTab({ s }: { s: Scene }) {
  const ed = useEd();
  const sel = useStore(skillLayer);
  const props = (s.skill?.props ?? {}) as Props;
  const style = (props.style ?? {}) as Record<string, string>;
  const groups = ed.lib?.styleOptions ?? [];
  const locked = s.status === "dikunci";
  const setProps = (changes: Props) => {
    const next = { ...props, ...changes };
    for (const [k, v] of Object.entries(changes)) if (v === null || v === "") delete next[k];
    void ed.op({ type: "updateScene", id: s.id, changes: { skill: { component: s.skill!.component, props: next } } });
  };
  /** Salin satu setelan scene ini ke semua bagian skill lain yang tidak dikunci (satu langkah undo). */
  const copyProps = (label: string, keys: string[]) => {
    const ops = ed.project.scenes.filter((x) => x.id !== s.id && x.skill && x.status !== "dikunci").map((x) => {
      const np = { ...(x.skill!.props as Props) };
      for (const k of keys) { if (props[k] === undefined) delete np[k]; else np[k] = props[k]; }
      return { type: "updateScene" as const, id: x.id, changes: { skill: { component: x.skill!.component, props: np } } };
    });
    if (ops.length) void ed.op({ type: "batch", label: `${label} ke semua bagian`, ops });
  };
  const All = ({ label, keys }: { label: string; keys: string[] }) => (
    <button type="button" className="btn btn--sm-text style-row__all" onClick={() => copyProps(label, keys)} title={`Pakai ${label.toLowerCase()} ini di semua bagian yang tidak dikunci`}>Terapkan ke semua</button>
  );
  const adjust = adjustOf(s);
  const setAdjust = (key: string, a: LayerAdjust | null) => void ed.op(adjustOp(s, key, a));
  const layers = [...new Set([...(sel ? [sel] : []), ...Object.keys(adjust)])];

  return (
    <div className="stack">
      <p className="hint">Digambar skill. Kosongkan untuk nilai otomatis.</p>
      {Object.entries(style).map(([key, value]) => {
        const g = groups.find((x) => x.ids.includes(value));
        // Pakai gaya ini di semua bagian skill lain yang tidak dikunci (satu langkah undo).
        const applyAll = () => {
          const ops = ed.project.scenes.filter((x) => x.id !== s.id && x.skill && x.status !== "dikunci").map((x) => {
            const xp = x.skill!.props as Props;
            return { type: "updateScene" as const, id: x.id, changes: { skill: { component: x.skill!.component, props: { ...xp, style: { ...((xp.style ?? {}) as Record<string, string>), [key]: value } } } } };
          });
          if (ops.length) void ed.op({ type: "batch", label: `${g?.label ?? key} ke semua bagian`, ops });
        };
        return (
          <div key={key} className="style-row">
            <StylePicker s={s} label={g?.label ?? key} ids={g ? g.ids : [value]} value={value} disabled={locked}
              withId={(id) => ({ ...props, style: { ...style, [key]: id } })} onPick={(id) => setProps({ style: { ...style, [key]: id } })} />
            <button type="button" className="btn btn--sm-text style-row__all" onClick={applyAll} title={`Pakai ${value} di semua bagian yang tidak dikunci`}>Terapkan ke semua</button>
          </div>
        );
      })}
      <TextField label="Kata kunci" value={String(props.keyword ?? "")} disabled={locked} onCommit={(v) => setProps({ keyword: v || null })} />
      <All label="Kata kunci" keys={["keyword"]} />
      <TextField label="Teks kartu" area value={String(props.text ?? "")} disabled={locked} onCommit={(v) => setProps({ text: v || null })} />
      <All label="Teks kartu" keys={["text"]} />
      <Num label="Kartu muncul di detik" step={0.1} value={typeof props.cardAt === "number" ? props.cardAt : null} placeholder="otomatis" disabled={locked} onCommit={(v) => setProps({ cardAt: v })} />
      <All label="Waktu kartu" keys={["cardAt"]} />
      <Num label="Tempo animasi" step={0.05} value={typeof props.tempoK === "number" ? props.tempoK : null} placeholder="1" disabled={locked} onCommit={(v) => setProps({ tempoK: v })} />
      <All label="Tempo" keys={["tempoK"]} />

      <h3 className="group__label">Elemen</h3>
      <p className="hint">Klik elemen di pratinjau, lalu seret atau ubah ukurannya.</p>
      {layers.length === 0 && <p className="muted">Belum ada elemen dipilih.</p>}
      {layers.map((key) => {
        const a = adjust[key] ?? {};
        const set = (c: LayerAdjust) => setAdjust(key, { ...a, ...c });
        return (
          <div key={key} className={"option" + (sel === key ? " is-on" : "")}>
            <div className="option__head">
              <strong>{key}</strong>
              <button className="btn btn--sm-text" disabled={locked || !adjust[key]} onClick={() => setAdjust(key, null)}>Kembalikan</button>
            </div>
            <button type="button" className="btn btn--sm-text style-row__all" disabled={!adjust[key]} title="Pakai posisi dan ukuran elemen ini di semua bagian yang punya elemen sama"
              onClick={() => { const ops = ed.project.scenes.filter((x) => x.id !== s.id && x.skill && x.status !== "dikunci").map((x) => adjustOp(x, key, adjust[key] ?? null)); if (ops.length) void ed.op({ type: "batch", label: `Elemen ${key} ke semua bagian`, ops }); }}>Terapkan ke semua</button>
            <Num label="Geser kanan" step={1} value={a.dx ?? 0} disabled={locked} onCommit={(v) => set({ dx: v ?? 0 })} />
            <Num label="Geser bawah" step={1} value={a.dy ?? 0} disabled={locked} onCommit={(v) => set({ dy: v ?? 0 })} />
            <Num label="Skala" step={0.05} value={a.scale ?? 1} disabled={locked} onCommit={(v) => set({ scale: Math.max(0.2, Math.min(4, v ?? 1)) })} />
            <label className="field field--inline"><span>Sembunyikan</span>
              <input type="checkbox" checked={!!a.hidden} disabled={locked} onChange={(e) => set({ hidden: e.target.checked })} /></label>
          </div>
        );
      })}
    </div>
  );
}

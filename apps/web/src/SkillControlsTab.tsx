// Menu Kustom untuk scene skill: grup dan kontrol dideklarasikan skill (remotion/cz-controls.json).
// Nilai disimpan di scene.skill.props.custom; pratinjau memakai mesin komposisi yang sama dengan render.
import { useEffect, useRef, useState } from "react";
import type { Scene } from "@cz/core";
import { controlValues, controlVisible, nextCustom, type ControlValue, type SkillControl, type SkillControlGroup } from "@cz/core";
import { useEd } from "./ed.ts";

type Props = Record<string, unknown>;
const same = (a: unknown, b: unknown) => String(a) === String(b);

const artSrc = (svg: string) => "data:image/svg+xml;utf8," + encodeURIComponent(svg);

/** Ilustrasi bawaan untuk slider: lintasan dengan titik di posisi nilai. */
function RangeArt({ c, v }: { c: SkillControl; v: number }) {
  const p = c.max > c.min ? (v - c.min) / (c.max - c.min) : 0;
  return (
    <svg viewBox="0 0 64 64" className="kart" aria-hidden="true">
      <rect x="8" y="29" width="48" height="6" rx="3" fill="#e2e8f0" />
      <rect x="8" y="29" width={48 * p} height="6" rx="3" fill="#3683D6" />
      <circle cx={8 + 48 * p} cy="32" r="6" fill="#fff" stroke="#3683D6" strokeWidth="2.5" />
    </svg>
  );
}

export function SkillControlsTab({ s }: { s: Scene }) {
  const ed = useEd();
  const groups: SkillControlGroup[] = ed.lib?.controls ?? [];
  const props = (s.skill?.props ?? {}) as Props;
  const locked = s.status === "dikunci";
  const [gi, setGi] = useState(0);
  const [live, setLive] = useState<Record<string, ControlValue> | null>(null); // tampilan nilai
  const [pv, setPv] = useState<Record<string, ControlValue> | null>(null); // pratinjau (ditunda saat slider digeser)
  const timer = useRef<number | undefined>(undefined);
  const saved = props.custom as Record<string, ControlValue> | undefined;
  const values = controlValues(groups, saved);
  const shown = live ? { ...values, ...live } : values;

  // Pratinjau sementara: scene diputar berulang dengan nilai yang sedang disorot/digeser, tanpa menyimpan.
  useEffect(() => {
    if (!pv || !s.skill) return;
    const p = ed.player.current, back = ed.playhead.get();
    ed.setPreview({ ...ed.project, scenes: ed.project.scenes.map((x) => (x.id === s.id ? { ...x, skill: { component: x.skill!.component, props: { ...props, custom: { ...saved, ...pv } } } } : x)) });
    ed.seek(s.start);
    p?.play();
    const onFrame = (e: { detail: { frame: number } }) => { if (e.detail.frame >= s.end - 1 || e.detail.frame < s.start) p?.seekTo(s.start); };
    p?.addEventListener("frameupdate", onFrame);
    return () => { p?.removeEventListener("frameupdate", onFrame); p?.pause(); ed.setPreview(null); ed.seek(back); };
  }, [pv]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (!groups.length) return <p className="muted">Skill ini belum punya menu kustom.</p>;

  const patch = (key: string, value: ControlValue, target: Scene = s): Props => {
    const c = nextCustom(groups, (target.skill!.props as Props).custom, key, value);
    const next = { ...(target.skill!.props as Props) };
    if (c) next.custom = c; else delete next.custom;
    return next;
  };
  const commit = (key: string, value: ControlValue) => {
    if (locked || same(shown[key], value) && !live) return;
    setLive(null); setPv(null);
    void ed.op({ type: "updateScene", id: s.id, changes: { skill: { component: s.skill!.component, props: patch(key, value) } } });
  };
  const resetGroup = (g: SkillControlGroup) => {
    const next = { ...props }, cur = { ...(saved ?? {}) };
    for (const c of g.controls) delete cur[c.key];
    if (Object.keys(cur).length) next.custom = cur; else delete next.custom;
    void ed.op({ type: "updateScene", id: s.id, changes: { skill: { component: s.skill!.component, props: next } } });
  };
  const applyAll = (g: SkillControlGroup) => {
    const targets = ed.project.scenes.filter((x) => x.id !== s.id && x.skill && x.status !== "dikunci");
    const ops = targets.map((x) => {
      let p = { ...(x.skill!.props as Props) };
      for (const c of g.controls) {
        const c2 = nextCustom(groups, p.custom, c.key, values[c.key]);
        p = { ...p }; if (c2) p.custom = c2; else delete p.custom;
      }
      return { type: "updateScene" as const, id: x.id, changes: { skill: { component: x.skill!.component, props: p } } };
    });
    if (ops.length) void ed.op({ type: "batch", label: `Terapkan ${g.group} ke ${ops.length} scene`, ops });
  };

  const g = groups[Math.min(gi, groups.length - 1)];
  const nMod = (grp: SkillControlGroup) => grp.controls.filter((c) => saved && c.key in saved).length;
  const hoverPreview = (key: string, value: ControlValue | null) => { const v = value === null ? null : { [key]: value }; setLive(v); setPv(v); };

  return (
    <div className="kwrap">
      <nav className="knav" aria-label="Grup kustom">
        {groups.map((x, i) => (
          <button key={x.group} type="button" className="kn" aria-pressed={i === gi} onClick={() => setGi(i)}>
            <span>{x.group}</span>{nMod(x) > 0 && <span className="kc">{nMod(x)}</span>}
          </button>
        ))}
      </nav>
      <section className="kpane">
        <div className="kph">
          <h5>{g.group}</h5>
          <div className="kact">
            <button type="button" className="btn btn--sm-text" disabled={locked} title="Pakai nilai grup ini di semua scene skill yang tidak dikunci" onClick={() => applyAll(g)}>Ke semua bagian</button>
            <button type="button" className="btn btn--sm-text" disabled={locked || nMod(g) === 0} onClick={() => resetGroup(g)}>Reset grup</button>
          </div>
        </div>
        {locked && <p className="hint">Bagian ini dikunci. Ganti statusnya untuk mengubah.</p>}
        {g.controls.map((c) => {
          const mod = !!saved && c.key in saved;
          const label = <span className="flab">{c.label}{mod && <i className="mod" title="Diubah dari bawaan skill" />}<b className="v">{String(shown[c.key])}{c.type === "range" ? c.unit : ""}</b></span>;
          if (!controlVisible(c, shown)) return <div key={c.key} className="kf">{label}<p className="kskip">{c.hideReason ?? "Tidak berlaku untuk pilihan saat ini."}</p></div>;
          if (c.type === "range") {
            const v = Number(shown[c.key]);
            return (
              <div key={c.key} className="kf">{label}
                <div className="krange">
                  <RangeArt c={c} v={v} />
                  <div className="kr">
                    <input type="range" aria-label={c.label} min={c.min} max={c.max} step={c.step} value={v} disabled={locked}
                      onChange={(e) => { const nv = { [c.key]: Number(e.currentTarget.value) }; setLive(nv); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setPv(nv), 120); }}
                      onPointerUp={(e) => commit(c.key, Number(e.currentTarget.value))} onKeyUp={(e) => commit(c.key, Number(e.currentTarget.value))} />
                    <div className="mm"><span>{c.min}{c.unit}</span><span>★ {String(c.default)}{c.unit}</span><span>{c.max}{c.unit}</span></div>
                  </div>
                </div>
              </div>
            );
          }
          return (
            <div key={c.key} className="kf">{label}
              <div className="tiles" role="group" aria-label={c.label} onMouseLeave={() => hoverPreview(c.key, null)}>
                {c.options.map((o) => (
                  <button key={String(o.value)} type="button" className="tile" aria-pressed={same(values[c.key], o.value)} disabled={locked}
                    onMouseEnter={() => hoverPreview(c.key, o.value)} onFocus={() => hoverPreview(c.key, o.value)} onBlur={() => hoverPreview(c.key, null)} onClick={() => commit(c.key, o.value)}>
                    {o.art && <img className="ill" alt="" src={artSrc(o.art)} />}
                    <span>{o.label}</span>
                    {same(c.default, o.value) && <i className="bdot" title="Bawaan skill">★</i>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <div className="klegend"><span><i className="bd">★</i>Bawaan skill</span><span><i className="mod" />Diubah</span><span>Sorot untuk pratinjau</span></div>
      </section>
    </div>
  );
}

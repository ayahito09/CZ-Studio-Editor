// Pilihan efek berupa kotak kecil. Saat kotak di-hover, contohnya diputar oleh mesin komposisi yang sama dengan render.
import { useState, type ComponentType, type ReactNode } from "react";
import { Player } from "@remotion/player";

export type Choice = { id: string; label: string; preview?: () => ReactNode };

/** Pemutar mini 16:9 yang berulang, untuk contoh di dalam kotak pilihan. */
export function miniPlayer<P extends { width: number; height: number }>(component: ComponentType<P>, inputProps: P, frames = 60): () => ReactNode {
  return () => (
    <Player component={component as unknown as ComponentType<Record<string, unknown>>} inputProps={inputProps} compositionWidth={inputProps.width} compositionHeight={inputProps.height}
      durationInFrames={frames} fps={30} autoPlay loop controls={false} clickToPlay={false} style={{ width: "100%", height: "100%" }} />
  );
}

export function EffectPicker({ label, choices, value, onPick, onHover, disabled }: {
  label: string; choices: Choice[]; value: string; onPick: (id: string) => void; onHover?: (id: string | null) => void; disabled?: boolean;
}) {
  const [hov, setHov] = useState<string | null>(null);
  const hover = (id: string | null) => { setHov(id); onHover?.(id); };
  return (
    <div className="field"><span>{label}</span>
      <div className="style-grid" role="radiogroup" aria-label={label} onMouseLeave={() => hover(null)}>
        {choices.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={c.id === value} disabled={disabled} title={c.label}
            className={"style-card" + (c.id === value ? " is-on" : "")}
            onMouseEnter={() => hover(c.id)} onFocus={() => hover(c.id)} onBlur={() => hover(null)} onClick={() => onPick(c.id)}>
            <span className="style-card__demo" aria-hidden="true">
              {hov === c.id && c.preview ? c.preview() : c.id ? <i>Aa</i> : <s />}
            </span>
            <span className="style-card__name">{c.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

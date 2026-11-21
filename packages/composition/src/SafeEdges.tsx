// Pelindung area aman: gradasi gelap, blur, atau kontras di tepi atas/bawah bingkai, di bawah teks dan elemen.
import type { CSSProperties, ReactElement } from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { safeEdgesOf, type Edge, type Project } from "@cz/core";

function EdgeLayer({ edge, side, H }: { edge: Edge; side: "top" | "bottom"; H: number }) {
  if (edge.mode === "mati" || edge.strength <= 0) return null;
  const h = edge.size * H, s = edge.strength;
  const dir = side === "top" ? "to bottom" : "to top";
  const fade = `linear-gradient(${dir}, #000 35%, transparent)`; // masker: penuh di tepi, memudar ke tengah
  const base: CSSProperties = { position: "absolute", left: 0, right: 0, [side]: 0, height: h, pointerEvents: "none" };
  const layers: ReactElement[] = [];
  if (edge.mode === "gelap" || edge.mode === "gelap+blur") {
    layers.push(<div key="g" style={{ ...base, background: `linear-gradient(${dir}, rgba(0,0,0,${0.9 * s}), rgba(0,0,0,${0.45 * s}) 45%, rgba(0,0,0,0))` }} />);
  }
  if (edge.mode === "blur" || edge.mode === "gelap+blur") {
    layers.push(<div key="b" style={{ ...base, backdropFilter: `blur(${Math.round(4 + s * 30)}px)`, WebkitBackdropFilter: `blur(${Math.round(4 + s * 30)}px)`, WebkitMaskImage: fade, maskImage: fade }} />);
  }
  if (edge.mode === "kontras") {
    layers.push(<div key="k" style={{ ...base, backdropFilter: `contrast(${1 + s * 0.8}) brightness(${1 - s * 0.35})`, WebkitBackdropFilter: `contrast(${1 + s * 0.8}) brightness(${1 - s * 0.35})`, WebkitMaskImage: fade, maskImage: fade }} />);
  }
  return <>{layers}</>;
}

/** Satu lapisan per scene (hanya selama scene itu), di atas footage dan di bawah aset dan caption. */
export function SafeEdgesLayer({ project }: { project: Project }) {
  const H = project.sequence.height;
  return (
    <>
      {project.scenes.map((sc) => {
        const e = safeEdgesOf(sc.custom);
        if (e.top.mode === "mati" && e.bottom.mode === "mati") return null;
        return (
          <Sequence key={sc.id} from={sc.start} durationInFrames={Math.max(1, sc.end - sc.start)} layout="none">
            <AbsoluteFill style={{ pointerEvents: "none" }}>
              <EdgeLayer edge={e.top} side="top" H={H} />
              <EdgeLayer edge={e.bottom} side="bottom" H={H} />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </>
  );
}

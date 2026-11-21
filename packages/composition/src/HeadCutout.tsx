// Potongan subjek (kepala dan badan, ber-alpha) di atas elemen dan teks yang ditandai "di belakang kepala".
// Memakai kamera yang sama dengan footage supaya potongannya tepat menumpuk di atas orangnya.
import { AbsoluteFill, getRemotionEnvironment, Html5Video, OffthreadVideo, Sequence, useCurrentFrame } from "remotion";
import { clipLen, type Project } from "@cz/core";
import { Camera } from "./native.tsx";
const rendering = () => getRemotionEnvironment().isRendering;

type Lib = { media?: Record<string, { subject?: string }> } | null | undefined;

const behindOf = (project: Project) => [
  ...project.assets.filter((a) => !a.hidden && a.params.behindHead === true).map((a) => [a.start, a.start + a.duration] as const),
  ...project.captions.filter((c) => (c.style as Record<string, unknown>).behindHead === true).map((c) => [c.start, c.end] as const),
];

export function HeadCutout({ project, subjects, lib }: { project: Project; subjects: Record<string, string>; lib: Lib }) {
  const f = useCurrentFrame();
  const fps = project.sequence.fps;
  const active = behindOf(project).some(([a, b]) => f >= a && f < b);
  if (!active) return null;
  const abs = (u: string) => (typeof location === "undefined" ? u : new URL(u, location.href).href);
  const subj = (id: string) => subjects[id] ?? lib?.media?.[id]?.subject;
  const clips = project.clips.filter((c) => c.enabled && c.trackId === "V1" && subj(c.mediaId));
  if (!clips.length) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <Camera project={project}>
        {clips.map((c) => {
          const url = abs(subj(c.mediaId)!);
          return (
            <Sequence key={c.id} from={c.start} durationInFrames={clipLen(c, fps)} layout="absolute-fill">
              {rendering()
                ? <OffthreadVideo src={url} muted transparent trimBefore={Math.round(c.srcIn * fps)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <Html5Video src={url} muted trimBefore={Math.round(c.srcIn * fps)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </Sequence>
          );
        })}
      </Camera>
    </AbsoluteFill>
  );
}

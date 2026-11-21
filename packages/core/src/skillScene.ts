// Scene yang digambar komponen Remotion milik skill: dipecah per klip footage, karena komponen skill
// memutar footage-nya sendiri dari detik a sampai b (tanpa potongan di tengah).
import type { Project, SceneSkill } from "./project.ts";
import { clipLen } from "./timeline.ts";

export interface SkillSegment {
  key: string; sceneId: string; sceneIndex: number; mediaId: string;
  /** Frame sequence. */
  from: number; durationInFrames: number;
  /** Detik sumber. */
  a: number; b: number;
  /** Kata di rentang ini, detik relatif terhadap a (format komponen skill: w, s, e). */
  words: { w: string; s: number; e: number }[];
  skill: SceneSkill;
}

export function skillSegments(p: Project): SkillSegment[] {
  const fps = p.sequence.fps;
  const video = new Set(p.tracks.filter((t) => t.kind === "video" && !t.hidden).map((t) => t.id));
  const clips = p.clips.filter((c) => c.enabled && video.has(c.trackId)).sort((x, y) => x.start - y.start);
  const out: SkillSegment[] = [];
  p.scenes.forEach((sc, sceneIndex) => {
    if (!sc.skill) return;
    for (const c of clips) {
      const from = Math.max(sc.start, c.start), to = Math.min(sc.end, c.start + clipLen(c, fps));
      if (to <= from) continue;
      const a = c.srcIn + (from - c.start) / fps, b = a + (to - from) / fps;
      const words = p.transcript.words
        .filter((w) => w.mediaId === c.mediaId && w.srcStart >= a - 1e-3 && w.srcStart < b)
        .map((w) => ({ w: w.text, s: r3(w.srcStart - a), e: r3(Math.min(w.srcEnd, b) - a) }));
      out.push({ key: `${sc.id}:${c.id}`, sceneId: sc.id, sceneIndex, mediaId: c.mediaId, from, durationInFrames: to - from, a: r3(a), b: r3(b), words, skill: sc.skill });
    }
  });
  return out;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

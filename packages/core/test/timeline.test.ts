import { test } from "node:test";
import assert from "node:assert/strict";
import { createProject, History, clipEnd, type Media, type Project } from "../src/index.ts";

// 30 fps; media 10 detik = 300 frame.
const media = (id: string, duration = 10, hasAudio = true): Media => ({
  id, name: id + ".mp4", path: `media/${id}.mp4`, linked: false, proxy: `proxy/${id}.mp4`,
  duration, fps: 30, width: 1080, height: 1920, hasAudio,
});

function setup(...ms: Media[]) {
  const h = new History(createProject("Uji", "p_t"));
  for (const m of ms) assert.equal(h.apply({ type: "addMedia", media: m, place: true }), null);
  return h;
}
const clips = (p: Project, track: string) =>
  p.clips.filter((c) => c.trackId === track).sort((a, b) => a.start - b.start).map((c) => [c.start, clipEnd(c, p.sequence.fps), c.srcIn, c.srcOut]);
const ok = (h: History, op: unknown) => assert.equal(h.apply(op), null);

test("impor menaruh V1+A1 terhubung berurutan dan mengatur sequence", () => {
  const h = setup(media("m1"), media("m2", 5));
  const p = h.project;
  assert.deepEqual(clips(p, "V1"), [[0, 300, 0, 10], [300, 450, 0, 5]]);
  assert.deepEqual(clips(p, "A1"), [[0, 300, 0, 10], [300, 450, 0, 5]]);
  assert.equal(p.sequence.durationFrames, 450);
  const [v, a] = [p.clips.find((c) => c.trackId === "V1")!, p.clips.find((c) => c.trackId === "A1")!];
  assert.ok(v.linkId && v.linkId === a.linkId);
});

test("media tanpa audio tidak membuat klip A1", () => {
  const h = setup(media("m1", 4, false));
  assert.equal(h.project.clips.length, 1);
  assert.equal(h.project.clips[0].linkId, null);
});

test("razor memotong video dan audio terhubung; Ctrl+Z menyatukan lagi", () => {
  const h = setup(media("m1"));
  const before = h.project;
  ok(h, { type: "split", frame: 90 });
  assert.deepEqual(clips(h.project, "V1"), [[0, 90, 0, 3], [90, 300, 3, 10]]);
  assert.deepEqual(clips(h.project, "A1"), [[0, 90, 0, 3], [90, 300, 3, 10]]);
  const right = h.project.clips.filter((c) => c.start === 90);
  assert.ok(right[0].linkId && right[0].linkId === right[1].linkId);
  assert.notEqual(right[0].linkId, h.project.clips.find((c) => c.start === 0)!.linkId);
  h.undo();
  assert.deepEqual(h.project, before);
});

test("ripple delete menutup celah; lift membiarkan celah", () => {
  const h = setup(media("m1"));
  ok(h, { type: "split", frame: 90 });
  ok(h, { type: "split", frame: 150 });
  const mid = h.project.clips.find((c) => c.trackId === "V1" && c.start === 90)!;
  ok(h, { type: "deleteClips", clipIds: [mid.id], ripple: false });
  assert.deepEqual(clips(h.project, "V1").map((c) => c.slice(0, 2)), [[0, 90], [150, 300]]);
  h.undo();
  ok(h, { type: "deleteClips", clipIds: [mid.id], ripple: true });
  assert.deepEqual(clips(h.project, "V1").map((c) => c.slice(0, 2)), [[0, 90], [90, 240]]);
  assert.deepEqual(clips(h.project, "A1").map((c) => c.slice(0, 2)), [[0, 90], [90, 240]]);
  assert.equal(h.project.sequence.durationFrames, 240);
});

test("trim dibatasi tetangga dan panjang sumber; ripple trim menggeser sisanya", () => {
  const h = setup(media("m1"), media("m2", 5));
  const first = h.project.clips.find((c) => c.trackId === "V1" && c.start === 0)!;
  ok(h, { type: "trimClip", clipId: first.id, edge: "out", delta: 60, ripple: false }); // tidak bisa: sumber habis + tetangga
  assert.deepEqual(clips(h.project, "V1")[0], [0, 300, 0, 10]);
  ok(h, { type: "trimClip", clipId: first.id, edge: "out", delta: -60, ripple: false });
  assert.deepEqual(clips(h.project, "V1"), [[0, 240, 0, 8], [300, 450, 0, 5]]);
  h.undo();
  ok(h, { type: "trimClip", clipId: first.id, edge: "out", delta: -60, ripple: true });
  assert.deepEqual(clips(h.project, "V1"), [[0, 240, 0, 8], [240, 390, 0, 5]]);
  assert.deepEqual(clips(h.project, "A1"), [[0, 240, 0, 8], [240, 390, 0, 5]]);
  ok(h, { type: "trimClip", clipId: first.id, edge: "in", delta: 30, ripple: true });
  assert.deepEqual(clips(h.project, "V1"), [[0, 210, 1, 8], [210, 360, 0, 5]]);
});

test("roll, slip, dan slide menjaga panjang total", () => {
  const h = setup(media("m1"));
  ok(h, { type: "split", frame: 150 });
  ok(h, { type: "trimClip", clipId: h.project.clips.find((c) => c.trackId === "V1" && c.start === 0)!.id, edge: "out", delta: -30, ripple: true });
  // V1: [0,120 src 0-4] [120,270 src 5-10]
  const left = h.project.clips.find((c) => c.trackId === "V1" && c.start === 0)!;
  const right = h.project.clips.find((c) => c.trackId === "V1" && c.start === 120)!;
  ok(h, { type: "rollEdit", clipId: left.id, delta: 15 });
  assert.deepEqual(clips(h.project, "V1"), [[0, 135, 0, 4.5], [135, 270, 5.5, 10]]);
  h.undo();
  ok(h, { type: "slipClip", clipId: left.id, delta: 30 });
  assert.deepEqual(clips(h.project, "V1")[0], [0, 120, 1, 5]);
  h.undo();
  ok(h, { type: "slipClip", clipId: right.id, delta: 300 }); // dibatasi akhir file
  assert.deepEqual(clips(h.project, "V1")[1], [120, 270, 5, 10]);
  ok(h, { type: "slideClip", clipId: right.id, delta: -30 });
  assert.deepEqual(clips(h.project, "V1"), [[0, 90, 0, 3], [90, 240, 5, 10]]);
  assert.equal(h.project.sequence.durationFrames, 240);
});

test("pindah klip menimpa klip di tujuan (overwrite) dan bisa pindah track", () => {
  const h = setup(media("m1"), media("m2", 5));
  const second = h.project.clips.find((c) => c.trackId === "V1" && c.start === 300)!;
  ok(h, { type: "moveClips", clipIds: [second.id], delta: -150 });
  assert.deepEqual(clips(h.project, "V1"), [[0, 150, 0, 5], [150, 300, 0, 5]]);
  ok(h, { type: "moveClips", clipIds: [second.id], delta: 0, trackShift: -1 }); // urutan tampilan: V1 → V3 di atasnya
  assert.deepEqual(clips(h.project, "V3"), [[150, 300, 0, 5]]);
  assert.deepEqual(clips(h.project, "A1").map((c) => c.slice(0, 2)), [[0, 150], [150, 300]]);
});

test("track terkunci menolak perubahan dan dilewati razor", () => {
  const h = setup(media("m1"));
  ok(h, { type: "updateTrack", trackId: "A1", changes: { locked: true } });
  const v = h.project.clips.find((c) => c.trackId === "V1")!;
  assert.match(h.apply({ type: "moveClips", clipIds: [v.id], delta: 10 }) ?? "", /terkunci/);
  ok(h, { type: "split", frame: 30 });
  assert.equal(clips(h.project, "V1").length, 2);
  assert.equal(clips(h.project, "A1").length, 1);
});

test("lift dan extract rentang in/out", () => {
  const h = setup(media("m1"));
  ok(h, { type: "deleteRange", start: 60, end: 120, ripple: false });
  assert.deepEqual(clips(h.project, "V1"), [[0, 60, 0, 2], [120, 300, 4, 10]]);
  h.undo();
  ok(h, { type: "deleteRange", start: 60, end: 120, ripple: true });
  assert.deepEqual(clips(h.project, "V1"), [[0, 60, 0, 2], [60, 240, 4, 10]]);
});

test("tempel klip baru, link/unlink, setClips, penanda", () => {
  const h = setup(media("m1"));
  ok(h, { type: "addClips", clips: [{ trackId: "V3", mediaId: "m1", srcIn: 1, srcOut: 2, start: 10 }] });
  const pasted = h.project.clips.find((c) => c.trackId === "V3")!;
  assert.deepEqual([pasted.start, clipEnd(pasted, 30)], [10, 40]);
  const v1 = h.project.clips.find((c) => c.trackId === "V1")!;
  ok(h, { type: "unlink", clipIds: [v1.id] });
  assert.ok(h.project.clips.every((c) => c.linkId === null));
  ok(h, { type: "moveClips", clipIds: [v1.id], delta: 30 });
  assert.deepEqual(clips(h.project, "A1")[0].slice(0, 2), [0, 300]);
  ok(h, { type: "setClips", clipIds: [v1.id], changes: { enabled: false, gainDb: -6 } });
  assert.equal(h.project.clips.find((c) => c.id === v1.id)!.enabled, false);
  ok(h, { type: "addMarker", frame: 45, label: "Hook" });
  assert.deepEqual(h.project.markers, [{ id: "mk1", frame: 45, label: "Hook" }]);
});

test("ganti fps menskalakan posisi klip", () => {
  const h = setup(media("m1"), media("m2", 5));
  ok(h, { type: "setSequence", width: 1080, height: 1920, fps: 60 });
  assert.deepEqual(clips(h.project, "V1").map((c) => c.slice(0, 2)), [[0, 600], [600, 900]]);
});

test("batch diterapkan sebagai satu langkah undo dan menolak op server", () => {
  const h = setup(media("m1"));
  const before = h.project;
  ok(h, { type: "batch", label: "Ripple trim ke playhead", ops: [{ type: "split", frame: 60 }, { type: "split", frame: 120 }] });
  assert.equal(clips(h.project, "V1").length, 3);
  assert.equal(h.done.at(-1)?.label, "Ripple trim ke playhead");
  h.undo();
  assert.deepEqual(h.project, before);
  assert.ok(h.apply({ type: "batch", label: "x", ops: [{ type: "batch", label: "y", ops: [] }] }));
});

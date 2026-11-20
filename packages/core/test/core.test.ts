import { test } from "node:test";
import assert from "node:assert/strict";
import { createProject, validateProject, validateOp, History } from "../src/index.ts";

test("proyek baru sah dan lolos JSON bolak-balik", () => {
  const p = createProject("Uji", "p_test");
  assert.deepEqual(validateProject(p), []);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))), []);
});

test("validateProject menolak proyek rusak", () => {
  assert.ok(validateProject(null).length > 0);
  const p: any = createProject("Uji");
  p.sequence.fps = 0;
  p.tracks.push({ ...p.tracks[0] });
  const errs = validateProject(p);
  assert.ok(errs.some((e) => e.includes("sequence")));
  assert.ok(errs.some((e) => e.includes("ganda")));
});

test("validateOp menolak op tidak sah", () => {
  const p = createProject("Uji");
  assert.equal(validateOp({ type: "setTitle", title: "Baru" }, p), null);
  assert.ok(validateOp({ type: "setTitle", title: "  " }, p));
  assert.ok(validateOp({ type: "setSequence", width: 1080, height: 1920, fps: 29.97 }, p));
  assert.ok(validateOp({ type: "updateTrack", trackId: "X9", changes: { locked: true } }, p));
  assert.ok(validateOp({ type: "updateTrack", trackId: "V1", changes: { id: "V9" } }, p));
  assert.ok(validateOp({ type: "hapusSemua" }, p));
});

test("undo dan redo mengembalikan keadaan persis", () => {
  const start = createProject("Awal", "p_test");
  const h = new History(start);
  assert.equal(h.apply({ type: "setTitle", title: "Kedua" }), null);
  assert.equal(h.apply({ type: "setSequence", width: 1080, height: 1080, fps: 25 }), null);
  assert.equal(h.apply({ type: "updateTrack", trackId: "V1", changes: { locked: true } }, "claude"), null);
  const end = h.project;

  assert.equal(h.done.at(-1)?.source, "claude");
  h.undo(); h.undo(); h.undo();
  assert.deepEqual(h.project, start);
  assert.equal(h.undo(), null);
  h.redo(); h.redo(); h.redo();
  assert.deepEqual(h.project, end);
  assert.equal(h.redo(), null);
});

test("op baru setelah undo membuang redo; op tanpa perubahan tidak dicatat", () => {
  const h = new History(createProject("A"));
  h.apply({ type: "setTitle", title: "B" });
  h.undo();
  h.apply({ type: "setTitle", title: "C" });
  assert.equal(h.undone.length, 0);
  h.apply({ type: "setTitle", title: "C" });
  assert.equal(h.done.length, 1);
});

test("op tidak sah tidak mengubah proyek", () => {
  const h = new History(createProject("A"));
  const before = h.project;
  assert.ok(h.apply({ type: "setSequence", width: 0, height: 0, fps: 30 }));
  assert.equal(h.project, before);
  assert.equal(h.done.length, 0);
});

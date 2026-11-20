import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCaptions, checkCuts, createProject, detectSilences, expandPreset, History, suggestFillers, validateAssetDef, validateTemplate,
  type AssetDef, type Media, type Template,
} from "../src/index.ts";

const media = (id: string, duration = 10): Media => ({
  id, name: id + ".mp4", path: `media/${id}.mp4`, linked: false, proxy: `proxy/${id}.mp4`,
  duration, fps: 30, width: 1080, height: 1920, hasAudio: true,
});
const ok = (h: History, op: unknown, source?: "manual" | "claude") => assert.equal(h.apply(op, source), null);

function withWords() {
  const h = new History(createProject("Uji", "p_t"));
  ok(h, { type: "addMedia", media: media("m1"), place: true });
  // "satu" 0.5-1.0, jeda 1.0-3.0, "dua" 3.0-3.5, "tiga" 3.6-4.0
  ok(h, { type: "setTranscript", mediaId: "m1", words: [
    { text: "Satu", srcStart: 0.5, srcEnd: 1.0 }, { text: "dua", srcStart: 3.0, srcEnd: 3.5 }, { text: "tiga.", srcStart: 3.6, srcEnd: 4.0 },
  ] });
  return h;
}

test("deteksi jeda: celah ≥ minimum dipotong dengan padding; awal file tanpa padding luar", () => {
  const rate = 100;
  const env = new Array(500).fill(-20);
  for (let i = 0; i < 40; i++) env[i] = -70;          // 0.0-0.4 sunyi (awal file)
  for (let i = 100; i < 300; i++) env[i] = -70;       // 1.0-3.0 sunyi
  for (let i = 350; i < 380; i++) env[i] = -70;       // 3.5-3.8 terlalu pendek
  const { regions } = detectSilences(env, rate, 5, { minGap: 0.45, padding: 0.3, thresholdDb: -40 });
  assert.deepEqual(regions, [{ srcStart: 1.3, srcEnd: 2.7 }]); // awal 0.4 dtk < minimum
  const auto = detectSilences(env, rate, 5);
  assert.ok(auto.threshold > -70 && auto.threshold < -20);
});

test("kata isian dan ulangan hanya diusulkan", () => {
  const words = [
    { id: "w1", mediaId: "m1", text: "eh,", srcStart: 0, srcEnd: 0.2, estimated: false },
    { id: "w2", mediaId: "m1", text: "kita", srcStart: 0.3, srcEnd: 0.5, estimated: false },
    { id: "w3", mediaId: "m1", text: "kita", srcStart: 0.6, srcEnd: 0.8, estimated: false },
    { id: "w4", mediaId: "m1", text: "bisa", srcStart: 0.9, srcEnd: 1.1, estimated: false },
  ];
  const s = suggestFillers(words);
  assert.deepEqual(s.map((x) => [x.kind, x.srcStart, x.srcEnd]), [["isian", 0, 0.2], ["ulangan", 0.3, 0.6]]);
});

test("terapkan potongan: ripple, fade di sambungan audio, caption ikut bergeser; undo memulihkan", () => {
  const h = withWords();
  ok(h, { type: "setCaptions", captions: buildCaptions(h.project) });
  const before = h.project;
  const capDua = before.captions.flatMap((c) => c.words).find((w) => w.text === "dua")!;
  assert.equal(capDua.start, 90);

  ok(h, { type: "addCuts", cuts: [{ kind: "jeda", mediaId: "m1", srcStart: 1.3, srcEnd: 2.7, by: "auto" }] });
  const cut = h.project.cuts[0];
  assert.equal(cut.state, "proposed");
  ok(h, { type: "applyCuts", cutIds: [cut.id] });

  const p = h.project;
  assert.equal(p.cuts[0].state, "applied");
  const v1 = p.clips.filter((c) => c.trackId === "V1").sort((a, b) => a.start - b.start);
  assert.deepEqual(v1.map((c) => [c.start, c.srcIn, c.srcOut]), [[0, 0, 1.3], [39, 2.7, 10]]);
  const a1 = p.clips.filter((c) => c.trackId === "A1").sort((a, b) => a.start - b.start);
  assert.equal(a1[0].fadeOut, 1);
  assert.equal(a1[1].fadeIn, 1);
  assert.equal(p.sequence.durationFrames, 300 - 42);
  // "dua" di sumber 3.0 dtk → 39 + (3.0-2.7)*30 = 48
  assert.equal(p.captions.flatMap((c) => c.words).find((w) => w.text === "dua")!.start, 48);

  h.undo(); h.undo();
  assert.deepEqual(h.project, before);
});

test("potong lewat teks membuang kata dari caption", () => {
  const h = withWords();
  ok(h, { type: "setCaptions", captions: buildCaptions(h.project) });
  const w = h.project.transcript.words.find((x) => x.text === "dua")!;
  ok(h, { type: "addCuts", cuts: [{ kind: "teks", mediaId: "m1", srcStart: w.srcStart, srcEnd: w.srcEnd }], apply: true });
  const texts = h.project.captions.flatMap((c) => c.words.map((x) => x.text));
  assert.ok(!texts.includes("dua"));
  assert.ok(texts.includes("tiga."));
});

test("pemeriksaan potongan menandai kata yang terbelah", () => {
  const h = withWords();
  const probs = checkCuts([{ id: "k1", kind: "jeda", mediaId: "m1", srcStart: 0.8, srcEnd: 2, by: "auto", state: "proposed" }], h.project.transcript.words);
  assert.equal(probs.length, 1);
  assert.equal(probs[0].kind, "kata-terpotong");
});

test("aset: tambah, ubah menandai edited, Claude tidak bisa mengubah aset terkunci", () => {
  const h = withWords();
  ok(h, { type: "addAssets", assets: [{ defId: "ce.kartu", start: 10, duration: 60, transform: { x: 540, y: 1500 } }] });
  const a = h.project.assets[0];
  assert.equal(a.id, "a1");
  assert.equal(a.transform.scale, 1);
  ok(h, { type: "updateAsset", id: "a1", changes: { transform: { x: 600 } } });
  assert.equal(h.project.assets[0].transform.y, 1500);
  assert.equal(h.project.assets[0].edited, true);
  ok(h, { type: "updateAsset", id: "a1", changes: { locked: true } });
  assert.ok(h.apply({ type: "updateAsset", id: "a1", changes: { start: 0 } }, "claude"));
  assert.ok(h.apply({ type: "batch", label: "x", ops: [{ type: "removeAssets", ids: ["a1"] }] }, "claude"));
  ok(h, { type: "updateAsset", id: "a1", changes: { start: 0 } });
  assert.ok(h.apply({ type: "updateAsset", id: "a1", changes: { transform: { scale: -1 } } }));
});

test("aset terikat kata ikut bergeser saat jeda dipotong", () => {
  const h = withWords();
  const dua = h.project.transcript.words.find((x) => x.text === "dua")!;
  ok(h, { type: "addAssets", assets: [{ start: 95, duration: 30, anchorWordId: dua.id }] });
  ok(h, { type: "addCuts", cuts: [{ kind: "jeda", mediaId: "m1", srcStart: 1.3, srcEnd: 2.7 }], apply: true });
  assert.equal(h.project.assets[0].start, 95 - 42);
});

test("scene: tepat satu bintang; scene dikunci tidak bisa diubah Claude", () => {
  const h = withWords();
  assert.ok(h.apply({ type: "setScenes", scenes: [{ title: "A", start: 0, end: 60, options: [{ id: "A", star: true, presetId: "x" }, { id: "B", star: true, presetId: "y" }] }] }));
  ok(h, { type: "setScenes", scenes: [{ title: "Pembuka", start: 0, end: 60, options: [{ id: "A", star: true, presetId: "x" }, { id: "B", star: false, presetId: "y" }] }] });
  assert.equal(h.project.scenes[0].choice, "A");
  ok(h, { type: "updateScene", id: "s1", changes: { status: "dikunci" } });
  assert.ok(h.apply({ type: "updateScene", id: "s1", changes: { title: "Ganti" } }, "claude"));
  ok(h, { type: "addNote", note: { sceneId: "s1", frame: 10, text: "caption lebih besar" } });
  ok(h, { type: "replyNote", id: "n1", by: "claude", text: "Sudah" });
  ok(h, { type: "updateNote", id: "n1", changes: { status: "selesai" } });
  assert.equal(h.project.notes[0].replies.length, 1);
});

test("ganti fps menskalakan aset, caption, dan scene", () => {
  const h = withWords();
  ok(h, { type: "setCaptions", captions: buildCaptions(h.project) });
  ok(h, { type: "addAssets", assets: [{ start: 30, duration: 30 }] });
  ok(h, { type: "setSequence", width: 1080, height: 1920, fps: 60 });
  assert.deepEqual([h.project.assets[0].start, h.project.assets[0].duration], [60, 60]);
  assert.equal(h.project.captions[0].start, 30);
});

const def: AssetDef = {
  id: "ce.kartu-ui", name: "Kartu UI", category: "kartu", version: 1,
  params: { title: { type: "text", default: "Judul" }, width: { type: "number", default: 800 } },
  layout: { x: 540, y: 1520, w: "$width" },
  tree: [{ type: "rect", radius: 34 }, { type: "stack", children: [{ type: "text", bind: "title" }] }],
  in: { preset: "blurRise", frames: 15 }, out: { preset: "blurFade" }, sfx: { in: "tombol" }, duration: 2,
};

test("validasi definisi aset dan template", () => {
  assert.deepEqual(validateAssetDef(def), []);
  assert.ok(validateAssetDef({ ...def, tree: [{ type: "script" }] }).length);
  assert.ok(validateAssetDef({ ...def, id: "../jahat" }).length);
  const t: Template = { id: "clean-editing", name: "Clean", version: 1, tokens: { accent: "#143BFF" }, caption: {}, stylePresets: [] };
  assert.deepEqual(validateTemplate(t), []);
  assert.ok(validateTemplate({ ...t, sfx: { woosh: "../../etc" } }).length);
});

test("preset gaya dijabarkan menjadi aset scene", () => {
  const t: Template = {
    id: "ce", name: "CE", version: 1, tokens: {}, caption: {},
    stylePresets: [{ id: "kartu-bawah", name: "Kartu bawah", assets: [{ defId: "ce.kartu-ui", at: "akhir", params: { title: "Hai" } }, { defId: "hilang" }] }],
  };
  const out = expandPreset(t, new Map([[def.id, def]]), { id: "s1", start: 100, end: 400 }, "kartu-bawah", 30, { width: 1080, height: 1920 });
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].start, out[0].duration, out[0].sceneId, out[0].transform?.y], [340, 60, "s1", 1520]);
  assert.deepEqual(out[0].anim, { in: "blurRise", out: "blurFade" });
});

test("setScenes mempertahankan id scene lama supaya aset tetap terikat", () => {
  const h = withWords();
  ok(h, { type: "setScenes", scenes: [{ title: "A", start: 0, end: 60 }, { title: "B", start: 60, end: 120 }] });
  ok(h, { type: "addAssets", assets: [{ start: 70, duration: 10, sceneId: "s2" }] });
  const [a, b] = h.project.scenes;
  ok(h, { type: "setScenes", scenes: [{ ...a, end: 30 }, { title: "A2", start: 30, end: 60 }, b] });
  assert.deepEqual(h.project.scenes.map((s) => s.id), ["s1", "s3", "s2"]);
  assert.equal(h.project.assets[0].sceneId, "s2");
});

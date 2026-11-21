import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_ASSETS, buildCaptions, checkCuts, createProject, detectSilences, expandPreset, History, instantiate, missingAssets, SKILL_ASSET, skillAssetDef,
  assetBox, cameraFromContent, controlValues, controlVisible, faceToSeq, fullScale, nextCustom, normalizeControls, keyWordIndex, placementIssues, placementY, skillSegments, suggestFillers, validateAssetDef, validateTemplate,
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
  // properti yang tak dikenal renderer atau tree yang tak menampilkan apa pun ditolak (aset polos)
  assert.ok(validateAssetDef({ ...def, tree: [{ type: "rect", background: "#fff" }] }).some((e) => e.includes("background")));
  assert.ok(validateAssetDef({ ...def, tree: [{ type: "rect", radius: 34 }] }).some((e) => e.includes("tidak menampilkan")));
  assert.deepEqual(validateAssetDef({ ...def, tree: [{ type: "rect", fill: "$colors.accent", radius: 34, w: 400, h: 120 }] }), []);
  const t: Template = { id: "clean-editing", name: "Clean", version: 1, tokens: { accent: "#143BFF" }, caption: {}, stylePresets: [] };
  assert.deepEqual(validateTemplate(t), []);
  assert.ok(validateTemplate({ ...t, sfx: { woosh: "../../etc" } }).length);
  assert.deepEqual(validateTemplate({ ...t, catalog: [{ id: "ce.kartu", name: "Kartu", source: "SKILL.md#kartu" }] }), []);
  assert.ok(validateTemplate({ ...t, catalog: [{ id: "../x", name: "X" }] }).length);
});

test("katalog: aset yang disebut skill tetapi belum dibuat", () => {
  const t: Template = {
    id: "ce", name: "CE", version: 1, tokens: {}, caption: {}, stylePresets: [],
    catalog: [{ id: "ce.kartu", name: "Kartu", source: "SKILL.md#kartu" }, { id: "ce.badge", name: "Badge", source: "refs/badge.md" }],
  };
  assert.deepEqual(missingAssets(t, ["ce.kartu"]).map((c) => c.id), ["ce.badge"]);
  assert.deepEqual(missingAssets({ ...t, catalog: undefined }, []), []);
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

test("scene skill: divalidasi lalu dipecah per klip dengan kata relatif terhadap a", () => {
  const h = withWords();
  ok(h, { type: "addCuts", cuts: [{ kind: "jeda", mediaId: "m1", srcStart: 1.5, srcEnd: 2.5 }], apply: true });
  const skill = { component: "CleanScene", props: { style: { caption: "cap-clean-kata" } } };
  assert.ok(h.apply({ type: "setScenes", scenes: [{ title: "A", start: 0, end: 90, skill: { component: "../x", props: {} } }] }));
  assert.ok(h.apply({ type: "setScenes", scenes: [{ title: "A", start: 0, end: 90, skill: { component: "CleanScene", props: [] } }] }));
  ok(h, { type: "setScenes", scenes: [{ title: "A", start: 0, end: 90, skill }, { title: "B", start: 90, end: 200 }] });
  const segs = skillSegments(h.project);
  // Potongan 1.5-2.5 membelah footage: scene A = 0-1.5 dtk (45 frame) + 2.5-4.0 dtk (45 frame).
  assert.deepEqual(segs.map((s) => [s.from, s.durationInFrames, s.a, s.b]), [[0, 45, 0, 1.5], [45, 45, 2.5, 4]]);
  assert.deepEqual(segs[0].words, [{ w: "Satu", s: 0.5, e: 1 }]);
  assert.deepEqual(segs[1].words.map((w) => [w.w, w.s]), [["dua", 0.5], ["tiga.", 1.1]]);
  ok(h, { type: "updateScene", id: "s1", changes: { skill: null } });
  assert.equal(skillSegments(h.project).length, 0);
});

test("aset kode: katalog bawaan sah, aset skill membaca isi dari defaultProps, instans dipasang lewat op", () => {
  for (const d of BUILTIN_ASSETS) {
    assert.deepEqual(validateAssetDef(d), [], d.id);
    assert.equal(d.component, d.id);
    assert.deepEqual(d.tree, []);
  }
  const sk = skillAssetDef("AsetKartuHarga", { judul: "Pro", harga: 99, poin: ["a", "b"], aksen: "#143BFF", tampil: true, data: { x: 1 } }, 90, 30, { width: 1080, height: 1920 });
  assert.equal(sk.id, "skill:AsetKartuHarga");
  assert.equal(sk.name, "Kartu Harga");
  assert.deepEqual(Object.fromEntries(Object.entries(sk.params).map(([k, p]) => [k, p.type])), { judul: "text", harga: "number", poin: "list", aksen: "color", tampil: "bool" });
  assert.equal(sk.duration, 3);
  assert.ok(SKILL_ASSET.test("AsetChat") && !SKILL_ASSET.test("CleanScene"));
  const h = withWords();
  const chat = BUILTIN_ASSETS.find((d) => d.id === "cz.chat")!;
  ok(h, { type: "addAssets", assets: [instantiate(chat, {}, { start: 0, fps: 30, seq: { width: 1080, height: 1920 } }, { params: { pesan: ["Saya: halo", "Claude: hai"] } })] });
  assert.equal(h.project.assets[0].defId, "cz.chat");
  assert.equal(h.project.assets[0].duration, 210);
});

test("mesin gerak: kamera aditif, transisi scene, dan easing keyframe divalidasi sebagai data", () => {
  const h = withWords();
  ok(h, { type: "setScenes", scenes: [{ title: "A", start: 0, end: 60 }, { title: "B", start: 60, end: 120 }] });
  const camera = { moves: [{ at: 0, dur: 24, zoom: 1.15, ease: "move" }, { at: 16, dur: 20, x: 40, ease: "enter" }], shake: [{ at: 30, amp: 3 }] };
  ok(h, { type: "updateScene", id: "s1", changes: { camera } });
  ok(h, { type: "updateScene", id: "s2", changes: { transition: { kind: "whip", frames: 8 } } });
  assert.deepEqual(h.project.scenes[0].camera, camera);
  assert.deepEqual(h.project.scenes[1].transition, { kind: "whip", frames: 8 });
  // kurva atau transisi yang tidak dikenal mesin ditolak
  assert.ok(h.apply({ type: "updateScene", id: "s1", changes: { camera: { moves: [{ at: 0, dur: 10, ease: "bebas" }] } } }));
  assert.ok(h.apply({ type: "updateScene", id: "s1", changes: { camera: { moves: [{ at: 0, dur: 0 }] } } }));
  assert.ok(h.apply({ type: "updateScene", id: "s2", changes: { transition: { kind: "putar", frames: 8 } } }));
  // proyek lama (from/to) tetap sah
  ok(h, { type: "updateScene", id: "s1", changes: { camera: { from: 1, to: 1.06 } } });
  ok(h, { type: "addAssets", assets: [{ trackId: "V3", defId: null, start: 0, duration: 30, keyframes: [{ frame: 0, opacity: 0 }, { frame: 10, opacity: 1, ease: "enterSnap" }] }] });
  assert.ok(h.apply({ type: "updateAsset", id: h.project.assets[0].id, changes: { keyframes: [{ frame: 0, x: 1, ease: "zigzag" }] } }));
});

test("kamera dasar proyek: bisa diatur tanpa rencana, tetap ada setelah rencana dibuat, dan divalidasi", () => {
  const h = withWords();
  const camera = { moves: [{ at: 30, dur: 24, hold: 20, out: 24, zoom: 1.08, ease: "move" }], drift: true };
  ok(h, { type: "setCamera", camera });
  assert.deepEqual(h.project.camera, camera);
  ok(h, { type: "setScenes", scenes: [{ title: "A", start: 0, end: 60 }] });
  assert.deepEqual(h.project.camera, camera); // rencana tidak menyentuh kamera dasar
  assert.ok(h.apply({ type: "setCamera", camera: { moves: [{ at: 0, dur: 0 }] } }));
  ok(h, { type: "setCamera", camera: null });
  assert.equal(h.project.camera, null);
});

test("caption: kata kunci = kata pertama bergaya, selain itu kata terpanjang", () => {
  const w = (text: string, style = "normal") => ({ text, style });
  assert.equal(keyWordIndex([w("ini"), w("premium", "serif"), w("banget", "tebal")]), 1);
  assert.equal(keyWordIndex([w("ini"), w("editan"), w("rapi!!")]), 1);
  assert.equal(keyWordIndex([]), -1);
});

test("penempatan elemen: atas/bawah menempel di area aman, layar penuh tetap di tengah", () => {
  assert.equal(placementY("atas", 200, 1, 1920), 320);
  assert.equal(placementY("bawah", 200, 1, 1920), 1420);
  assert.equal(placementY("tengah", 200, 1, 1920), 960);
  assert.equal(placementY("atas", 1920, 1, 1920), 960);
  assert.equal(placementY("bawah", 100, 2, 960), 660);
});

test("layar penuh: elemen dibesarkan sampai sisi terdekat area aman", () => {
  assert.equal(fullScale(460, 200, { width: 1080, height: 1920 }), 2);
  assert.equal(fullScale(900, 1300, { width: 1080, height: 1920 }), 1);
  assert.equal(fullScale(100, 100, { width: 1080, height: 1920 }), 2.5);
});

test("penempatan: elemen yang menutupi wajah atau keluar area aman dilaporkan, layar penuh dibiarkan", () => {
  const seq = { width: 1080, height: 1920 };
  const face = faceToSeq({ x: 0.3, y: 0.3, w: 0.4, h: 0.25 }, { width: 1080, height: 1920 }, seq);
  assert.deepEqual(face, { x0: 324, y0: 576, x1: 756, y1: 1056 });
  const onFace = placementIssues(assetBox({ x: 540, y: 800, scale: 1 }, 800, 400), seq, face);
  assert.ok(onFace.faceCover > 0.8 && onFace.issues.some((x) => x.includes("wajah")));
  const below = placementIssues(assetBox({ x: 540, y: 1300, scale: 1 }, 800, 300), seq, face);
  assert.deepEqual(below.issues, []);
  const low = placementIssues(assetBox({ x: 540, y: 1500, scale: 1 }, 800, 300), seq, face);
  assert.ok(low.issues[0].includes("bawah"));
  assert.ok(placementIssues(assetBox({ x: 540, y: 960, scale: 1 }, 1080, 1920), seq, face).full);
  // footage lanskap di sequence vertikal: dipotong kiri-kanan (cover)
  const wide = faceToSeq({ x: 0.5, y: 0, w: 0.1, h: 0.1 }, { width: 1920, height: 1080 }, seq);
  assert.deepEqual([wide.x0, wide.y0, Math.round(wide.x1), wide.y1], [540, 0, 881, 192]);
});

test("kontrol skill: normalisasi, nilai efektif, syarat, dan hanya selisih yang disimpan", () => {
  const g = normalizeControls([
    { group: "Kamera", controls: [
      { key: "camera", label: "Kamera", type: "seg", options: [{ value: "statis" }, { value: "push", label: "Push" }], default: "statis" },
      { key: "camAmt", label: "Kekuatan", type: "range", min: 2, max: 12, step: 1, unit: "%", default: 6, when: { key: "camera", not: ["statis"] } },
      { key: "rusak", type: "seg", options: [{ value: "a" }] },
      { key: "1salah", type: "switch" },
    ] },
    { group: "Kosong", controls: [] },
  ]);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].controls.map((c) => c.key), ["camera", "camAmt"]);
  let v = controlValues(g, null);
  assert.deepEqual(v, { camera: "statis", camAmt: 6 });
  assert.equal(controlVisible(g[0].controls[1], v), false);
  v = controlValues(g, { camera: "push", camAmt: "bukan angka-sah?" });
  assert.equal(controlVisible(g[0].controls[1], v), true);
  assert.deepEqual(nextCustom(g, null, "camera", "push"), { camera: "push" });
  assert.equal(nextCustom(g, { camera: "push" }, "camera", "statis"), null);
  assert.deepEqual(normalizeControls("x"), []);
});

test("kamera: gerak punya masuk, tahan, keluar dan scene berakhir netral", () => {
  const fps = 30;
  const cam = cameraFromContent({ duration: 300, fps, words: [{ start: 40, end: 60, emphasis: false }, { start: 90, end: 110, emphasis: true }, { start: 200, end: 220, emphasis: true }], face: { x: 80, y: -40 } });
  assert.equal(cam.moves!.length, 2);
  for (const m of cam.moves!) { assert.ok(m.out && m.out > 0 && m.hold! > 0); assert.ok(m.at + m.dur + m.hold! + m.out <= 300 - 10); }
  assert.ok(cam.moves![1].at >= cam.moves![0].at + cam.moves![0].dur + cam.moves![0].hold! + cam.moves![0].out!);
  assert.ok(cam.moves![0].x! > 0 && cam.moves![0].y! < 0); // condong ke arah wajah
  // tanpa kata penting: satu dorong; scene sangat pendek: tidak ada gerak
  assert.equal(cameraFromContent({ duration: 240, fps, words: [] }).moves!.length, 1);
  assert.equal(cameraFromContent({ duration: 60, fps, words: [{ start: 10, end: 20, emphasis: true }] }).moves!.length, 0);
  // validasi: hold/out sah, out 0 ditolak
  const h = new History(createProject("t"));
  assert.equal(h.apply({ type: "setScenes", scenes: [{ title: "a", start: 0, end: 300, camera: { moves: [{ at: 10, dur: 24, zoom: 1.1, hold: 20, out: 24 }] } }] } as never), null);
  assert.match(String(h.apply({ type: "setScenes", scenes: [{ title: "a", start: 0, end: 300, camera: { moves: [{ at: 10, dur: 24, zoom: 1.1, out: 0 }] } }] } as never)), /out gerak kamera/);
});

test("kamera: faceAt per gerak mengalahkan face tetap", () => {
  const cam = cameraFromContent({ duration: 300, fps: 30, words: [{ start: 90, end: 110, emphasis: true }], face: { x: -100, y: 0 }, faceAt: () => ({ x: 120, y: 60 }) });
  assert.ok(cam.moves![0].x! > 0 && cam.moves![0].y! > 0);
});

// Alat MCP cz_* untuk Claude. Setiap perubahan lewat Op yang sama dengan UI (validasi + riwayat sumber "claude").
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildCaptions, instantiate, wordFrames, type AssetDef, type Op, type Project,
} from "@cz/core";
import { stillFrame, renderQueue } from "./render.ts";
import type { Session } from "./session.ts";
import { saveAssetDef, saveTemplate } from "./skills.ts";

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type Args = Record<string, unknown>;
interface Tool { name: string; description: string; inputSchema: Record<string, unknown>; run: (s: Session, a: Args) => Promise<Content[] | string> }

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const S = { type: "string" }, N = { type: "number" }, I = { type: "integer" }, O = { type: "object" }, B = { type: "boolean" };
const arr = (items: unknown) => ({ type: "array", items });
const json = (v: unknown) => JSON.stringify(v);

/** Ringkas supaya hemat token: hanya yang dibutuhkan untuk mengambil keputusan editing. */
function projectSummary(p: Project) {
  return {
    title: p.title, sequence: p.sequence, skill: p.skill,
    media: p.media.map((m) => ({ id: m.id, name: m.name, duration: m.duration, hasAudio: m.hasAudio })),
    tracks: p.tracks.map((t) => `${t.id}:${t.name}${t.locked ? " (terkunci)" : ""}`),
    counts: { clips: p.clips.length, words: p.transcript.words.length, captions: p.captions.length, assets: p.assets.length, cuts: p.cuts.length },
    scenes: p.scenes,
    openNotes: p.notes.filter((n) => n.status !== "selesai"),
    markers: p.markers,
  };
}

function transcriptText(p: Project, from = 0, to = Infinity) {
  const frames = wordFrames(p);
  const lines: string[] = [];
  for (const w of p.transcript.words) {
    const f = frames.get(w.id);
    if (f && (f.start < from || f.start > to)) continue;
    lines.push(`${w.id} ${f ? `f${f.start}-${f.end}` : "(terpotong)"} src ${w.mediaId}@${w.srcStart.toFixed(2)}-${w.srcEnd.toFixed(2)} ${w.text}`);
  }
  return lines.length ? `fps ${p.sequence.fps}. Baris: id frame-sequence sumber teks\n` + lines.join("\n") : "Transkrip kosong. Minta user menjalankan Transkrip di mode Media.";
}

export const TOOLS: Tool[] = [
  {
    name: "cz_get_project", description: "Ringkasan proyek: sequence (fps, ukuran, durasi frame), media, track, scene, catatan terbuka, penanda.",
    inputSchema: obj({}), run: async (s) => json(projectSummary(s.history.project)),
  },
  {
    name: "cz_get_timeline", description: "Klip, aset (instans lengkap), caption, dan potongan di timeline. Opsional rentang frame.",
    inputSchema: obj({ from: I, to: I }),
    run: async (s, a) => {
      const p = s.history.project;
      const from = Number(a.from ?? 0), to = Number(a.to ?? Infinity);
      const inRange = (x: number, y: number) => y > from && x < to;
      return json({
        fps: p.sequence.fps,
        clips: p.clips.filter((c) => inRange(c.start, c.start + Math.round((c.srcOut - c.srcIn) * p.sequence.fps))).map((c) => ({ id: c.id, track: c.trackId, media: c.mediaId, start: c.start, srcIn: c.srcIn, srcOut: c.srcOut, enabled: c.enabled })),
        assets: p.assets.filter((x) => inRange(x.start, x.start + x.duration)),
        captions: p.captions.filter((c) => inRange(c.start, c.end)).map((c) => ({ id: c.id, start: c.start, end: c.end, text: c.words.map((w) => w.text).join(" "), position: c.position, style: c.style })),
        cuts: p.cuts.map((c) => ({ id: c.id, kind: c.kind, state: c.state, mediaId: c.mediaId, srcStart: c.srcStart, srcEnd: c.srcEnd, reason: c.reason })),
      });
    },
  },
  {
    name: "cz_get_transcript", description: "Transkrip per kata dengan frame sequence (kata yang sudah dipotong ditandai). Opsional rentang frame.",
    inputSchema: obj({ from: I, to: I }), run: async (s, a) => transcriptText(s.history.project, Number(a.from ?? 0), Number(a.to ?? Infinity)),
  },
  {
    name: "cz_get_frame", description: "Gambar komposit (footage + caption + aset) pada frame sequence tertentu. Pakai seperlunya; setiap frame tercatat di log user.",
    inputSchema: obj({ frame: I }, ["frame"]),
    run: async (s, a) => {
      const f = Math.max(0, Math.round(Number(a.frame)));
      s.claude.log("frame", `Claude melihat gambar di detik ${(f / s.history.project.sequence.fps).toFixed(1)}`);
      const out = await stillFrame(s.folder, s.history.project, await s.library(), f, join(s.folder, "cache", "claude-frame.jpg"));
      return [{ type: "image", data: (await readFile(out)).toString("base64"), mimeType: "image/jpeg" }];
    },
  },
  {
    name: "cz_propose_cuts", description: "Usulkan potongan (ulangan, awal kalimat salah, bagian bertele-tele) dalam detik sumber, beserta alasan. Muncul kuning di timeline; user yang menerima.",
    inputSchema: obj({ cuts: arr(obj({ mediaId: S, srcStart: N, srcEnd: N, reason: S, kind: { type: "string", enum: ["claude", "isian", "ulangan"] } }, ["mediaId", "srcStart", "srcEnd", "reason"])) }, ["cuts"]),
    run: async (s, a) => {
      const cuts = (a.cuts as Args[]).map((c) => ({ ...c, kind: c.kind ?? "claude", by: "claude" }));
      const err = s.apply({ type: "addCuts", cuts } as Op, "claude");
      return err ? `Ditolak: ${err}` : `${cuts.length} potongan diusulkan. User meninjaunya di panel Potong jeda.`;
    },
  },
  {
    name: "cz_apply_cuts", description: "Terapkan potongan (id dari cz_get_timeline). Ripple: celah ditutup; caption dan aset terikat kata ikut bergeser.",
    inputSchema: obj({ cutIds: arr(S) }, ["cutIds"]),
    run: async (s, a) => {
      if (s.review()) return s.propose({ type: "applyCuts", cutIds: a.cutIds as string[] });
      const problems = await s.applyCuts(a.cutIds as string[], "claude");
      return problems.length ? `Diterapkan. Periksa: ${problems.map((x) => x.detail).join("; ")}` : "Diterapkan tanpa masalah.";
    },
  },
  {
    name: "cz_set_scenes", description: "Ganti seluruh scene plan. Tiap scene: title, beat, summary, reason (alasan batas), start/end (frame), options (≤3, id A/B/C, presetId dari template, tepat satu star:true, why).",
    inputSchema: obj({ scenes: arr(obj({ title: S, beat: S, summary: S, reason: S, start: I, end: I, options: arr(obj({ id: S, presetId: S, star: B, why: S })) }, ["title", "start", "end"])) }, ["scenes"]),
    run: async (s, a) => {
      const lib = await s.library();
      const known = new Set(lib?.template?.stylePresets.map((p) => p.id) ?? []);
      const bad = (a.scenes as { options?: { presetId: string }[] }[]).flatMap((x) => x.options ?? []).filter((o) => known.size && !known.has(o.presetId));
      if (bad.length) return `Ditolak: presetId tidak ada di template: ${[...new Set(bad.map((o) => o.presetId))].join(", ")}. Pilihan: ${[...known].join(", ")}`;
      return s.claudeOp({ type: "setScenes", scenes: a.scenes as never });
    },
  },
  {
    name: "cz_update_scene", description: "Ubah satu scene (title, beat, summary, reason, start, end, options, custom, status). choose: id opsi untuk dipilih — aset preset gaya dipasang di scene itu.",
    inputSchema: obj({ id: S, changes: O, choose: S }, ["id"]),
    run: async (s, a) => {
      const p = s.history.project;
      const ops: Op[] = [];
      if (a.changes && Object.keys(a.changes as object).length) ops.push({ type: "updateScene", id: String(a.id), changes: a.changes as never });
      if (a.choose) {
        const sc = p.scenes.find((x) => x.id === a.id);
        const opt = sc?.options.find((o) => o.id === a.choose);
        if (!sc || !opt) return "Ditolak: scene atau opsi tidak ada";
        ops.push(...await s.chooseOps(sc.id, opt.id));
      }
      if (!ops.length) return "Tidak ada perubahan";
      return s.claudeOp(ops.length === 1 ? ops[0] : { type: "batch", label: `Claude: scene ${String(a.id)}`, ops });
    },
  },
  {
    name: "cz_list_assets", description: "Pustaka aset template skill proyek (id, kategori, parameter, pemicu) dan preset gaya.",
    inputSchema: obj({}),
    run: async (s) => {
      const lib = await s.library();
      if (!lib) return "Proyek belum memakai skill. Aset bebas tetap bisa dibuat dengan defId null.";
      return json({
        presets: lib.template?.stylePresets.map((p) => ({ id: p.id, name: p.name, description: p.description, assets: p.assets?.map((x) => x.defId) })),
        assets: lib.assets.map((d) => ({ id: d.id, name: d.name, category: d.category, params: d.params, trigger: d.trigger, duration: d.duration })),
        rules: lib.template?.rules,
      });
    },
  },
  {
    name: "cz_add_asset", description: "Pasang aset dari pustaka di timeline. start/duration dalam frame; anchorWordId mengikat aset ke kata (ikut bergeser bila dipotong). transform {x,y,scale,rotation,opacity} di koordinat sequence.",
    inputSchema: obj({ defId: S, start: I, duration: I, params: O, transform: O, sceneId: S, anchorWordId: S, trackId: S }, ["defId", "start"]),
    run: async (s, a) => {
      const p = s.history.project;
      const lib = await s.library();
      const def = lib?.assets.find((d) => d.id === a.defId) as AssetDef | undefined;
      if (!def) return `Ditolak: aset ${String(a.defId)} tidak ada di pustaka. Lihat cz_list_assets.`;
      const base = instantiate(def, lib!.template?.tokens ?? {}, { start: Number(a.start), fps: p.sequence.fps, seq: p.sequence });
      const asset = {
        ...base, ...(a.duration ? { duration: Number(a.duration) } : {}), params: (a.params as Args) ?? {},
        ...(a.transform ? { transform: { ...base.transform!, ...(a.transform as object) } } : {}),
        ...(a.sceneId ? { sceneId: String(a.sceneId) } : {}), ...(a.anchorWordId ? { anchorWordId: String(a.anchorWordId) } : {}),
        ...(a.trackId ? { trackId: String(a.trackId) } : {}),
      };
      return s.claudeOp({ type: "addAssets", assets: [asset] });
    },
  },
  {
    name: "cz_update_asset", description: "Ubah instans aset: params, transform, start, duration, anim {in,out}, keyframes, sfx, hidden. Aset terkunci user ditolak.",
    inputSchema: obj({ id: S, changes: O }, ["id", "changes"]),
    run: async (s, a) => s.claudeOp({ type: "updateAsset", id: String(a.id), changes: a.changes as never }),
  },
  {
    name: "cz_remove_asset", description: "Hapus instans aset.", inputSchema: obj({ ids: arr(S) }, ["ids"]),
    run: async (s, a) => s.claudeOp({ type: "removeAssets", ids: a.ids as string[] }),
  },
  {
    name: "cz_set_caption", description: "Caption. action=generate (dari transkrip, maxWords per blok), update (id, changes: style/position/words/start/end), split (id, index kata), merge (id dengan blok berikutnya).",
    inputSchema: obj({ action: { type: "string", enum: ["generate", "update", "split", "merge"] }, id: S, changes: O, index: I, maxWords: I }, ["action"]),
    run: async (s, a) => {
      const p = s.history.project;
      if (a.action === "generate") return s.claudeOp({ type: "setCaptions", captions: buildCaptions(p, Number(a.maxWords ?? 4)) });
      if (a.action === "update") return s.claudeOp({ type: "updateCaption", id: String(a.id), changes: a.changes as never });
      if (a.action === "split") return s.claudeOp({ type: "splitCaption", id: String(a.id), index: Number(a.index) });
      return s.claudeOp({ type: "mergeCaption", id: String(a.id) });
    },
  },
  {
    name: "cz_save_template", description: "Simpan template hasil membaca skill: {id, name, version, tokens, textStyles, caption, stylePresets[{id,name,description,caption,camera{from,to},assets[{defId,at:'awal'|'tengah'|'akhir'|detik,duration,params}]}], controls[{id,group,label,type:select|slider|toggle,options,min,max,default}], sfx{peran: path relatif di folder skill}, rules{auto[],scenes,notes[],forbid[]}, warnings[]}. Hanya saat tugas generate/ubah skill.",
    inputSchema: obj({ template: O }, ["template"]),
    run: async (s, a) => {
      const sk = s.claude.running?.skill;
      if (!sk) return "Ditolak: tidak sedang generate skill.";
      const errs = await saveTemplate(sk.id, sk.version, a.template);
      return errs.length ? `Tidak tersimpan: ${errs.join("; ")}` : `Template tersimpan di ${sk.id} v${sk.version}.`;
    },
  },
  {
    name: "cz_save_asset_def", description: "Simpan satu definisi aset JSON deklaratif: {id, name, category, version, description, params{nama:{type:text|list|color|number|bool|select|image|icon, default, min, max, options}}, layout{anchor,x,y,w,h,safeArea}, tree[elemen rect|text|image|video|icon|shape|stack|list|mask|ui-chat], in{preset,frames}, out{preset,frames}, sfx{in,out peran}, duration(detik), trigger, source, license}. Properti elemen: lihat prompt tugas (properti tak dikenal ditolak). Nilai '$nama' merujuk parameter lalu token template. Preset animasi: fade, blurRise, blurFade, pop, slideUp, slideDown, slideLeft, slideRight, scaleIn, wipe.",
    inputSchema: obj({ def: O }, ["def"]),
    run: async (s, a) => {
      const sk = s.claude.running?.skill;
      if (!sk) return "Ditolak: tidak sedang generate skill.";
      const errs = await saveAssetDef(sk.id, sk.version, a.def);
      return errs.length ? `Tidak tersimpan: ${errs.join("; ")}` : `Aset ${(a.def as AssetDef).id} tersimpan.`;
    },
  },
  {
    name: "cz_reply_note", description: "Balas catatan user (mis. menjelaskan apa yang diubah atau kenapa tidak bisa).",
    inputSchema: obj({ id: S, text: S }, ["id", "text"]),
    run: async (s, a) => { const e = s.apply({ type: "replyNote", id: String(a.id), by: "claude", text: String(a.text) }, "claude"); return e ? `Ditolak: ${e}` : "Terkirim."; },
  },
  {
    name: "cz_add_note", description: "Tambah catatan di scene/frame (mis. masalah yang ditemukan saat memeriksa hasil).",
    inputSchema: obj({ sceneId: S, frame: I, text: S }, ["frame", "text"]),
    run: async (s, a) => { const e = s.apply({ type: "addNote", note: { sceneId: (a.sceneId as string) ?? null, frame: Number(a.frame), text: `[Claude] ${String(a.text)}` } }, "claude"); return e ? `Ditolak: ${e}` : "Catatan ditambahkan."; },
  },
  {
    name: "cz_set_note_status", description: "Tandai catatan: terbuka, selesai, konflik.",
    inputSchema: obj({ id: S, status: { type: "string", enum: ["terbuka", "selesai", "konflik"] } }, ["id", "status"]),
    run: async (s, a) => s.claudeOp({ type: "updateNote", id: String(a.id), changes: { status: a.status as never } }),
  },
  {
    name: "cz_render", description: "Mulai render (default seluruh sequence, H.264). range: all | scene (sceneId).",
    inputSchema: obj({ range: { type: "string", enum: ["all", "scene"] }, sceneId: S }),
    run: async (s, a) => {
      const p = s.history.project;
      const job = renderQueue.enqueue(s.folder, p, await s.library(), {
        width: p.sequence.width, height: p.sequence.height, fps: p.sequence.fps, codec: "h264", crf: 18, normalize: true,
        range: a.range === "scene" ? "scene" : "all", sceneId: a.sceneId as string | undefined,
      });
      return `Render ${job.id} masuk antrean. Kemajuan tampil di mode Render.`;
    },
  },
  {
    name: "cz_set_status", description: "Laporkan kemajuan tugas panjang ke user (tampil di panel Claude).",
    inputSchema: obj({ text: S, progress: N }, ["text"]),
    run: async (s, a) => { s.claude.log("info", `${String(a.text)}${a.progress !== undefined ? ` (${Math.round(Number(a.progress) * 100)}%)` : ""}`); return "ok"; },
  },
];

export const toolList = () => TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

export async function callTool(s: Session, name: string, args: Args) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { content: [{ type: "text", text: `Alat tidak dikenal: ${name}` }], isError: true };
  try {
    const r = await t.run(s, args);
    const content = typeof r === "string" ? [{ type: "text", text: r }] : r;
    return { content, isError: typeof r === "string" && r.startsWith("Ditolak") };
  } catch (e) {
    return { content: [{ type: "text", text: (e as Error).message }], isError: true };
  }
}


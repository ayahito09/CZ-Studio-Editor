import type { AssetDef, Op, Project, SkillControlGroup, Template } from "@cz/core";

export type Stage = "menunggu" | "proxy" | "thumbnail" | "waveform" | "siap" | "gagal";
export interface JobStatus { stage: Stage; progress: number; error?: string }
export interface TxStatus { stage: "menunggu" | "transkrip" | "siap" | "gagal"; progress: number; error?: string }
export interface LogEntry { at: number; kind: "user" | "text" | "tool" | "result" | "error" | "frame" | "info"; text: string }
export interface ClaudeTask { id: string; label: string; state: "antre" | "berjalan" | "selesai" | "gagal" | "dihentikan"; log: LogEntry[]; startedAt?: number; endedAt?: number; costUsd?: number }
export interface ClaudeStatus { state: "terhubung" | "belum-login" | "tidak-terpasang" | "memeriksa"; email?: string; plan?: string; version?: string; detail?: string; checkedAt: number }
export interface Pending { id: string; label: string; at: number }
export interface RenderJob {
  id: string; folder: string; title: string; state: "antre" | "menyiapkan" | "render" | "audio" | "selesai" | "gagal" | "batal";
  progress: number; frames: number; eta: number | null; output?: string; error?: string; note?: string;
  settings: { width: number; height: number; fps: number; codec: string; range: string; sceneId?: string } & Record<string, unknown>;
  startedAt?: number; endedAt?: number;
}
export interface SetupStep { id: string; label: string; state: "menunggu" | "memeriksa" | "mengunduh" | "siap" | "gagal"; progress: number; note?: string }
export interface Settings { reviewClaude: boolean; txLang: string; claudeModel: string; claudeEffort: string }
/** Pilihan model Claude (sama dengan CLAUDE_MODELS di server). "" = bawaan Claude Code. */
export const CLAUDE_MODELS = [
  { id: "", name: "Bawaan", hint: "ikut Claude Code" },
  { id: "opus", name: "Opus", hint: "paling cerdas" },
  { id: "sonnet", name: "Sonnet", hint: "seimbang" },
  { id: "haiku", name: "Haiku", hint: "tercepat" },
];
/** Tingkat effort (sama dengan CLAUDE_EFFORTS di server): makin tinggi makin teliti, makin banyak kuota. */
export const CLAUDE_EFFORTS = [
  { id: "", name: "Bawaan", hint: "ikut Claude Code" },
  { id: "low", name: "Rendah", hint: "cepat, hemat kuota" },
  { id: "medium", name: "Sedang", hint: "seimbang" },
  { id: "high", name: "Tinggi", hint: "teliti" },
  { id: "xhigh", name: "Sangat tinggi", hint: "sangat teliti" },
  { id: "max", name: "Maksimal", hint: "paling dalam, boros kuota" },
];

export interface SessionState {
  folder: string;
  project: Project;
  dirty: boolean;
  savedAt: number;
  undo: string | null;
  redo: string | null;
  jobs: Record<string, JobStatus>;
  tx: Record<string, TxStatus>;
  claude: { sessionId: string | null; tasks: ClaudeTask[] };
  pending: Pending[];
  busy: boolean;
  auto: { steps: AutoStep[]; running: boolean; startedAt: number } | null;
  claudeFocus: ClaudeFocus | null;
  claudeNote: { text: string; progress?: number; at: number } | null;
}
export interface AutoStep { id: string; label: string; state: "menunggu" | "berjalan" | "selesai" | "dilewati" | "gagal"; note?: string; progress?: number; startedAt?: number; endedAt?: number }
export interface ClaudeFocus { frame: number; end: number; label: string; ids: string[]; at: number }

/** Kemajuan satu media 0..1 lintas tahap (sama dengan server). */
export const jobFraction = (j: JobStatus | undefined) =>
  !j ? 0 : j.stage === "siap" || j.stage === "gagal" ? 1 : j.stage === "proxy" ? j.progress * 0.8
    : j.stage === "thumbnail" ? 0.8 + j.progress * 0.05 : j.stage === "waveform" ? 0.85 + j.progress * 0.15 : 0;
export interface Recent {
  i: number; folder: string; name: string; exists: boolean; title: string; durationSec: number; updatedAt: number; videos: number;
  poster: { width: number; height: number; duration: number } | null; preview: boolean;
}
export interface State {
  session: SessionState | null; recent: Recent[]; defaultDir: string;
  claude: ClaudeStatus; settings: Settings; renders: RenderJob[]; busy: boolean;
  setup: { running: boolean; steps: SetupStep[] };
}

export interface SkillMeta { id: string; name: string; description: string; source: string; versions: number[]; addedAt: number; generated: Record<number, boolean> }
export interface Library {
  id: string; version: number; name: string; template: Template | null; assets: AssetDef[]; warnings: string[]; base: string;
  component: { url: string; publicBase: string; sfxLib: Record<string, string[]> | null } | null;
  media: Record<string, { faces?: unknown[]; subject?: string }>;
  styleOptions: { label: string; ids: string[] }[];
  controls: SkillControlGroup[];
}
export interface Inventory { refs: string[]; fonts: string[]; sfx: string[]; images: string[]; presets: string[]; scripts: string[]; other: string[] }

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({ error: `Server membalas ${res.status}` }));
  if (!res.ok) throw new Error(data?.error ?? `Server membalas ${res.status}`);
  return data;
}
const parse = (res: Response) => json<State>(res);

const post = (path: string, body: unknown = {}) =>
  fetch("/api/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(parse);
const postAny = <T,>(path: string, body: unknown = {}) =>
  fetch("/api/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => json<T>(r));
const get = <T,>(path: string) => fetch("/api/" + path).then((r) => json<T>(r));

export const api = {
  state: () => fetch("/api/state").then(parse),
  open: (folder: string) => post("open", { folder }),
  create: (title: string, folder?: string, skill?: { id: string; version: number }) => post("new", { title, folder, skill }),
  autoStart: () => post("auto/start"),
  autoCamera: (ids?: string[]) => post("scenes/auto-camera", { ids }),
  autoBaseCamera: (ranges: [number, number][]) => post("camera/auto", { ranges }),
  subjects: () => get<{ subjects: Record<string, string>; busy: string[] }>("subjects"),
  makeSubject: (mediaId: string) => postAny<{ ok: boolean }>(`media/${mediaId}/subject/make`, {}),
  forget: (folder: string) => post("recent/forget", { folder }),
  close: () => post("close"),
  op: (op: Op) => post("op", { op }),
  undo: () => post("undo"),
  redo: () => post("redo"),
  save: () => post("save"),
  importPaths: (paths: string[], link: boolean) => post("media/import", { paths, link }),
  settings: (s: Partial<Settings>) => post("settings", s),
  history: () => get<{ done: { label: string; source: string; at: number }[]; undone: number }>("history"),
  // F3
  updateCheck: () => get<{ current: string; latest: string | null; available: boolean }>("update"),
  updateInstall: () => postAny<{ ok: boolean; detail: string }>("update/install"),
  engine: () => get<{ ready: boolean; bin: string | null; model: string | null }>("engine"),
  transcribe: (mediaId?: string, lang?: string) => post("transcribe", { mediaId, lang }),
  detectCuts: (o: { minGap: number; padding: number; thresholdDb: number | null }) => postAny<State & { detect: { threshold: number | null; count: number } }>("cuts/detect", o),
  applyCuts: (cutIds: string[]) => postAny<State & { problems: { detail: string }[] }>("cuts/apply", { cutIds }),
  // F4
  claudeStatus: (force: boolean) => get<ClaudeStatus>("claude/status" + (force ? "?force=1" : "")),
  claudeLogin: () => postAny<{ ok: boolean }>("claude/login"),
  claudeLogout: (relogin: boolean) => postAny<{ ok: boolean }>("claude/logout", { relogin }),
  claudeRun: (action: string, text = "", source?: string) => post("claude/run", { action, text, source }),
  claudeEstimate: (action: string) => get<{ text: string }>("claude/estimate?action=" + action),
  claudeStop: (id?: string) => post("claude/stop", { id }),
  claudeNewSession: () => post("claude/new-session"),
  settle: (ids: string[] | "all", accept: boolean) => post("claude/pending", { ids, accept }),
  // F5
  skills: () => get<SkillMeta[]>("skills"),
  addSkill: (path: string) => postAny<{ meta: SkillMeta; skills: SkillMeta[] }>("skills/add", { path }),
  skill: (id: string, v: number) => get<Library & { meta: SkillMeta; inventory: Inventory }>(`skills/${id}/${v}`),
  generateSkill: (id: string, v: number, text = "") => post(`skills/${id}/${v}/generate`, { text }),
  editSkill: (id: string, v: number, text: string) => post(`skills/${id}/${v}/edit`, { text }),
  useSkill: (id: string | null, version?: number) => post("project/skill", { id, version }),
  library: () => get<Library | null>("library"),
  reloadLibrary: () => postAny<{ ok: boolean }>("library/reload"),
  // F7
  choose: (sceneId: string, optionId: string) => post("scene/choose", { sceneId, optionId }),
  // F8
  precheck: () => get<{ issues: string[] }>("render/precheck"),
  render: (settings: Record<string, unknown>) => post("render", settings),
  stopRender: (id: string) => post("render/stop", { id }),
  reveal: (id: string, open: boolean) => postAny<{ ok: boolean }>("render/reveal", { id, open }),
};

/** Upload satu file dengan progres (fetch belum memberi progres upload). */
export function upload(file: File, onProgress: (p: number) => void): Promise<State> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", "/api/media/upload?name=" + encodeURIComponent(file.name));
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: { error?: string } = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* balasan bukan JSON */ }
      xhr.status < 300 ? resolve(data as State) : reject(new Error(data.error ?? `Upload gagal (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Koneksi ke server CZ terputus"));
    xhr.send(file);
  });
}

export async function uploadNoteImage(file: File): Promise<string> {
  const res = await fetch("/api/notes/image?name=" + encodeURIComponent(file.name), { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: file });
  return (await json<{ path: string }>(res)).path;
}

export const mediaUrl = (id: string, kind: "proxy" | "thumbs" | "peaks") => `/api/media/${id}/${kind}`;
export const noteImageUrl = (p: string) => `/api/notes/image?p=${encodeURIComponent(p)}`;

/** Unggah isi folder (atau satu .zip) gaya edit hasil seret-lepas, lalu pasang. */
export async function uploadSkill(files: { path: string; file: File }[], onProgress: (done: number, total: number) => void) {
  const batch = (Math.random().toString(36).slice(2, 10) + Date.now().toString(36)).slice(0, 24);
  for (let i = 0; i < files.length; i++) {
    const { path, file } = files[i];
    const res = await fetch(`/api/skills/upload?batch=${batch}&path=${encodeURIComponent(path)}`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: file });
    if (!res.ok) await json(res);
    onProgress(i + 1, files.length);
  }
  return postAny<{ meta: SkillMeta; skills: SkillMeta[] }>("skills/upload/done", { batch });
}

export const recentUrl = (i: number, kind: "poster" | "preview") => `/api/recent/${i}/${kind}`;

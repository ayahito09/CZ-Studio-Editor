// Mesin wajah milik CZ (bukan milik skill): deteksi wajah per media dengan OpenCV YuNet di Python CZ (`cz install`).
// Hasil: <proyek>/skill-data/<mediaId>/faces.json [[t, x, y, w, h, skor]] ternormalisasi, wajah terbesar per sampel.
// Lokasi dan format sama dengan analisis skill, jadi kamera CZ, penempatan elemen, dan komponen skill memakai data yang sama.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config, toolBin } from "./config.ts";
import { pyEnvReady, venvPython, visionDir } from "./pyenv.ts";
import { skillDataDir } from "./skills.ts";

const SCRIPT = String.raw`import sys, json, cv2
src, out, model, step = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
cap = cv2.VideoCapture(src)
fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
every = max(1, int(round(fps * step)))
det = None; faces = []; i = 0
while True:
    ok = cap.grab()
    if not ok: break
    if i % every == 0:
        ok, f = cap.retrieve()
        if not ok: break
        H, W = f.shape[:2]; s = 640.0 / max(W, H)
        small = cv2.resize(f, (int(W * s), int(H * s)))
        if det is None: det = cv2.FaceDetectorYN.create(model, '', (small.shape[1], small.shape[0]), 0.6)
        det.setInputSize((small.shape[1], small.shape[0]))
        _, r = det.detect(small)
        t = round(i / fps, 3)
        if r is not None and len(r):
            b = max(r, key=lambda x: x[2] * x[3]); x, y, w, h = [float(v) / s for v in b[:4]]
            faces.append([t, round(x / W, 4), round(y / H, 4), round(w / W, 4), round(h / H, 4), round(float(b[-1]), 3)])
        else:
            faces.append([t, None, None, None, None, 0.0])
    i += 1
last = None
for fc in faces:
    if fc[1] is None:
        if last: fc[1:5] = last
    else: last = fc[1:5]
first = next((fc[1:5] for fc in faces if fc[1] is not None), None)
faces = [fc for fc in faces if fc[1] is not None or first]
for fc in faces:
    if fc[1] is None: fc[1:5] = first
json.dump(faces, open(out, 'w'))
`;

export const facesFile = (folder: string, mediaId: string) => join(skillDataDir(folder, mediaId), "faces.json");

let ready: boolean | null = null;
/** Siap bila Python CZ dan model YuNet sudah dipasang (`cz install`). Hasil positif disimpan untuk sesi server ini. */
export async function faceEngineReady(): Promise<boolean> {
  if (ready) return true;
  ready = existsSync(join(visionDir(), "yunet.onnx")) && (await pyEnvReady());
  return ready;
}

const running = new Map<string, Promise<boolean>>();
/** Deteksi wajah satu media (proxy bila ada). Sudah ada hasil = langsung true. Satu proses per media. */
export function detectFaces(folder: string, media: { id: string; path: string; proxy?: string }, force = false): Promise<boolean> {
  const key = folder + "|" + media.id;
  const out = facesFile(folder, media.id);
  if (!force && existsSync(out)) return Promise.resolve(true);
  const cur = running.get(key);
  if (cur) return cur;
  const job = (async () => {
    if (!(await faceEngineReady())) return false;
    const proxy = media.proxy ? join(folder, media.proxy) : "";
    const src = proxy && existsSync(proxy) ? proxy : media.path;
    const script = join(config.dataDir, "scripts", "cz_faces.py");
    await mkdir(join(config.dataDir, "scripts"), { recursive: true });
    await writeFile(script, SCRIPT);
    await mkdir(skillDataDir(folder, media.id), { recursive: true });
    const tmp = out + ".tmp";
    const ok = await new Promise<boolean>((res) => {
      const p = spawn(venvPython(), [script, src, tmp, join(visionDir(), "yunet.onnx"), "0.2"], { windowsHide: true });
      p.on("error", () => res(false));
      p.on("close", (c) => res(c === 0));
    });
    if (!ok || !existsSync(tmp)) { await rm(tmp, { force: true }); return false; }
    await rename(tmp, out);
    return true;
  })().finally(() => running.delete(key));
  running.set(key, job);
  return job;
}

// ---------- Matte subjek (teks/elemen di belakang kepala) ----------
// u2net_human_seg per ~10 sampel/dtk, diinterpolasi per frame, digabung ke video jadi subject.webm ber-alpha (VP9).
const MATTE_SCRIPT = String.raw`import sys, os, subprocess
import numpy as np, cv2
import onnxruntime as ort
src, out_dir, model, ffmpeg = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
sess = ort.InferenceSession(model, providers=['CPUExecutionProvider']); iname = sess.get_inputs()[0].name
cap = cv2.VideoCapture(src); fps = cap.get(cv2.CAP_PROP_FPS) or 30.0; n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
W0, H0 = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
mw = 360; mh = int(round(mw * H0 / W0 / 2) * 2); step = max(1, int(round(fps / 10)))
mean = np.array([0.485, 0.456, 0.406]); std = np.array([0.229, 0.224, 0.225]); masks = {}
for i in range(0, n, step):
    cap.set(cv2.CAP_PROP_POS_FRAMES, i); ok, f = cap.read()
    if not ok: break
    x = cv2.resize(cv2.cvtColor(f, cv2.COLOR_BGR2RGB), (320, 320)).astype(np.float32) / 255
    x = ((x - mean) / std).transpose(2, 0, 1)[None].astype(np.float32)
    m = sess.run(None, {iname: x})[0][0, 0]; m = (m - m.min()) / (m.max() - m.min() + 1e-6)
    masks[i] = cv2.resize(m, (mw, mh))
keys = sorted(masks)
if not keys: sys.exit(2)
matte = os.path.join(out_dir, 'matte.mp4')
p = subprocess.Popen([ffmpeg, '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', f'{mw}x{mh}', '-r', f'{fps}', '-i', '-', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', matte], stdin=subprocess.PIPE)
for i in range(n):
    j = min(len(keys) - 1, i // step); k0 = keys[j]; k1 = keys[min(len(keys) - 1, j + 1)]
    u = 0 if k1 == k0 else (i - k0) / (k1 - k0)
    m = np.clip((masks[k0] * (1 - u) + masks[k1] * u - 0.35) / 0.3, 0, 1)
    p.stdin.write((m * 255).astype(np.uint8).tobytes())
p.stdin.close()
if p.wait() != 0: sys.exit(3)
tmp = os.path.join(out_dir, 'subject.tmp.webm')
r = subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', src, '-i', matte, '-filter_complex', f'[1:v]scale={W0}:{H0},format=gray[m];[0:v][m]alphamerge,format=yuva420p',
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '34', '-deadline', 'realtime', '-cpu-used', '8', '-an', tmp])
if r.returncode != 0: sys.exit(4)
os.replace(tmp, os.path.join(out_dir, 'subject.webm'))
`;

export const subjectFile = (folder: string, mediaId: string) => join(skillDataDir(folder, mediaId), "subject.webm");
export const subjectState = new Map<string, "membuat" | "gagal">();

/** Buat subject.webm satu media bila belum ada. Satu proses per media; status di subjectState untuk UI. */
export function detectSubject(folder: string, media: { id: string; path: string; proxy?: string }): Promise<boolean> {
  const key = folder + "|" + media.id, out = subjectFile(folder, media.id);
  if (existsSync(out)) return Promise.resolve(true);
  const cur = matteRunning.get(key);
  if (cur) return cur;
  const job = (async () => {
    if (!(await faceEngineReady()) || !existsSync(join(visionDir(), "u2net_human_seg.onnx"))) return false;
    subjectState.set(key, "membuat");
    const proxy = media.proxy ? join(folder, media.proxy) : "";
    const src = proxy && existsSync(proxy) ? proxy : media.path;
    const script = join(config.dataDir, "scripts", "cz_matte.py");
    await mkdir(join(config.dataDir, "scripts"), { recursive: true });
    await writeFile(script, MATTE_SCRIPT);
    const dir = skillDataDir(folder, media.id);
    await mkdir(dir, { recursive: true });
    const ok = await new Promise<boolean>((res) => {
      const p = spawn(venvPython(), [script, src, dir, join(visionDir(), "u2net_human_seg.onnx"), toolBin("ffmpeg")], { windowsHide: true });
      p.on("error", () => res(false)); p.on("close", (c) => res(c === 0));
    });
    await rm(join(dir, "subject.tmp.webm"), { force: true });
    if (ok && existsSync(out)) { subjectState.delete(key); return true; }
    subjectState.set(key, "gagal");
    return false;
  })().finally(() => matteRunning.delete(key));
  matteRunning.set(key, job);
  return job;
}
const matteRunning = new Map<string, Promise<boolean>>();

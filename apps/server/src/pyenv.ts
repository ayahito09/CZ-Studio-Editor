// Mesin skrip skill yang dipasang `cz install`: Python terpisah milik CZ (venv di folder data) dengan paket
// yang umum dipakai skill video (numpy, OpenCV, ONNX Runtime, soundfile), plus model analisis wajah dan matte subjek.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { askConsent } from "./consent.ts";
import { config } from "./config.ts";
import { download } from "./transcribe.ts";

// Dibatasi sampai versi mayor berikutnya: tidak ikut lompat ke rilis yang bisa merusak skrip analisis.
export const PY_PACKAGES = ["numpy>=2,<3", "opencv-python-headless>=4.10,<6", "onnxruntime>=1.18,<2", "soundfile>=0.12,<1", "pillow>=10,<14"];
const IMPORT_TEST = "import numpy, cv2, onnxruntime, soundfile, PIL";

export const pyEnvDir = () => join(config.dataDir, "python");
export const venvPython = () => join(pyEnvDir(), process.platform === "win32" ? "Scripts\\python.exe" : "bin/python");
/** Model untuk skrip skill (argumen {models}): nama file sama dengan yang dipakai skill clean-editing. */
export const visionDir = () => join(config.dataDir, "models", "vision");
// yunet: SHA-256 sama dengan pointer LFS resmi opencv_zoo. u2net: hash dihitung dari rilis resmi rembg v0.0.0 (tidak ada hash terbit).
export const VISION_MODELS: Record<string, { url: string; sha256: string; size: number }> = {
  "yunet.onnx": { url: "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx", sha256: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4", size: 232589 },
  "u2net_human_seg.onnx": { url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx", sha256: "01eb6a29a5c4d8edb30b56adad9bb3a2a0535338e480724a213e0acfd2d1c73c", size: 175997641 },
};

const ok = (bin: string, args: string[]) => new Promise<boolean>((res) => {
  const p = spawn(bin, args, { windowsHide: true });
  p.on("error", () => res(false)); p.on("close", (c) => res(c === 0));
});
function runLog(bin: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(bin, args, { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    p.on("error", rej);
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`${bin} gagal (kode ${c}): ${err.trim().split("\n").at(-1) ?? ""}`))));
  });
}

export const pyEnvReady = async () => existsSync(venvPython()) && ok(venvPython(), ["-c", IMPORT_TEST]);

/** Python sistem 3.10–3.13 (versi yang punya paket onnxruntime) untuk membuat venv; di Windows dipasang lewat winget (cakupan user) bila belum ada. */
async function systemPython(): Promise<string[]> {
  const test = ["-c", "import sys, venv; assert (3, 10) <= sys.version_info[:2] <= (3, 13)"];
  const list = process.platform === "win32"
    ? [["py", "-3.12"], ["py", "-3.13"], ["py", "-3.11"], ["py", "-3.10"], ["python3"], ["python"]]
    : [["python3.12"], ["python3.13"], ["python3.11"], ["python3"], ["python"]];
  for (const [c, ...pre] of list) if (await ok(c, [...pre, ...test])) return [c, ...pre];
  if (process.platform === "win32" && spawnSync("winget", ["--version"], { windowsHide: true }).status === 0
    && (await askConsent("CZ_ALLOW_WINGET", "Python 3 belum ada. Pasang Python 3.12 (cakupan user) lewat winget dan setujui perjanjiannya?"))) {
    await runLog("winget", ["install", "-e", "--id", "Python.Python.3.12", "--scope", "user", "--silent", "--accept-package-agreements", "--accept-source-agreements"]);
    const local = join(process.env.LOCALAPPDATA ?? "", "Programs", "Python", "Python312", "python.exe");
    if (await ok(local, test)) return [local];
  }
  throw new Error("Python 3.10–3.13 belum terpasang. Pasang dari python.org lalu jalankan: cz install (atau setujui pemasangan lewat winget saat cz install bertanya)");
}

export async function installPyEnv(onProgress: (p: number) => void) {
  // venv dari Python yang tidak cocok (mis. dari percobaan sebelumnya) dibuat ulang.
  if (existsSync(venvPython()) && !(await ok(venvPython(), ["-c", "import sys; assert (3, 10) <= sys.version_info[:2] <= (3, 13)"]))) await rm(pyEnvDir(), { recursive: true, force: true });
  if (!existsSync(venvPython())) {
    const [py, ...pre] = await systemPython();
    onProgress(0.1);
    await runLog(py, [...pre, "-m", "venv", pyEnvDir()]);
  }
  onProgress(0.3);
  onProgress(0.4);
  await runLog(venvPython(), ["-m", "pip", "install", "--disable-pip-version-check", ...PY_PACKAGES]);
  onProgress(1);
}

export const visionReady = async () => Object.keys(VISION_MODELS).every((f) => existsSync(join(visionDir(), f)));

export async function installVision(onProgress: (p: number) => void) {
  await mkdir(visionDir(), { recursive: true });
  const files = Object.entries(VISION_MODELS);
  for (const [i, [name, m]] of files.entries()) {
    const out = join(visionDir(), name);
    if (existsSync(out) && (await stat(out)).size === m.size) continue;
    await download(m.url, out, name, (p) => onProgress((i + p) / files.length), { sha256: m.sha256, size: m.size });
  }
}

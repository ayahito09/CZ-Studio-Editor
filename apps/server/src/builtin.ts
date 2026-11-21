// Aset bawaan CZ, dipasang oleh `cz install`: SFX buatan sendiri (disintesis ffmpeg, bebas lisensi),
// font berlisensi terbuka (OFL), dan gaya edit Clip Minimalist. Semuanya di <data>/builtin, milik user.
import { existsSync } from "node:fs";
import { mkdir, readdir, rename } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { libraryPath } from "./config.ts";
import { run } from "./media.ts";
import { addSkill, listSkills } from "./skills.ts";
import { download } from "./transcribe.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const builtinDir = () => libraryPath("assets");
/** Awalan path di /api/skills/:id/:v/file/* untuk file bawaan (bukan dari folder skill). */
export const BUILTIN_PREFIX = "__cz/";

const S = ":s=48000";
const noise = (d: number, c = "pink") => `anoisesrc=d=${d}:c=${c}:r=48000`;
const tone = (expr: string, d: number) => `aevalsrc='${expr}':d=${d}${S}`;
/** Peran → [sumber lavfi, filter]. Nama peran sama dengan peta SFX skill (woosh, tombol, kilau, …). */
export const SFX: Record<string, [string, string]> = {
  "woosh": [noise(0.7), "highpass=f=500,lowpass=f=6000,afade=t=in:d=0.3,afade=t=out:st=0.3:d=0.4,volume=0.7"],
  "woosh-besar": [noise(1.2), "lowpass=f=3500,highpass=f=200,afade=t=in:d=0.6,afade=t=out:st=0.6:d=0.6"],
  "riser": [tone("0.35*sin(2*PI*(180*t+260*t*t))", 1.6), "afade=t=in:d=1.2,afade=t=out:st=1.4:d=0.2"],
  "impak": [tone("0.9*sin(2*PI*55*t)*exp(-6*t)+0.3*sin(2*PI*110*t)*exp(-9*t)", 0.9), "afade=t=out:st=0.7:d=0.2"],
  "tombol": [tone("0.7*sin(2*PI*1500*t)*exp(-70*t)", 0.1), "anull"],
  "klik": [tone("0.6*sin(2*PI*2200*t)*exp(-120*t)+0.2*sin(2*PI*700*t)*exp(-80*t)", 0.08), "anull"],
  "ketik": [tone("0.5*sin(2*PI*900*t)*exp(-90*t)", 0.06), "anull"],
  "kunci": [tone("0.7*sin(2*PI*320*t)*exp(-30*t)+0.4*sin(2*PI*1900*t)*exp(-100*t)", 0.3), "anull"],
  "kilau": [tone("0.4*sin(2*PI*2600*t)*exp(-6*t)+0.3*sin(2*PI*3900*t)*exp(-8*t)", 0.8), "anull"],
  "notif": [tone("0.45*sin(2*PI*880*t)*exp(-7*t)+0.45*gte(t,0.12)*sin(2*PI*1320*(t-0.12))*exp(-7*(t-0.12))", 0.7), "anull"],
  "kertas": [noise(0.25, "white"), "highpass=f=1500,afade=t=in:d=0.02,afade=t=out:st=0.05:d=0.2,volume=0.5"],
  "shutter": [tone("0.7*sin(2*PI*1200*t)*exp(-90*t)+0.5*gte(t,0.07)*sin(2*PI*800*t)*exp(-80*(t-0.07))", 0.2), "anull"],
  "glitch": [noise(0.3, "white"), "tremolo=f=40:d=1,highpass=f=800,afade=t=out:st=0.2:d=0.1,volume=0.5"],
};

const GF = "https://github.com/google/fonts/raw/main/ofl/";
/** Keluarga font → [file lokal, URL]. Satu file per keluarga (sesuai tokens.fontFiles). */
export const FONTS: Record<string, [string, string]> = {
  "Inter": ["Inter.ttf", GF + "inter/Inter%5Bopsz%2Cwght%5D.ttf"],
  "Poppins": ["Poppins-SemiBold.ttf", GF + "poppins/Poppins-SemiBold.ttf"],
  "Instrument Serif": ["InstrumentSerif-Regular.ttf", GF + "instrumentserif/InstrumentSerif-Regular.ttf"],
};

export const SKILL_ID = "clip-minimalist";
const skillSource = () => [join(here, "builtin", SKILL_ID), join(here, "../builtin", SKILL_ID)].find((d) => existsSync(join(d, "SKILL.md")));

/** Path file bawaan yang diminta lewat URL; kosong bila mencoba keluar dari folder bawaan. */
export const builtinFile = (rel: string) => { const f = resolve(builtinDir(), rel); return f.startsWith(builtinDir() + sep) ? f : ""; };
export const sfxFile = (role: string) => join(builtinDir(), "sfx", role + ".wav");
export const fontFile = (family: string) => join(builtinDir(), "fonts", FONTS[family][0]);

export async function builtinReady(): Promise<boolean> {
  if (!Object.keys(SFX).every((r) => existsSync(sfxFile(r)))) return false;
  if (!Object.keys(FONTS).every((f) => existsSync(fontFile(f)))) return false;
  const src = skillSource();
  return !src || (await listSkills()).some((s) => s.id === SKILL_ID);
}

/** Memasang yang kurang saja; aman dipanggil berulang. */
export async function installBuiltin(onProgress: (p: number) => void = () => {}) {
  const roles = Object.keys(SFX), fonts = Object.keys(FONTS);
  const total = roles.length + fonts.length + 1;
  let done = 0;
  const tick = () => onProgress(++done / total);
  await mkdir(join(builtinDir(), "sfx"), { recursive: true });
  await mkdir(join(builtinDir(), "fonts"), { recursive: true });
  for (const role of roles) {
    const out = sfxFile(role);
    if (!existsSync(out)) {
      const [src, af] = SFX[role], tmp = out + ".tmp.wav";
      await run("ffmpeg", ["-y", "-v", "error", "-nostdin", "-f", "lavfi", "-i", src, "-af", af, "-ar", "48000", "-ac", "1", tmp]);
      await rename(tmp, out);
    }
    tick();
  }
  for (const family of fonts) {
    const out = fontFile(family);
    if (!existsSync(out)) await download(FONTS[family][1], out, family, () => {});
    tick();
  }
  const src = skillSource();
  if (src && !(await listSkills()).some((s) => s.id === SKILL_ID)) await addSkill(src, "bawaan CZ");
  tick();
}

export async function builtinSfxRoles(): Promise<string[]> {
  try { return (await readdir(join(builtinDir(), "sfx"))).filter((f) => f.endsWith(".wav")).map((f) => f.slice(0, -4)); } catch { return []; }
}

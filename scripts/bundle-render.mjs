// Bundel komposisi Remotion sekali saat build (dist/render-bundle), supaya paket npm tidak butuh webpack saat render.
// Source map ikut disimpan: renderer memakainya untuk menerjemahkan galat komposisi.
import { bundle } from "@remotion/bundler";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = (p) => fileURLToPath(new URL("../" + p, import.meta.url));
const outDir = root("dist/render-bundle");
const out = await bundle({ entryPoint: root("packages/composition/src/entry.tsx"), outDir });

// Hasil bundel memuat path komputer pembuatnya (remotion_cwd di index.html, "sources" di source map). Paket npm tidak boleh membawanya.
const HOME = /[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)[^\\\/"']+/g;
let cleaned = 0;
for (const f of readdirSync(outDir)) {
  if (!/\.(html|map|js)$/.test(f)) continue;
  const p = join(outDir, f), s = readFileSync(p, "utf8");
  const t = s.replace(HOME, "~");
  if (t !== s) { writeFileSync(p, t); cleaned++; }
}
console.log("Bundel render:", out, cleaned ? `(path pengguna dibersihkan di ${cleaned} file)` : "");

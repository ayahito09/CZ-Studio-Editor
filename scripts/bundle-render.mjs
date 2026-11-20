// Bundel komposisi Remotion sekali saat build (dist/render-bundle), supaya paket npm tidak butuh webpack saat render.
// Source map ikut disimpan: renderer memakainya untuk menerjemahkan galat komposisi.
import { bundle } from "@remotion/bundler";
import { fileURLToPath } from "node:url";

const root = (p) => fileURLToPath(new URL("../" + p, import.meta.url));
const out = await bundle({ entryPoint: root("packages/composition/src/entry.tsx"), outDir: root("dist/render-bundle") });
console.log("Bundel render:", out);

// Persetujuan untuk langkah pemasangan yang mengubah komputer di luar folder data CZ (winget, npm global).
// Hanya `cz install` di terminal yang bertanya; pemasangan otomatis di latar (postinstall, aplikasi) tidak pernah menyetujui sendiri.
import { createInterface } from "node:readline/promises";

let interactive = false;
export const setInteractive = (v: boolean) => { interactive = v; };

/** true bila env `envName`=1 (setuju di muka) atau user menjawab y di terminal interaktif. */
export async function askConsent(envName: string, question: string): Promise<boolean> {
  if (process.env[envName] === "1") return true;
  if (!interactive || !process.stdin.isTTY || !process.stdout.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return /^(y|ya)$/i.test((await rl.question(`${question} [y/N] `)).trim()); } finally { rl.close(); }
}

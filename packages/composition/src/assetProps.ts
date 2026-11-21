// Kontrak komponen elemen: sama dengan yang dipakai paket elemen lokal (private/pack, milik developer) dan komposisi "Aset…" skill.
export interface AssetProps {
  params: Record<string, unknown>;
  durationInFrames: number; fps: number;
  /** Ukuran kotak aset (px sequence). */
  width: number; height: number;
  /** Kata yang diucapkan selama aset tampil: detik relatif awal aset. */
  words: { w: string; s: number; e: number }[];
  /** URL video untuk param bertipe media (param media pertama). Elemen baru memakai `media`. */
  mediaSrc?: string;
  /** Foto atau video tiap slot (param bertipe media), kunci = nama param. Slot kosong = tidak ada kuncinya. */
  media?: Record<string, { src: string; kind: "image" | "video" }>;
  /** Font skill pengganti font UI bawaan, mis. "'CE Inter', sans-serif". */
  font?: string;
}

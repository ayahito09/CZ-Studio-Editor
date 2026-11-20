import { useEffect, useRef } from "react";
import { Icon } from "./icons.tsx";

const GROUPS: [string, [string, string][]][] = [
  ["Alat", [["V", "Pilih dan geser"], ["A", "Pilih semua ke kanan"], ["B", "Pangkas dan rapatkan"], ["N", "Geser sambungan"], ["C", "Gunting"], ["Y", "Geser isi klip"], ["U", "Geser klip di antara tetangganya"]]],
  ["Sunting", [["Ctrl+K", "Potong di posisi sekarang"], ["Delete", "Hapus, celahnya dibiarkan"], ["Shift+Delete", "Hapus dan rapatkan"], ["Q / W", "Pangkas awal / akhir sampai posisi sekarang"],
    ["; / '", "Kosongkan / hapus bagian bertanda"], ["Ctrl+C / X / V", "Salin / potong / tempel"], ["Alt + seret", "Gandakan"], ["Ctrl+L", "Gabungkan / pisahkan gambar dan suara"], ["Shift+E", "Nyalakan / matikan klip"]]],
  ["Putar", [["Spasi", "Putar / jeda"], ["J / K / L", "Mundur / berhenti / maju (tekan lagi = lebih cepat)"], ["← / →", "Satu gambar (Shift = 5)"], ["↑ / ↓", "Sambungan sebelumnya / berikutnya"],
    ["I / O", "Tandai awal / akhir bagian (Alt = hapus tanda)"], ["Home / End", "Ke awal / akhir"]]],
  ["Tampilan", [["+ / − / \\", "Perbesar / perkecil / lihat semua"], ["Ctrl + gulir", "Perbesar di posisi kursor"], ["M", "Tambah penanda"], ["S", "Magnet"], ["Ctrl+Z / Ctrl+Shift+Z", "Batalkan / ulangi"], ["Ctrl+S", "Simpan"]]],
];

export function Shortcuts({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current.close()} aria-labelledby="sc-h">
      <div className="sheet__head">
        <h2 id="sc-h">Pintasan keyboard</h2>
        <button className="btn btn--icon" onClick={() => ref.current?.close()} aria-label="Tutup"><Icon name="close" /></button>
      </div>
      <div className="sheet__grid">
        {GROUPS.map(([title, rows]) => (
          <section key={title}>
            <h3>{title}</h3>
            <dl>
              {rows.map(([k, v]) => (
                <div key={k} className="sc-row"><dt>{k.split(" / ").map((x, i) => <span key={i}>{i > 0 && " / "}<kbd>{x}</kbd></span>)}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  );
}

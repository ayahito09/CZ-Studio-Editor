import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as RPointerEvent } from "react";
import { timecode } from "./store.ts";
import { api, recentUrl, upload, type Recent, type State } from "./api.ts";
import type { Run } from "./App.tsx";
import { Icon } from "./icons.tsx";
import { Progress } from "./Progress.tsx";

const VIDEO = /\.(mp4|mov|mkv|webm|m4v|avi|mts|m2ts|mpe?g|wmv|flv|3gp)$/i;

export function Home({ g, run }: { g: State; run: Run }) {
  const live = g.recent.filter((r) => r.exists);
  const missing = g.recent.filter((r) => !r.exists);
  const [openOther, setOpenOther] = useState(false);
  const [openFolder, setOpenFolder] = useState("");

  return (
    <main className="home">
      <Backdrop />
      <header className="home__top">
        <img className="mark" src="/logo.png" alt="" />
        <span className="home__brand">CZ Studio</span>
        <LiveClock />
        <ClaudeBadge g={g} run={run} />
        <UpdateButton />
      </header>

      <SetupStrip g={g} />
      {/* Kartu judul: form papan klep di tengah, judul terbelah di kiri dan kanannya. */}
      <section className="stage" aria-labelledby="stage-h">
        <h1 id="stage-h" className="cutin stage__title" aria-label="Mau bikin video apa hari ini?">
          {[["Mau", "bikin"], ["video", "apa", "hari", "ini?"]].map((side, s) => (
            <span key={s} className={s ? "stage__r" : "stage__l"} aria-hidden="true">
              {side.map((w, k) => {
                const i = s * 2 + k;
                return <Fragment key={i}>
                  <span className={"cutin__w" + (w === "video" ? " cutin__w--accent" : "")} style={{ "--i": i } as CSSProperties}>{w === "video" ? <em>{w}</em> : w}</span>
                  {w === "apa" && <span className="cutin__br" />}
                </Fragment>;
              })}
            </span>
          ))}
          <span className="cutin__head" aria-hidden="true" />
        </h1>
        <div className="stage__intro">
          <p>Editor video lokal dengan bantuan Claude Code. Semua berjalan di komputermu.</p>
        </div>
        {/* Proyek terakhir langsung di layar pertama: sampul satu bingkai, video berputar saat disorot. */}
        <div className="hub" aria-labelledby="recent-h">
          <div className="hub__head">
            <h2 id="recent-h">Lanjutkan proyek{live.length > 0 && <span className="home__count mono">{live.length}</span>}</h2>
            <button className="link-btn" onClick={() => setOpenOther(!openOther)}>{openOther ? "Tutup" : "Buka dari folder lain"}</button>
          </div>
          {openOther && (
            <form className="home__open" onSubmit={(e) => { e.preventDefault(); run(() => api.open(openFolder)); }}>
              <input className="mono" value={openFolder} onChange={(e) => setOpenFolder(e.target.value)} placeholder="C:\Video\Proyek1" aria-label="Lokasi folder proyek" autoFocus required />
              <button className="btn" type="submit">Buka</button>
            </form>
          )}
          {live.length === 0 ? (
            <p className="home__empty">Belum ada proyek. Buat yang pertama di sebelah kanan: cukup judul, videonya boleh menyusul.</p>
          ) : (
            <ul className="pgrid">
              {live.map((r, i) => <ProjectCard key={r.folder} r={r} run={run} first={i === 0} />)}
            </ul>
          )}
          {missing.length > 0 && (
            <details className="missing">
              <summary>{missing.length} proyek lama tidak ditemukan lagi di foldernya</summary>
              <ul>
                {missing.map((r) => <li key={r.folder}><span>{r.name}</span><span className="muted mono">{r.folder}</span></li>)}
              </ul>
              <button className="link-btn" onClick={() => run(async () => { let st = await api.state(); for (const r of missing) st = await api.forget(r.folder); return st; })}>Hapus semuanya dari daftar</button>
            </details>
          )}
        </div>
        {/* Kolom kanan: buat proyek, lalu cara pasang di bawahnya (satu kolom, tepi sejajar). */}
        <aside className="stage__side">
          <NewProject g={g} run={run} />
          <section className="side-install" aria-labelledby="install-h">
            <h2 id="install-h">Pasang di komputer lain</h2>
            <InstallFlow />
          </section>
        </aside>
      </section>
      {g.claude.state !== "terhubung" && <ConnectClaude g={g} run={run} />}
    </main>
  );
}

/** Buat proyek: cukup judul. Video boleh langsung diseret; folder dibuatkan otomatis. */
function NewProject({ g, run }: { g: State; run: Run }) {
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [custom, setCustom] = useState(false);
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [up, setUp] = useState<{ v: number; since: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // Salin dulu: FileList dari <input> ikut kosong saat value di-reset, sedangkan updater setFiles jalan belakangan.
  const add = (list: FileList | File[]) => { const picked = [...list]; setFiles((xs) => [...xs, ...picked.filter((f) => VIDEO.test(f.name) && !xs.some((x) => x.name === f.name && x.size === f.size))]); };

  const [clap, setClap] = useState(0);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setClap((c) => c + 1);
    setBusy("Membuat proyek…");
    await run(async () => {
      await api.create(title, custom && folder.trim() ? folder.trim() : undefined);
      for (const [n, f] of files.entries()) {
        await upload(f, (p) => { setBusy(`Menyalin video ${n + 1} dari ${files.length}`); setUp((u) => ({ since: u?.since ?? Date.now(), v: (n + p) / files.length })); });
      }
      return files.length ? api.autoStart() : api.state();
    });
    setBusy(null); setUp(null);
  };

  return (
    <form className="newcard" onSubmit={create}>
      {/* Papan klep: menutup sekali saat dimuat dan tiap kali proyek dibuat. */}
      <div className="slate" aria-hidden="true">
        <span key={clap} className="slate__arm" />
        <span className="slate__base" />
        <dl className="slate__info mono">
          <div><dt>Proyek</dt><dd>{title.trim() || "tanpa judul"}</dd></div>
          <div><dt>Take</dt><dd>{String(files.length || 1).padStart(2, "0")}</dd></div>
          <div><dt>Tanggal</dt><dd>{new Date().toLocaleDateString("id", { day: "2-digit", month: "short" })}</dd></div>
        </dl>
      </div>
      <label className="newcard__title">
        <span>Judul video</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="mis. 3 cara edit lebih cepat" maxLength={200} autoFocus />
      </label>
      <div className={"newcard__drop" + (over ? " is-over" : "") + (files.length ? " has-files" : "")}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
        onClick={() => !files.length && input.current?.click()}>
        {files.length === 0 ? (
          <>
            <Icon name="film" />
            <div><strong>Seret video ke sini</strong><span>atau klik untuk memilih. Boleh juga nanti.</span></div>
          </>
        ) : (
          <ul className="newcard__files">
            {files.map((f) => (
              <li key={f.name + f.size}>
                <FileThumb file={f} /><span>{f.name}</span><span className="muted">{(f.size / 1e6).toFixed(0)} MB</span>
                <button type="button" className="btn btn--icon btn--sm" aria-label={`Batal pakai ${f.name}`} onClick={(e) => { e.stopPropagation(); setFiles(files.filter((x) => x !== f)); }}><Icon name="close" /></button>
              </li>
            ))}
            <li><button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); input.current?.click(); }}>Tambah video lain</button></li>
          </ul>
        )}
        <input ref={input} type="file" accept="video/*,.mkv,.mov,.avi,.mts,.m2ts,.mpg,.mpeg,.wmv,.flv,.3gp" multiple hidden onChange={(e) => { add(e.target.files ?? []); e.target.value = ""; }} />
      </div>
      <p className="newcard__note">{files.length ? "Transkrip, potong jeda, dan subtitle berjalan otomatis setelah proyek dibuat." : "Setelah ada video: transkrip, potong jeda, dan subtitle berjalan otomatis."} Skill dipilih di dalam editor.</p>
      {custom ? (
        <label className="newcard__where">
          <span>Simpan di folder</span>
          <input className="mono" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder={g.defaultDir} />
        </label>
      ) : (
        <p className="newcard__where-note">Disimpan di <span className="mono">{g.defaultDir}</span> · <button type="button" className="link-btn" onClick={() => setCustom(true)}>ubah</button></p>
      )}
      <button className="btn btn--primary newcard__go" type="submit" disabled={!!busy}>
        {busy ? <><span className="spinner" aria-hidden="true" />{busy}</> : <>{files.length ? `Buat proyek dengan ${files.length} video` : "Buat proyek"}<Icon name="stepFwd" /></>}
      </button>
      {up && <Progress value={up.v} since={up.since} />}
    </form>
  );
}

const ago = (t: number) => {
  const f = new Intl.RelativeTimeFormat("id", { numeric: "auto", style: "short" });
  const s = (t - Date.now()) / 1000;
  for (const [u, n] of [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]] as const) {
    if (Math.abs(s) >= n) return f.format(Math.round(s / n), u);
  }
  return "baru saja";
};
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

function ProjectCard({ r, run, first }: { r: Recent; run: Run; first?: boolean }) {
  const [hover, setHover] = useState(false);
  const vid = useRef<HTMLVideoElement>(null);
  const media = useRef<HTMLSpanElement>(null);
  // Geser kursor di sampul = menggulir isi video, seperti scrub di linimasa.
  const scrub = (e: RPointerEvent) => {
    const box = media.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
    media.current!.style.setProperty("--scrub", String(x));
    const v = vid.current;
    if (v && v.readyState >= 1 && Number.isFinite(v.duration)) v.currentTime = x * v.duration;
  };
  // Sampul: bingkai pertama dari strip gambar mini (kotak seukuran rasio video, strip setinggi kotak).
  const poster = useMemo(() => (r.poster ? { backgroundImage: `url(${recentUrl(r.i, "poster")})` } as CSSProperties : undefined), [r]);
  const ratio = r.poster ? `${r.poster.width} / ${r.poster.height}` : "9 / 16";
  return (
    <li className={"pcard" + (first ? " pcard--first" : "")} style={{ "--ratio": ratio } as CSSProperties} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {first && <span className="pcard__tag">Terakhir dibuka</span>}
      <button className="pcard__open" onClick={() => run(() => api.open(r.folder))} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
        <span className="pcard__media" style={poster} ref={media} onPointerMove={scrub}>
          {!r.poster && <span className="pcard__blank"><Icon name="film" /></span>}
          {hover && r.preview && <video ref={vid} src={recentUrl(r.i, "preview")} muted loop autoPlay playsInline preload="auto" />}
          {hover && <span className="pcard__head" aria-hidden="true" />}
          {r.durationSec > 0 && <span className="pcard__dur mono">{clock(r.durationSec)}</span>}
        </span>
        <span className="pcard__body">
          <strong>{r.title}</strong>
          <span className="muted" title={`Diubah ${ago(r.updatedAt)}${r.videos ? ` · ${r.videos} video` : ""}`}>{ago(r.updatedAt)}</span>
        </span>
      </button>
      <button className="btn btn--icon btn--sm pcard__forget" onClick={() => run(() => api.forget(r.folder))} aria-label={`Hapus ${r.title} dari daftar`} title="Hapus dari daftar (file proyek tetap ada)">
        <Icon name="close" />
      </button>
    </li>
  );
}

/** Latar: jalur-jalur linimasa samar yang memudar ke bawah, motif dari pekerjaan editing itu sendiri. */
const SVG_NS = "http://www.w3.org/2000/svg";
const ROW_Y = (r: number) => 36 + r * 58;
// Jalur latar: 0 bagian, 1 elemen, 2 subtitle (diisi "Claude"), 3 video, 4 suara (sudah ada klip).
const AI_ACTS = [
  { row: 3, kind: "cut", label: "Memotong jeda" },
  { row: 2, kind: "grow", label: "Membuat subtitle", color: "#4b5a2a", w: 150 },
  { row: 1, kind: "pop", label: "Memasang elemen", color: "#34437a", w: 96 },
  { row: 2, kind: "grow", label: "Membuat subtitle", color: "#4b5a2a", w: 120 },
  { row: 0, kind: "grow", label: "Menata bagian", color: "#5b4632", w: 280 },
] as const;

/** Linimasa latar yang "dikerjakan" Claude: kursor berpindah, memotong jeda, mengisi subtitle, memasang elemen, lalu mulai lagi. */
function useAiTimeline(layer: React.RefObject<SVGGElement | null>, cursor: React.RefObject<SVGGElement | null>, say: React.RefObject<SVGTextElement | null>, pill: React.RefObject<SVGRectElement | null>) {
  useEffect(() => {
    const L = layer.current, C = cursor.current, S = say.current, P = pill.current;
    if (!L || !C || !S || !P) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let alive = true;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const rect = (x: number, row: number, w: number, fill: string, op: number) => {
      const el = document.createElementNS(SVG_NS, "rect");
      for (const [k, v] of Object.entries({ x, y: ROW_Y(row), width: w, height: 44, rx: 4, fill, opacity: op })) el.setAttribute(k, String(v));
      el.style.transformBox = "fill-box";
      L.append(el);
      return el;
    };
    const act = async (a: (typeof AI_ACTS)[number], x: number) => {
      if (a.kind === "cut") {
        const gap = rect(x - 18, 3, 36, "#ff4d3d", 0);
        await gap.animate([{ opacity: 0 }, { opacity: 0.85 }, { opacity: 0.45 }], { duration: 520, fill: "forwards" }).finished;
        const blade = rect(x - 1, 3, 2, "#fff", 0);
        blade.setAttribute("height", "102");
        await blade.animate([{ opacity: 0 }, { opacity: 0.9 }, { opacity: 0 }], { duration: 380, fill: "forwards" }).finished;
      } else if (a.kind === "grow") {
        const el = rect(x, a.row, a.w, a.color, 0.75);
        el.style.transformOrigin = "0 50%";
        await el.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 560, easing: "cubic-bezier(.2,.7,.2,1)", fill: "forwards" }).finished;
      } else {
        const el = rect(x, a.row, a.w, a.color, 0.75);
        el.style.transformOrigin = "50% 50%";
        await el.animate([{ transform: "scale(.4)", opacity: 0 }, { transform: "scale(1.06)", opacity: 0.85, offset: 0.7 }, { transform: "scale(1)", opacity: 0.75 }], { duration: 480, fill: "forwards" }).finished;
      }
    };
    const moveTo = async (x: number, row: number, label: string) => {
      S.textContent = label;
      P.setAttribute("width", String(44 + label.length * 7.4));
      const to = `translate(${x}px, ${ROW_Y(row)}px)`;
      await C.animate([{ transform: getComputedStyle(C).transform === "none" ? "translate(0px, 36px)" : getComputedStyle(C).transform }, { transform: to }], { duration: 760, easing: "cubic-bezier(.5,0,.25,1)", fill: "forwards" }).finished;
      C.style.transform = to;
    };
    const run = async () => {
      while (alive) {
        L.replaceChildren();
        L.style.opacity = "1";
        C.style.opacity = "1";
        let x = 70;
        for (let i = 0; x < 1520 && alive; i++) {
          const a = AI_ACTS[i % AI_ACTS.length];
          await moveTo(x, a.row, a.label);
          await act(a, x);
          await sleep(260);
          x += a.kind === "cut" ? 40 : ("w" in a ? Math.round(a.w * 0.55) : 80) + ((i * 37) % 60);
        }
        if (!alive) break;
        await moveTo(1500, 0, "Selesai ditata");
        await sleep(900);
        await Promise.all([L.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900, fill: "forwards" }).finished, C.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, fill: "forwards" }).finished]);
        C.style.transform = "translate(0px, 36px)";
      }
    };
    if (reduced) {
      // Diam: hasil akhir saja, tanpa kursor.
      C.style.display = "none";
      [[60, 2, 150], [260, 2, 120], [520, 2, 140], [820, 2, 130], [1100, 2, 150]].forEach(([x, r, w]) => rect(x, r, w, "#4b5a2a", 0.75));
      [[180, 1, 96], [700, 1, 96], [1240, 1, 96]].forEach(([x, r, w]) => rect(x, r, w, "#34437a", 0.75));
      [[40, 0, 420], [480, 0, 520], [1020, 0, 520]].forEach(([x, r, w]) => rect(x, r, w, "#5b4632", 0.75));
    } else run().catch(() => { /* animasi dibatalkan saat beranda ditutup */ });
    return () => { alive = false; L.getAnimations?.({ subtree: true }).forEach((a) => a.cancel()); C.getAnimations().forEach((a) => a.cancel()); };
  }, []);
}

function Backdrop() {
  const rows = useMemo(() => {
    // Pola tetap (bukan acak tiap muat) supaya latar tidak "melompat". Hanya jalur video dan suara yang sudah berisi klip.
    const seed = [7, 3, 11, 5, 9, 2, 13, 6, 4, 10, 8, 12];
    const colors = ["#2b4642", "#3d3226", "#2b4642"];
    return colors.map((c, i) => {
      const r = i + 3;
      let x = (seed[r] * 37) % 120 - 60;
      const clips: { x: number; w: number }[] = [];
      for (let k = 0; x < 1600; k++) {
        const w = 90 + ((seed[(r + k) % seed.length] * 53) % 260);
        clips.push({ x, w });
        x += w + 8 + ((seed[(k * 3 + r) % seed.length] * 7) % 40);
      }
      return { c, r, clips };
    });
  }, []);
  const layer = useRef<SVGGElement>(null);
  const aiCursor = useRef<SVGGElement>(null);
  const say = useRef<SVGTextElement>(null);
  const pill = useRef<SVGRectElement>(null);
  useAiTimeline(layer, aiCursor, say, pill);
  // Playhead mengikuti kursor dan menampilkan timecode posisinya; DOM diubah langsung supaya tidak me-render ulang.
  const wrap = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const tc = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0, x = 0;
    const paint = () => {
      raf = 0;
      if (!head.current || !tc.current) return;
      head.current.style.transform = `translateX(${x}px)`;
      tc.current.textContent = timecode(Math.round((x / innerWidth) * 60 * 30), 30);
      wrap.current?.classList.add("is-live");
    };
    const move = (e: PointerEvent) => { x = e.clientX; if (!raf) raf = requestAnimationFrame(paint); };
    addEventListener("pointermove", move);
    return () => { removeEventListener("pointermove", move); cancelAnimationFrame(raf); };
  }, []);
  return (
    <div className="home__bgwrap" ref={wrap} aria-hidden="true">
    <div className="home__cursor" ref={head}><span ref={tc} className="mono">00:00:00:00</span></div>
    <svg className="home__bg" viewBox="0 0 1600 420" preserveAspectRatio="xMidYMin slice">
      <defs>
        <linearGradient id="bgfade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="bgmask"><rect width="1600" height="420" fill="url(#bgfade)" /></mask>
      </defs>
      <g mask="url(#bgmask)">
        {/* Jalur kosong yang akan diisi Claude */}
        {[0, 1, 2].map((r) => <rect key={r} x={0} y={ROW_Y(r)} width={1600} height={44} fill="#fff" opacity={0.025} />)}
        {rows.map((row) => (
          <g key={row.r} transform={`translate(0 ${ROW_Y(row.r)})`}>
            {row.clips.map((cl, k) => <rect key={k} x={cl.x} y={0} width={cl.w} height={44} rx={4} fill={row.c} opacity={0.32} />)}
          </g>
        ))}
        <g ref={layer} />
      </g>
      {/* Kursor Claude: garis oranye + pil berlogo dan aksi yang sedang dikerjakan (di luar mask supaya tetap jelas). */}
      <g ref={aiCursor} className="aicur" style={{ transform: "translate(0px, 36px)" }}>
        <rect x={-1} y={-10} width={2} height={64} fill="#d97757" />
        <rect ref={pill} x={6} y={-22} width={150} height={24} rx={12} fill="#d97757" />
        <image href="/claude-logo.png" x={12} y={-18} width={16} height={16} className="aicur__logo" />
        <text ref={say} x={34} y={-5} className="aicur__say">Claude</text>
      </g>
    </svg>
    </div>
  );
}

/** Jam timecode langsung (jam:menit:detik:gambar) dengan tanda REC; hiasan, tidak dibaca pembaca layar. */
function LiveClock() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const p = (n: number) => String(n).padStart(2, "0");
    const slow = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = () => { const d = new Date(); if (ref.current) ref.current.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}:${slow ? "00" : p(Math.floor(d.getMilliseconds() / 40))}`; };
    tick();
    const t = setInterval(tick, slow ? 1000 : 40);
    return () => clearInterval(t);
  }, []);
  return <span className="home__clock mono" aria-hidden="true"><i />REC <span ref={ref} /></span>;
}

/** Cuplikan video yang dipilih (bingkai awal, langsung dari file di browser). Bila codec tak terbaca, ikon film tetap tampil. */
function FileThumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => { const u = URL.createObjectURL(file); setUrl(u); return () => URL.revokeObjectURL(u); }, [file]);
  return (
    <span className="newcard__thumb">
      <Icon name="film" />
      {url && <video src={`${url}#t=0.5`} muted playsInline preload="metadata" onError={() => setUrl(undefined)} />}
    </span>
  );
}

const ClaudeMark = () => <img className="cmark" src="/claude-logo.png" width="15" height="15" alt="" />;

/** Badge status Claude; bila diklik membuka menu ganti akun, keluar, atau cek ulang. */
function ClaudeBadge({ g, run }: { g: State; run: Run }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const st = g.claude.state;
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const act = async (fn: () => Promise<unknown>) => {
    setOpen(false); setBusy(true);
    try { await fn(); await api.claudeStatus(true).catch(() => {}); await run(api.state); } catch (e) { alert((e as Error).message); }
    setBusy(false);
  };
  const logout = (relogin: boolean) => {
    if (confirm(relogin ? "Keluar dari akun Claude sekarang, lalu masuk dengan akun lain? Login ini dipakai bersama Claude Code di komputermu." : "Keluar dari akun Claude? Login ini dipakai bersama Claude Code di komputermu.")) act(() => api.claudeLogout(relogin));
  };
  return (
    <div className="cmenu" ref={box}>
      <button type="button" className={`home__claude home__claude--${st}`} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} disabled={busy}>
        <ClaudeMark />
        {busy ? "Memproses…" : st === "terhubung" ? "Claude siap" : st === "belum-login" ? "Claude belum masuk" : st === "memeriksa" ? "Memeriksa Claude…" : "Claude belum dipasang"}
        <svg className="cmenu__chev" width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
      </button>
      {open && (
        <div className="cmenu__list" role="menu">
          {st === "terhubung" && g.claude.email && (
            <div className="cmenu__acct">
              <span>Masuk sebagai</span>
              <b title={g.claude.email}>{g.claude.email}</b>
              {g.claude.plan && <em>{g.claude.plan}</em>}
            </div>
          )}
          {st === "terhubung" && <>
            <button role="menuitem" onClick={() => logout(true)}>Ganti akun</button>
            <button role="menuitem" onClick={() => logout(false)}>Keluar (logout)</button>
          </>}
          {st === "belum-login" && <button role="menuitem" onClick={() => act(() => api.claudeLogin())}>Masuk ke Claude</button>}
          <button role="menuitem" onClick={() => act(async () => {})}>Cek ulang</button>
        </div>
      )}
    </div>
  );
}

/** Ajakan menghubungkan Claude: penataan otomatis dan saran butuh Claude milik user. */
function ConnectClaude({ g, run }: { g: State; run: Run }) {
  const [checking, setChecking] = useState(false);
  const recheck = async () => { setChecking(true); await api.claudeStatus(true).catch(() => {}); await run(api.state); setChecking(false); };
  const missing = g.claude.state === "tidak-terpasang";
  return (
    <section className="connect" aria-labelledby="connect-h">
      <div className="connect__icon" aria-hidden="true"><Icon name="wand" /></div>
      <div className="connect__text">
        <h2 id="connect-h">Hubungkan Claude untuk penataan otomatis</h2>
        {missing
          ? <p>Claude Code belum ada di komputer ini. Pasang dari <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer">claude.com/claude-code</a>, lalu kembali ke sini.</p>
          : <p>Login aplikasi Claude di desktop tidak otomatis ikut. Tekan <b>Masuk ke Claude</b>, masuk dengan akun yang sama di halaman yang terbuka, lalu tekan <b>Cek ulang</b>. Cukup sekali; videomu tetap di komputer ini.</p>}
      </div>
      <div className="connect__actions">
        {!missing && <button className="btn btn--primary" onClick={() => api.claudeLogin().catch((e) => alert((e as Error).message))}>Masuk ke Claude</button>}
        <button className="btn" onClick={recheck} disabled={checking}>{checking ? <><span className="spinner" aria-hidden="true" />Memeriksa…</> : "Cek ulang"}</button>
      </div>
    </section>
  );
}

const INSTALL_STEPS = [
  { cmd: "npm install -g cz-studio", note: "pasang sekali · butuh Node.js 20+" },
  { cmd: "cz install", note: "pasang alat: ffmpeg, transkrip, ekspor" },
  { cmd: "cz", note: "buka kapan saja" },
];

/** Tata cara pasang berupa satu jendela terminal; klik sebuah baris untuk menyalin perintahnya. */
function InstallFlow() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (cmd: string) => {
    navigator.clipboard?.writeText(cmd).then(() => { setCopied(cmd); setTimeout(() => setCopied((c) => (c === cmd ? null : c)), 1500); }).catch(() => {});
  };
  return (
    <div className="iterm" role="group" aria-label="Cara memasang CZ Studio">
      <div className="iterm__bar" aria-hidden="true"><i /><i /><i /><span>Terminal</span></div>
      {INSTALL_STEPS.map((x) => (
        <button key={x.cmd} type="button" className="iterm__line" onClick={() => copy(x.cmd)} aria-label={`Salin perintah ${x.cmd}`}>
          <code><b aria-hidden="true">$</b> {x.cmd}</code>
          <em>{x.note}</em>
          <span aria-hidden="true">{copied === x.cmd ? <span className="term__ok">Tersalin</span> : <Icon name="copy" />}</span>
        </button>
      ))}
    </div>
  );
}

/** Muncul hanya bila ada versi CZ Studio yang lebih baru di npm. */
function UpdateButton() {
  const [info, setInfo] = useState<{ latest: string | null; available: boolean } | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const [detail, setDetail] = useState("");
  useEffect(() => { api.updateCheck().then(setInfo).catch(() => {}); }, []);
  if (!info?.available) return null;
  const install = async () => {
    setState("busy");
    try {
      const r = await api.updateInstall();
      setDetail(r.detail);
      setState(r.ok ? "done" : "fail");
    } catch (e) { setDetail(String(e)); setState("fail"); }
  };
  if (state === "done") return <span className="btn btn--sm-text" role="status">Versi {info.latest} terpasang. Tutup CZ Studio lalu buka lagi.</span>;
  return (
    <button className="btn btn--primary btn--sm-text" onClick={install} disabled={state === "busy"} title={state === "fail" ? detail : undefined}>
      {state === "busy" ? <><span className="spinner" aria-hidden="true" />Memperbarui…</> : state === "fail" ? "Gagal, coba lagi" : `Update ke ${info.latest}`}
    </button>
  );
}

/** Kemajuan pemasangan alat (ffmpeg, whisper, model) yang berjalan otomatis di latar. */
export function SetupStrip({ g }: { g: State }) {
  const steps = g.setup?.steps ?? [];
  const failed = steps.filter((x) => x.state === "gagal");
  if (!g.setup?.running && !failed.length) return null;
  const cur = steps.find((x) => x.state === "mengunduh" || x.state === "memeriksa");
  return (
    <div className={"setupstrip" + (failed.length && !g.setup.running ? " is-bad" : "")} role="status">
      {g.setup.running ? <span className="spinner" aria-hidden="true" /> : <Icon name="alert" />}
      <span>
        {g.setup.running
          ? <>Menyiapkan alat sekali saja: <b>{cur?.label ?? "memeriksa"}</b>{cur?.state === "mengunduh" ? ` · ${Math.round(cur.progress * 100)}%` : ""}</>
          : <>Belum terpasang: {failed.map((x) => x.label).join(", ")}. Buka Terminal lalu ketik <code>cz setup</code>.</>}
      </span>
      {g.setup.running && <span className="setupstrip__bar"><Progress key={cur?.id} value={cur?.state === "mengunduh" ? cur.progress : null} size="sm" /></span>}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { thumbPlan } from "@cz/core";
import { api, recentUrl, upload, uploadSkill, type Recent, type SkillMeta, type State } from "./api.ts";
import { filesFromDrop, skipped } from "./AssetsPanel.tsx";
import type { Run } from "./App.tsx";
import { Icon } from "./icons.tsx";

const VIDEO = /\.(mp4|mov|mkv|webm|m4v)$/i;

export function Home({ g, run }: { g: State; run: Run }) {
  const live = g.recent.filter((r) => r.exists);
  const missing = g.recent.filter((r) => !r.exists);
  const [openOther, setOpenOther] = useState(false);
  const [openFolder, setOpenFolder] = useState("");

  return (
    <main className="home">
      <Backdrop />
      <header className="home__top">
        <span className="mark" aria-hidden="true">CZ</span>
        <span className="home__brand">CZ Studio</span>
        <span className={`home__claude home__claude--${g.claude.state}`}>
          <span className="pill__dot" aria-hidden="true" />
          {g.claude.state === "terhubung" ? "Claude siap" : g.claude.state === "belum-login" ? "Claude belum masuk" : g.claude.state === "memeriksa" ? "Memeriksa Claude…" : "Claude belum dipasang"}
        </span>
      </header>

      <SetupStrip g={g} />
      <section className="home__hero">
        <div className="home__intro">
          <h1>Mau bikin video apa hari ini?</h1>
          <p>Seret video mentahmu. CZ memotong jeda, menyiapkan subtitle per kata, lalu kamu tinggal merapikan tampilannya.</p>
        </div>
        <NewProject g={g} run={run} />
      </section>
      {g.claude.state !== "terhubung" && <ConnectClaude g={g} run={run} />}

      <section className="home__recent" aria-labelledby="recent-h">
        <div className="home__recent-head">
          <h2 id="recent-h">Lanjutkan proyek</h2>
          <button className="link-btn" onClick={() => setOpenOther(!openOther)}>{openOther ? "Tutup" : "Buka proyek dari folder lain"}</button>
        </div>
        {openOther && (
          <form className="home__open" onSubmit={(e) => { e.preventDefault(); run(() => api.open(openFolder)); }}>
            <input className="mono" value={openFolder} onChange={(e) => setOpenFolder(e.target.value)} placeholder="C:\Video\Proyek1" aria-label="Lokasi folder proyek" autoFocus required />
            <button className="btn" type="submit">Buka</button>
          </form>
        )}
        {live.length === 0 ? (
          <p className="home__empty">Proyekmu akan muncul di sini, lengkap dengan cuplikan videonya.</p>
        ) : (
          <ul className="cards">
            {live.map((r) => <ProjectCard key={r.folder} r={r} run={run} />)}
          </ul>
        )}
        {missing.length > 0 && (
          <ul className="missing">
            {missing.map((r) => (
              <li key={r.folder}>
                <span>{r.name}</span><span className="muted">folder tidak ditemukan</span>
                <button className="link-btn" onClick={() => run(() => api.forget(r.folder))}>Hapus dari daftar</button>
              </li>
            ))}
          </ul>
        )}
      </section>
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
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [skill, setSkill] = useState("");
  const [skillOver, setSkillOver] = useState(false);
  const [skillBusy, setSkillBusy] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const skillFolder = useRef<HTMLInputElement>(null);
  const skillZip = useRef<HTMLInputElement>(null);
  useEffect(() => { api.skills().then((xs) => { setSkills(xs); if (xs[0]) setSkill(`${xs[0].id}@${Math.max(...xs[0].versions)}`); }).catch(() => {}); }, []);

  /** Gaya edit baru dari seret-lepas atau pilihan folder/.zip; langsung terpilih. */
  const addSkill = async (list: { path: string; file: File }[]) => {
    if (!list.length) return;
    setSkillBusy("Menyalin gaya edit…");
    try {
      const r = await uploadSkill(list, (d, t) => setSkillBusy(t > 1 ? `Menyalin ${d} dari ${t} file…` : "Menyalin…"));
      setSkills(r.skills);
      setSkill(`${r.meta.id}@${Math.max(...r.meta.versions)}`);
    } catch (err) { alert((err as Error).message); }
    setSkillBusy(null);
  };
  const fromSkillInput = (l: FileList | null) => addSkill([...(l ?? [])].map((f) => ({ path: f.webkitRelativePath || f.name, file: f })).filter((x) => !skipped(x.path)));
  const add = (list: FileList | File[]) => setFiles((xs) => [...xs, ...[...list].filter((f) => VIDEO.test(f.name) && !xs.some((x) => x.name === f.name && x.size === f.size))]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("Membuat proyek…");
    await run(async () => {
      const [id, v] = skill.split("@");
      await api.create(title, custom && folder.trim() ? folder.trim() : undefined, id ? { id, version: Number(v) } : undefined);
      for (const [n, f] of files.entries()) {
        await upload(f, (p) => setBusy(`Menyalin video ${n + 1} dari ${files.length} · ${Math.round(p * 100)}%`));
      }
      return files.length && auto ? api.autoStart() : api.state();
    });
    setBusy(null);
  };

  return (
    <form className="newcard" onSubmit={create}>
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
            <strong>Seret video ke sini</strong>
            <span>atau klik untuk memilih. Boleh juga nanti.</span>
          </>
        ) : (
          <ul className="newcard__files">
            {files.map((f) => (
              <li key={f.name + f.size}>
                <Icon name="film" /><span>{f.name}</span><span className="muted">{(f.size / 1e6).toFixed(0)} MB</span>
                <button type="button" className="btn btn--icon btn--sm" aria-label={`Batal pakai ${f.name}`} onClick={(e) => { e.stopPropagation(); setFiles(files.filter((x) => x !== f)); }}><Icon name="close" /></button>
              </li>
            ))}
            <li><button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); input.current?.click(); }}>Tambah video lain</button></li>
          </ul>
        )}
        <input ref={input} type="file" accept="video/*,.mkv,.mov" multiple hidden onChange={(e) => { add(e.target.files ?? []); e.target.value = ""; }} />
      </div>
      <div className={"newcard__skill" + (skillOver ? " is-over" : "")}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.stopPropagation(); setSkillOver(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSkillOver(false); }}
        onDrop={async (e) => { e.preventDefault(); e.stopPropagation(); setSkillOver(false); addSkill(await filesFromDrop(e.dataTransfer)); }}>
        <span className="newcard__label">Gaya edit</span>
        {skillBusy ? <span className="newcard__skillbusy"><span className="spinner" aria-hidden="true" />{skillBusy}</span> : (
          <div className="newcard__skillrow">
            <select value={skill} onChange={(e) => setSkill(e.target.value)} aria-label="Gaya edit">
              <option value="">Tanpa gaya edit</option>
              {skills.flatMap((sk) => sk.versions.map((v) => <option key={sk.id + v} value={`${sk.id}@${v}`}>{sk.name}{sk.versions.length > 1 ? ` · versi ${v}` : ""}</option>))}
            </select>
            <button type="button" className="btn" onClick={() => skillFolder.current?.click()} title="Atau seret folder / file .zip skill ke kotak ini">
              <Icon name="upload" />Unggah skill
            </button>
          </div>
        )}
        <span className="newcard__hint">Seret folder atau .zip skill ke sini, atau <button type="button" className="link-btn" onClick={() => skillZip.current?.click()}>pilih file .zip</button>.</span>
        <input ref={skillFolder} type="file" hidden {...{ webkitdirectory: "", directory: "" }} onChange={(e) => { fromSkillInput(e.target.files); e.target.value = ""; }} />
        <input ref={skillZip} type="file" accept=".zip" hidden onChange={(e) => { fromSkillInput(e.target.files); e.target.value = ""; }} />
      </div>
      <label className={"newcard__auto" + (files.length ? "" : " is-off")}>
        <input type="checkbox" checked={auto && files.length > 0} disabled={!files.length} onChange={(e) => setAuto(e.target.checked)} />
        <span>
          <strong>Rapikan otomatis setelah dibuat</strong>
          <span>{!files.length ? "Tambahkan video dulu." : g.claude.state === "terhubung"
            ? "Potong jeda, buat subtitle, lalu Claude menata tiap bagian sesuai gaya edit."
            : "Potong jeda dan buat subtitle. Hubungkan Claude supaya tiap bagian ikut ditata sesuai gaya edit."}</span>
        </span>
      </label>
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
    </form>
  );
}

const ago = (t: number) => {
  const f = new Intl.RelativeTimeFormat("id", { numeric: "auto" });
  const s = (t - Date.now()) / 1000;
  for (const [u, n] of [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]] as const) {
    if (Math.abs(s) >= n) return f.format(Math.round(s / n), u);
  }
  return "baru saja";
};
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

function ProjectCard({ r, run }: { r: Recent; run: Run }) {
  const [hover, setHover] = useState(false);
  // Sampul: satu gambar dari strip gambar mini, sekitar sepertiga video.
  const poster = useMemo(() => {
    if (!r.poster) return undefined;
    const t = thumbPlan(r.poster);
    const idx = Math.min(t.count - 1, Math.floor(t.count / 3));
    return { backgroundImage: `url(${recentUrl(r.i, "poster")})`, backgroundSize: `${t.count * 100}% 100%`, backgroundPosition: `${t.count > 1 ? (idx / (t.count - 1)) * 100 : 0}% 0` } as CSSProperties;
  }, [r]);
  return (
    <li className="pcard" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button className="pcard__open" onClick={() => run(() => api.open(r.folder))} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
        <span className="pcard__media" style={poster}>
          {!r.poster && <span className="pcard__blank"><Icon name="film" /></span>}
          {hover && r.preview && <video src={recentUrl(r.i, "preview")} muted loop autoPlay playsInline preload="auto" />}
          {r.durationSec > 0 && <span className="pcard__dur mono">{clock(r.durationSec)}</span>}
        </span>
        <span className="pcard__body">
          <strong>{r.title}</strong>
          <span className="muted">Diubah {ago(r.updatedAt)}{r.videos ? ` · ${r.videos} video` : ""}</span>
        </span>
      </button>
      <button className="btn btn--icon btn--sm pcard__forget" onClick={() => run(() => api.forget(r.folder))} aria-label={`Hapus ${r.title} dari daftar`} title="Hapus dari daftar (file proyek tetap ada)">
        <Icon name="close" />
      </button>
    </li>
  );
}

/** Latar: jalur-jalur linimasa samar yang memudar ke bawah, motif dari pekerjaan editing itu sendiri. */
function Backdrop() {
  const rows = useMemo(() => {
    // Pola tetap (bukan acak tiap muat) supaya latar tidak "melompat".
    const seed = [7, 3, 11, 5, 9, 2, 13, 6, 4, 10, 8, 12];
    const colors = ["#2b4642", "#3d3226", "#2c3550", "#33402a", "#2b4642", "#3d3226"];
    return colors.map((c, r) => {
      let x = (seed[r] * 37) % 120 - 60;
      const clips: { x: number; w: number }[] = [];
      for (let k = 0; x < 1600; k++) {
        const w = 90 + ((seed[(r + k) % seed.length] * 53) % 260);
        clips.push({ x, w });
        x += w + 8 + ((seed[(k * 3 + r) % seed.length] * 7) % 40);
      }
      return { c, clips };
    });
  }, []);
  return (
    <svg className="home__bg" viewBox="0 0 1600 420" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      <defs>
        <linearGradient id="bgfade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="bgmask"><rect width="1600" height="420" fill="url(#bgfade)" /></mask>
      </defs>
      <g mask="url(#bgmask)">
        {rows.map((row, r) => (
          <g key={r} transform={`translate(0 ${36 + r * 58})`}>
            {row.clips.map((cl, k) => <rect key={k} x={cl.x} y={0} width={cl.w} height={44} rx={4} fill={row.c} opacity={0.32} />)}
          </g>
        ))}
        <line x1="980" y1="0" x2="980" y2="420" stroke="#dafa9c" strokeOpacity=".35" strokeWidth="2" />
        <path d="M972 0h16v8l-8 8-8-8z" fill="#dafa9c" fillOpacity=".5" />
      </g>
    </svg>
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
      {g.setup.running && cur?.state === "mengunduh" && <span className="setupstrip__bar"><span style={{ width: `${Math.round(cur.progress * 100)}%` }} /></span>}
    </div>
  );
}

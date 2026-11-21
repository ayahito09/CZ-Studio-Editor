import { useRef, useState, type FormEvent } from "react";
import { thumbPlan, type Media } from "@cz/core";
import { api, jobFraction, mediaUrl, upload, type JobStatus } from "./api.ts";
import { Progress } from "./Progress.tsx";
import { useEd, type Ed } from "./ed.ts";
import { Icon } from "./icons.tsx";
import { timecode } from "./store.ts";

export const MEDIA_DRAG = "application/x-cz-media";
const STAGE_LABEL: Record<string, string> = { menunggu: "Menunggu", proxy: "Menyiapkan pratinjau", thumbnail: "Membuat gambar mini", waveform: "Membaca suara", gagal: "Gagal" };

interface Uploading { key: string; name: string; progress: number }

/** Upload beberapa file berurutan; dipakai panel Media dan seret-lepas di seluruh editor. */
export function useUploader(run: Ed["run"]) {
  const [items, setItems] = useState<Uploading[]>([]);
  const start = async (files: File[]) => {
    for (const file of files) {
      const key = file.name + file.size + Math.random();
      setItems((xs) => [...xs, { key, name: file.name, progress: 0 }]);
      await run(() => upload(file, (p) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, progress: p } : x)))));
      setItems((xs) => xs.filter((x) => x.key !== key));
    }
  };
  return { items, start };
}

export function MediaPanel({ uploader }: { uploader: ReturnType<typeof useUploader> }) {
  const ed = useEd();
  const fileInput = useRef<HTMLInputElement>(null);
  const [showPath, setShowPath] = useState(false);
  const [path, setPath] = useState("");
  const [link, setLink] = useState(false);
  const media = ed.project.media.filter((m) => m.kind !== "image"); // foto slot elemen tidak tampil di daftar video

  const importPath = async (e: FormEvent) => {
    e.preventDefault();
    const paths = path.split(/\r?\n/).map((p) => p.trim()).filter(Boolean);
    if (paths.length && (await ed.run(() => api.importPaths(paths, link)))) { setPath(""); setShowPath(false); }
  };

  return (
    <aside className="panel media" aria-labelledby="media-h">
      <div className="panel__head">
        <h2 id="media-h" className="panel__title">Video <span className="count">{media.length || ""}</span></h2>
        <button className="btn btn--sm-text" onClick={() => fileInput.current?.click()}><Icon name="upload" />Impor</button>
        <input ref={fileInput} type="file" accept="video/*,.mkv,.mov,.avi,.mts,.m2ts,.mpg,.mpeg,.wmv,.flv,.3gp" multiple hidden
          onChange={(e) => { uploader.start([...(e.target.files ?? [])]); e.target.value = ""; }} />
      </div>

      {uploader.items.map((u) => (
        <div key={u.key} className="upload">
          <span className="upload__name">{u.name}</span>
          <Progress value={u.progress} size="sm" />
        </div>
      ))}

      {media.length === 0 && uploader.items.length === 0 ? (
        <button className="drop" onClick={() => fileInput.current?.click()}>
          <Icon name="film" />
          <strong>Seret video ke sini</strong>
          <span>MP4, MOV, MKV, atau WebM. Video disalin ke folder proyek; file aslimu tidak diubah.</span>
        </button>
      ) : (
        <ul className="media-list">
          {media.map((m) => <MediaItem key={m.id} m={m} job={ed.s.jobs[m.id]} />)}
        </ul>
      )}

      <div className="panel__foot">
        {showPath ? (
          <form className="path-form" onSubmit={importPath}>
            <label className="field">
              <span>Lokasi file video (satu per baris)</span>
              <textarea className="mono" rows={2} value={path} onChange={(e) => setPath(e.target.value)} placeholder="D:\Footage\take1.mp4" autoFocus />
            </label>
            <label className="check">
              <input type="checkbox" checked={link} onChange={(e) => setLink(e.target.checked)} />
              <span>Pakai langsung dari tempatnya, jangan disalin (untuk file besar)</span>
            </label>
            <div className="row">
              <button className="btn btn--primary" type="submit">Impor</button>
              <button className="btn btn--ghost" type="button" onClick={() => setShowPath(false)}>Batal</button>
            </div>
          </form>
        ) : (
          <button className="link-btn" onClick={() => setShowPath(true)}>Ambil dari lokasi file</button>
        )}
      </div>
    </aside>
  );
}

function MediaItem({ m, job }: { m: Media; job?: JobStatus }) {
  const ed = useEd();
  const stage = job?.stage ?? "menunggu";
  const thumbsReady = stage === "waveform" || stage === "siap";
  const t = thumbPlan(m);
  const fps = ed.project.sequence.fps;

  // Overwrite edit di playhead pada V1 (+A1 bila ada audio).
  const insert = () => {
    const at = ed.playhead.get();
    ed.op({
      type: "addClips",
      clips: [
        { trackId: "V1", mediaId: m.id, srcIn: 0, srcOut: m.duration, start: at, link: "a" },
        { trackId: "A1", mediaId: m.id, srcIn: 0, srcOut: m.duration, start: at, link: "a" },
      ],
    });
  };

  return (
    <li className="media-item" draggable onDragStart={(e) => { e.dataTransfer.setData(MEDIA_DRAG, m.id); e.dataTransfer.effectAllowed = "copy"; }}
      onDoubleClick={insert} title="Seret ke linimasa, atau klik dua kali untuk menaruh di posisi sekarang">
      <div className="media-item__thumb" style={thumbsReady ? { backgroundImage: `url(${mediaUrl(m.id, "thumbs")})`, backgroundSize: `${t.count * 100}% 100%`, aspectRatio: `${t.tileW} / ${t.tileH}` } : { aspectRatio: `${t.tileW} / ${t.tileH}` }}>
        <span className="media-item__dur mono">{timecode(Math.round(m.duration * fps), fps)}</span>
      </div>
      <div className="media-item__body">
        <span className="media-item__name" title={m.path}>{m.name}</span>
        <span className="media-item__meta">{m.height > m.width ? "Tegak" : m.height < m.width ? "Mendatar" : "Kotak"}{m.linked ? " · dipakai dari tempat aslinya" : ""}{m.hasAudio ? "" : " · tanpa suara"}</span>
        {stage !== "siap" && (
          stage === "gagal" ? (
            <span className="media-item__error" title={job?.error}><Icon name="alert" />{job?.error ?? "Gagal"}</span>
          ) : (
            <div className="media-item__job">
              <Progress value={jobFraction(job)} size="sm" label={STAGE_LABEL[stage]} />
            </div>
          )
        )}
      </div>
      <div className="media-item__actions">
        <button className="btn btn--icon btn--sm" onClick={insert} aria-label={`Taruh ${m.name} di posisi sekarang`} title="Taruh di posisi sekarang"><Icon name="insert" /></button>
        <button className="btn btn--icon btn--sm" onClick={() => ed.op({ type: "removeMedia", mediaId: m.id })} aria-label={`Hapus ${m.name} dari proyek`}
          title="Hapus dari proyek (file di disk tetap ada, bisa dibatalkan)"><Icon name="trash" /></button>
      </div>
    </li>
  );
}

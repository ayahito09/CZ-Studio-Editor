import { useCallback, useEffect, useState } from "react";
import { api, type State } from "./api.ts";
import { Editor } from "./Editor.tsx";
import { Home } from "./Home.tsx";

export type Run = (fn: () => Promise<State>) => Promise<boolean>;

export function App() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run: Run = useCallback(async (fn) => {
    try { setState(await fn()); setError(null); return true; }
    catch (e) { setError((e as Error).message); return false; }
  }, []);

  useEffect(() => { run(api.state); }, [run]);

  // Selama ada kerja latar (media, transkrip, Claude, render), ambil status tiap detik. Balasan yang sama tidak me-render ulang.
  const busy = !!state?.busy;
  useEffect(() => {
    if (!busy) return;
    let last = "";
    const t = setInterval(async () => {
      try {
        const next = await api.state();
        const text = JSON.stringify(next);
        if (text !== last) { last = text; setState(next); }
      } catch { /* server sedang sibuk; coba lagi detik berikutnya */ }
    }, 1000);
    return () => clearInterval(t);
  }, [busy]);

  // Undo/redo/simpan global; di dalam kolom teks biarkan undo bawaan browser.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!state?.session || !(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement;
      const typing = t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
      const k = e.key.toLowerCase();
      if (k === "s") { e.preventDefault(); run(api.save); }
      else if (typing) return;
      else if (k === "z" && !e.shiftKey) { e.preventDefault(); run(api.undo); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); run(api.redo); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [state?.session, run]);

  useEffect(() => {
    document.title = state?.session ? `${state.session.project.title} · CZ Studio` : "CZ Studio";
  }, [state?.session?.project.title]);

  if (!state) return <div className="boot" role="status">{error ?? "Menghubungkan ke server CZ…"}</div>;
  return (
    <>
      {state.session ? <Editor s={state.session} g={state} run={run} /> : <Home g={state} run={run} />}
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button className="btn btn--ghost" onClick={() => setError(null)}>Tutup</button>
        </div>
      )}
    </>
  );
}

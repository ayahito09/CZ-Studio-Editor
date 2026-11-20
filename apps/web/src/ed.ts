import { createContext, useContext, type RefObject } from "react";
import type { PlayerRef } from "@remotion/player";
import type { NewClip, Op, Project } from "@cz/core";
import type { Library, SessionState, State } from "./api.ts";
import type { Store } from "./store.ts";

export type Tool = "select" | "trackFwd" | "ripple" | "roll" | "razor" | "slip" | "slide";

export const TOOLS: { id: Tool; key: string; label: string }[] = [
  { id: "select", key: "V", label: "Pilih dan geser" },
  { id: "trackFwd", key: "A", label: "Pilih semua ke kanan" },
  { id: "ripple", key: "B", label: "Pangkas dan rapatkan" },
  { id: "roll", key: "N", label: "Geser sambungan" },
  { id: "razor", key: "C", label: "Gunting" },
  { id: "slip", key: "Y", label: "Geser isi klip" },
  { id: "slide", key: "U", label: "Geser klip di antara tetangganya" },
];

export interface InOut { in: number | null; out: number | null }

export type Mode = "media" | "plan" | "edit" | "render";
export const MODES: { id: Mode; label: string }[] = [
  { id: "media", label: "Bahan" }, { id: "plan", label: "Rencana" }, { id: "edit", label: "Sunting" }, { id: "render", label: "Ekspor" },
];

/** Jenis item dari prefiks id (c=klip, a=aset, cap=caption, s=scene). */
export const itemKind = (id: string) => (id.startsWith("cap") ? "caption" : id.startsWith("a") ? "asset" : id.startsWith("s") ? "scene" : "clip");

/** Semua yang dibagi panel editor. Nilai yang berubah tiap frame (playhead) ada di Store. */
export interface Ed {
  s: SessionState;
  g: State;
  project: Project;
  mode: Mode;
  setMode: (m: Mode) => void;
  lib: Library | null;
  reloadLib: () => void;
  /** Pratinjau sementara di Player (mis. Putar dengan potongan); null = proyek sebenarnya. */
  preview: Project | null;
  setPreview: (p: Project | null) => void;
  claudeOpen: boolean;
  setClaudeOpen: (v: boolean) => void;
  op: (op: Op) => Promise<boolean>;
  run: (fn: () => Promise<State>) => Promise<boolean>;
  playhead: Store<number>;
  playing: Store<boolean>;
  player: RefObject<PlayerRef | null>;
  seek: (frame: number) => void;
  selection: Set<string>;
  select: (ids: Iterable<string>) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  snap: boolean;
  setSnap: (v: boolean) => void;
  pps: number;
  setPps: (v: number) => void;
  inOut: InOut;
  setInOut: (v: InOut) => void;
  loop: boolean;
  setLoop: (v: boolean) => void;
  clipboard: RefObject<NewClip[]>;
}

export const EdContext = createContext<Ed | null>(null);
export const useEd = () => useContext(EdContext)!;

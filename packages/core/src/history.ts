import { applyPatches, type Patch } from "immer";
import { applyOp, claudeBlocked, describeOp, OpError, validateOp, type Op } from "./ops.ts";
import type { Project } from "./project.ts";

export type Source = "manual" | "claude" | "catatan";

export interface Entry {
  label: string;
  source: Source;
  at: number;
  patches: Patch[];
  inverse: Patch[];
}

/** Undo/redo tak terbatas berbasis patch: hanya selisih yang disimpan, bukan salinan proyek. */
export class History {
  project: Project;
  done: Entry[] = [];
  undone: Entry[] = [];

  constructor(project: Project) {
    this.project = project;
  }

  /** Memvalidasi lalu menerapkan op. Mengembalikan pesan galat, atau null bila berhasil. */
  apply(op: unknown, source: Source = "manual"): string | null {
    const err = validateOp(op, this.project);
    if (err) return err;
    if (source === "claude") { const blocked = claudeBlocked(op as Record<string, unknown>, this.project); if (blocked) return blocked; }
    let result;
    try { result = applyOp(this.project, op as Op); }
    catch (e) { if (e instanceof OpError) return e.message; throw e; }
    const [next, patches, inverse] = result;
    if (patches.length === 0) return null; // tidak ada yang berubah, tidak dicatat
    this.project = next;
    this.done.push({ label: describeOp(op as Op), source, at: Date.now(), patches, inverse });
    this.undone = [];
    return null;
  }

  undo(): Entry | null {
    const e = this.done.pop();
    if (!e) return null;
    this.project = applyPatches(this.project, e.inverse);
    this.undone.push(e);
    return e;
  }

  redo(): Entry | null {
    const e = this.undone.pop();
    if (!e) return null;
    this.project = applyPatches(this.project, e.patches);
    this.done.push(e);
    return e;
  }
}

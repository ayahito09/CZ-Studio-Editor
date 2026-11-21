// Bagian panel yang bisa dilipat: satu fungsi per bagian, ditumpuk dalam satu gulir, bukan tab terpisah-pisah.
import type { ReactNode } from "react";

export function Section({ title, count, open = true, children }: { title: string; count?: number; open?: boolean; children: ReactNode }) {
  return (
    <details className="sect" open={open}>
      <summary className="sect__head">
        <span>{title}</span>
        {count ? <span className="count">{count}</span> : null}
        <i className="sect__chev" aria-hidden="true" />
      </summary>
      <div className="sect__body">{children}</div>
    </details>
  );
}

import { useState, type ReactNode } from "react";

export type SectionStatus = "clear" | "moderate" | "restricted" | "neutral" | "warning";

interface SectionCardProps {
  title: string;
  icon?: string;
  status?: SectionStatus;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** Collapsible report section. Self-contained so the future PDF editor can reuse it. */
export function SectionCard({ title, icon, status = "neutral", defaultOpen = false, children }: SectionCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const dotClass =
    status === "clear" ? "clear" : status === "warning" || status === "moderate" ? "moderate" : status === "restricted" ? "restricted" : "";

  return (
    <section className="section-card">
      <button className="section-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {icon && <span className="icon">{icon}</span>}
        <span>{title}</span>
        {status !== "neutral" && <span className={`status-dot ${dotClass}`} />}
        <span className="chev">›</span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

/** Key/value grid helper used across report sections. */
export function KeyValue({ rows }: { rows: Array<[string, ReactNode]> }) {
  const visible = rows.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== "—");
  if (visible.length === 0) return null;
  return (
    <div className="kv">
      {visible.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </div>
      ))}
    </div>
  );
}

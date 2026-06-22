import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PDFViewer, pdf } from "@react-pdf/renderer";
import { api, isApiError } from "@/lib/api";
import { EMPTY_BRAND_KIT, fileToDataUrl, loadBrandKit, saveBrandKit, type BrandKit } from "@/lib/brandKit";
import { getPdfExportTarget } from "@/lib/pdfExportTarget";
import { safeBrandColor } from "@/lib/pdfStyles";
import {
  ReportPdfDocument,
  defaultLayout,
  SECTION_LABELS,
  type PdfLayout,
  type SectionKey,
} from "@/components/pdf/ReportPdfDocument";

const A4_W = 595.28;
const A4_H = 841.89;
const COVER_PREVIEW_W = 300; // px
const SCALE = A4_W / COVER_PREVIEW_W;

export function ReportPdfEditor() {
  const report = useMemo(() => getPdfExportTarget(), []);
  const [brandKit, setBrandKit] = useState<BrandKit>(EMPTY_BRAND_KIT);
  const [layout, setLayout] = useState<PdfLayout | null>(report ? defaultLayout(report) : null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [busy, setBusy] = useState<"download" | "email" | null>(null);
  const [toEmail, setToEmail] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    void loadBrandKit().then(setBrandKit);
  }, []);

  if (!report || !layout) {
    return (
      <div className="ws-gate">
        <h2>No report selected</h2>
        <p>Open a feasibility report in the Work Space, then choose “Export white-label PDF”.</p>
        <Link className="btn btn-primary" to="/">
          Back to Work Space
        </Link>
      </div>
    );
  }

  const patchKit = (p: Partial<BrandKit>) => setBrandKit((k) => ({ ...k, ...p }));
  const patchLayout = (p: Partial<PdfLayout>) => setLayout((l) => (l ? { ...l, ...p } : l));

  const doc = <ReportPdfDocument report={report} brandKit={brandKit} layout={layout} />;

  const handleSaveKit = async () => {
    try {
      const saved = await saveBrandKit(brandKit);
      setBrandKit(saved);
      setSavedAt(Date.now());
      setStatus({ kind: "ok", text: "Brand kit saved." });
    } catch (e) {
      setStatus({ kind: "err", text: errText(e, "Could not save brand kit.") });
    }
  };

  const handleLogo = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1_400_000) {
      setStatus({ kind: "err", text: "Logo is too large — use an image under ~1.4 MB." });
      return;
    }
    patchKit({ logoUrl: await fileToDataUrl(file) });
  };

  const generateSummary = async () => {
    setSummaryLoading(true);
    setStatus(null);
    try {
      const { summary } = await api<{ summary: string }>("/reports/pdf/summary", {
        method: "POST",
        body: JSON.stringify({ report }),
        redirectOn401: false,
      });
      patchLayout({ executiveSummary: summary });
    } catch (e) {
      setStatus({ kind: "err", text: errText(e, "Couldn't generate a summary.") });
    } finally {
      setSummaryLoading(false);
    }
  };

  const fileName = `${(report.address ?? "feasibility-report").replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}.pdf`;

  const handleDownload = async () => {
    setBusy("download");
    setStatus(null);
    try {
      const blob = await pdf(doc).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setStatus({ kind: "err", text: errText(e, "Could not generate the PDF.") });
    } finally {
      setBusy(null);
    }
  };

  const handleEmail = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail.trim())) {
      setStatus({ kind: "err", text: "Enter a valid client email address." });
      return;
    }
    setBusy("email");
    setStatus(null);
    try {
      const blob = await pdf(doc).toBlob();
      const pdfBase64 = await blobToBase64(blob);
      await api("/reports/pdf/email", {
        method: "POST",
        body: JSON.stringify({
          toEmail: toEmail.trim(),
          message: emailMessage,
          subject: `${layout.coverTitle} — ${report.address}`,
          filename: fileName,
          pdfBase64,
        }),
        redirectOn401: false,
      });
      setStatus({ kind: "ok", text: `Sent to ${toEmail.trim()}.` });
    } catch (e) {
      setStatus({ kind: "err", text: errText(e, "Could not send the email.") });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="pdf-editor">
      <div className="pdf-editor-controls">
        <div className="pdf-editor-head">
          <Link to="/" className="btn btn-ghost">
            ← Back
          </Link>
          <strong>White-label export</strong>
        </div>

        <Panel title="Cover">
          <Field label="Title">
            <input className="ws-input" value={layout.coverTitle} onChange={(e) => patchLayout({ coverTitle: e.target.value })} />
          </Field>
          <Field label="Subtitle">
            <input className="ws-input" value={layout.coverSubtitle} onChange={(e) => patchLayout({ coverSubtitle: e.target.value })} />
          </Field>
          <Field label="Executive summary">
            <textarea
              className="ws-input"
              rows={5}
              value={layout.executiveSummary}
              placeholder="Write a client-facing summary, or generate one with AI."
              onChange={(e) => patchLayout({ executiveSummary: e.target.value })}
            />
            <button className="btn btn-quiet" onClick={generateSummary} disabled={summaryLoading} style={{ marginTop: 6 }}>
              {summaryLoading ? "Generating…" : "✨ Generate with AI"}
            </button>
          </Field>
          <label className="ws-check">
            <input
              type="checkbox"
              checked={layout.showCoverPhoto}
              onChange={(e) => patchLayout({ showCoverPhoto: e.target.checked })}
            />
            Show property photo on cover
          </label>
        </Panel>

        <Panel title="Branding">
          <Field label="Logo">
            <CoverLogoDesigner brandKit={brandKit} layout={layout} onMove={(logoBox) => patchLayout({ logoBox })} />
            <input type="file" accept="image/*" onChange={(e) => handleLogo(e.target.files?.[0])} style={{ marginTop: 8 }} />
            {brandKit.logoUrl && (
              <button className="btn btn-ghost" onClick={() => patchKit({ logoUrl: null })}>
                Remove logo
              </button>
            )}
          </Field>
          <Field label="Brand colour">
            <input
              type="color"
              value={safeBrandColor(brandKit.brandColor)}
              onChange={(e) => patchKit({ brandColor: e.target.value })}
              style={{ width: 48, height: 32, padding: 0, border: "none", background: "none" }}
            />
          </Field>
          <Field label="Company name">
            <input className="ws-input" value={brandKit.companyName ?? ""} onChange={(e) => patchKit({ companyName: e.target.value })} />
          </Field>
          <Field label="Contact name">
            <input className="ws-input" value={brandKit.contactName ?? ""} onChange={(e) => patchKit({ contactName: e.target.value })} />
          </Field>
          <Field label="Contact email">
            <input className="ws-input" value={brandKit.contactEmail ?? ""} onChange={(e) => patchKit({ contactEmail: e.target.value })} />
          </Field>
          <Field label="Contact phone">
            <input className="ws-input" value={brandKit.contactPhone ?? ""} onChange={(e) => patchKit({ contactPhone: e.target.value })} />
          </Field>
          <Field label="Website">
            <input className="ws-input" value={brandKit.website ?? ""} onChange={(e) => patchKit({ website: e.target.value })} />
          </Field>
          <Field label="Licence number">
            <input className="ws-input" value={brandKit.licenceNumber ?? ""} onChange={(e) => patchKit({ licenceNumber: e.target.value })} />
          </Field>
          <Field label="Footer text">
            <input className="ws-input" value={brandKit.footerText ?? ""} onChange={(e) => patchKit({ footerText: e.target.value })} />
          </Field>
          <button className="btn btn-quiet" onClick={handleSaveKit}>
            Save brand kit{savedAt ? " ✓" : ""}
          </button>
        </Panel>

        <Panel title="Sections">
          {layout.sectionOrder.map((key, idx) => (
            <div key={key} className="pdf-section-row">
              <label className="ws-check" style={{ flex: 1 }}>
                <input
                  type="checkbox"
                  checked={layout.includeSections[key]}
                  onChange={(e) =>
                    patchLayout({ includeSections: { ...layout.includeSections, [key]: e.target.checked } })
                  }
                />
                {SECTION_LABELS[key]}
              </label>
              <button className="btn btn-ghost" disabled={idx === 0} onClick={() => patchLayout({ sectionOrder: move(layout.sectionOrder, idx, -1) })}>
                ↑
              </button>
              <button
                className="btn btn-ghost"
                disabled={idx === layout.sectionOrder.length - 1}
                onClick={() => patchLayout({ sectionOrder: move(layout.sectionOrder, idx, 1) })}
              >
                ↓
              </button>
            </div>
          ))}
        </Panel>

        <Panel title="Send to client">
          <Field label="Client email">
            <input className="ws-input" type="email" value={toEmail} placeholder="client@example.com" onChange={(e) => setToEmail(e.target.value)} />
          </Field>
          <Field label="Message">
            <textarea className="ws-input" rows={3} value={emailMessage} onChange={(e) => setEmailMessage(e.target.value)} placeholder="Optional note to your client." />
          </Field>
          {status && <div className={status.kind === "ok" ? "ws-ok" : "ws-error"}>{status.text}</div>}
          <div className="pdf-actions">
            <button className="btn btn-quiet" onClick={handleDownload} disabled={busy !== null}>
              {busy === "download" ? "Preparing…" : "⬇ Download PDF"}
            </button>
            <button className="btn btn-primary" onClick={handleEmail} disabled={busy !== null}>
              {busy === "email" ? "Sending…" : "✉ Email to client"}
            </button>
          </div>
        </Panel>
      </div>

      <div className="pdf-editor-preview">
        <PDFViewer style={{ width: "100%", height: "100%", border: "none" }} showToolbar>
          {doc}
        </PDFViewer>
      </div>
    </div>
  );
}

function CoverLogoDesigner({
  brandKit,
  layout,
  onMove,
}: {
  brandKit: BrandKit;
  layout: PdfLayout;
  onMove: (box: PdfLayout["logoBox"]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const previewH = COVER_PREVIEW_W * (A4_H / A4_W);

  const onPointerDown = (e: React.PointerEvent) => {
    const logoPxX = layout.logoBox.x / SCALE;
    const logoPxY = layout.logoBox.y / SCALE;
    const rect = ref.current!.getBoundingClientRect();
    drag.current = { dx: e.clientX - rect.left - logoPxX, dy: e.clientY - rect.top - logoPxY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const widthPx = layout.logoBox.width / SCALE;
    const pxX = clamp(e.clientX - rect.left - drag.current.dx, 0, COVER_PREVIEW_W - widthPx);
    const pxY = clamp(e.clientY - rect.top - drag.current.dy, 0, previewH - 20);
    onMove({ ...layout.logoBox, x: Math.round(pxX * SCALE), y: Math.round(pxY * SCALE) });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div>
      <div
        ref={ref}
        className="cover-designer"
        style={{ width: COVER_PREVIEW_W, height: previewH }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="cover-designer-band" style={{ background: safeBrandColor(brandKit.brandColor) }}>
          <div className="cover-designer-title">{layout.coverTitle}</div>
        </div>
        {brandKit.logoUrl && (
          <img
            src={brandKit.logoUrl}
            alt="logo"
            draggable={false}
            onPointerDown={onPointerDown}
            style={{
              position: "absolute",
              left: layout.logoBox.x / SCALE,
              top: layout.logoBox.y / SCALE,
              width: layout.logoBox.width / SCALE,
              cursor: "grab",
              userSelect: "none",
            }}
          />
        )}
      </div>
      {brandKit.logoUrl && (
        <label className="ws-range">
          Logo size
          <input
            type="range"
            min={60}
            max={260}
            value={layout.logoBox.width}
            onChange={(e) => onMove({ ...layout.logoBox, width: Number(e.target.value) })}
          />
        </label>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pdf-panel">
      <h4 className="pdf-panel-title">{title}</h4>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="pdf-field">
      <span className="pdf-field-label">{label}</span>
      {children}
    </label>
  );
}

function move<T>(arr: T[], idx: number, dir: -1 | 1): T[] {
  const next = [...arr];
  const j = idx + dir;
  if (j < 0 || j >= next.length) return next;
  [next[idx], next[j]] = [next[j], next[idx]];
  return next;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

function errText(e: unknown, fallback: string): string {
  if (isApiError(e)) return e.message || fallback;
  return e instanceof Error ? e.message : fallback;
}

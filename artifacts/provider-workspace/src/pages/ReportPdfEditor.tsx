import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { pdf } from "@react-pdf/renderer";
import { GlobalWorkerOptions, getDocument, type RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api, isApiError } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { EMPTY_BRAND_KIT, loadBrandKit, saveBrandKit, type BrandKit } from "@/lib/brandKit";
import { getPdfExportTarget } from "@/lib/pdfExportTarget";
import { safeBrandColor } from "@/lib/pdfStyles";
import {
  ReportPdfDocument,
  defaultLayout,
  editableDataFields,
  EMPTY_PDF_CONTENT_EDITS,
  SECTION_LABELS,
  type PdfContentEdits,
  type PdfLayout,
  type SectionKey,
} from "@/components/pdf/ReportPdfDocument";
import type { FeasibilityReport } from "@/state/chat-model";

const A4_W = 595.28;
const A4_H = 841.89;
const COVER_PREVIEW_W = 300; // px
const SCALE = A4_W / COVER_PREVIEW_W;
const LOGO_MAX_EDGE = 640;
const LOGO_TARGET_BYTES = 1_200_000;
const PHOTO_MAX_EDGE = 1400;

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type DraftSaveState = "idle" | "loading" | "saving" | "saved" | "error";

type DmThread = {
  id: string;
  otherParticipant?: {
    id: string;
    fullName?: string | null;
    role?: string | null;
    avatarUrl?: string | null;
  } | null;
  blockStatus?: {
    messagingBlocked?: boolean;
  } | null;
};

type PdfDraftResponse = {
  pdfDraft: {
    reportKey: string;
    reportAddress: string;
    draft: {
      layout?: Partial<PdfLayout>;
      contentEdits?: Partial<PdfContentEdits>;
    };
    updatedAt?: string;
  } | null;
};

export function ReportPdfEditor() {
  const report = useMemo(() => getPdfExportTarget(), []);
  const reportKey = useMemo(() => (report ? pdfDraftKey(report) : null), [report]);
  const [pdfReport, setPdfReport] = useState<FeasibilityReport | null>(report);
  const [brandKit, setBrandKit] = useState<BrandKit>(EMPTY_BRAND_KIT);
  const [layout, setLayout] = useState<PdfLayout | null>(report ? defaultLayout(report) : null);
  const [contentEdits, setContentEdits] = useState<PdfContentEdits>(
    report ? defaultContentEdits(report) : EMPTY_PDF_CONTENT_EDITS,
  );
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [draftState, setDraftState] = useState<DraftSaveState>("idle");
  const [draftDirty, setDraftDirty] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [busy, setBusy] = useState<"download" | "message" | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [dmThreads, setDmThreads] = useState<DmThread[]>([]);
  const [dmQuery, setDmQuery] = useState("");
  const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
  const draftHydrated = useRef(false);

  useEffect(() => {
    void loadBrandKit().then(setBrandKit);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!report || !reportKey) return;
    draftHydrated.current = false;
    setDraftState("loading");
    void loadPdfDraft(reportKey)
      .then((saved) => {
        if (cancelled) return;
        if (saved?.draft?.layout) setLayout(mergeLayout(report, saved.draft.layout));
        if (saved?.draft?.contentEdits) setContentEdits(mergeContentEdits(report, saved.draft.contentEdits));
        if (saved?.updatedAt) setDraftSavedAt(Date.parse(saved.updatedAt));
        setDraftDirty(false);
        setDraftState(saved ? "saved" : "idle");
        draftHydrated.current = true;
      })
      .catch(() => {
        if (cancelled) return;
        setDraftState("error");
        draftHydrated.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [report, reportKey]);

  useEffect(() => {
    let cancelled = false;
    void api<{ threads?: DmThread[] }>("/dm/threads", { method: "GET", redirectOn401: false })
      .then((data) => {
        if (cancelled) return;
        const threads = Array.isArray(data.threads) ? data.threads : [];
        setDmThreads(threads.filter((thread) => thread.otherParticipant?.role === "general"));
      })
      .catch(() => {
        if (!cancelled) setDmThreads([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!report) return;
    const firstPhoto = report.photoUrl ?? report.photoUrls?.[0] ?? null;
    if (!firstPhoto) {
      setPdfReport(report);
      return;
    }

    setPdfReport({ ...report, photoUrl: firstPhoto, photoUrls: [firstPhoto] });
    void imageUrlToPdfDataUrl(firstPhoto)
      .then((dataUrl) => {
        if (cancelled || !dataUrl) return;
        setPdfReport({ ...report, photoUrl: dataUrl, photoUrls: [dataUrl] });
      })
      .catch(() => {
        if (!cancelled) setPdfReport({ ...report, photoUrl: firstPhoto, photoUrls: [firstPhoto] });
      });

    return () => {
      cancelled = true;
    };
  }, [report]);

  const savePdfDraft = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!report || !reportKey || !layout) return false;
      if (!options?.silent) setStatus(null);
      setDraftState("saving");
      try {
        const saved = await savePdfDraftApi(reportKey, report.address ?? "", { layout, contentEdits });
        const parsed = saved?.updatedAt ? Date.parse(saved.updatedAt) : Date.now();
        setDraftSavedAt(Number.isFinite(parsed) ? parsed : Date.now());
        setDraftDirty(false);
        setDraftState("saved");
        if (!options?.silent) setStatus({ kind: "ok", text: "PDF draft saved." });
        return true;
      } catch (e) {
        setDraftState("error");
        if (!options?.silent) setStatus({ kind: "err", text: errText(e, "Could not save PDF draft.") });
        return false;
      }
    },
    [contentEdits, layout, report, reportKey],
  );

  useEffect(() => {
    if (!draftHydrated.current || !draftDirty || !report || !reportKey || !layout) return;
    const timer = window.setTimeout(() => {
      void savePdfDraft({ silent: true });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [draftDirty, layout, contentEdits, report, reportKey, savePdfDraft]);

  if (!report || !layout || !pdfReport) {
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
  const markDraftDirty = () => {
    if (!draftHydrated.current) return;
    setDraftDirty(true);
    setDraftState("idle");
  };
  const patchLayout = (p: Partial<PdfLayout>) => {
    setLayout((l) => (l ? { ...l, ...p } : l));
    markDraftDirty();
  };
  const patchField = (key: string, value: string) => {
    setContentEdits((current) => ({ ...current, fields: { ...current.fields, [key]: value } }));
    markDraftDirty();
  };
  const patchSectionNote = (key: SectionKey, value: string) => {
    setContentEdits((current) => ({ ...current, sectionNotes: { ...current.sectionNotes, [key]: value } }));
    markDraftDirty();
  };

  // Memoize the PDF document so the live preview only rebuilds when an input
  // that actually changes the PDF changes — not on unrelated re-renders (autosave
  // status flips, recipient search/selection, busy state). Without this the
  // preview re-rendered constantly and reset the user's scroll position.
  const doc = useMemo(
    () => <ReportPdfDocument report={pdfReport} brandKit={brandKit} layout={layout} contentEdits={contentEdits} />,
    [pdfReport, brandKit, layout, contentEdits],
  );

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

  const handlePdfLogo = async (file: File | undefined) => {
    if (!file) return;
    setStatus(null);
    try {
      const logoUrl = await imageFileToPdfDataUrl(file, { maxEdge: LOGO_MAX_EDGE, targetBytes: LOGO_TARGET_BYTES });
      patchKit({ logoUrl });
      patchLayout({ logoBox: { ...layout.logoBox, width: 120 } });
      setStatus({ kind: "ok", text: "Logo added and resized for the PDF." });
    } catch (e) {
      setStatus({ kind: "err", text: errText(e, "Could not prepare that logo image.") });
    }
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
      await savePdfDraft({ silent: true });
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

  const sendToChats = async () => {
    const selected = dmThreads.filter((thread) => selectedThreadIds.includes(thread.id));
    if (selected.length === 0) {
      setStatus({ kind: "err", text: "Select at least one user from your chat list." });
      return;
    }

    setBusy("message");
    setStatus(null);
    try {
      await savePdfDraft({ silent: true });
      const blob = await pdf(doc).toBlob();
      const file = new File([blob], fileName, { type: "application/pdf" });
      const uploaded = await uploadDmFile(file);
      await Promise.all(
        selected.map((thread) =>
          api(`/dm/threads/${encodeURIComponent(thread.id)}/messages`, {
            method: "POST",
            body: JSON.stringify({
              body: `Shared PDF report: ${layout.coverTitle}`,
              fileUrl: uploaded.fileUrl,
              fileName,
              fileMime: "application/pdf",
            }),
            redirectOn401: false,
          }),
        ),
      );
      setSelectedThreadIds([]);
      setStatus({ kind: "ok", text: `PDF sent to ${selected.length} chat${selected.length === 1 ? "" : "s"}.` });
    } catch (e) {
      setStatus({ kind: "err", text: errText(e, "Could not send the PDF to chat.") });
    } finally {
      setBusy(null);
    }
  };

  const filteredDmThreads = dmThreads.filter((thread) => {
    const other = thread.otherParticipant;
    const haystack = [other?.fullName, other?.id].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(dmQuery.trim().toLowerCase());
  });

  const toggleThread = (threadId: string) => {
    setSelectedThreadIds((ids) => (ids.includes(threadId) ? ids.filter((id) => id !== threadId) : [...ids, threadId]));
  };

  return (
    <div className="pdf-editor">
      <div className="pdf-editor-controls">
        <div className="pdf-editor-head">
          <Link to="/" className="btn btn-ghost">
            ← Back
          </Link>
          <div className="pdf-editor-title">
            <strong>White-label export</strong>
            <span>{draftStatusText(draftState, draftDirty, draftSavedAt)}</span>
          </div>
          <button className="btn btn-quiet pdf-save-draft" onClick={() => void savePdfDraft()} disabled={draftState === "saving"}>
            {draftState === "saving" ? "Saving..." : "Save PDF"}
          </button>
        </div>

        {status && <div className={status.kind === "ok" ? "ws-ok pdf-status" : "ws-error pdf-status"}>{status.text}</div>}

        <Panel title="Cover" defaultOpen>
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

        <ReportTextPanel
          report={report}
          layout={layout}
          contentEdits={contentEdits}
          onField={patchField}
          onSectionNote={patchSectionNote}
        />

        <ReportDataPanel report={report} layout={layout} contentEdits={contentEdits} onField={patchField} />

        <Panel title="Branding">
          <Field label="Logo">
            <CoverLogoDesigner brandKit={brandKit} layout={layout} onMove={(logoBox) => patchLayout({ logoBox })} />
            <input type="file" accept="image/*" onChange={(e) => handlePdfLogo(e.target.files?.[0])} style={{ marginTop: 8 }} />
            {brandKit.logoUrl && <div className="pdf-help">Drag the logo on the cover preview, or adjust its standard PDF size below.</div>}
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

        <Panel title="Share" defaultOpen>
          <div className="pdf-share-head">
            <button className="btn btn-quiet" onClick={handleDownload} disabled={busy !== null}>
              {busy === "download" ? "Preparing…" : "⬇ Download PDF"}
            </button>
          </div>
          <Field label="Search users">
            <input
              className="ws-input"
              value={dmQuery}
              placeholder="Search your chat list"
              onChange={(e) => setDmQuery(e.target.value)}
            />
          </Field>
          <div className="pdf-recipient-list" role="listbox" aria-label="Chat recipients">
            {filteredDmThreads.length === 0 ? (
              <div className="pdf-recipient-empty">
                {dmThreads.length === 0 ? "No general users in your chat list yet." : "No users match that search."}
              </div>
            ) : (
              filteredDmThreads.map((thread) => {
                const other = thread.otherParticipant;
                const selected = selectedThreadIds.includes(thread.id);
                const blocked = !!thread.blockStatus?.messagingBlocked;
                return (
                  <label key={thread.id} className={`pdf-recipient${selected ? " selected" : ""}${blocked ? " disabled" : ""}`}>
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={blocked || busy === "message"}
                      onChange={() => toggleThread(thread.id)}
                    />
                    <span className="pdf-recipient-avatar">{initials(other?.fullName)}</span>
                    <span className="pdf-recipient-main">
                      <span className="pdf-recipient-name">{other?.fullName || "Unnamed user"}</span>
                      {blocked ? <span className="pdf-recipient-meta">Messaging unavailable</span> : null}
                    </span>
                  </label>
                );
              })
            )}
          </div>
          <button
            className="btn btn-primary"
            onClick={sendToChats}
            disabled={busy !== null || selectedThreadIds.length === 0}
            style={{ marginTop: 10, width: "100%" }}
          >
            {busy === "message" ? "Sending..." : `Send to selected${selectedThreadIds.length ? ` (${selectedThreadIds.length})` : ""}`}
          </button>
        </Panel>
      </div>

      <div className="pdf-editor-preview">
        <LivePdfPreview document={doc} />
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
              maxHeight: 56 / SCALE,
              objectFit: "contain",
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

function Panel({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="pdf-panel" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="pdf-panel-title">{title}</summary>
      {children}
    </details>
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

function LivePdfPreview({ document: pdfDocument }: { document: ReactElement<any> }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const renderTasks = useRef<RenderTask[]>([]);
  const lastPageCount = useRef(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setState("loading");

      void (async () => {
        const blob = await pdf(pdfDocument).toBlob();
        const data = await blob.arrayBuffer();
        if (cancelled) return;

        renderTasks.current.forEach((task) => task.cancel());
        renderTasks.current = [];

        const loadingTask = getDocument({ data });
        const loadedPdf = await loadingTask.promise;
        if (cancelled) {
          await loadingTask.destroy();
          return;
        }

        const host = pagesRef.current;
        if (!host) {
          await loadingTask.destroy();
          return;
        }
        // Capture scroll position at the LAST possible moment (the old pages are
        // still mounted here), so an edit doesn't reset the user's view.
        const scroller = scrollerRef.current;
        const prevScrollTop = scroller ? scroller.scrollTop : 0;
        const prevMax = scroller ? Math.max(1, scroller.scrollHeight - scroller.clientHeight) : 1;
        const prevRatio = prevScrollTop / prevMax;
        const prevPageCount = lastPageCount.current;

        host.replaceChildren();
        setPageCount(loadedPdf.numPages);
        lastPageCount.current = loadedPdf.numPages;

        const hostWidth = Math.max(320, Math.min(920, host.clientWidth - 32));
        for (let pageNumber = 1; pageNumber <= loadedPdf.numPages; pageNumber += 1) {
          if (cancelled) break;
          const page = await loadedPdf.getPage(pageNumber);
          const natural = page.getViewport({ scale: 1 });
          const scale = Math.min(1.75, Math.max(0.7, hostWidth / natural.width));
          const viewport = page.getViewport({ scale });
          const shell = window.document.createElement("div");
          shell.className = "pdf-live-page";
          shell.setAttribute("aria-label", `Page ${pageNumber}`);
          const label = window.document.createElement("span");
          label.className = "pdf-live-page-label";
          label.textContent = String(pageNumber);
          const canvas = window.document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          shell.append(label, canvas);
          host.append(shell);

          const context = canvas.getContext("2d");
          if (!context) continue;
          const task = page.render({ canvas, canvasContext: context, viewport });
          renderTasks.current.push(task);
          await task.promise.catch((error: unknown) => {
            if (!cancelled && !(error instanceof Error && error.name === "RenderingCancelledException")) throw error;
          });
        }

        await loadingTask.destroy();
        if (cancelled) return;
        window.requestAnimationFrame(() => {
          const nextScroller = scrollerRef.current;
          if (nextScroller) {
            const nextMax = Math.max(0, nextScroller.scrollHeight - nextScroller.clientHeight);
            // Same page count → restore the exact position (locked view); only
            // fall back to a proportional restore when the layout grew/shrank.
            nextScroller.scrollTop =
              prevPageCount === loadedPdf.numPages ? Math.min(prevScrollTop, nextMax) : prevRatio * nextMax;
          }
          setState("ready");
        });
      })().catch(() => {
        if (!cancelled) setState("error");
      });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      renderTasks.current.forEach((task) => task.cancel());
      renderTasks.current = [];
    };
  }, [pdfDocument]);

  return (
    <div className="pdf-live-preview">
      <div className="pdf-live-toolbar">
        <span>{state === "ready" ? `${pageCount} page${pageCount === 1 ? "" : "s"}` : state === "error" ? "Preview unavailable" : "Updating preview"}</span>
      </div>
      <div ref={scrollerRef} className="pdf-live-scroll">
        {state === "error" ? <div className="pdf-live-state">Could not render the preview. Download still uses the latest PDF.</div> : null}
        <div ref={pagesRef} className="pdf-live-pages" />
      </div>
    </div>
  );
}

function ReportTextPanel({
  report,
  layout,
  contentEdits,
  onField,
  onSectionNote,
}: {
  report: FeasibilityReport;
  layout: PdfLayout;
  contentEdits: PdfContentEdits;
  onField: (key: string, value: string) => void;
  onSectionNote: (key: SectionKey, value: string) => void;
}) {
  const groups = editableTextGroups(report, layout);
  return (
    <Panel title="Report text">
      <div className="pdf-help">Edit the generated wording used in the exported PDF. For bullet lists, keep one item per line.</div>
      {groups.length === 0 ? (
        <div className="pdf-help">This report has no generated narrative fields to edit.</div>
      ) : (
        groups.map((group) => (
          <div key={group.section} className={`pdf-text-group${layout.includeSections[group.section] ? "" : " muted"}`}>
            <div className="pdf-text-group-title">
              <span>{SECTION_LABELS[group.section]}</span>
              {!layout.includeSections[group.section] ? <em>Hidden from PDF</em> : null}
            </div>
            {group.fields.map((field) => (
              <Field key={field.key} label={field.label}>
                <textarea
                  className="ws-input pdf-textarea"
                  rows={field.rows}
                  value={contentEdits.fields[field.key] ?? field.value}
                  onChange={(e) => onField(field.key, e.target.value)}
                />
              </Field>
            ))}
          </div>
        ))
      )}
      <div className="pdf-section-notes">
        <div className="pdf-field-label">Additional section notes</div>
        {layout.sectionOrder.map((key) => (
          <details key={key} className="pdf-note-editor">
            <summary>
              {SECTION_LABELS[key]}
              {!layout.includeSections[key] ? <em>Hidden</em> : null}
            </summary>
            <textarea
              className="ws-input pdf-textarea"
              rows={3}
              placeholder="Optional note to add at the end of this section."
              value={contentEdits.sectionNotes[key] ?? ""}
              onChange={(e) => onSectionNote(key, e.target.value)}
            />
          </details>
        ))}
      </div>
    </Panel>
  );
}
function ReportDataPanel({
  report,
  layout,
  contentEdits,
  onField,
}: {
  report: FeasibilityReport;
  layout: PdfLayout;
  contentEdits: PdfContentEdits;
  onField: (key: string, value: string) => void;
}) {
  const fields = editableDataFields(report);
  const groups = layout.sectionOrder
    .map((section) => ({ section, fields: fields.filter((f) => f.section === section) }))
    .filter((group) => group.fields.length > 0);

  return (
    <Panel title="Report data">
      <div className="pdf-help">Correct any of the report’s data values used in the exported PDF (e.g. capital value, areas, costs).</div>
      {groups.length === 0 ? (
        <div className="pdf-help">This report has no editable data fields.</div>
      ) : (
        groups.map((group) => (
          <div key={group.section} className={`pdf-text-group${layout.includeSections[group.section] ? "" : " muted"}`}>
            <div className="pdf-text-group-title">
              <span>{SECTION_LABELS[group.section]}</span>
              {!layout.includeSections[group.section] ? <em>Hidden from PDF</em> : null}
            </div>
            <div className="pdf-data-grid">
              {group.fields.map((field) => (
                <label key={field.key} className="pdf-data-cell">
                  <span className="pdf-data-label">{field.label}</span>
                  <input
                    className="ws-input"
                    value={contentEdits.fields[field.key] ?? field.value}
                    onChange={(e) => onField(field.key, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </div>
        ))
      )}
    </Panel>
  );
}

type EditableTextField = {
  section: SectionKey;
  key: string;
  label: string;
  value: string;
  rows: number;
};

type EditableTextGroup = {
  section: SectionKey;
  fields: EditableTextField[];
};

function editableTextFields(report: FeasibilityReport): EditableTextField[] {
  const fields: EditableTextField[] = [];
  const add = (section: SectionKey, key: string, label: string, value?: string | null, rows = 4) => {
    if (value && value.trim()) fields.push({ section, key, label, value, rows });
  };
  const addLines = (section: SectionKey, key: string, label: string, value?: (string | null | undefined)[], rows = 5) => {
    const lines = (value ?? []).filter((line): line is string => !!line && line.trim().length > 0);
    if (lines.length) fields.push({ section, key, label, value: lines.join("\n"), rows });
  };

  add("title", "title.opportunity", "Opportunity paragraph", report.titleInsight?.opportunity);
  addLines("title", "title.risks", "Risk bullets", report.titleInsight?.risks);
  add("planning", "planning.subdivisionSummary", "Subdivision summary", report.planning?.subdivisionSummary);
  add("planning", "planning.subdivisionPathwayNote", "Pathway note", report.planning?.subdivisionPathwayNote);
  addLines(
    "planning",
    "planning.easements",
    "Easement bullets",
    report.planning?.easements?.map((e) => `${e.description}${e.severity ? ` (${e.severity})` : ""}`),
  );
  add("asbestos", "asbestos.notes", "Asbestos note", report.asbestos?.notes);
  addLines("market", "market.transportReasons", "Transport context bullets", report.transportContext?.roiInfluence?.reasons);
  addLines("market", "market.reasons", "Market context bullets", visibleEditableMarketReasons(report.neighbourhoodContext?.reasons));
  addLines("builtEnv", "builtEnv.reasons", "Built environment bullets", report.builtEnvironmentContext?.reasons);
  for (const strategy of report.developmentStrategies ?? []) {
    add("strategies", `strategies.${strategy.id}.rationale`, `${strategy.title} rationale`, strategy.rationale);
    addLines("strategies", `strategies.${strategy.id}.assumptions`, `${strategy.title} assumptions`, strategy.assumptions);
  }
  addLines("risk", "risk.summary", "Risk bullets", report.riskSummary);
  add("risk", "disclaimer", "Disclaimer", report.disclaimer, 5);
  return fields;
}

function editableTextGroups(report: FeasibilityReport, layout: PdfLayout): EditableTextGroup[] {
  const fields = editableTextFields(report);
  return layout.sectionOrder
    .map((section) => ({
      section,
      fields: fields.filter((field) => field.section === section),
    }))
    .filter((group) => group.fields.length > 0);
}

function defaultContentEdits(report: FeasibilityReport): PdfContentEdits {
  const fields: Record<string, string> = {};
  for (const field of editableTextFields(report)) fields[field.key] = field.value;
  for (const field of editableDataFields(report)) fields[field.key] = field.value;
  return { fields, sectionNotes: {} };
}

function mergeContentEdits(report: FeasibilityReport, saved: Partial<PdfContentEdits> | undefined): PdfContentEdits {
  const defaults = defaultContentEdits(report);
  const fields = saved?.fields && typeof saved.fields === "object" ? saved.fields : {};
  const sectionNotes = saved?.sectionNotes && typeof saved.sectionNotes === "object" ? saved.sectionNotes : {};
  return {
    fields: { ...defaults.fields, ...stringRecord(fields) },
    sectionNotes: stringRecord(sectionNotes) as Partial<Record<SectionKey, string>>,
  };
}

function mergeLayout(report: FeasibilityReport, saved: Partial<PdfLayout> | undefined): PdfLayout {
  const base = defaultLayout(report);
  if (!saved || typeof saved !== "object") return base;
  const includeSections = { ...base.includeSections, ...(saved.includeSections ?? {}) };
  const savedOrder = Array.isArray(saved.sectionOrder) ? saved.sectionOrder : [];
  const sectionOrder = [
    ...savedOrder.filter((key): key is SectionKey => key in base.includeSections),
    ...base.sectionOrder.filter((key) => !savedOrder.includes(key)),
  ];
  const logoBox =
    saved.logoBox &&
    typeof saved.logoBox.x === "number" &&
    typeof saved.logoBox.y === "number" &&
    typeof saved.logoBox.width === "number"
      ? saved.logoBox
      : base.logoBox;
  return {
    ...base,
    ...saved,
    includeSections,
    sectionOrder,
    logoBox,
    showCoverPhoto: typeof saved.showCoverPhoto === "boolean" ? saved.showCoverPhoto : base.showCoverPhoto,
  };
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value).reduce<Record<string, string>>((acc, [key, val]) => {
    if (typeof val === "string") acc[key] = val;
    return acc;
  }, {});
}

function visibleEditableMarketReasons(items?: (string | null | undefined)[] | null): string[] {
  return (items ?? []).filter(
    (item): item is string =>
      !!item &&
      item.trim().length > 0 &&
      !(
        item.toLowerCase().includes("linz title-owner data was unavailable") &&
        item.toLowerCase().includes("no public-housing conclusion")
      ),
  );
}

function pdfDraftKey(report: FeasibilityReport): string {
  if (report.historyId?.trim()) return `history:${report.historyId.trim()}`;
  const basis = [
    report.address,
    report.historyCreatedAt,
    report.selectedListingContext?.listingUrl,
    report.selectedListingContext?.address,
  ]
    .filter(Boolean)
    .join("|")
    .toLowerCase();
  return `report:${hashString(basis || report.address || "unknown-report")}`;
}

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) hash = (hash * 33) ^ input.charCodeAt(i);
  return (hash >>> 0).toString(36);
}

async function loadPdfDraft(reportKey: string): Promise<PdfDraftResponse["pdfDraft"]> {
  const data = await api<PdfDraftResponse>(`/reports/pdf/drafts/${encodeURIComponent(reportKey)}`, {
    method: "GET",
    redirectOn401: false,
  });
  return data.pdfDraft;
}

async function savePdfDraftApi(
  reportKey: string,
  reportAddress: string,
  draft: { layout: PdfLayout; contentEdits: PdfContentEdits },
): Promise<PdfDraftResponse["pdfDraft"]> {
  const data = await api<PdfDraftResponse>(`/reports/pdf/drafts/${encodeURIComponent(reportKey)}`, {
    method: "PUT",
    body: JSON.stringify({ reportAddress, draft }),
    redirectOn401: false,
  });
  return data.pdfDraft;
}

function draftStatusText(state: DraftSaveState, dirty: boolean, savedAt: number | null): string {
  if (state === "loading") return "Loading saved draft";
  if (state === "saving") return "Saving draft";
  if (dirty) return "Unsaved changes";
  if (state === "error") return "Draft save unavailable";
  if (savedAt) return `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return "No saved draft yet";
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

async function imageUrlToPdfDataUrl(src: string): Promise<string | null> {
  if (src.startsWith("data:image/")) return src;
  const fetchUrl = src.startsWith("/api/image-proxy")
    ? src
    : /^https?:\/\//i.test(src)
      ? `/api/image-proxy?url=${encodeURIComponent(src)}`
      : src;
  const res = await fetch(fetchUrl);
  if (!res.ok) return null;
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) return null;
  return imageBlobToPdfDataUrl(blob, { maxEdge: PHOTO_MAX_EDGE, targetBytes: 1_800_000, background: "#ffffff" });
}

async function uploadDmFile(file: File): Promise<{ fileUrl: string }> {
  const form = new FormData();
  form.append("file", file);
  const token = getToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch("/api/upload/dm-file", {
    method: "POST",
    headers,
    body: form,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(payload?.error || `Upload failed (${res.status})`);
  }
  if (!payload?.fileUrl || typeof payload.fileUrl !== "string") {
    throw new Error("Upload did not return a file URL.");
  }
  return { fileUrl: payload.fileUrl };
}

async function imageFileToPdfDataUrl(file: File, options: { maxEdge: number; targetBytes: number }): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file for the logo.");
  return imageBlobToPdfDataUrl(file, options);
}

async function imageBlobToPdfDataUrl(
  blob: Blob,
  options: { maxEdge: number; targetBytes: number; background?: string },
): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, options.maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare image.");
  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const png = canvas.toDataURL("image/png");
  if (dataUrlBytes(png) <= options.targetBytes) return png;

  for (const quality of [0.86, 0.78, 0.68, 0.58]) {
    const jpeg = canvas.toDataURL("image/jpeg", quality);
    if (dataUrlBytes(jpeg) <= options.targetBytes || quality === 0.58) return jpeg;
  }
  return canvas.toDataURL("image/jpeg", 0.58);
}

function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Math.ceil((base64.length * 3) / 4);
}

function initials(name?: string | null): string {
  const parts = String(name || "User").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "U";
}

function errText(e: unknown, fallback: string): string {
  if (isApiError(e)) return e.message || fallback;
  return e instanceof Error ? e.message : fallback;
}

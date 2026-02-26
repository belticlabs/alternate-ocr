/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { FieldCitation } from "@/lib/types";
import { RunDetailDto } from "@/lib/api-types";

interface RunResultsPanelProps {
  runDetail: RunDetailDto | null;
  filePreviewUrl?: string | null;
  fileMimeType?: string | null;
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatSeconds(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

const tablePageStyles = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 8px; font-family: system-ui, sans-serif; font-size: 12px; color: #1a1a1a; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e0e0e0; padding: 6px 10px; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  tr:nth-child(even) { background: #fafafa; }
`;

const TABLE_HEIGHT_SCRIPT = (id: string) =>
  `<script>
    (function () {
      var id = ${JSON.stringify(id)};
      function measure() {
        var body = document.body;
        var doc = document.documentElement;
        return Math.max(
          body ? body.scrollHeight : 0,
          body ? body.offsetHeight : 0,
          doc ? doc.scrollHeight : 0,
          doc ? doc.offsetHeight : 0
        );
      }
      function post() {
        try {
          window.parent.postMessage({ type: "glm-ocr-table-height", id: id, height: measure() }, "*");
        } catch (e) {}
      }
      post();
      requestAnimationFrame(post);
      setTimeout(post, 50);
      setTimeout(post, 200);
      setTimeout(post, 600);
      window.addEventListener("load", post);
      window.addEventListener("resize", post);
      if (window.ResizeObserver && document.body) {
        var ro = new ResizeObserver(post);
        ro.observe(document.body);
      }
      if (document.body) {
        var mo = new MutationObserver(post);
        mo.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
    })();
  <\/script>`;

/** Build HTML document for table display: use raw HTML if present, else parse markdown/TSV/text into a table. */
function tableContentToHtml(raw: string, blockId: string): string {
  const trimmed = raw.trim();
  const tail = TABLE_HEIGHT_SCRIPT(blockId);
  if (!trimmed) return `<html><head><style>${tablePageStyles}</style></head><body><p>No content</p>${tail}</body></html>`;
  const looksLikeHtml = /<\s*table|<\s*tr\b/i.test(trimmed);
  if (looksLikeHtml) {
    return `<!DOCTYPE html><html><head><style>${tablePageStyles}</style></head><body>${trimmed}${tail}</body></html>`;
  }
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return `<html><head><style>${tablePageStyles}</style></head><body><p>No content</p>${tail}</body></html>`;

  // Markdown table: | a | b | with optional separator line |---|---|
  const markdownPipe = lines.every((l) => /^\s*\|.+\|\s*$/.test(l) || /^\s*\|[\s\-:]+\|\s*$/.test(l));
  let rows: string[][];
  if (markdownPipe) {
    rows = lines
      .filter((l) => !/^\s*\|[\s\-:]+\|\s*$/.test(l))
      .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  } else {
    const hasTabs = lines.some((l) => l.includes("\t"));
    const sep = hasTabs ? "\t" : ",";
    rows = lines.map((line) => line.split(sep).map((cell) => cell.trim()));
  }

  const maxCols = Math.max(...rows.map((r) => r.length), 1);
  const pad = (arr: string[]) => {
    const out = [...arr];
    while (out.length < maxCols) out.push("");
    return out;
  };
  const header = rows.length > 0 ? pad(rows[0]) : [];
  const bodyRows = rows.slice(1);
  const thCells = header.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const trs = bodyRows
    .map((row) => pad(row).map((c) => `<td>${escapeHtml(c)}</td>`).join(""))
    .map((cells) => `<tr>${cells}</tr>`)
    .join("");
  const tableHtml =
    `<table><thead><tr>${thCells}</tr></thead><tbody>${trs}</tbody></table>` ||
    `<table><tbody><tr><td>${escapeHtml(trimmed)}</td></tr></tbody></table>`;
  return `<!DOCTYPE html><html><head><style>${tablePageStyles}</style></head><body>${tableHtml}${tail}</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatBbox(bbox: [number, number, number, number]): string {
  return `[${bbox[0].toFixed(4)}, ${bbox[1].toFixed(4)}, ${bbox[2].toFixed(4)}, ${bbox[3].toFixed(4)}]`;
}

const FULL_PAGE_BBOX_EPSILON = 0.015;

function isFullPageBbox(bbox: [number, number, number, number]): boolean {
  const [x1, y1, x2, y2] = bbox;
  return (
    x1 <= FULL_PAGE_BBOX_EPSILON &&
    y1 <= FULL_PAGE_BBOX_EPSILON &&
    x2 >= 1 - FULL_PAGE_BBOX_EPSILON &&
    y2 >= 1 - FULL_PAGE_BBOX_EPSILON
  );
}

function isRenderableBbox(bbox: [number, number, number, number]): boolean {
  const [x1, y1, x2, y2] = bbox;
  if (x2 <= x1 || y2 <= y1) {
    return false;
  }
  return !isFullPageBbox(bbox);
}

function markdownToPreviewHtml(markdown: string): string {
  const input = markdown || "";
  const rendered = marked.parse(input, {
    gfm: true,
    breaks: true,
  });
  const renderedHtml = typeof rendered === "string" ? rendered : "";
  const content = DOMPurify.sanitize(renderedHtml, {
    USE_PROFILES: { html: true },
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });

  return `<!DOCTYPE html><html><head><style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 12px; font-family: ui-sans-serif, system-ui, sans-serif; color: #18181a; background: #fff; line-height: 1.45; }
    h1,h2,h3,h4,h5,h6 { margin: 0.6em 0 0.35em; line-height: 1.2; }
    p { margin: 0.5em 0; white-space: pre-wrap; word-break: break-word; }
    a { color: #374151; text-decoration: underline; }
    ul,ol { margin: 0.45em 0 0.65em 1.3em; }
    li { margin: 0.2em 0; }
    pre { margin: 0.75em 0; padding: 10px; overflow: auto; border: 1px solid #e4e4e7; border-radius: 8px; background: #f8fafc; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    table { margin: 0.75em 0; border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #e0e0e0; padding: 6px 10px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; font-weight: 600; }
    blockquote { margin: 0.75em 0; padding: 0.5em 0.85em; border-left: 3px solid #d4d4d8; color: #4b5563; }
    img { display: block; margin: 8px 0; max-width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 8px; }
    hr { border: 0; border-top: 1px solid #e4e4e7; margin: 1em 0; }
  </style></head><body>${content || "<p>No markdown output.</p>"}</body></html>`;
}

export function RunResultsPanel({
  runDetail,
  filePreviewUrl = null,
  fileMimeType = null,
}: RunResultsPanelProps): React.JSX.Element {
  const [activeFieldPath, setActiveFieldPath] = useState("");
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [showThumbnailStrip, setShowThumbnailStrip] = useState(true);
  const [showLayoutBlocks, setShowLayoutBlocks] = useState(true);
  const [markdownView, setMarkdownView] = useState<"preview" | "raw">("preview");
  const [tableHeights, setTableHeights] = useState<Record<string, number>>({});
  const [pdfPageImages, setPdfPageImages] = useState<string[]>([]);
  const [isRenderingPdfPages, setIsRenderingPdfPages] = useState(false);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const d = e.data;
      if (d?.type === "glm-ocr-table-height" && typeof d.id === "string" && typeof d.height === "number") {
        setTableHeights((prev) => (prev[d.id] === d.height ? prev : { ...prev, [d.id]: d.height }));
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const payload = runDetail?.payload ?? null;
  const run = runDetail?.run ?? null;
  const fields = useMemo(() => payload?.extractedFields.fields ?? [], [payload?.extractedFields.fields]);
  const resolvedActiveFieldPath = fields.some((f) => f.fieldPath === activeFieldPath)
    ? activeFieldPath
    : (fields[0]?.fieldPath ?? "");
  const activeField = fields.find((f) => f.fieldPath === resolvedActiveFieldPath) ?? fields[0] ?? null;

  useEffect(() => {
    let cancelled = false;
    const localUrls: string[] = [];

    async function renderPdfPages(): Promise<void> {
      const isPdf = fileMimeType === "application/pdf" || run?.mimeType === "application/pdf";
      if (!filePreviewUrl || !isPdf) {
        setPdfPageImages((prev) => {
          prev.forEach((url) => URL.revokeObjectURL(url));
          return [];
        });
        return;
      }

      setIsRenderingPdfPages(true);
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.mjs`;
        if (pdfjs.GlobalWorkerOptions.workerSrc !== workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
        }

        const loadingTask = pdfjs.getDocument({
          url: filePreviewUrl,
          isEvalSupported: false,
        });
        const pdf = await loadingTask.promise;
        const nextImages: string[] = [];

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) {
            break;
          }

          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1.35 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) {
            continue;
          }

          await page.render({ canvas, canvasContext: context, viewport }).promise;
          const blob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob(resolve, "image/jpeg", 0.92);
          });
          if (!blob) {
            continue;
          }

          const objectUrl = URL.createObjectURL(blob);
          localUrls.push(objectUrl);
          nextImages.push(objectUrl);
        }

        if (cancelled) {
          localUrls.forEach((url) => URL.revokeObjectURL(url));
          return;
        }

        setPdfPageImages((prev) => {
          prev.forEach((url) => URL.revokeObjectURL(url));
          return nextImages;
        });
      } catch {
        if (!cancelled) {
          setPdfPageImages((prev) => {
            prev.forEach((url) => URL.revokeObjectURL(url));
            return [];
          });
        } else {
          localUrls.forEach((url) => URL.revokeObjectURL(url));
        }
      } finally {
        if (!cancelled) {
          setIsRenderingPdfPages(false);
        }
      }
    }

    void renderPdfPages();

    return () => {
      cancelled = true;
      localUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [filePreviewUrl, fileMimeType, run?.mimeType]);

  const pages = useMemo(() => {
    if (payload?.layoutVisualization?.length) return payload.layoutVisualization;
    if (pdfPageImages.length > 0) return pdfPageImages;
    if (filePreviewUrl && run?.mimeType.startsWith("image/")) return [filePreviewUrl];
    return [] as string[];
  }, [payload?.layoutVisualization, pdfPageImages, filePreviewUrl, run?.mimeType]);

  useEffect(() => {
    setActivePageIndex((prev) => Math.min(prev, Math.max(pages.length - 1, 0)));
  }, [pages.length]);

  const safeActivePageIndex = Math.min(Math.max(activePageIndex, 0), Math.max(pages.length - 1, 0));
  const hasPageImages = pages.length > 0;

  const showPdfFallback =
    !hasPageImages && filePreviewUrl && (fileMimeType === "application/pdf" || run?.mimeType === "application/pdf");
  const showImageFallback =
    !hasPageImages && filePreviewUrl && (fileMimeType?.startsWith("image/") || run?.mimeType?.startsWith("image/"));

  const scrollToPage = useCallback(
    (pageIndex: number) => {
      if (pages.length === 0) {
        return;
      }
      const bounded = Math.max(0, Math.min(pageIndex, pages.length - 1));
      setActivePageIndex(bounded);
      pageRefs.current[bounded]?.scrollIntoView({
        behavior: "smooth",
        block: "start",
        inline: "nearest",
      });
    },
    [pages.length]
  );

  useEffect(() => {
    if (!previewScrollRef.current || pages.length <= 1) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        let bestPage: { pageIndex: number; ratio: number } | null = null;
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          const rawIndex = Number((entry.target as HTMLElement).dataset.pageIndex ?? Number.NaN);
          if (!Number.isFinite(rawIndex)) {
            continue;
          }
          if (!bestPage || entry.intersectionRatio > bestPage.ratio) {
            bestPage = { pageIndex: rawIndex, ratio: entry.intersectionRatio };
          }
        }

        if (bestPage) {
          setActivePageIndex((prev) => (prev === bestPage.pageIndex ? prev : bestPage.pageIndex));
        }
      },
      {
        root: previewScrollRef.current,
        threshold: [0.35, 0.6, 0.85],
      }
    );

    pageRefs.current.forEach((node) => {
      if (node) {
        observer.observe(node);
      }
    });

    return () => observer.disconnect();
  }, [pages]);

  const visibleCitationsByPage = useMemo(() => {
    const byPage = new Map<number, FieldCitation[]>();
    for (const citation of activeField?.citations ?? []) {
      if (!isRenderableBbox(citation.bbox2d)) {
        continue;
      }
      const inPage = byPage.get(citation.pageIndex) ?? [];
      inPage.push(citation);
      byPage.set(citation.pageIndex, inPage);
    }
    return byPage;
  }, [activeField?.citations]);

  type RichBlock = {
    pageIndex: number;
    index: number;
    label: "image" | "table";
    content: string;
    bbox2d: [number, number, number, number];
  };

  const richBlocks = useMemo((): RichBlock[] => {
    const pages = payload?.layoutDetails ?? [];
    const out: RichBlock[] = [];
    pages.forEach((pageBlocks, pageIndex) => {
      pageBlocks.forEach((b, localIndex) => {
        const idx = b.index ?? localIndex;
        if (b.label === "table" && typeof b.content === "string" && b.content.length > 0) {
          out.push({
            pageIndex,
            index: idx,
            label: "table",
            content: b.content,
            bbox2d: b.bbox_2d ?? [0, 0, 0, 0],
          });
        } else if (
          b.label === "image" &&
          typeof b.content === "string" &&
          (b.content as string).length > 0
        ) {
          out.push({
            pageIndex,
            index: idx,
            label: "image",
            content: b.content as string,
            bbox2d: b.bbox_2d ?? [0, 0, 0, 0],
          });
        }
      });
    });
    return out;
  }, [payload?.layoutDetails]);

  type ExtractionItem =
    | { type: "field"; sortKey: [number, number]; field: (typeof fields)[number] }
    | { type: "block"; sortKey: [number, number]; block: RichBlock };

  const extractionsInOrder = useMemo((): ExtractionItem[] => {
    const items: ExtractionItem[] = [];
    fields.forEach((field) => {
      const page = field.citations[0]?.pageIndex ?? 0;
      const inPage = field.citations[0]?.blockIndex ?? 0;
      items.push({ type: "field", sortKey: [page, inPage], field });
    });
    if (showLayoutBlocks) {
      richBlocks.forEach((block) => {
        items.push({ type: "block", sortKey: [block.pageIndex, block.index], block });
      });
    }
    items.sort((a, b) => {
      const [pa, ia] = a.sortKey;
      const [pb, ib] = b.sortKey;
      return pa !== pb ? pa - pb : ia - ib;
    });
    return items;
  }, [fields, richBlocks, showLayoutBlocks]);

  if (!runDetail) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-muted)]">
        No results yet. Upload a document and run extraction to see the document preview, extracted fields, and
        citations.
      </div>
    );
  }

  const guaranteedRun = runDetail.run;

  return (
    <section className="space-y-4">
      {/* Compact status bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs text-[var(--text-muted)]">
        <span className="font-medium text-[var(--text-strong)]">{guaranteedRun.status}</span>
        <span>·</span>
        <span>Extracted in {formatSeconds((guaranteedRun.timing?.totalMs ?? 0) / 1000)}s</span>
        <span>·</span>
        <span>{formatSeconds(guaranteedRun.stats?.secondsPerPage ?? 0)}s/page</span>
        <span>·</span>
        <span>{(guaranteedRun.stats?.pagesPerSecond ?? 0).toFixed(2)} pages/s</span>
      </div>

      {/* Side by side: full document (all pages) | extractions */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)]">
        {/* Left: full document, all pages in one scroll */}
        <article className="flex min-h-0 flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 lg:max-h-[calc(100vh-11rem)]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-[var(--text-muted)]">
              {hasPageImages ? `Document · ${pages.length} page${pages.length === 1 ? "" : "s"}` : "Document Preview"}
            </p>
            {hasPageImages && pages.length > 1 ? (
              <button
                type="button"
                onClick={() => setShowThumbnailStrip((prev) => !prev)}
                className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)]/30 hover:text-[var(--text)]"
              >
                {showThumbnailStrip ? "Hide thumbnails" : "Show thumbnails"}
              </button>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 gap-3">
            {hasPageImages && pages.length > 1 && showThumbnailStrip ? (
              <div className="hidden w-[72px] shrink-0 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-1.5 sm:block">
                <div className="flex flex-col gap-1.5">
                  {pages.map((src, index) => (
                    <button
                      key={`thumb-${index}`}
                      type="button"
                      onClick={() => scrollToPage(index)}
                      className={clsx(
                        "overflow-hidden rounded border text-left transition-all",
                        index === safeActivePageIndex
                          ? "border-[var(--accent)] shadow-sm ring-1 ring-[var(--accent)]/20"
                          : "border-[var(--border)] opacity-80 hover:opacity-100"
                      )}
                    >
                      <span className="block border-b border-[var(--border)] px-1 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
                        {index + 1}
                      </span>
                      <img src={src} alt={`Page ${index + 1}`} className="h-auto w-full object-cover object-top" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div
              ref={previewScrollRef}
              className="min-h-0 min-w-0 flex-1 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]"
            >
              {hasPageImages ? (
                <div className="mx-auto flex w-full max-w-[980px] flex-col gap-4 p-3">
                  {pages.map((src, pageIndex) => (
                    <div
                      key={`page-${pageIndex}`}
                      ref={(node) => {
                        pageRefs.current[pageIndex] = node;
                      }}
                      data-page-index={pageIndex}
                      className={clsx(
                        "overflow-hidden rounded-lg border bg-white shadow-sm",
                        pageIndex === safeActivePageIndex
                          ? "border-[var(--accent)]/45"
                          : "border-[var(--border)]"
                      )}
                    >
                      <p className="border-b border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-muted)]">
                        Page {pageIndex + 1}
                      </p>
                      <div className="relative">
                        <img src={src} alt={`Page ${pageIndex + 1}`} className="block h-auto w-full" />
                        <div className="pointer-events-none absolute inset-0 z-10">
                          {(visibleCitationsByPage.get(pageIndex) ?? []).map((citation: FieldCitation, index) => {
                            const [x1, y1, x2, y2] = citation.bbox2d;
                            return (
                              <div
                                key={`${citation.blockId}-${pageIndex}-${index}`}
                                className="absolute border-[3px] border-[var(--accent)] bg-[var(--accent)]/25 shadow-[0_0_0_1px_rgba(255,255,255,0.8)_inset] ring-2 ring-[var(--accent)]/50"
                                style={{
                                  left: `${x1 * 100}%`,
                                  top: `${y1 * 100}%`,
                                  width: `${Math.max((x2 - x1) * 100, 0.4)}%`,
                                  height: `${Math.max((y2 - y1) * 100, 0.4)}%`,
                                }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : showPdfFallback && filePreviewUrl ? (
                isRenderingPdfPages ? (
                  <div className="flex h-full min-h-[520px] items-center justify-center p-6 text-center text-sm text-[var(--text-muted)]">
                    Rendering PDF pages for bbox overlays…
                  </div>
                ) : (
                  <iframe src={filePreviewUrl} title="Document preview" className="h-full min-h-[520px] w-full border-0" />
                )
              ) : showImageFallback && filePreviewUrl ? (
                <img src={filePreviewUrl} alt="Document" className="block h-auto w-full object-contain" />
              ) : (
                <div className="flex h-full min-h-[320px] items-center justify-center p-6 text-center text-sm text-[var(--text-muted)]">
                  No page render available. Extracted fields and coordinates are listed to the right.
                </div>
              )}
            </div>
          </div>
        </article>

        {/* Right: extractions */}
        <aside className="flex min-h-0 flex-col lg:max-h-[calc(100vh-11rem)]">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--text-strong)]">Extractions</h2>
              <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <input
                  type="checkbox"
                  checked={showLayoutBlocks}
                  onChange={(e) => setShowLayoutBlocks(e.target.checked)}
                  className="rounded border-[var(--border)]"
                />
                Layout images & tables
              </label>
            </div>
            <p className="mb-3 text-[11px] text-[var(--text-muted)]">
              Schema fields (from your template) in document order.
              {showLayoutBlocks ? " Layout images/tables from the OCR are included." : ""}
            </p>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {extractionsInOrder.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--border)] px-3 py-6 text-center text-sm text-[var(--text-muted)]">
                  No extracted fields or rich blocks.
                </div>
              ) : null}

              {extractionsInOrder.map((item) => {
                if (item.type === "field") {
                  const { field } = item;
                  const isActive = activeField?.fieldPath === field.fieldPath;
                  const firstCitation = field.citations[0];
                  return (
                    <button
                      key={field.fieldPath}
                      type="button"
                      onMouseEnter={() => {
                        setActiveFieldPath(field.fieldPath);
                      }}
                      onClick={() => {
                        setActiveFieldPath(field.fieldPath);
                        if (field.citations[0]) scrollToPage(field.citations[0].pageIndex);
                      }}
                      className={clsx(
                        "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                        isActive
                          ? "border-[var(--accent)]/40 bg-[var(--accent)]/10"
                          : "border-[var(--border)] hover:border-[var(--accent)]/25 hover:bg-[var(--surface-raised)]"
                      )}
                    >
                      <p className="font-mono text-xs text-[var(--text-muted)]">{field.fieldPath}</p>
                      <p className="mt-1 line-clamp-2 text-sm text-[var(--text)]">{formatValue(field.value)}</p>
                      <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                        {field.citations.length} citation{field.citations.length === 1 ? "" : "s"}
                      </p>
                      {firstCitation ? (
                        <p className="mt-1 font-mono text-[11px] text-[var(--text-muted)]">
                          {isRenderableBbox(firstCitation.bbox2d)
                            ? `Page ${firstCitation.pageIndex + 1} · bbox ${formatBbox(firstCitation.bbox2d)}`
                            : isFullPageBbox(firstCitation.bbox2d)
                              ? `Page ${firstCitation.pageIndex + 1} · full page`
                              : `Page ${firstCitation.pageIndex + 1} · exact bbox unavailable`}
                        </p>
                      ) : null}
                    </button>
                  );
                }
                const { block } = item;
                return (
                  <div
                    key={`${block.label}-${block.pageIndex}-${block.index}`}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] overflow-hidden"
                  >
                    <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                      {block.label === "image" ? "Image" : "Table"} · Page {block.pageIndex + 1}
                    </p>
                    <p className="px-3 pb-1.5 font-mono text-[11px] text-[var(--text-muted)]">
                      bbox {formatBbox(block.bbox2d)}
                    </p>
                    {block.label === "image" ? (
                      <div className="border-t border-[var(--border)]">
                        <img
                          src={block.content}
                          alt=""
                          className="block w-full max-h-64 object-contain bg-[var(--surface)]"
                        />
                      </div>
                    ) : (() => {
                      const tableBlockId = `table-${block.pageIndex}-${block.index}`;
                      const height = tableHeights[tableBlockId] ?? 180;
                      return (
                        <div className="border-t border-[var(--border)] overflow-hidden bg-[var(--surface)]">
                          <iframe
                            title={`Table Page ${block.pageIndex + 1}`}
                            sandbox="allow-scripts"
                            srcDoc={tableContentToHtml(block.content, tableBlockId)}
                            style={{ height: `${height}px` }}
                            className="w-full min-h-[80px] border-0 block"
                          />
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>

      <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--text-strong)]">OCR Markdown</summary>
        <div className="mt-3">
          <div className="mb-2 inline-flex rounded-lg border border-[var(--border)] p-1">
            {(["preview", "raw"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMarkdownView(option)}
                className={clsx(
                  "rounded-md px-2.5 py-1 text-xs transition-colors",
                  markdownView === option
                    ? "bg-[var(--accent)]/10 text-[var(--text-strong)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]"
                )}
              >
                {option === "preview" ? "Preview" : "Raw"}
              </button>
            ))}
          </div>

          {markdownView === "preview" ? (
            <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-white">
              <iframe
                title="OCR Markdown Preview"
                sandbox=""
                srcDoc={markdownToPreviewHtml(payload?.mdResults || "")}
                className="h-[340px] w-full border-0"
              />
            </div>
          ) : (
            <pre className="max-h-[340px] overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--surface-raised)] p-3 text-xs text-[var(--text)]">
              {payload?.mdResults || "No markdown output."}
            </pre>
          )}
        </div>
      </details>
    </section>
  );
}

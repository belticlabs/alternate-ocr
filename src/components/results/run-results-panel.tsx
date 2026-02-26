/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
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

export function RunResultsPanel({
  runDetail,
  filePreviewUrl = null,
  fileMimeType = null,
}: RunResultsPanelProps): React.JSX.Element {
  const [activeFieldPath, setActiveFieldPath] = useState("");
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [showLayoutBlocks, setShowLayoutBlocks] = useState(true);
  const [tableHeights, setTableHeights] = useState<Record<string, number>>({});

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
  const fields = payload?.extractedFields.fields ?? [];
  const resolvedActiveFieldPath = fields.some((f) => f.fieldPath === activeFieldPath)
    ? activeFieldPath
    : (fields[0]?.fieldPath ?? "");
  const activeField = fields.find((f) => f.fieldPath === resolvedActiveFieldPath) ?? fields[0] ?? null;

  const pages = useMemo(() => {
    if (payload?.layoutVisualization?.length) return payload.layoutVisualization;
    if (filePreviewUrl && run?.mimeType.startsWith("image/")) return [filePreviewUrl];
    return [] as string[];
  }, [payload?.layoutVisualization, filePreviewUrl, run?.mimeType]);

  const safeActivePageIndex = Math.min(activePageIndex, Math.max(pages.length - 1, 0));
  const hasPageImages = pages.length > 0;

  const showPdfFallback =
    !hasPageImages && filePreviewUrl && (fileMimeType === "application/pdf" || run?.mimeType === "application/pdf");
  const showImageFallback =
    !hasPageImages && filePreviewUrl && (fileMimeType?.startsWith("image/") || run?.mimeType?.startsWith("image/"));

  const visibleCitations = (activeField?.citations ?? []).filter(
    (c: FieldCitation) => c.pageIndex === safeActivePageIndex
  );

  type RichBlock = { pageIndex: number; index: number; label: "image" | "table"; content: string };

  const richBlocks = useMemo((): RichBlock[] => {
    const pages = payload?.layoutDetails ?? [];
    const out: RichBlock[] = [];
    pages.forEach((pageBlocks, pageIndex) => {
      pageBlocks.forEach((b, localIndex) => {
        const idx = b.index ?? localIndex;
        if (b.label === "table" && typeof b.content === "string" && b.content.length > 0) {
          out.push({ pageIndex, index: idx, label: "table", content: b.content });
        } else if (
          b.label === "image" &&
          typeof b.content === "string" &&
          (b.content as string).length > 0
        ) {
          out.push({ pageIndex, index: idx, label: "image", content: b.content as string });
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

      {/* Half-and-half: document preview | extractions */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left: document preview with optional thumbnail strip */}
        <article className="flex min-h-0 flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          {hasPageImages && pages.length > 1 ? (
            <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">
              Page {safeActivePageIndex + 1} of {pages.length}
            </p>
          ) : null}
          <div className="flex min-h-0 flex-1 gap-3">
          {hasPageImages && pages.length > 1 ? (
            <div className="flex shrink-0 flex-col gap-1.5 overflow-y-auto py-1">
              {pages.map((src, index) => (
                <button
                  key={`thumb-${index}`}
                  type="button"
                  onClick={() => setActivePageIndex(index)}
                  className={clsx(
                    "block shrink-0 overflow-hidden rounded-lg border-2 transition-all",
                    index === safeActivePageIndex
                      ? "border-[var(--accent)] shadow-sm ring-1 ring-[var(--accent)]/20"
                      : "border-transparent opacity-75 hover:opacity-100"
                  )}
                >
                  <img
                    src={src}
                    alt={`Page ${index + 1}`}
                    className="h-auto w-[72px] max-w-[72px] object-cover object-top"
                  />
                </button>
              ))}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]">
            {hasPageImages && pages[safeActivePageIndex] ? (
              <div className="relative inline-block min-h-full w-full">
                <img
                  src={pages[safeActivePageIndex]}
                  alt={`Page ${safeActivePageIndex + 1}`}
                  className="block h-auto w-full"
                />
                <div className="pointer-events-none absolute inset-0">
                  {visibleCitations.map((citation: FieldCitation, index: number) => {
                    const [x1, y1, x2, y2] = citation.bbox2d;
                    return (
                      <div
                        key={`${citation.blockId}-${index}`}
                        className="absolute border-2 border-[var(--accent)] bg-[var(--accent)]/15"
                        style={{
                          left: `${x1 * 100}%`,
                          top: `${y1 * 100}%`,
                          width: `${Math.max((x2 - x1) * 100, 0.5)}%`,
                          height: `${Math.max((y2 - y1) * 100, 0.5)}%`,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ) : showPdfFallback && filePreviewUrl ? (
              <iframe
                src={filePreviewUrl}
                title="Document preview"
                className="h-[70vh] min-h-[400px] w-full border-0"
              />
            ) : showImageFallback && filePreviewUrl ? (
              <img
                src={filePreviewUrl}
                alt="Document"
                className="block h-auto w-full object-contain"
              />
            ) : (
              <div className="flex h-[50vh] min-h-[280px] items-center justify-center p-6 text-center text-sm text-[var(--text-muted)]">
                No page render available. Extracted fields and coordinates are listed to the right.
              </div>
            )}
          </div>
          </div>
        </article>

        {/* Right: all extractions together (fields + images + tables) */}
        <aside className="flex min-h-0 flex-col">
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
                  return (
                    <button
                      key={field.fieldPath}
                      type="button"
                      onMouseEnter={() => {
                        setActiveFieldPath(field.fieldPath);
                        if (field.citations[0]) setActivePageIndex(field.citations[0].pageIndex);
                      }}
                      onClick={() => {
                        setActiveFieldPath(field.fieldPath);
                        if (field.citations[0]) setActivePageIndex(field.citations[0].pageIndex);
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
        <pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--surface-raised)] p-3 text-xs text-[var(--text)]">
          {payload?.mdResults || "No markdown output."}
        </pre>
      </details>
    </section>
  );
}

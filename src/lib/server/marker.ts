import { getEnv } from "@/lib/env";
import { LayoutDetail } from "@/lib/types";
import { clamp } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Marker JSON block hierarchy types (from Marker's JSON renderer)
// ---------------------------------------------------------------------------

interface MarkerJsonBlock {
  id: string;
  block_type: string;
  html: string;
  polygon: [number, number][];
  bbox: [number, number, number, number];
  children: MarkerJsonBlock[] | null;
  section_hierarchy: Record<number, string> | null;
  images: Record<string, string> | null;
}

interface MarkerJsonDocument {
  children: MarkerJsonBlock[];
  block_type: string;
  metadata: {
    table_of_contents: Array<{
      title: string;
      heading_level: number | null;
      page_id: number;
      polygon: [number, number][];
    }>;
    page_stats: Array<{
      page_id: number;
      text_extraction_method: string;
      block_counts: [string, number][];
    }>;
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarkerOcrResponse {
  text: MarkerJsonDocument;
  num_pages: number;
  text_length: number;
  convert_time_s: number;
  total_time_s: number;
  per_page_s: number;
  pages_per_s: number;
  model_load_s: number;
  peak_gpu_mem_mb: number | null;
  /** When the API returns markdown but no JSON block tree, callers can use this for mdResults. */
  markdownFallback?: string;
}

interface CallMarkerOcrInput {
  fileDataUrl: string;
  mimeType: string;
  filename: string;
}

// ---------------------------------------------------------------------------
// Block type → LayoutDetail label mapping
// ---------------------------------------------------------------------------

const BLOCK_TYPE_TO_LABEL: Record<string, LayoutDetail["label"]> = {
  Text: "text",
  TextInlineMath: "text",
  SectionHeader: "text",
  PageHeader: "text",
  PageFooter: "text",
  Line: "text",
  Span: "text",
  ListItem: "text",
  ListGroup: "text",
  Caption: "text",
  Footnote: "text",
  Handwriting: "text",
  Table: "table",
  Form: "table",
  Picture: "image",
  Figure: "image",
  FigureGroup: "image",
  Equation: "formula",
  Code: "text",
  PageNumber: "text",
};

// Block types that are containers — we recurse into them instead of emitting
const CONTAINER_TYPES = new Set([
  "Page",
  "Document",
]);

// Block types whose content is already included in their parent
const SKIP_TYPES = new Set([
  "Span",
  "Line",
]);

const EMPTY_METADATA: MarkerJsonDocument["metadata"] = {
  table_of_contents: [],
  page_stats: [],
};

// ---------------------------------------------------------------------------
// Marker HTTP response normalization (JSON only)
//
// Marker’s JSONOutput model is defined in datalab-to/marker (JSONBlockOutput).
// Modal’s official Marker tutorial returns JSON via Pydantic model_dump_json().
// The worker must embed that as JSON (object or JSON string), never str(model)
// or repr(), which breaks clients. See modal/marker_convert_reference.py.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyDocument(): MarkerJsonDocument {
  return {
    children: [],
    block_type: "Document",
    metadata: { ...EMPTY_METADATA },
  };
}

/** Detects mistaken use of repr() / str(Pydantic) instead of JSON serialization. */
function isPythonReprMarkerText(s: string): boolean {
  const t = s.trim();
  return t.includes("JSONBlockOutput(") || /^children\s*=\s*\[/m.test(t);
}

function looksLikeProseMarkdown(s: string): boolean {
  const t = s.trim();
  if (t.length < 2 || isPythonReprMarkerText(t)) {
    return false;
  }
  return /^#\s/m.test(t) || t.includes("\n## ") || (t.includes("\n\n") && !t.includes("block_type="));
}

function tryParseJsonTreeString(s: string): MarkerJsonDocument | null {
  const t = s.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(t);
    if (Array.isArray(parsed)) {
      return coerceMarkerDocument({
        children: parsed,
        block_type: "Document",
        metadata: {},
      });
    }
    return coerceMarkerDocument(parsed);
  } catch {
    return null;
  }
}

function coerceMarkerDocument(value: unknown): MarkerJsonDocument | null {
  if (!isRecord(value)) {
    return null;
  }
  const children = value.children;
  if (!Array.isArray(children)) {
    return null;
  }
  const metaIn = value.metadata;
  let metadata: MarkerJsonDocument["metadata"] = { ...EMPTY_METADATA };
  if (isRecord(metaIn)) {
    const toc = (metaIn as { table_of_contents?: unknown }).table_of_contents;
    const stats = (metaIn as { page_stats?: unknown }).page_stats;
    metadata = {
      table_of_contents: Array.isArray(toc) ? (toc as MarkerJsonDocument["metadata"]["table_of_contents"]) : [],
      page_stats: Array.isArray(stats) ? (stats as MarkerJsonDocument["metadata"]["page_stats"]) : [],
    };
  }
  return {
    children: children as MarkerJsonBlock[],
    block_type: typeof value.block_type === "string" ? value.block_type : "Document",
    metadata,
  };
}

/**
 * Normalize heterogeneous Marker HTTP responses into MarkerOcrResponse.
 */
export function normalizeMarkerResponse(raw: unknown): MarkerOcrResponse {
  if (!isRecord(raw)) {
    throw new Error("Marker OCR: response is not a JSON object.");
  }

  const num_pages = typeof raw.num_pages === "number" ? raw.num_pages : Number(raw.num_pages) || 0;
  const text_length =
    typeof raw.text_length === "number" ? raw.text_length : Number(raw.text_length) || 0;
  const convert_time_s =
    typeof raw.convert_time_s === "number" ? raw.convert_time_s : Number(raw.convert_time_s) || 0;
  const total_time_s =
    typeof raw.total_time_s === "number" ? raw.total_time_s : Number(raw.total_time_s) || 0;
  const per_page_s =
    typeof raw.per_page_s === "number" ? raw.per_page_s : Number(raw.per_page_s) || 0;
  const pages_per_s =
    typeof raw.pages_per_s === "number" ? raw.pages_per_s : Number(raw.pages_per_s) || 0;
  const model_load_s =
    typeof raw.model_load_s === "number" ? raw.model_load_s : Number(raw.model_load_s) || 0;
  const peak_gpu_mem_mb =
    raw.peak_gpu_mem_mb === null || raw.peak_gpu_mem_mb === undefined
      ? null
      : typeof raw.peak_gpu_mem_mb === "number"
        ? raw.peak_gpu_mem_mb
        : Number(raw.peak_gpu_mem_mb);

  const base: MarkerOcrResponse = {
    text: emptyDocument(),
    num_pages,
    text_length,
    convert_time_s,
    total_time_s,
    per_page_s,
    pages_per_s,
    model_load_s,
    peak_gpu_mem_mb: Number.isFinite(peak_gpu_mem_mb as number) ? (peak_gpu_mem_mb as number) : null,
  };

  const unwrapTree = (node: unknown): MarkerJsonDocument | null => {
    return coerceMarkerDocument(node);
  };

  let doc: MarkerJsonDocument | null = null;

  if (unwrapTree(raw.text)) {
    doc = unwrapTree(raw.text);
  } else if (unwrapTree(raw.json)) {
    doc = unwrapTree(raw.json);
  } else if (unwrapTree(raw.result)) {
    doc = unwrapTree(raw.result);
  } else if (unwrapTree(raw.document)) {
    doc = unwrapTree(raw.document);
  } else if (unwrapTree(raw)) {
    doc = unwrapTree(raw);
  }

  if (!doc && typeof raw.text === "string") {
    const t = raw.text.trim();
    if (isPythonReprMarkerText(t)) {
      throw new Error(
        "Marker OCR: response field `text` contains Python repr (e.g. JSONBlockOutput(...)), not JSON. " +
          "Fix the Modal worker: return rendered_output.model_dump(mode=\"json\") or assign the dict from " +
          "json.loads(rendered_output.model_dump_json()) — see Modal’s doc_ocr_jobs example and " +
          "modal/marker_convert_reference.py in this repo. Do not use str() or repr() on Pydantic models."
      );
    }
    doc = tryParseJsonTreeString(t);
    if (!doc && looksLikeProseMarkdown(t)) {
      base.markdownFallback = t;
    }
  }

  const md =
    typeof raw.markdown === "string"
      ? raw.markdown
      : typeof raw.md === "string"
        ? raw.md
        : typeof raw.md_results === "string"
          ? raw.md_results
          : "";
  if (!base.markdownFallback && md.trim()) {
    base.markdownFallback = md.trim();
  }

  if (doc) {
    base.text = doc;
  }

  return base;
}

function markerFilenameForUpload(filename: string, mimeType: string): string {
  const trimmed = (filename || "").trim();
  if (trimmed && trimmed.includes(".")) {
    return trimmed.replace(/[/\\]/g, "_").slice(0, 240);
  }
  const ext =
    mimeType === "application/pdf"
      ? ".pdf"
      : mimeType === "image/png"
        ? ".png"
        : mimeType === "image/jpeg" || mimeType === "image/jpg"
          ? ".jpg"
          : mimeType === "image/webp"
            ? ".webp"
            : mimeType === "image/heic" || mimeType === "image/heif"
              ? ".heic"
              : ".pdf";
  return `document${ext}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function callMarkerOcr({
  fileDataUrl,
  mimeType,
  filename,
}: CallMarkerOcrInput): Promise<MarkerOcrResponse> {
  const env = getEnv();

  const base64 = fileDataUrl.replace(/^data:[^;]+;base64,/, "");

  const response = await fetch(env.MARKER_OCR_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file: base64,
      filename: markerFilenameForUpload(filename, mimeType),
      output_format: "json",
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Marker OCR request failed (${response.status}): ${text}`);
  }

  const raw: unknown = await response.json();
  return normalizeMarkerResponse(raw);
}

/**
 * Walk the JSON block tree and collect markdown-ish text per page.
 */
export function collectMarkerMarkdown(response: MarkerOcrResponse): string {
  const doc = response.text;
  if (!doc?.children?.length) {
    return response.markdownFallback?.trim() ?? "";
  }

  const pages: string[] = [];

  for (let i = 0; i < doc.children.length; i++) {
    const page = doc.children[i];
    const pageContent = collectBlockText(page);
    pages.push(`# Page ${i + 1}\n\n${pageContent}`);
  }

  const fromTree = pages.join("\n\n").trim();
  if (fromTree) {
    return fromTree;
  }
  return response.markdownFallback?.trim() ?? "";
}

/**
 * Walk the JSON block tree and produce real LayoutDetail[][] with bbox data.
 */
export function markerToLayoutDetails(
  response: MarkerOcrResponse
): LayoutDetail[][] {
  const doc = response.text;
  if (!doc?.children?.length) {
    return [];
  }

  const result: LayoutDetail[][] = [];

  for (const page of doc.children) {
    // Page-level bbox gives us page dimensions for normalization
    const pageBbox = page.bbox;
    const pageWidth = pageBbox ? pageBbox[2] - pageBbox[0] : 1;
    const pageHeight = pageBbox ? pageBbox[3] - pageBbox[1] : 1;
    const pageOriginX = pageBbox ? pageBbox[0] : 0;
    const pageOriginY = pageBbox ? pageBbox[1] : 0;

    const blocks: LayoutDetail[] = [];
    flattenMarkerBlocks(page, pageWidth, pageHeight, pageOriginX, pageOriginY, blocks);

    // Re-index blocks sequentially
    for (let i = 0; i < blocks.length; i++) {
      blocks[i].index = i;
    }

    result.push(blocks);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect text content from a block and its children.
 */
function collectBlockText(block: MarkerJsonBlock): string {
  const blockType = block.block_type;

  // For leaf content blocks, use HTML content directly
  if (block.html && (!block.children || block.children.length === 0)) {
    return stripHtml(block.html);
  }

  // For blocks with children, recurse
  if (block.children && block.children.length > 0) {
    // For table blocks, prefer the HTML directly (preserves table structure)
    if (blockType === "Table" || blockType === "Form") {
      return block.html || "";
    }

    const childTexts = block.children
      .map((child) => collectBlockText(child))
      .filter(Boolean);
    return childTexts.join("\n\n");
  }

  return block.html ? stripHtml(block.html) : "";
}

/**
 * Strip HTML tags to get plain text content.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+(>|$)/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * Recursively flatten the block tree into leaf-level LayoutDetail items.
 *
 * - Container blocks (Page, Document) → recurse into children
 * - Span/Line blocks → skip (content is in parent)
 * - Content blocks (Text, Table, Picture, etc.) → emit as LayoutDetail
 *   - If they have children that aren't Span/Line, recurse into those too
 */
function flattenMarkerBlocks(
  block: MarkerJsonBlock,
  pageWidth: number,
  pageHeight: number,
  pageOriginX: number,
  pageOriginY: number,
  out: LayoutDetail[]
): void {
  const blockType = block.block_type;

  // Skip types whose content is in their parent
  if (SKIP_TYPES.has(blockType)) {
    return;
  }

  // Container types: just recurse
  if (CONTAINER_TYPES.has(blockType)) {
    if (block.children) {
      for (const child of block.children) {
        flattenMarkerBlocks(child, pageWidth, pageHeight, pageOriginX, pageOriginY, out);
      }
    }
    return;
  }

  // Content block — emit it
  const label = BLOCK_TYPE_TO_LABEL[blockType] || "text";
  const content = getBlockContent(block);
  const bbox = normalizeBbox(block.bbox, pageWidth, pageHeight, pageOriginX, pageOriginY);

  if (content || label === "image") {
    out.push({
      index: 0, // Re-indexed later
      label,
      bbox_2d: bbox,
      content: content || "",
      width: Math.round(pageWidth),
      height: Math.round(pageHeight),
    });
  }
}

/**
 * Get the content string for a block.
 * For tables, keep the HTML; for everything else, strip tags.
 */
function getBlockContent(block: MarkerJsonBlock): string {
  if (block.block_type === "Table" || block.block_type === "Form") {
    return block.html || "";
  }

  if (block.html) {
    return stripHtml(block.html);
  }

  // If no direct html, collect from children
  if (block.children && block.children.length > 0) {
    return block.children
      .map((child) => (child.html ? stripHtml(child.html) : ""))
      .filter(Boolean)
      .join(" ");
  }

  return "";
}

/**
 * Normalize a bbox from PDF point coordinates to 0-1 range.
 */
function normalizeBbox(
  bbox: [number, number, number, number] | null | undefined,
  pageWidth: number,
  pageHeight: number,
  pageOriginX: number,
  pageOriginY: number
): [number, number, number, number] {
  if (!bbox || pageWidth <= 0 || pageHeight <= 0) {
    return [0, 0, 1, 1];
  }

  const x1 = clamp((bbox[0] - pageOriginX) / pageWidth, 0, 1);
  const y1 = clamp((bbox[1] - pageOriginY) / pageHeight, 0, 1);
  const x2 = clamp((bbox[2] - pageOriginX) / pageWidth, 0, 1);
  const y2 = clamp((bbox[3] - pageOriginY) / pageHeight, 0, 1);

  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

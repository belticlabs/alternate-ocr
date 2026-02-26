import { performance } from "node:perf_hooks";
import { getRepository } from "./persistence";
import { extractWithTemplate } from "./extraction";
import {
  callMistralOcr,
  collectMistralMarkdown,
  mistralPagesToLayoutDetails,
  MistralOcrPage,
  parseMistralDocumentAnnotation,
} from "./mistral";
import { callLayoutParsing } from "./zai";
import {
  ExtractedField,
  ExtractedFieldsPayload,
  LayoutDetail,
  NormalizedBlock,
  RunMode,
  RunProvider,
  RunStats,
  TimingStats,
} from "@/lib/types";
import { safeJsonParse } from "@/lib/utils";

export interface RunProcessInput {
  runId: string;
  mode: RunMode;
  provider: RunProvider;
  templateId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  fileDataUrl: string;
}

function normalizeLayoutDetails(layoutDetails?: LayoutDetail[][]): {
  blocks: NormalizedBlock[];
  pageCount: number;
} {
  if (!layoutDetails || layoutDetails.length === 0) {
    return { blocks: [], pageCount: 0 };
  }

  const blocks: NormalizedBlock[] = [];

  layoutDetails.forEach((pageBlocks, pageIndex) => {
    pageBlocks.forEach((block, localIndex) => {
      const bbox = block.bbox_2d ?? [0, 0, 0, 0];
      blocks.push({
        id: `${pageIndex}:${block.index ?? localIndex}`,
        pageIndex,
        index: block.index ?? localIndex,
        label: block.label,
        bbox2d: [bbox[0] ?? 0, bbox[1] ?? 0, bbox[2] ?? 0, bbox[3] ?? 0],
        content: block.content ?? "",
        pageWidth: block.width ?? 0,
        pageHeight: block.height ?? 0,
      });
    });
  });

  return {
    blocks,
    pageCount: layoutDetails.length,
  };
}

function buildStats(
  pageCount: number,
  timing: TimingStats,
  usage: {
    ocrPromptTokens: number;
    ocrCompletionTokens: number;
    llmPromptTokens: number;
    llmCompletionTokens: number;
  }
): RunStats {
  const totalSeconds = timing.totalMs / 1000;
  const safePages = pageCount > 0 ? pageCount : 1;
  const safeTotalSeconds = totalSeconds > 0 ? totalSeconds : 0.001;

  return {
    pageCount,
    totalSeconds,
    secondsPerPage: totalSeconds / safePages,
    pagesPerSecond: pageCount > 0 ? pageCount / safeTotalSeconds : 0,
    usage,
  };
}

function createEverythingPayload(blocks: NormalizedBlock[]): ExtractedFieldsPayload {
  const pageText = new Map<number, string[]>();
  const blockRecords = blocks.map((block) => {
    if ((block.label === "text" || block.label === "formula") && block.content.trim().length > 0) {
      const pageItems = pageText.get(block.pageIndex) ?? [];
      pageItems.push(block.content.trim());
      pageText.set(block.pageIndex, pageItems);
    }

    return {
      block_id: block.id,
      page_index: block.pageIndex,
      index: block.index,
      label: block.label,
      bbox_2d: block.bbox2d,
      content: block.content,
      width: block.pageWidth,
      height: block.pageHeight,
    };
  });

  const values = {
    summary: {
      total_blocks: blocks.length,
      text_blocks: blocks.filter((block) => block.label === "text").length,
      formula_blocks: blocks.filter((block) => block.label === "formula").length,
      table_blocks: blocks.filter((block) => block.label === "table").length,
      image_blocks: blocks.filter((block) => block.label === "image").length,
    },
    page_text: Object.fromEntries(
      Array.from(pageText.entries()).map(([pageIndex, textParts]) => [String(pageIndex), textParts.join("\n\n")])
    ),
    blocks: blockRecords,
    tables: blockRecords.filter((item) => item.label === "table"),
    images: blockRecords.filter((item) => item.label === "image"),
  };

  const fields = blocks.map((block) => ({
    fieldPath: `blocks.${block.id}.content`,
    value: block.content,
    citations: [
      {
        fieldPath: `blocks.${block.id}.content`,
        pageIndex: block.pageIndex,
        blockId: block.id,
        blockIndex: block.index,
        bbox2d: block.bbox2d,
        label: block.label,
      },
    ],
  }));

  return {
    values,
    fields,
  };
}

function flattenObject(
  value: unknown,
  pathPrefix = ""
): Array<{ fieldPath: string; value: unknown }> {
  if (value === null || value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      flattenObject(item, pathPrefix ? `${pathPrefix}[${index}]` : `[${index}]`)
    );
  }

  if (typeof value !== "object") {
    return pathPrefix ? [{ fieldPath: pathPrefix, value }] : [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, nestedValue]) => {
    const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    return flattenObject(nestedValue, nextPath);
  });
}

function normalizeForSearch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function toSearchableContent(value: string): string {
  return normalizeForSearch(value.replace(/<[^>]+>/g, " "));
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

function hasUsableBlockBbox(block: NormalizedBlock): boolean {
  const [x1, y1, x2, y2] = block.bbox2d;
  return x2 > x1 && y2 > y1 && !isFullPageBbox(block.bbox2d);
}

function scoreBlockForCitation(block: NormalizedBlock): number {
  const [x1, y1, x2, y2] = block.bbox2d;
  const area = Math.max((x2 - x1) * (y2 - y1), 0);
  const labelBias =
    block.label === "table" ? 0 : block.label === "image" ? 1 : block.label === "formula" ? 2 : 3;
  return labelBias * 10 + area;
}

function pickBestCitationBlock(
  value: unknown,
  pageBlocks: NormalizedBlock[]
): NormalizedBlock | null {
  if (pageBlocks.length === 0) {
    return null;
  }

  const usableBlocks = pageBlocks.filter(hasUsableBlockBbox);
  if (usableBlocks.length === 0) {
    // Mistral: only text block per page has bbox [0,0,1,1]; use it when value is in that block so we cite page instead of "unavailable"
    const needle =
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? normalizeForSearch(String(value)).slice(0, 260)
        : "";
    if (needle) {
      const fullPageTextBlock = pageBlocks.find(
        (b) =>
          b.label === "text" &&
          isFullPageBbox(b.bbox2d) &&
          toSearchableContent(b.content).includes(needle)
      );
      if (fullPageTextBlock) {
        return fullPageTextBlock;
      }
    }
    return null;
  }

  const needle =
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? normalizeForSearch(String(value)).slice(0, 260)
      : "";

  if (needle) {
    const contentMatches = usableBlocks
      .filter((block) => toSearchableContent(block.content).includes(needle))
      .sort((a, b) => scoreBlockForCitation(a) - scoreBlockForCitation(b));
    if (contentMatches.length > 0) {
      return contentMatches[0];
    }
  }

  const structuralBlocks = usableBlocks
    .filter((block) => block.label !== "text")
    .sort((a, b) => scoreBlockForCitation(a) - scoreBlockForCitation(b));
  if (structuralBlocks.length > 0) {
    return structuralBlocks[0];
  }

  return null;
}

function findCitationPage(value: unknown, pages: MistralOcrPage[]): number | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return null;
  }

  const needle = normalizeForSearch(String(value)).slice(0, 260);
  if (!needle) {
    return null;
  }

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const haystack = normalizeForSearch(pages[pageIndex]?.markdown ?? "");
    if (haystack && haystack.includes(needle)) {
      return pageIndex;
    }
  }

  return null;
}

function createMistralTemplatePayload(
  values: Record<string, unknown>,
  pages: MistralOcrPage[],
  blocks: NormalizedBlock[]
): { extracted: ExtractedFieldsPayload; citationMs: number } {
  const citationStart = performance.now();
  const blocksByPage = new Map<number, NormalizedBlock[]>();

  for (const block of blocks) {
    const inPage = blocksByPage.get(block.pageIndex) ?? [];
    inPage.push(block);
    blocksByPage.set(block.pageIndex, inPage);
  }

  const flattenedValues = flattenObject(values);
  const fields: ExtractedField[] = flattenedValues.map((entry) => {
    const citationPage = findCitationPage(entry.value, pages);
    const pageBlocks = citationPage != null ? blocksByPage.get(citationPage) ?? [] : [];
    const citationBlock = citationPage != null ? pickBestCitationBlock(entry.value, pageBlocks) : null;

    let citations: ExtractedField["citations"] = [];
    if (citationPage != null && citationBlock) {
      citations = [
        {
          fieldPath: entry.fieldPath,
          pageIndex: citationPage,
          blockId: citationBlock.id,
          blockIndex: citationBlock.index,
          bbox2d: citationBlock.bbox2d,
          label: citationBlock.label,
        },
      ];
    } else if (citationPage != null) {
      citations = [
        {
          fieldPath: entry.fieldPath,
          pageIndex: citationPage,
          blockId: `page:${citationPage}`,
          blockIndex: -1,
          bbox2d: [0, 0, 0, 0],
          label: "text",
        },
      ];
    }

    return {
      fieldPath: entry.fieldPath,
      value: entry.value,
      citations,
    };
  });

  return {
    extracted: {
      values,
      fields,
    },
    citationMs: performance.now() - citationStart,
  };
}

export async function processRun(input: RunProcessInput): Promise<void> {
  const repository = getRepository();

  const overallStart = performance.now();
  const timers = {
    ocrMs: 0,
    llmMs: 0,
    citationMs: 0,
    persistedMs: 0,
  };

  const startedAt = new Date().toISOString();
  await repository.markRunProcessing(input.runId, startedAt);

  try {
    const usage = {
      ocrPromptTokens: 0,
      ocrCompletionTokens: 0,
      llmPromptTokens: 0,
      llmCompletionTokens: 0,
    };

    let extractedPayload: ExtractedFieldsPayload | null = null;
    let markdown = "";
    let layoutDetails: LayoutDetail[][] = [];
    let layoutVisualization: string[] = [];
    let rawProviderPayload: unknown = null;
    let pageCount = 0;
    let normalized = { blocks: [] as NormalizedBlock[], pageCount: 0 };

    if (input.provider === "mistral") {
      let schema: Record<string, unknown> | undefined;
      let extractionRules = "";
      if (input.mode === "template") {
        const template = await repository.getTemplate(input.templateId);
        if (!template) {
          throw new Error("Template not found for template-mode extraction.");
        }
        schema = safeJsonParse<Record<string, unknown>>(template.schemaJson, {});
        extractionRules = template.extractionRules;
      }

      const ocrStart = performance.now();
      const ocrResponse = await callMistralOcr({
        fileDataUrl: input.fileDataUrl,
        mimeType: input.mimeType,
        documentAnnotationSchema: input.mode === "template" ? schema : undefined,
        documentAnnotationPrompt:
          input.mode === "template"
            ? `Extract values that match the schema exactly.\n\nRules:\n${
                extractionRules || "(none)"
              }\n\nUse null when a value is missing.`
            : undefined,
      });
      timers.ocrMs = performance.now() - ocrStart;

      const pages = ocrResponse.pages ?? [];
      markdown = collectMistralMarkdown(pages);
      layoutDetails = mistralPagesToLayoutDetails(pages);
      layoutVisualization = [];
      normalized = normalizeLayoutDetails(layoutDetails);
      pageCount = pages.length > 0 ? pages.length : normalized.pageCount;
      rawProviderPayload = ocrResponse;

      if (input.mode === "template") {
        const values = parseMistralDocumentAnnotation(ocrResponse.document_annotation);
        const mistralTemplatePayload = createMistralTemplatePayload(values, pages, normalized.blocks);
        extractedPayload = mistralTemplatePayload.extracted;
        timers.citationMs = mistralTemplatePayload.citationMs;
      } else {
        const citationStart = performance.now();
        extractedPayload = createEverythingPayload(normalized.blocks);
        timers.citationMs = performance.now() - citationStart;
      }
    } else {
      const ocrStart = performance.now();
      const ocrResponse = await callLayoutParsing(input.fileDataUrl);
      timers.ocrMs = performance.now() - ocrStart;

      markdown = ocrResponse.md_results ?? "";
      layoutDetails = ocrResponse.layout_details ?? [];
      layoutVisualization = ocrResponse.layout_visualization ?? [];
      normalized = normalizeLayoutDetails(layoutDetails);
      pageCount = ocrResponse.data_info?.num_pages ?? normalized.pageCount;
      rawProviderPayload = ocrResponse;

      usage.ocrPromptTokens = ocrResponse.usage?.prompt_tokens ?? 0;
      usage.ocrCompletionTokens = ocrResponse.usage?.completion_tokens ?? 0;

      if (input.mode === "template") {
        const template = await repository.getTemplate(input.templateId);
        if (!template) {
          throw new Error("Template not found for template-mode extraction.");
        }

        const schema = safeJsonParse<Record<string, unknown>>(template.schemaJson, {});

        const llmStart = performance.now();
        const extractionResult = await extractWithTemplate(
          schema,
          template.extractionRules,
          markdown,
          normalized.blocks
        );
        timers.llmMs = performance.now() - llmStart;
        timers.citationMs = extractionResult.citationMs;

        usage.llmPromptTokens = extractionResult.usage.prompt_tokens ?? 0;
        usage.llmCompletionTokens = extractionResult.usage.completion_tokens ?? 0;

        extractedPayload = extractionResult.extracted;
      } else {
        const citationStart = performance.now();
        extractedPayload = createEverythingPayload(normalized.blocks);
        timers.citationMs = performance.now() - citationStart;
      }
    }

    const persistStart = performance.now();
    await repository.storeRunPayload(
      input.runId,
      {
        runId: input.runId,
        mdResults: markdown,
        layoutDetailsJson: JSON.stringify(layoutDetails),
        layoutVisualizationJson: JSON.stringify(layoutVisualization),
        extractedFieldsJson: JSON.stringify(
          extractedPayload ?? {
            values: {},
            fields: [],
          }
        ),
        rawProviderJson: JSON.stringify(rawProviderPayload ?? {}),
      },
      pageCount
    );
    timers.persistedMs = performance.now() - persistStart;

    const completedAt = new Date().toISOString();
    const totalMs = performance.now() - overallStart;

    const timing: TimingStats = {
      totalMs,
      ocrMs: timers.ocrMs,
      llmMs: timers.llmMs,
      citationMs: timers.citationMs,
      persistedMs: timers.persistedMs,
    };

    const stats = buildStats(pageCount, timing, usage);

    await repository.markRunCompleted(input.runId, completedAt, timing, stats);
  } catch (error) {
    const completedAt = new Date().toISOString();
    const totalMs = performance.now() - overallStart;

    const timing: TimingStats = {
      totalMs,
      ocrMs: timers.ocrMs,
      llmMs: timers.llmMs,
      citationMs: timers.citationMs,
      persistedMs: timers.persistedMs,
    };

    const message = error instanceof Error ? error.message : "Unknown run-processing error.";
    await repository.markRunFailed(input.runId, completedAt, timing, message);

    throw error;
  }
}

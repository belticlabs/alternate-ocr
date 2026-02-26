import { performance } from "node:perf_hooks";
import { getRepository } from "./persistence";
import { extractWithTemplate } from "./extraction";
import { callLayoutParsing } from "./zai";
import {
  ExtractedFieldsPayload,
  LayoutDetail,
  NormalizedBlock,
  RunMode,
  RunStats,
  TimingStats,
} from "@/lib/types";
import { safeJsonParse } from "@/lib/utils";

export interface RunProcessInput {
  runId: string;
  mode: RunMode;
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
    const ocrStart = performance.now();
    const ocrResponse = await callLayoutParsing(input.fileDataUrl);
    timers.ocrMs = performance.now() - ocrStart;

    const markdown = ocrResponse.md_results ?? "";
    const normalized = normalizeLayoutDetails(ocrResponse.layout_details);
    const pageCount = ocrResponse.data_info?.num_pages ?? normalized.pageCount;

    const usage = {
      ocrPromptTokens: ocrResponse.usage?.prompt_tokens ?? 0,
      ocrCompletionTokens: ocrResponse.usage?.completion_tokens ?? 0,
      llmPromptTokens: 0,
      llmCompletionTokens: 0,
    };

    let extractedPayload: ExtractedFieldsPayload | null = null;

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

    const persistStart = performance.now();
    await repository.storeRunPayload(
      input.runId,
      {
        runId: input.runId,
        mdResults: markdown,
        layoutDetailsJson: JSON.stringify(ocrResponse.layout_details ?? []),
        layoutVisualizationJson: JSON.stringify(ocrResponse.layout_visualization ?? []),
        extractedFieldsJson: JSON.stringify(
          extractedPayload ?? {
            values: {},
            fields: [],
          }
        ),
        rawProviderJson: JSON.stringify(ocrResponse),
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

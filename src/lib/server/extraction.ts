import { performance } from "node:perf_hooks";
import { z } from "zod";
import { ExtractedField, ExtractedFieldsPayload, NormalizedBlock } from "@/lib/types";
import { summarizeText } from "@/lib/utils";
import { resolveFieldCitations } from "./citations";
import { callChatCompletionJson } from "./zai";

const extractionResultSchema = z.object({
  values: z.record(z.string(), z.unknown()),
  citations: z
    .array(
      z.object({
        field_path: z.string(),
        source_block_ids: z.array(z.string()).optional().default([]),
      })
    )
    .default([]),
});

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
    return [{ fieldPath: pathPrefix, value }];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, nestedValue]) => {
    const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    return flattenObject(nestedValue, nextPath);
  });
}

function buildBlocksPrompt(blocks: NormalizedBlock[]): string {
  return blocks
    .map((block) => {
      const bbox = block.bbox2d.map((point) => point.toFixed(4)).join(",");
      const content = summarizeText(block.content || "", 500);

      return `- block_id: ${block.id}\n  page_index: ${block.pageIndex}\n  label: ${block.label}\n  bbox_2d: [${bbox}]\n  content: ${content}`;
    })
    .join("\n");
}

export async function extractWithTemplate(
  schema: Record<string, unknown>,
  extractionRules: string,
  markdown: string,
  blocks: NormalizedBlock[]
): Promise<{
  extracted: ExtractedFieldsPayload;
  usage: { prompt_tokens?: number; completion_tokens?: number };
  citationMs: number;
}> {
  const systemPrompt = `You convert OCR output into deterministic structured extraction.\nOutput valid JSON only.\nReturn this shape:\n{\n  "values": <object matching requested schema>,\n  "citations": [{"field_path":"dot.path", "source_block_ids":["page:index"]}]\n}\nRules:\n- Use source_block_ids that exist in provided blocks.\n- Prefer exact textual support for each value.\n- If value is missing, set null and citations [] for that field.`;

  const userPrompt = [
    "JSON schema:",
    JSON.stringify(schema, null, 2),
    "",
    "Extraction rules:",
    extractionRules || "(none)",
    "",
    "OCR markdown:",
    summarizeText(markdown, 18000),
    "",
    "OCR blocks:",
    buildBlocksPrompt(blocks),
  ].join("\n");

  const response = await callChatCompletionJson(systemPrompt, userPrompt);
  const parsed = extractionResultSchema.parse(response.json);

  const citationStart = performance.now();
  const blocksById = new Map<string, NormalizedBlock>(blocks.map((block) => [block.id, block]));
  const allCitations = resolveFieldCitations(parsed.citations, blocksById);

  const citationsByPath = new Map<string, typeof allCitations>();
  for (const citation of allCitations) {
    const existing = citationsByPath.get(citation.fieldPath) ?? [];
    existing.push(citation);
    citationsByPath.set(citation.fieldPath, existing);
  }

  const flattenedValues = flattenObject(parsed.values);
  const fields: ExtractedField[] = flattenedValues.map((entry) => ({
    fieldPath: entry.fieldPath,
    value: entry.value,
    citations: citationsByPath.get(entry.fieldPath) ?? [],
  }));
  const citationMs = performance.now() - citationStart;

  return {
    extracted: {
      values: parsed.values,
      fields,
    },
    usage: {
      prompt_tokens: response.usage.prompt_tokens,
      completion_tokens: response.usage.completion_tokens,
    },
    citationMs,
  };
}

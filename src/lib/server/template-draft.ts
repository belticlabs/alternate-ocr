import { z } from "zod";
import { LayoutDetail } from "@/lib/types";
import { summarizeText } from "@/lib/utils";
import { callChatCompletionJson, callLayoutParsing } from "./zai";
import { callMistralChatCompletionJson, callMistralOcr } from "./mistral";

const TEMPLATE_DRAFT_MAX_PAGES = 10;
const TEMPLATE_DRAFT_MAX_CHARS = 14000;

const schemaDraftSchema = z.object({
  type: z.literal("object"),
  properties: z.record(z.string(), z.unknown()),
  required: z.array(z.string()).default([]),
  additionalProperties: z.boolean().default(true),
});

const draftResultSchema = z.object({
  schema: schemaDraftSchema,
  name: z.string().optional(),
  description: z.string().optional(),
  extraction_rules: z.string().optional(),
});

export type TemplateDraftResult = {
  schema: Record<string, unknown>;
  name?: string;
  description?: string;
  extractionRules?: string;
};

export type TemplateDraftOcrProvider = "glm" | "mistral";
export type TemplateDraftLlmProvider = "glm" | "mistral";

function parseDraftResult(json: unknown): TemplateDraftResult {
  const parsed = draftResultSchema.parse(json);
  return {
    schema: parsed.schema as Record<string, unknown>,
    name: parsed.name,
    description: parsed.description,
    extractionRules: parsed.extraction_rules,
  };
}

const fullDraftSystemPrompt = `You design extraction templates for OCR/document processing.
Return a single JSON object with this exact shape (all fields required unless noted):
{
  "schema": {
    "type": "object",
    "properties": { ... },
    "required": [ ... ],
    "additionalProperties": true
  },
  "name": "Short template name, e.g. Car Rental Confirmation",
  "description": "One sentence describing what this template extracts and from what documents",
  "extraction_rules": "Brief rules for the extractor, e.g. prefer tax-inclusive totals, capture all line items"
}
Schema rules:
- Use snake_case property names.
- Add a "description" for each property.
- Use type: ["string", "null"] for optional scalar fields.
- For repeated rows (line items or table rows), use arrays of objects.
- Respect the user's goal exactly (if they ask "tables only", do not include non-table fields).
- Keep schema practical and extraction-friendly.`;

function layoutDetailsToMarkdown(layoutDetails: LayoutDetail[][], maxPages: number): {
  markdown: string;
  totalPages: number;
  usedPages: number;
} {
  const totalPages = layoutDetails.length;
  const selectedPages = layoutDetails.slice(0, maxPages);
  const markdown = selectedPages
    .map((blocks, pageIndex) => {
      const body = blocks
        .map((block) => {
          const content = (block.content ?? "").trim();
          if (!content) {
            return "";
          }
          if (block.label === "image") {
            return "[image block]";
          }
          if (block.label === "table") {
            return `Table:\n${summarizeText(content, 2000)}`;
          }
          return summarizeText(content, 2000);
        })
        .filter(Boolean)
        .join("\n\n");
      return `# Page ${pageIndex + 1}\n${body}`;
    })
    .join("\n\n");

  return {
    markdown,
    totalPages,
    usedPages: selectedPages.length,
  };
}

async function getSampleMarkdown(
  file: { dataUrl: string; filename: string; mimeType: string },
  ocrProvider: TemplateDraftOcrProvider
): Promise<{
  filename: string;
  markdown: string;
  totalPages: number;
  usedPages: number;
}> {
  if (ocrProvider === "mistral") {
    const ocr = await callMistralOcr({
      fileDataUrl: file.dataUrl,
      mimeType: file.mimeType,
    });
    const pages = ocr.pages ?? [];
    const selectedPages = pages.slice(0, TEMPLATE_DRAFT_MAX_PAGES);
    const markdown = selectedPages
      .map((page, pageIndex) => `# Page ${pageIndex + 1}\n${(page.markdown ?? "").trim()}`)
      .join("\n\n");

    return {
      filename: file.filename,
      markdown,
      totalPages: pages.length,
      usedPages: selectedPages.length,
    };
  }

  const ocr = await callLayoutParsing(file.dataUrl);
  if (ocr.layout_details?.length) {
    const fromLayout = layoutDetailsToMarkdown(ocr.layout_details, TEMPLATE_DRAFT_MAX_PAGES);
    return {
      filename: file.filename,
      markdown: fromLayout.markdown,
      totalPages: ocr.data_info?.num_pages ?? fromLayout.totalPages,
      usedPages: fromLayout.usedPages,
    };
  }

  const fallbackMarkdown = summarizeText(ocr.md_results ?? "", TEMPLATE_DRAFT_MAX_CHARS);
  const totalPages = ocr.data_info?.num_pages ?? (fallbackMarkdown ? 1 : 0);
  return {
    filename: file.filename,
    markdown: fallbackMarkdown,
    totalPages,
    usedPages: totalPages > 0 ? Math.min(totalPages, TEMPLATE_DRAFT_MAX_PAGES) : 0,
  };
}

async function callDraftLlm(
  systemPrompt: string,
  userPrompt: string,
  llmProvider: TemplateDraftLlmProvider
): Promise<{ json: unknown }> {
  if (llmProvider === "mistral") {
    const response = await callMistralChatCompletionJson(systemPrompt, userPrompt);
    return { json: response.json };
  }

  const response = await callChatCompletionJson(systemPrompt, userPrompt);
  return { json: response.json };
}

export async function draftTemplateSchemaFromSamples(
  files: Array<{ dataUrl: string; filename: string; mimeType: string }>,
  userExplanation: string,
  options?: {
    ocrProvider?: TemplateDraftOcrProvider;
    llmProvider?: TemplateDraftLlmProvider;
  }
): Promise<TemplateDraftResult> {
  if (files.length === 0) {
    throw new Error("At least one sample file is required.");
  }

  const ocrProvider = options?.ocrProvider ?? "mistral";
  const llmProvider = options?.llmProvider ?? "glm";

  const ocrResults = await Promise.all(
    files.map(async (file) => {
      return getSampleMarkdown(file, ocrProvider);
    })
  );

  const compiledDocs = ocrResults
    .map(
      (result) =>
        `## ${result.filename} (pages used: ${result.usedPages}/${result.totalPages || result.usedPages || 1})\n${summarizeText(result.markdown, TEMPLATE_DRAFT_MAX_CHARS)}`
    )
    .join("\n\n");

  const userPrompt = [
    "Goal:",
    userExplanation || "Create a template that extracts all important information from these documents. Propose schema, name, description, and extraction rules.",
    "",
    `OCR provider used: ${ocrProvider}`,
    `Schema LLM used: ${llmProvider}`,
    `Page limit policy: if a sample has more than ${TEMPLATE_DRAFT_MAX_PAGES} pages, only the first ${TEMPLATE_DRAFT_MAX_PAGES} are used for drafting.`,
    "",
    "Sample OCR markdown:",
    compiledDocs,
  ].join("\n");

  const response = await callDraftLlm(fullDraftSystemPrompt, userPrompt, llmProvider);
  return parseDraftResult(response.json);
}

/** Generate a draft template (schema + name, description, rules) from a natural-language description only. */
export async function draftTemplateSchemaFromDescription(
  userExplanation: string,
  options?: {
    llmProvider?: TemplateDraftLlmProvider;
  }
): Promise<TemplateDraftResult> {
  const trimmed = userExplanation?.trim() ?? "";
  if (!trimmed) {
    throw new Error("A description of what to extract is required.");
  }

  const llmProvider = options?.llmProvider ?? "glm";
  const userPrompt = `Design a document extraction template.\n\nGoal: ${trimmed}\n\nSchema LLM used: ${llmProvider}`;

  const response = await callDraftLlm(fullDraftSystemPrompt, userPrompt, llmProvider);
  return parseDraftResult(response.json);
}

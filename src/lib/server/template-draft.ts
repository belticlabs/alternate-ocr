import { z } from "zod";
import { summarizeText } from "@/lib/utils";
import { callChatCompletionJson, callLayoutParsing } from "./zai";

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
Schema rules: use snake_case for property names; add a "description" to each property; use type: ["string", "null"] for optional fields; keep fields practical (dates, amounts, names, identifiers, images, etc.).`;

export async function draftTemplateSchemaFromSamples(
  files: Array<{ dataUrl: string; filename: string }>,
  userExplanation: string
): Promise<TemplateDraftResult> {
  if (files.length === 0) {
    throw new Error("At least one sample file is required.");
  }

  const ocrResults = await Promise.all(
    files.map(async (file) => {
      const ocr = await callLayoutParsing(file.dataUrl);
      return {
        filename: file.filename,
        markdown: ocr.md_results ?? "",
      };
    })
  );

  const compiledDocs = ocrResults
    .map(
      (result) =>
        `## ${result.filename}\n${summarizeText(result.markdown, 12000)}`
    )
    .join("\n\n");

  const userPrompt = [
    "Goal:",
    userExplanation || "Create a template that extracts all important information from these documents. Propose schema, name, description, and extraction rules.",
    "",
    "Sample OCR markdown:",
    compiledDocs,
  ].join("\n");

  const response = await callChatCompletionJson(fullDraftSystemPrompt, userPrompt);
  return parseDraftResult(response.json);
}

/** Generate a draft template (schema + name, description, rules) from a natural-language description only. */
export async function draftTemplateSchemaFromDescription(
  userExplanation: string
): Promise<TemplateDraftResult> {
  const trimmed = userExplanation?.trim() ?? "";
  if (!trimmed) {
    throw new Error("A description of what to extract is required.");
  }

  const userPrompt = `Design a document extraction template.\n\nGoal: ${trimmed}`;

  const response = await callChatCompletionJson(fullDraftSystemPrompt, userPrompt);
  return parseDraftResult(response.json);
}

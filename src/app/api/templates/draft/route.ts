import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { bytesToMegabytes } from "@/lib/utils";
import {
  draftTemplateSchemaFromSamples,
  draftTemplateSchemaFromDescription,
} from "@/lib/server/template-draft";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";

const draftInputSchema = z.object({
  ocrProvider: z.enum(["glm", "mistral"]).default("mistral"),
  llmProvider: z.enum(["glm", "mistral"]).default("mistral"),
});

async function fileToDataUrl(
  file: File
): Promise<{ dataUrl: string; filename: string; mimeType: string; byteSize: number }> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";

  return {
    dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    filename: file.name || "sample",
    mimeType,
    byteSize: bytes.length,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const env = getEnv();
    const formData = await request.formData();
    const explanation = String(formData.get("explanation") ?? "").trim();
    const sampleEntries = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
    const { ocrProvider, llmProvider } = draftInputSchema.parse({
      ocrProvider: formData.get("ocrProvider") ?? undefined,
      llmProvider: formData.get("llmProvider") ?? undefined,
    });

    const hasExplanation = explanation.length > 0;
    const hasFiles = sampleEntries.length > 0;

    if (!hasExplanation && !hasFiles) {
      return jsonError("Describe what to extract, upload sample files, or both.", 400);
    }

    if (hasFiles) {
      const files = await Promise.all(sampleEntries.map((entry) => fileToDataUrl(entry)));
      const tooLarge = files.find((file) => bytesToMegabytes(file.byteSize) > env.MAX_UPLOAD_MB);
      if (tooLarge) {
        return jsonError(
          `Sample file "${tooLarge.filename}" exceeds MAX_UPLOAD_MB (${env.MAX_UPLOAD_MB}MB).`,
          400
        );
      }

      const goal = hasExplanation
        ? explanation
        : "Create a schema that captures all important structured information from these documents.";

      const draft = await draftTemplateSchemaFromSamples(
        files.map((file) => ({ dataUrl: file.dataUrl, filename: file.filename, mimeType: file.mimeType })),
        goal,
        {
          ocrProvider,
          llmProvider,
        }
      );

      return NextResponse.json({
        schema: draft.schema,
        name: draft.name ?? undefined,
        description: draft.description ?? undefined,
        extractionRules: draft.extractionRules ?? undefined,
      });
    }

    const draft = await draftTemplateSchemaFromDescription(explanation, { llmProvider });

    return NextResponse.json({
      schema: draft.schema,
      name: draft.name ?? undefined,
      description: draft.description ?? undefined,
      extractionRules: draft.extractionRules ?? undefined,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issuePath = error.issues[0]?.path?.[0];
      if (issuePath === "ocrProvider") {
        return jsonError("ocrProvider must be either glm or mistral.", 400);
      }
      if (issuePath === "llmProvider") {
        return jsonError("llmProvider must be either glm or mistral.", 400);
      }
    }
    const message = error instanceof Error ? error.message : "Failed to draft template schema.";
    return jsonError(message, 500);
  }
}

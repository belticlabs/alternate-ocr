import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { bytesToMegabytes } from "@/lib/utils";
import {
  draftTemplateSchemaFromDescription,
  draftTemplateSchemaFromSamples,
} from "@/lib/server/template-draft";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";

async function fileToDataUrl(file: File): Promise<{ dataUrl: string; filename: string; byteSize: number }> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";

  return {
    dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    filename: file.name || "sample",
    byteSize: bytes.length,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const env = getEnv();
    const formData = await request.formData();
    const explanation = String(formData.get("explanation") ?? "").trim();
    const sampleEntries = formData.getAll("files");

    if (sampleEntries.length === 0) {
      if (!explanation) {
        return jsonError("Describe what to extract, or attach sample files.", 400);
      }
      const draft = await draftTemplateSchemaFromDescription(explanation);
      return NextResponse.json({
        schema: draft.schema,
        name: draft.name ?? undefined,
        description: draft.description ?? undefined,
        extractionRules: draft.extractionRules ?? undefined,
      });
    }

    const files = await Promise.all(
      sampleEntries.map(async (entry) => {
        if (!(entry instanceof File)) {
          throw new Error("Invalid sample file payload.");
        }

        return fileToDataUrl(entry);
      })
    );

    const tooLarge = files.find((file) => bytesToMegabytes(file.byteSize) > env.MAX_UPLOAD_MB);
    if (tooLarge) {
      return jsonError(
        `Sample file "${tooLarge.filename}" exceeds MAX_UPLOAD_MB (${env.MAX_UPLOAD_MB}MB).`,
        400
      );
    }

    const draft = await draftTemplateSchemaFromSamples(
      files.map((file) => ({ dataUrl: file.dataUrl, filename: file.filename })),
      explanation || "Create a template that extracts all important information from these documents. Propose schema, name, description, and extraction rules."
    );

    return NextResponse.json({
      schema: draft.schema,
      name: draft.name ?? undefined,
      description: draft.description ?? undefined,
      extractionRules: draft.extractionRules ?? undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to draft template schema.";
    return jsonError(message, 500);
  }
}

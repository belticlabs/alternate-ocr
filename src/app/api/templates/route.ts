import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepository } from "@/lib/server/persistence";
import { serializeTemplate } from "@/lib/server/serializers";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";

const templateCreateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  schema: z.union([z.record(z.string(), z.unknown()), z.string()]),
  extractionRules: z.string().max(6000).default(""),
  isActive: z.boolean().default(true),
});

function normalizeSchemaJson(value: Record<string, unknown> | string): string {
  if (typeof value === "string") {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("schema must be a JSON object.");
    }
    return JSON.stringify(parsed);
  }

  return JSON.stringify(value);
}

export async function GET(): Promise<NextResponse> {
  try {
    const repository = getRepository();
    const templates = await repository.listTemplates();
    return NextResponse.json({
      templates: templates.map(serializeTemplate),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list templates.";
    return jsonError(message, 500);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const input = templateCreateSchema.parse(body);
    const repository = getRepository();

    const saved = await repository.upsertTemplate({
      id: input.id ?? randomUUID(),
      name: input.name,
      description: input.description,
      schemaJson: normalizeSchemaJson(input.schema),
      extractionRules: input.extractionRules,
      isActive: input.isActive,
    });

    return NextResponse.json(
      {
        template: serializeTemplate(saved),
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues[0]?.message ?? "Invalid template input.", 400);
    }

    const message = error instanceof Error ? error.message : "Failed to create template.";
    return jsonError(message, 500);
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepository } from "@/lib/server/persistence";
import { serializeTemplate } from "@/lib/server/serializers";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";

const templateUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  schema: z.union([z.record(z.string(), z.unknown()), z.string()]).optional(),
  extractionRules: z.string().max(6000).optional(),
  isActive: z.boolean().optional(),
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

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const repository = getRepository();
    const template = await repository.getTemplate(id);

    if (!template) {
      return jsonError("Template not found.", 404);
    }

    return NextResponse.json({
      template: serializeTemplate(template),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch template.";
    return jsonError(message, 500);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const repository = getRepository();
    const current = await repository.getTemplate(id);

    if (!current) {
      return jsonError("Template not found.", 404);
    }

    const body = await request.json();
    const input = templateUpdateSchema.parse(body);

    const saved = await repository.upsertTemplate({
      id: current.id,
      name: input.name ?? current.name,
      description: input.description ?? current.description,
      schemaJson: input.schema ? normalizeSchemaJson(input.schema) : current.schemaJson,
      extractionRules: input.extractionRules ?? current.extractionRules,
      isActive: input.isActive ?? current.isActive,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      template: serializeTemplate(saved),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues[0]?.message ?? "Invalid template update.", 400);
    }

    const message = error instanceof Error ? error.message : "Failed to update template.";
    return jsonError(message, 500);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const repository = getRepository();
    await repository.deactivateTemplate(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to deactivate template.";
    return jsonError(message, 500);
  }
}

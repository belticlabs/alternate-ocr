"use client";

import { RunDetailDto, RunDto, TemplateDto } from "@/lib/api-types";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const errorMessage =
      typeof payload.error === "string" ? payload.error : `Request failed (${response.status}).`;
    throw new Error(errorMessage);
  }

  return payload as T;
}

export async function listTemplatesApi(): Promise<TemplateDto[]> {
  const response = await fetch("/api/templates", { cache: "no-store" });
  const data = await parseJsonResponse<{ templates: TemplateDto[] }>(response);
  return data.templates;
}

export async function createTemplateApi(input: {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  extractionRules: string;
  isActive: boolean;
}): Promise<TemplateDto> {
  const response = await fetch("/api/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const data = await parseJsonResponse<{ template: TemplateDto }>(response);
  return data.template;
}

export async function updateTemplateApi(
  id: string,
  input: Partial<{
    name: string;
    description: string;
    schema: Record<string, unknown>;
    extractionRules: string;
    isActive: boolean;
  }>
): Promise<TemplateDto> {
  const response = await fetch(`/api/templates/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const data = await parseJsonResponse<{ template: TemplateDto }>(response);
  return data.template;
}

export async function deactivateTemplateApi(id: string): Promise<void> {
  const response = await fetch(`/api/templates/${id}`, {
    method: "DELETE",
  });

  await parseJsonResponse<{ ok: boolean }>(response);
}

export interface TemplateDraftResponse {
  schema: Record<string, unknown>;
  name?: string;
  description?: string;
  extractionRules?: string;
}

export async function draftTemplateSchemaApi(formData: FormData): Promise<TemplateDraftResponse> {
  const response = await fetch("/api/templates/draft", {
    method: "POST",
    body: formData,
  });

  return parseJsonResponse<TemplateDraftResponse>(response);
}

export async function startRunApi(formData: FormData): Promise<{
  runId: string;
  execution: "sync" | "async";
  run: RunDto | null;
}> {
  const response = await fetch("/api/runs", {
    method: "POST",
    body: formData,
  });

  return parseJsonResponse<{
    runId: string;
    execution: "sync" | "async";
    run: RunDto | null;
  }>(response);
}

export async function listRunsApi(): Promise<RunDto[]> {
  const response = await fetch("/api/runs", { cache: "no-store" });
  const data = await parseJsonResponse<{ runs: RunDto[] }>(response);
  return data.runs;
}

export async function fetchRunDetailApi(id: string): Promise<RunDetailDto> {
  const response = await fetch(`/api/runs/${id}`, { cache: "no-store" });
  const data = await parseJsonResponse<{ runDetail: RunDetailDto }>(response);
  return data.runDetail;
}

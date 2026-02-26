import { RunDetail, RunRecord, TemplateRecord, TimingStats } from "@/lib/types";
import { safeJsonParse } from "@/lib/utils";
import { RunDetailDto, RunDto, TemplateDto } from "@/lib/api-types";

const defaultTiming: TimingStats = {
  totalMs: 0,
  ocrMs: 0,
  llmMs: 0,
  citationMs: 0,
  persistedMs: 0,
};

export function serializeTemplate(template: TemplateRecord): TemplateDto {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    schema: safeJsonParse<Record<string, unknown>>(template.schemaJson, {}),
    schemaJson: template.schemaJson,
    extractionRules: template.extractionRules,
    isActive: template.isActive,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

export function serializeRun(run: RunRecord): RunDto {
  return {
    id: run.id,
    mode: run.mode,
    templateId: run.templateId,
    status: run.status,
    provider: run.provider,
    documentKey: run.documentKey,
    filename: run.filename,
    mimeType: run.mimeType,
    byteSize: run.byteSize,
    pageCount: run.pageCount,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    timing: safeJsonParse<TimingStats>(run.timingJson, defaultTiming),
    stats: safeJsonParse(run.statsJson, null),
  };
}

export function serializeRunDetail(detail: RunDetail): RunDetailDto {
  return {
    run: serializeRun(detail.run),
    payload: detail.payload
      ? {
          mdResults: detail.payload.mdResults,
          layoutDetails: safeJsonParse(detail.payload.layoutDetailsJson, []),
          layoutVisualization: safeJsonParse(detail.payload.layoutVisualizationJson, []),
          extractedFields: safeJsonParse(detail.payload.extractedFieldsJson, {
            values: {},
            fields: [],
          }),
          rawProvider: safeJsonParse(detail.payload.rawProviderJson, {}),
        }
      : null,
  };
}

import { ExtractedFieldsPayload, LayoutDetail, RunMode, RunStatus, TimingStats } from "@/lib/types";

export interface TemplateDto {
  id: string;
  name: string;
  description: string;
  schema: Record<string, unknown>;
  schemaJson: string;
  extractionRules: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RunDto {
  id: string;
  mode: RunMode;
  templateId: string;
  status: RunStatus;
  provider?: "glm" | "mistral";
  filename: string;
  mimeType: string;
  byteSize: number;
  pageCount: number;
  errorMessage: string;
  createdAt: string;
  startedAt: string;
  completedAt: string;
  timing: TimingStats;
  stats: {
    pageCount: number;
    totalSeconds: number;
    secondsPerPage: number;
    pagesPerSecond: number;
    usage: {
      ocrPromptTokens: number;
      ocrCompletionTokens: number;
      llmPromptTokens: number;
      llmCompletionTokens: number;
    };
  } | null;
}

export interface RunPayloadDto {
  mdResults: string;
  layoutDetails: LayoutDetail[][];
  layoutVisualization: string[];
  extractedFields: ExtractedFieldsPayload;
  rawProvider: unknown;
}

export interface RunDetailDto {
  run: RunDto;
  payload: RunPayloadDto | null;
}

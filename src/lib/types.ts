export type RunMode = "template" | "everything";
export type RunProvider = "glm" | "mistral";

export type RunStatus = "queued" | "processing" | "completed" | "failed";

export interface TemplateRecord {
  id: string;
  name: string;
  description: string;
  schemaJson: string;
  extractionRules: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  id: string;
  mode: RunMode;
  templateId: string;
  status: RunStatus;
  filename: string;
  mimeType: string;
  byteSize: number;
  pageCount: number;
  timingJson: string;
  statsJson: string;
  errorMessage: string;
  createdAt: string;
  startedAt: string;
  completedAt: string;
}

export interface RunPayloadRecord {
  runId: string;
  mdResults: string;
  layoutDetailsJson: string;
  layoutVisualizationJson: string;
  extractedFieldsJson: string;
  rawProviderJson: string;
}

export interface FieldCitation {
  fieldPath: string;
  pageIndex: number;
  blockId: string;
  blockIndex: number;
  bbox2d: [number, number, number, number];
  label: "image" | "text" | "formula" | "table";
}

export interface ExtractedField {
  fieldPath: string;
  value: unknown;
  citations: FieldCitation[];
}

export interface ExtractedFieldsPayload {
  values: Record<string, unknown>;
  fields: ExtractedField[];
}

export interface TimingStats {
  totalMs: number;
  ocrMs: number;
  llmMs: number;
  citationMs: number;
  persistedMs: number;
}

export interface RunStats {
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
}

export interface RunDetail {
  run: RunRecord;
  payload: RunPayloadRecord | null;
}

export interface LayoutDetail {
  index: number;
  label: "image" | "text" | "formula" | "table";
  bbox_2d?: [number, number, number, number];
  content?: string;
  height?: number;
  width?: number;
}

export interface NormalizedBlock {
  id: string;
  pageIndex: number;
  index: number;
  label: "image" | "text" | "formula" | "table";
  bbox2d: [number, number, number, number];
  content: string;
  pageWidth: number;
  pageHeight: number;
}

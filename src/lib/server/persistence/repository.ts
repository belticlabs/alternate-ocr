import {
  RunDetail,
  RunPayloadRecord,
  RunRecord,
  RunStats,
  RunStatus,
  TemplateRecord,
  TimingStats,
} from "@/lib/types";

export interface RunCreateInput {
  id: string;
  mode: "template" | "everything";
  templateId: string;
  status: RunStatus;
  filename: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
}

export interface PersistenceRepository {
  listTemplates(): Promise<TemplateRecord[]>;
  getTemplate(id: string): Promise<TemplateRecord | null>;
  upsertTemplate(template: Omit<TemplateRecord, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): Promise<TemplateRecord>;
  deactivateTemplate(id: string): Promise<void>;

  createRun(input: RunCreateInput): Promise<RunRecord>;
  markRunProcessing(id: string, startedAt: string): Promise<RunRecord>;
  storeRunPayload(id: string, payload: RunPayloadRecord, pageCount: number): Promise<void>;
  markRunCompleted(id: string, completedAt: string, timing: TimingStats, stats: RunStats): Promise<RunRecord>;
  markRunFailed(id: string, completedAt: string, timing: TimingStats, errorMessage: string): Promise<RunRecord>;

  listRuns(): Promise<RunRecord[]>;
  getRun(id: string): Promise<RunRecord | null>;
  getRunDetail(id: string): Promise<RunDetail | null>;
  deleteRun(id: string): Promise<void>;
}

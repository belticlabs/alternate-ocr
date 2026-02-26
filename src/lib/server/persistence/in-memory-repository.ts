import {
  RunDetail,
  RunPayloadRecord,
  RunRecord,
  RunStats,
  TemplateRecord,
  TimingStats,
} from "@/lib/types";
import { inferProviderFromRawPayload } from "./infer-provider";
import { PersistenceRepository, RunCreateInput } from "./repository";

type Store = {
  templates: Map<string, TemplateRecord>;
  runs: Map<string, RunRecord>;
  payloads: Map<string, RunPayloadRecord>;
};

function createStore(): Store {
  return {
    templates: new Map(),
    runs: new Map(),
    payloads: new Map(),
  };
}

declare global {
  var __glmOcrMemoryStore: Store | undefined;
}

const store = globalThis.__glmOcrMemoryStore ?? createStore();

if (!globalThis.__glmOcrMemoryStore) {
  globalThis.__glmOcrMemoryStore = store;
}

export class InMemoryRepository implements PersistenceRepository {
  async listTemplates(): Promise<TemplateRecord[]> {
    return Array.from(store.templates.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }

  async getTemplate(id: string): Promise<TemplateRecord | null> {
    return store.templates.get(id) ?? null;
  }

  async upsertTemplate(
    template: Omit<TemplateRecord, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }
  ): Promise<TemplateRecord> {
    const existing = store.templates.get(template.id);
    const now = new Date().toISOString();

    const next: TemplateRecord = {
      id: template.id,
      name: template.name,
      description: template.description,
      schemaJson: template.schemaJson,
      extractionRules: template.extractionRules,
      isActive: template.isActive,
      createdAt: existing?.createdAt ?? template.createdAt ?? now,
      updatedAt: template.updatedAt ?? now,
    };

    store.templates.set(next.id, next);
    return next;
  }

  async deactivateTemplate(id: string): Promise<void> {
    const existing = store.templates.get(id);
    if (!existing) {
      return;
    }

    store.templates.set(id, {
      ...existing,
      isActive: false,
      updatedAt: new Date().toISOString(),
    });
  }

  async createRun(input: RunCreateInput): Promise<RunRecord> {
    const run: RunRecord = {
      id: input.id,
      mode: input.mode,
      templateId: input.templateId,
      status: input.status,
      provider: input.provider,
      documentKey: input.documentKey,
      filename: input.filename,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      pageCount: 0,
      timingJson: "{}",
      statsJson: "{}",
      errorMessage: "",
      createdAt: input.createdAt,
      startedAt: "",
      completedAt: "",
    };

    store.runs.set(run.id, run);
    return run;
  }

  async markRunProcessing(id: string, startedAt: string): Promise<RunRecord> {
    const run = store.runs.get(id);
    if (!run) {
      throw new Error(`Run ${id} not found`);
    }

    const next: RunRecord = {
      ...run,
      status: "processing",
      startedAt,
    };

    store.runs.set(id, next);
    return next;
  }

  async storeRunPayload(id: string, payload: RunPayloadRecord, pageCount: number): Promise<void> {
    const run = store.runs.get(id);
    if (!run) {
      throw new Error(`Run ${id} not found`);
    }

    store.payloads.set(id, payload);
    store.runs.set(id, {
      ...run,
      pageCount,
    });
  }

  async markRunCompleted(id: string, completedAt: string, timing: TimingStats, stats: RunStats): Promise<RunRecord> {
    const run = store.runs.get(id);
    if (!run) {
      throw new Error(`Run ${id} not found`);
    }

    const next: RunRecord = {
      ...run,
      status: "completed",
      completedAt,
      timingJson: JSON.stringify(timing),
      statsJson: JSON.stringify(stats),
    };

    store.runs.set(id, next);
    return next;
  }

  async markRunFailed(
    id: string,
    completedAt: string,
    timing: TimingStats,
    errorMessage: string
  ): Promise<RunRecord> {
    const run = store.runs.get(id);
    if (!run) {
      throw new Error(`Run ${id} not found`);
    }

    const next: RunRecord = {
      ...run,
      status: "failed",
      completedAt,
      errorMessage,
      timingJson: JSON.stringify(timing),
    };

    store.runs.set(id, next);
    return next;
  }

  async listRuns(): Promise<RunRecord[]> {
    const runs = Array.from(store.runs.values());
    for (const run of runs) {
      if (run.provider == null) {
        const payload = store.payloads.get(run.id);
        if (payload?.rawProviderJson) {
          const inferred = inferProviderFromRawPayload(payload.rawProviderJson);
          if (inferred) run.provider = inferred;
        }
      }
    }
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getRun(id: string): Promise<RunRecord | null> {
    const run = store.runs.get(id) ?? null;
    if (run && run.provider == null) {
      const payload = store.payloads.get(id);
      if (payload?.rawProviderJson) {
        const inferred = inferProviderFromRawPayload(payload.rawProviderJson);
        if (inferred) run.provider = inferred;
      }
    }
    return run;
  }

  async getRunDetail(id: string): Promise<RunDetail | null> {
    const run = store.runs.get(id);
    if (!run) {
      return null;
    }

    const payload = store.payloads.get(id) ?? null;

    return {
      run,
      payload,
    };
  }

  async deleteRun(id: string): Promise<void> {
    store.runs.delete(id);
    store.payloads.delete(id);
  }
}

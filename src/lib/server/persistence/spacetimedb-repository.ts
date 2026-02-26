import { escapeSqlString } from "@/lib/utils";
import {
  RunDetail,
  RunPayloadRecord,
  RunRecord,
  RunStats,
  TemplateRecord,
  TimingStats,
} from "@/lib/types";
import { parseSqlRows } from "@/lib/server/spacetimedb/sats";
import { SpacetimeHttpClient } from "@/lib/server/spacetimedb/client";
import { inferProviderFromRawPayload } from "./infer-provider";
import { PersistenceRepository, RunCreateInput } from "./repository";

type TemplateRow = {
  id: string;
  name: string;
  description: string;
  schema_json: string;
  extraction_rules: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type RunRow = {
  id: string;
  mode: "template" | "everything";
  template_id: string;
  status: RunRecord["status"];
  provider?: string;
  document_key?: string | null;
  filename: string;
  mime_type: string;
  byte_size: number;
  page_count: number;
  timing_json: string;
  stats_json: string;
  error_message: string;
  created_at: string;
  started_at: string;
  completed_at: string;
};

type RunPayloadRow = {
  run_id: string;
  md_results: string;
  layout_details_json: string;
  layout_visualization_json: string;
  extracted_fields_json: string;
  raw_provider_json: string;
};

function toTemplateRecord(row: TemplateRow): TemplateRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    schemaJson: row.schema_json,
    extractionRules: row.extraction_rules,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRunRecord(row: RunRow): RunRecord {
  const provider = row.provider === "glm" || row.provider === "mistral" ? row.provider : undefined;
  return {
    id: row.id,
    mode: row.mode,
    templateId: row.template_id,
    status: row.status,
    provider,
    documentKey: typeof row.document_key === "string" && row.document_key.length > 0 ? row.document_key : undefined,
    filename: row.filename,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    pageCount: Number(row.page_count),
    timingJson: row.timing_json,
    statsJson: row.stats_json,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function toRunPayloadRecord(row: RunPayloadRow): RunPayloadRecord {
  return {
    runId: row.run_id,
    mdResults: row.md_results,
    layoutDetailsJson: row.layout_details_json,
    layoutVisualizationJson: row.layout_visualization_json,
    extractedFieldsJson: row.extracted_fields_json,
    rawProviderJson: row.raw_provider_json,
  };
}

export class SpacetimeRepository implements PersistenceRepository {
  private readonly client: SpacetimeHttpClient;

  constructor() {
    this.client = new SpacetimeHttpClient();
  }

  private async firstStatement<T extends Record<string, unknown>>(query: string): Promise<T[]> {
    const statements = await this.client.sql(query);
    const statement = statements[0];
    return parseSqlRows<T>(statement?.schema, statement?.rows);
  }

  async listTemplates(): Promise<TemplateRecord[]> {
    // Maincloud SQL currently supports only a subset; ORDER BY is not supported.
    const rows = await this.firstStatement<TemplateRow>("SELECT * FROM template;");
    return rows.map(toTemplateRecord).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getTemplate(id: string): Promise<TemplateRecord | null> {
    const rows = await this.firstStatement<TemplateRow>(
      `SELECT * FROM template WHERE id='${escapeSqlString(id)}';`
    );

    return rows[0] ? toTemplateRecord(rows[0]) : null;
  }

  async upsertTemplate(
    template: Omit<TemplateRecord, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }
  ): Promise<TemplateRecord> {
    await this.client.callReducer("template_upsert", [
      {
        id: template.id,
        name: template.name,
        description: template.description,
        schema_json: template.schemaJson,
        extraction_rules: template.extractionRules,
        is_active: template.isActive,
        created_at: template.createdAt ?? "",
        updated_at: template.updatedAt ?? "",
      },
    ]);

    const saved = await this.getTemplate(template.id);
    if (!saved) {
      throw new Error(`Template ${template.id} was not persisted`);
    }

    return saved;
  }

  async deactivateTemplate(id: string): Promise<void> {
    await this.client.callReducer("template_deactivate", [{ id }]);
  }

  async createRun(input: RunCreateInput): Promise<RunRecord> {
    await this.client.callReducer("run_create", [
      {
        id: input.id,
        mode: input.mode,
        template_id: input.templateId,
        status: input.status,
        provider: input.provider,
        document_key: input.documentKey ?? null,
        filename: input.filename,
        mime_type: input.mimeType,
        byte_size: input.byteSize,
        created_at: input.createdAt,
      },
    ]);

    const saved = await this.getRun(input.id);
    if (!saved) {
      throw new Error(`Run ${input.id} was not persisted`);
    }

    return saved;
  }

  async markRunProcessing(id: string, startedAt: string): Promise<RunRecord> {
    await this.client.callReducer("run_mark_processing", [
      {
        id,
        started_at: startedAt,
      },
    ]);

    const saved = await this.getRun(id);
    if (!saved) {
      throw new Error(`Run ${id} not found`);
    }

    return saved;
  }

  async storeRunPayload(id: string, payload: RunPayloadRecord, pageCount: number): Promise<void> {
    await this.client.callReducer("run_store_payload", [
      {
        id,
        md_results: payload.mdResults,
        layout_details_json: payload.layoutDetailsJson,
        layout_visualization_json: payload.layoutVisualizationJson,
        extracted_fields_json: payload.extractedFieldsJson,
        raw_provider_json: payload.rawProviderJson,
        page_count: pageCount,
      },
    ]);
  }

  async markRunCompleted(
    id: string,
    completedAt: string,
    timing: TimingStats,
    stats: RunStats
  ): Promise<RunRecord> {
    await this.client.callReducer("run_mark_completed", [
      {
        id,
        completed_at: completedAt,
        timing_json: JSON.stringify(timing),
        stats_json: JSON.stringify(stats),
      },
    ]);

    const saved = await this.getRun(id);
    if (!saved) {
      throw new Error(`Run ${id} not found`);
    }

    return saved;
  }

  async markRunFailed(
    id: string,
    completedAt: string,
    timing: TimingStats,
    errorMessage: string
  ): Promise<RunRecord> {
    await this.client.callReducer("run_mark_failed", [
      {
        id,
        completed_at: completedAt,
        timing_json: JSON.stringify(timing),
        error_message: errorMessage,
      },
    ]);

    const saved = await this.getRun(id);
    if (!saved) {
      throw new Error(`Run ${id} not found`);
    }

    return saved;
  }

  async listRuns(): Promise<RunRecord[]> {
    const [runRows, payloadRows] = await Promise.all([
      this.firstStatement<RunRow>("SELECT * FROM run;"),
      this.firstStatement<RunPayloadRow>("SELECT * FROM run_payload;"),
    ]);
    const payloadByRunId = new Map(
      payloadRows.map((row) => [row.run_id, toRunPayloadRecord(row)])
    );
    const runs = runRows.map((row) => {
      const run = toRunRecord(row);
      if (run.provider == null) {
        const payload = payloadByRunId.get(run.id);
        if (payload?.rawProviderJson) {
          const inferred = inferProviderFromRawPayload(payload.rawProviderJson);
          if (inferred) run.provider = inferred;
        }
      }
      return run;
    });
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getRun(id: string): Promise<RunRecord | null> {
    const rows = await this.firstStatement<RunRow>(
      `SELECT * FROM run WHERE id='${escapeSqlString(id)}';`
    );
    const run = rows[0] ? toRunRecord(rows[0]) : null;
    if (run && run.provider == null) {
      const payloadRows = await this.firstStatement<RunPayloadRow>(
        `SELECT * FROM run_payload WHERE run_id='${escapeSqlString(id)}';`
      );
      const payload = payloadRows[0] ? toRunPayloadRecord(payloadRows[0]) : null;
      if (payload?.rawProviderJson) {
        const inferred = inferProviderFromRawPayload(payload.rawProviderJson);
        if (inferred) run.provider = inferred;
      }
    }
    return run;
  }

  async getRunDetail(id: string): Promise<RunDetail | null> {
    const run = await this.getRun(id);
    if (!run) {
      return null;
    }

    const payloadRows = await this.firstStatement<RunPayloadRow>(
      `SELECT * FROM run_payload WHERE run_id='${escapeSqlString(id)}';`
    );

    return {
      run,
      payload: payloadRows[0] ? toRunPayloadRecord(payloadRows[0]) : null,
    };
  }

  async deleteRun(id: string): Promise<void> {
    await this.client.callReducer("run_delete", [{ id }]);
  }
}

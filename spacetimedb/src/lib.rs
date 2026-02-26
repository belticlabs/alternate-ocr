use spacetimedb::{reducer, table, ReducerContext, SpacetimeType, Table};

fn now_iso(ctx: &ReducerContext) -> String {
    ctx.timestamp.to_rfc3339().unwrap_or_else(|_| "".to_string())
}

#[table(accessor = template, public)]
pub struct Template {
    #[primary_key]
    pub id: String,
    pub name: String,
    pub description: String,
    pub schema_json: String,
    pub extraction_rules: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[table(accessor = run, public)]
pub struct Run {
    #[primary_key]
    pub id: String,
    pub mode: String,
    pub template_id: String,
    pub status: String,
    pub filename: String,
    pub mime_type: String,
    pub byte_size: u64,
    pub page_count: u32,
    pub timing_json: String,
    pub stats_json: String,
    pub error_message: String,
    pub created_at: String,
    pub started_at: String,
    pub completed_at: String,
    #[default(None::<String>)]
    pub provider: Option<String>,
    #[default(None::<String>)]
    pub document_key: Option<String>,
}

#[table(accessor = run_payload, public)]
pub struct RunPayload {
    #[primary_key]
    pub run_id: String,
    pub md_results: String,
    pub layout_details_json: String,
    pub layout_visualization_json: String,
    pub extracted_fields_json: String,
    pub raw_provider_json: String,
}

#[derive(SpacetimeType, Clone)]
pub struct TemplateUpsertArgs {
    pub id: String,
    pub name: String,
    pub description: String,
    pub schema_json: String,
    pub extraction_rules: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(SpacetimeType, Clone)]
pub struct TemplateDeactivateArgs {
    pub id: String,
}

#[derive(SpacetimeType, Clone)]
pub struct RunCreateArgs {
    pub id: String,
    pub mode: String,
    pub template_id: String,
    pub status: String,
    pub provider: String,
    pub document_key: Option<String>,
    pub filename: String,
    pub mime_type: String,
    pub byte_size: u64,
    pub created_at: String,
}

#[derive(SpacetimeType, Clone)]
pub struct RunMarkProcessingArgs {
    pub id: String,
    pub started_at: String,
}

#[derive(SpacetimeType, Clone)]
pub struct RunStorePayloadArgs {
    pub id: String,
    pub md_results: String,
    pub layout_details_json: String,
    pub layout_visualization_json: String,
    pub extracted_fields_json: String,
    pub raw_provider_json: String,
    pub page_count: u32,
}

#[derive(SpacetimeType, Clone)]
pub struct RunMarkCompletedArgs {
    pub id: String,
    pub completed_at: String,
    pub timing_json: String,
    pub stats_json: String,
}

#[derive(SpacetimeType, Clone)]
pub struct RunMarkFailedArgs {
    pub id: String,
    pub completed_at: String,
    pub timing_json: String,
    pub error_message: String,
}

#[derive(SpacetimeType, Clone)]
pub struct RunDeleteArgs {
    pub id: String,
}

#[reducer(init)]
pub fn init(_ctx: &ReducerContext) {}

#[reducer(client_connected)]
pub fn on_connect(_ctx: &ReducerContext) {}

#[reducer(client_disconnected)]
pub fn on_disconnect(_ctx: &ReducerContext) {}

#[reducer]
pub fn template_upsert(ctx: &ReducerContext, input: TemplateUpsertArgs) {
    let now = now_iso(ctx);

    let existing = ctx.db.template().id().find(&input.id);
    let created_at = if !input.created_at.is_empty() {
        input.created_at.clone()
    } else if let Some(row) = &existing {
        row.created_at.clone()
    } else {
        now.clone()
    };
    let updated_at = if !input.updated_at.is_empty() {
        input.updated_at.clone()
    } else {
        now.clone()
    };

    let row = Template {
        id: input.id,
        name: input.name,
        description: input.description,
        schema_json: input.schema_json,
        extraction_rules: input.extraction_rules,
        is_active: input.is_active,
        created_at,
        updated_at,
    };

    if existing.is_some() {
        ctx.db.template().id().update(row);
    } else {
        ctx.db.template().insert(row);
    }
}

#[reducer]
pub fn template_deactivate(ctx: &ReducerContext, input: TemplateDeactivateArgs) {
    if let Some(row) = ctx.db.template().id().find(&input.id) {
        ctx.db.template().id().update(Template {
            is_active: false,
            updated_at: now_iso(ctx),
            ..row
        });
    }
}

#[reducer]
pub fn run_create(ctx: &ReducerContext, input: RunCreateArgs) {
    let now = now_iso(ctx);

    let created_at = if !input.created_at.is_empty() {
        input.created_at
    } else {
        now.clone()
    };

    let row = Run {
        id: input.id,
        mode: input.mode,
        template_id: input.template_id,
        status: input.status,
        filename: input.filename,
        mime_type: input.mime_type,
        byte_size: input.byte_size,
        page_count: 0,
        timing_json: "{}".to_string(),
        stats_json: "{}".to_string(),
        error_message: "".to_string(),
        created_at,
        started_at: "".to_string(),
        completed_at: "".to_string(),
        provider: Some(input.provider),
        document_key: input.document_key,
    };

    let existing = ctx.db.run().id().find(&row.id);
    if existing.is_some() {
        ctx.db.run().id().update(row);
    } else {
        ctx.db.run().insert(row);
    }
}

#[reducer]
pub fn run_mark_processing(ctx: &ReducerContext, input: RunMarkProcessingArgs) {
    if let Some(row) = ctx.db.run().id().find(&input.id) {
        ctx.db.run().id().update(Run {
            status: "processing".to_string(),
            started_at: input.started_at,
            ..row
        });
    }
}

#[reducer]
pub fn run_store_payload(ctx: &ReducerContext, input: RunStorePayloadArgs) {
    if let Some(row) = ctx.db.run().id().find(&input.id) {
        ctx.db.run().id().update(Run {
            page_count: input.page_count,
            ..row
        });
    }

    let payload = RunPayload {
        run_id: input.id,
        md_results: input.md_results,
        layout_details_json: input.layout_details_json,
        layout_visualization_json: input.layout_visualization_json,
        extracted_fields_json: input.extracted_fields_json,
        raw_provider_json: input.raw_provider_json,
    };

    let existing = ctx.db.run_payload().run_id().find(&payload.run_id);
    if existing.is_some() {
        ctx.db.run_payload().run_id().update(payload);
    } else {
        ctx.db.run_payload().insert(payload);
    }
}

#[reducer]
pub fn run_mark_completed(ctx: &ReducerContext, input: RunMarkCompletedArgs) {
    if let Some(row) = ctx.db.run().id().find(&input.id) {
        ctx.db.run().id().update(Run {
            status: "completed".to_string(),
            completed_at: input.completed_at,
            timing_json: input.timing_json,
            stats_json: input.stats_json,
            ..row
        });
    }
}

#[reducer]
pub fn run_mark_failed(ctx: &ReducerContext, input: RunMarkFailedArgs) {
    if let Some(row) = ctx.db.run().id().find(&input.id) {
        ctx.db.run().id().update(Run {
            status: "failed".to_string(),
            completed_at: input.completed_at,
            timing_json: input.timing_json,
            error_message: input.error_message,
            ..row
        });
    }
}

#[reducer]
pub fn run_delete(ctx: &ReducerContext, input: RunDeleteArgs) {
    ctx.db.run_payload().run_id().delete(&input.id);
    ctx.db.run().id().delete(&input.id);
}

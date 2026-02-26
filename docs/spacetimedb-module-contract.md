# SpaceTimeDB Contract

This app can run fully in-memory, but when `SPACETIMEDB_*` env vars are set it expects a deployed SpaceTimeDB module with:

## Tables

### `template`
- `id` (string, primary key)
- `name` (string)
- `description` (string)
- `schema_json` (string)
- `extraction_rules` (string)
- `is_active` (bool)
- `created_at` (string ISO timestamp)
- `updated_at` (string ISO timestamp)

### `run`
- `id` (string, primary key)
- `mode` (`template` | `everything`)
- `template_id` (string)
- `status` (`queued` | `processing` | `completed` | `failed`)
- `filename` (string)
- `mime_type` (string)
- `byte_size` (u64/i64)
- `page_count` (u32/i32)
- `timing_json` (string)
- `stats_json` (string)
- `error_message` (string)
- `created_at` (string ISO timestamp)
- `started_at` (string ISO timestamp)
- `completed_at` (string ISO timestamp)

### `run_payload`
- `run_id` (string, primary key / unique key referencing `run.id`)
- `md_results` (string)
- `layout_details_json` (string)
- `layout_visualization_json` (string)
- `extracted_fields_json` (string)
- `raw_provider_json` (string)

## Reducers / procedures

The app calls these endpoints via:

`POST /v1/database/:db/call/:reducer`

Expected reducer names and argument payloads:

- `template_upsert([template_record])`
- `template_deactivate([{ id }])`
- `run_create([run_record])`
- `run_mark_processing([{ id, started_at }])`
- `run_store_payload([{ id, md_results, layout_details_json, layout_visualization_json, extracted_fields_json, raw_provider_json, page_count }])`
- `run_mark_completed([{ id, completed_at, timing_json, stats_json }])`
- `run_mark_failed([{ id, completed_at, timing_json, error_message }])`

Each reducer call receives a JSON array body, per SpaceTimeDB HTTP API conventions.

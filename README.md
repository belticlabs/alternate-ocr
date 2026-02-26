# OCR Console

In-house OCR console built with Next.js, with provider switching in Evaluate (`GLM` or `Mistral`):

- Upload PDF/images and run extraction in:
- `template` mode (exact schema fields + citations)
- `everything` mode (all layout blocks + citations)
- Draft templates from sample docs using selectable OCR (`Mistral`/`GLM`) and schema LLM (`Mistral`/`GLM`).
- Hover extracted fields to view source coordinates.
- View OCR markdown, table/image blocks, and subtle timing stats.
- Persist templates/runs to SpaceTimeDB (or fall back to in-memory store).

## Getting Started

1. Install dependencies:

```bash
pnpm install
```

2. Configure environment:

```bash
cp .env.example .env.local
```

3. Add your API key(s) in `.env.local`:
- `ZAI_API_KEY=...`
- `MISTRAL_API_KEY=...` (required only when using Mistral provider)

4. Run the app:

```bash
pnpm dev
```

Open `http://localhost:3000`.

## SpaceTimeDB Persistence

Set these vars to enable DB-backed history:

- `SPACETIMEDB_BASE_URL`
- `SPACETIMEDB_DATABASE`
- `SPACETIMEDB_TOKEN`

When unset, the app uses an in-memory repository.

Module/table/reducer contract expected by this app:

`docs/spacetimedb-module-contract.md`

To deploy or update the module (CLI is **spacetime**, not spacetimedb):

```bash
cd spacetimedb && spacetime publish -s maincloud -y $SPACETIMEDB_DATABASE
```

Install the CLI from [spacetimedb.com/docs](https://spacetimedb.com/docs); use `spacetime login` once before first publish.

## API Routes

- `GET/POST /api/templates`
- `GET/PATCH/DELETE /api/templates/:id`
- `POST /api/templates/draft`
- `GET/POST /api/runs`
- `GET /api/runs/:id`

## Notes

- GLM OCR endpoint used: `POST /paas/v4/layout_parsing`
- GLM structured extraction endpoint used: `POST /paas/v4/chat/completions` with JSON mode
- Mistral OCR endpoint used: `POST /v1/ocr`
- Mistral chat endpoint used (template drafting): `POST /v1/chat/completions`
- Upload limits are configurable in `.env.local` (`MAX_UPLOAD_MB`, `PROCESS_SYNC_MAX_FILE_MB`)
- To show only schema-based highlights on the document (no OCR-drawn layout boxes), set `NEED_LAYOUT_VISUALIZATION=false` in `.env.local`. The API is then called with `need_layout_visualization: false`; if it returns clean page images, only the app’s citation overlays (for extracted fields) will appear.

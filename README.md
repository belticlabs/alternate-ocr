# GLM OCR Console

In-house OCR console built with Next.js + GLM OCR:

- Upload PDF/images and run extraction in:
- `template` mode (exact schema fields + citations)
- `everything` mode (all layout blocks + citations)
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

3. Add your Z.AI key in `.env.local`:
- `ZAI_API_KEY=...`

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

## API Routes

- `GET/POST /api/templates`
- `GET/PATCH/DELETE /api/templates/:id`
- `POST /api/templates/draft`
- `GET/POST /api/runs`
- `GET /api/runs/:id`

## Notes

- GLM OCR endpoint used: `POST /paas/v4/layout_parsing`
- Structured extraction endpoint used: `POST /paas/v4/chat/completions` with JSON mode
- Upload limits are configurable in `.env.local` (`MAX_UPLOAD_MB`, `PROCESS_SYNC_MAX_FILE_MB`)
- To show only schema-based highlights on the document (no OCR-drawn layout boxes), set `NEED_LAYOUT_VISUALIZATION=false` in `.env.local`. The API is then called with `need_layout_visualization: false`; if it returns clean page images, only the app’s citation overlays (for extracted fields) will appear.

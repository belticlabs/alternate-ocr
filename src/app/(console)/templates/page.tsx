"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { PageHeader } from "@/components/console/page-header";
import { TemplateDto } from "@/lib/api-types";
import {
  createTemplateApi,
  deactivateTemplateApi,
  draftTemplateSchemaApi,
  listTemplatesApi,
  updateTemplateApi,
} from "@/lib/client/api";

function getDefaultSchemaText(): string {
  return JSON.stringify(
    {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: true,
    },
    null,
    2
  );
}

export default function TemplatesPage(): React.JSX.Element {
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [extractionRules, setExtractionRules] = useState("");
  const [schemaText, setSchemaText] = useState(getDefaultSchemaText);
  const [draftFiles, setDraftFiles] = useState<File[]>([]);
  const [draftGoal, setDraftGoal] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? null,
    [templates, selectedId]
  );

  async function refreshTemplates(nextSelectedId?: string): Promise<void> {
    const list = await listTemplatesApi();
    setTemplates(list);

    const candidate = nextSelectedId ?? selectedId ?? list[0]?.id ?? "";
    const exists = list.some((template) => template.id === candidate);
    const finalSelectedId = exists ? candidate : list[0]?.id ?? "";
    setSelectedId(finalSelectedId);
  }

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const list = await listTemplatesApi();
        if (!mounted) {
          return;
        }

        setTemplates(list);
        setSelectedId(list[0]?.id ?? "");
      } catch (error) {
        if (mounted) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to load templates.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedTemplate) {
      setName("");
      setDescription("");
      setExtractionRules("");
      setSchemaText(getDefaultSchemaText());
      return;
    }

    setName(selectedTemplate.name);
    setDescription(selectedTemplate.description);
    setExtractionRules(selectedTemplate.extractionRules);
    setSchemaText(JSON.stringify(selectedTemplate.schema, null, 2));
  }, [selectedTemplate]);

  async function handleSave(): Promise<void> {
    setErrorMessage("");
    setStatusMessage("");
    setIsSaving(true);

    try {
      const schema = JSON.parse(schemaText) as unknown;
      if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        throw new Error("Schema must be a JSON object.");
      }

      if (!name.trim()) {
        throw new Error("Template name is required.");
      }

      if (selectedTemplate) {
        await updateTemplateApi(selectedTemplate.id, {
          name: name.trim(),
          description: description.trim(),
          extractionRules: extractionRules.trim(),
          schema: schema as Record<string, unknown>,
        });
        await refreshTemplates(selectedTemplate.id);
        setStatusMessage("Template updated.");
      } else {
        const created = await createTemplateApi({
          name: name.trim(),
          description: description.trim(),
          extractionRules: extractionRules.trim(),
          schema: schema as Record<string, unknown>,
          isActive: true,
        });
        await refreshTemplates(created.id);
        setStatusMessage("Template created.");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save template.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDraftSchema(): Promise<void> {
    const hasFiles = draftFiles.length > 0;
    const hasGoal = draftGoal.trim().length > 0;
    if (!hasFiles && !hasGoal) {
      setErrorMessage("Describe what to extract, or upload a document (or both).");
      return;
    }

    setErrorMessage("");
    setStatusMessage("");
    setIsDrafting(true);

    try {
      const formData = new FormData();
      formData.append("explanation", hasGoal ? draftGoal.trim() : "");
      draftFiles.forEach((file) => formData.append("files", file));
      const draft = await draftTemplateSchemaApi(formData);
      setSchemaText(JSON.stringify(draft.schema, null, 2));
      if (draft.name?.trim()) setName(draft.name.trim());
      if (draft.description?.trim()) setDescription(draft.description.trim());
      if (draft.extractionRules?.trim()) setExtractionRules(draft.extractionRules.trim());
      setStatusMessage(
        hasFiles && hasGoal
          ? "Template draft generated from your document and description."
          : hasFiles
            ? "Template draft generated from your document (all important info). Edit below and save."
            : "Template draft generated. Edit any field and save when ready."
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to draft schema.");
    } finally {
      setIsDrafting(false);
    }
  }

  async function handleDeactivate(): Promise<void> {
    if (!selectedTemplate) {
      return;
    }

    setErrorMessage("");
    setStatusMessage("");

    try {
      await deactivateTemplateApi(selectedTemplate.id);
      await refreshTemplates();
      setStatusMessage("Template deactivated.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to deactivate template.");
    }
  }

  function startNewTemplate(): void {
    setSelectedId("");
    setName("");
    setDescription("");
    setExtractionRules("");
    setSchemaText(getDefaultSchemaText());
    setStatusMessage("");
    setErrorMessage("");
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title="Templates"
        description="Define extraction fields and rules. Describe what to extract and generate a schema, then edit and save."
        rightSlot={
          <button
            type="button"
            onClick={startNewTemplate}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] hover:border-[var(--accent)]/30"
          >
            <Plus className="size-4" />
            New Template
          </button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <aside className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Saved Templates
          </p>
          <div className="space-y-2">
            {loading ? (
              <div className="rounded-lg border border-[var(--border)] px-3 py-5 text-sm text-[var(--text-muted)]">
                Loading...
              </div>
            ) : null}
            {!loading && templates.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-5 text-sm text-[var(--text-muted)]">
                No templates yet.
              </div>
            ) : null}
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => setSelectedId(template.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  template.id === selectedId
                    ? "border-[var(--accent)]/35 bg-[var(--accent)]/10"
                    : "border-[var(--border)] hover:border-[var(--accent)]/20"
                }`}
              >
                <p className="text-sm font-medium text-[var(--text-strong)]">{template.name}</p>
                <p className="line-clamp-2 text-xs text-[var(--text-muted)]">{template.description || "No description"}</p>
              </button>
            ))}
          </div>
        </aside>

        <article className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Invoice core fields"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--text)]"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                Description
              </span>
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Invoice totals and due date"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--text)]"
              />
            </label>
          </div>

          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Extraction Rules
            </span>
            <textarea
              value={extractionRules}
              onChange={(event) => setExtractionRules(event.target.value)}
              rows={4}
              placeholder="Example: For totals, prefer tax-inclusive grand total."
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--text)]"
            />
          </label>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="size-4 text-[var(--accent)]" />
              <p className="text-sm font-medium text-[var(--text-strong)]">Generate template from document or description</p>
            </div>
            <p className="mb-3 text-xs text-[var(--text-muted)]">
              Upload a PDF or image to get a template that extracts all important info (we use document-aware processing). Or describe what to extract, or both.
            </p>
            <div className="mb-3">
              <span className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Upload document</span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp,image/heic,image/heif"
                onChange={(event) => setDraftFiles(Array.from(event.target.files ?? []))}
                className="sr-only"
                aria-label="Choose PDF or image files"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const files = Array.from(e.dataTransfer.files).filter(
                    (f) =>
                      f.type === "application/pdf" ||
                      /^image\/(png|jpeg|jpg|webp|heic|heif)$/i.test(f.type)
                  );
                  if (files.length) setDraftFiles(files);
                }}
                className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-6 text-[var(--text-muted)] transition-colors ${
                  dragOver
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]/40 hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"
                }`}
              >
                <Upload className="size-8" />
                <span className="text-sm font-medium">
                  {draftFiles.length > 0
                    ? `${draftFiles.length} file${draftFiles.length === 1 ? "" : "s"} selected — click to change`
                    : "Drop a PDF or image here, or click to choose"}
                </span>
                <span className="text-[11px]">Leave instruction blank to extract all important info</span>
              </button>
            </div>
            <div className="mb-3">
              <span className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Instruction (optional if document uploaded)</span>
              <textarea
                value={draftGoal}
                onChange={(event) => setDraftGoal(event.target.value)}
                rows={2}
                placeholder="e.g. Create a template that extracts all important info from this document"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleDraftSchema()}
              disabled={isDrafting || (!draftGoal.trim() && draftFiles.length === 0)}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)]/10 px-3 py-2 text-sm font-medium text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/15 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDrafting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {isDrafting ? "Generating…" : "Generate Schema"}
            </button>
          </div>

          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">JSON Schema</span>
            <textarea
              value={schemaText}
              onChange={(event) => setSchemaText(event.target.value)}
              rows={14}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 font-mono text-xs text-[var(--text)]"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-strong)] disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
              {selectedTemplate ? "Update Template" : "Create Template"}
            </button>
            {selectedTemplate ? (
              <button
                type="button"
                onClick={() => void handleDeactivate()}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--danger)] hover:border-[var(--danger)]/40"
              >
                <Trash2 className="size-4" />
                Deactivate
              </button>
            ) : null}
          </div>

          {statusMessage ? <p className="text-sm text-[var(--success)]">{statusMessage}</p> : null}
          {errorMessage ? <p className="text-sm text-[var(--danger)]">{errorMessage}</p> : null}
        </article>
      </div>
    </section>
  );
}

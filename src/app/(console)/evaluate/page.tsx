"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, UploadCloud } from "lucide-react";
import { PageHeader } from "@/components/console/page-header";
import { RunResultsPanel } from "@/components/results/run-results-panel";
import { RunDetailDto, TemplateDto } from "@/lib/api-types";
import { fetchRunDetailApi, listTemplatesApi, startRunApi } from "@/lib/client/api";

type RunMode = "template" | "everything";
type RunProvider = "glm" | "mistral";

export default function EvaluatePage(): React.JSX.Element {
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [provider, setProvider] = useState<RunProvider>("glm");
  const [mode, setMode] = useState<RunMode>("template");
  const [templateId, setTemplateId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState("");
  const [runDetail, setRunDetail] = useState<RunDetailDto | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [filePickerKey, setFilePickerKey] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function loadTemplates() {
      try {
        const list = await listTemplatesApi();
        if (!mounted) {
          return;
        }

        setTemplates(list.filter((template) => template.isActive));
        setTemplateId((previous) => previous || list[0]?.id || "");
        if (list.length === 0) {
          setMode("everything");
        }
      } catch (error) {
        if (!mounted) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : "Failed to load templates.");
      } finally {
        if (mounted) {
          setTemplatesLoading(false);
        }
      }
    }

    void loadTemplates();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!activeRunId) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    async function poll() {
      try {
        const detail = await fetchRunDetailApi(activeRunId);
        if (cancelled) {
          return;
        }

        setRunDetail(detail);
        const status = detail.run.status;
        const shouldContinue = status === "queued" || status === "processing";
        setIsPolling(shouldContinue);

        if (shouldContinue) {
          timer = setTimeout(() => {
            void poll();
          }, 1300);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        setIsPolling(false);
        setErrorMessage(error instanceof Error ? error.message : "Failed to fetch run.");
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [activeRunId]);

  useEffect(() => {
    return () => {
      if (filePreviewUrl) {
        URL.revokeObjectURL(filePreviewUrl);
      }
    };
  }, [filePreviewUrl]);

  const canSubmit = useMemo(() => {
    if (!selectedFile) {
      return false;
    }

    if (mode === "template") {
      return Boolean(templateId);
    }

    return true;
  }, [mode, selectedFile, templateId]);

  async function handleStartRun(): Promise<void> {
    if (!selectedFile) {
      return;
    }

    setErrorMessage("");
    setIsStarting(true);
    setRunDetail(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("provider", provider);
      formData.append("mode", mode);
      formData.append("templateId", mode === "template" ? templateId : "");

      const response = await startRunApi(formData);
      setActiveRunId(response.runId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to start extraction.");
    } finally {
      setIsStarting(false);
    }
  }

  function handleNewEvaluation(): void {
    setErrorMessage("");
    setIsStarting(false);
    setIsPolling(false);
    setRunDetail(null);
    setActiveRunId("");
    setSelectedFile(null);
    setFilePickerKey((v) => v + 1);
    setFilePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title="Evaluate"
        description="Upload a document, run OCR with GLM or Mistral, and inspect extraction output."
        rightSlot={
          runDetail ? (
            <button
              type="button"
              onClick={handleNewEvaluation}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)]/25 hover:bg-[var(--surface-raised)]"
            >
              New evaluation
            </button>
          ) : null
        }
      />

      {runDetail ? (
        <RunResultsPanel
          runDetail={runDetail}
          filePreviewUrl={filePreviewUrl}
          fileMimeType={selectedFile?.type ?? null}
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
          <article className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div>
              <p className="text-sm font-semibold text-[var(--text-strong)]">Run Setup</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Template mode extracts specific schema fields. Everything mode returns all detected content blocks.
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                Provider
              </label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: "glm", label: "GLM" },
                  { value: "mistral", label: "Mistral" },
                ] as const).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setProvider(option.value)}
                    className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                      provider === option.value
                        ? "border-[var(--accent)]/35 bg-[var(--accent)]/10 text-[var(--text-strong)]"
                        : "border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]/20"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["template", "everything"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setMode(option)}
                    className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                      mode === option
                        ? "border-[var(--accent)]/35 bg-[var(--accent)]/10 text-[var(--text-strong)]"
                        : "border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]/20"
                    }`}
                  >
                    {option === "template" ? "Template" : "Everything"}
                  </button>
                ))}
              </div>
            </div>

            {mode === "template" ? (
              <div className="space-y-2">
                <label
                  htmlFor="template"
                  className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"
                >
                  Template
                </label>
                <select
                  id="template"
                  value={templateId}
                  onChange={(event) => setTemplateId(event.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--text)]"
                >
                  {templatesLoading ? <option>Loading templates...</option> : null}
                  {!templatesLoading && templates.length === 0 ? <option value="">No templates yet</option> : null}
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                File
              </label>
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-raised)] px-4 py-8 text-center hover:border-[var(--accent)]/30">
                <UploadCloud className="size-5 text-[var(--accent)]" />
                <span className="text-sm text-[var(--text)]">
                  {selectedFile ? selectedFile.name : "Choose PDF / image file"}
                </span>
                <span className="text-xs text-[var(--text-muted)]">PDF, PNG, JPG, WEBP, HEIC</span>
                <input
                  key={filePickerKey}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp,image/heic,image/heif"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setSelectedFile(file);
                    setFilePreviewUrl((prev) => {
                      if (prev) URL.revokeObjectURL(prev);
                      return file ? URL.createObjectURL(file) : null;
                    });
                  }}
                />
              </label>
            </div>

            <button
              type="button"
              disabled={!canSubmit || isStarting}
              onClick={() => void handleStartRun()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isStarting ? <Loader2 className="size-4 animate-spin" /> : null}
              {isStarting ? "Starting…" : "Run Extraction"}
            </button>

            {isPolling ? (
              <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <Loader2 className="size-3 animate-spin" />
                Processing…
              </p>
            ) : null}
            {errorMessage ? <p className="text-sm text-[var(--danger)]">{errorMessage}</p> : null}
          </article>

          <RunResultsPanel
            runDetail={runDetail}
            filePreviewUrl={filePreviewUrl}
            fileMimeType={selectedFile?.type ?? null}
          />
        </div>
      )}
    </section>
  );
}

"use client";

import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/console/page-header";
import { RunResultsPanel } from "@/components/results/run-results-panel";
import { RunDetailDto } from "@/lib/api-types";
import { deleteRunApi, fetchRunDetailApi } from "@/lib/client/api";

export default function RunDetailPage(): React.JSX.Element {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const runId = params.id;
  const [runDetail, setRunDetail] = useState<RunDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [deleting, setDeleting] = useState(false);
  const filePreviewUrl = runId && runDetail?.run.documentKey ? `/api/runs/${runId}/document` : null;
  const fileMimeType = runDetail?.run.mimeType ?? null;

  useEffect(() => {
    if (!runId) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    async function load(poll = true): Promise<void> {
      try {
        const detail = await fetchRunDetailApi(runId);
        if (cancelled) {
          return;
        }

        setRunDetail(detail);
        setErrorMessage("");

        const status = detail.run.status;
        if (poll && (status === "queued" || status === "processing")) {
          timer = setTimeout(() => {
            void load(true);
          }, 1200);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to load run.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load(true);

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [runId]);

  async function handleDelete(): Promise<void> {
    if (!runId || !runDetail) return;
    if (!confirm(`Delete this run "${runDetail.run.filename}"?`)) return;
    setDeleting(true);
    setErrorMessage("");
    try {
      await deleteRunApi(runId);
      router.push("/runs");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to delete run.");
      setDeleting(false);
    }
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title={runDetail?.run.filename ?? "Run Detail"}
        description={runId ? `Run ID: ${runId}` : "Run detail"}
        rightSlot={
          <div className="flex items-center gap-2">
            <Link
              href="/runs"
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] hover:border-[var(--accent)]/30"
            >
              <ArrowLeft className="size-4" />
              Back
            </Link>
            <button
              type="button"
              onClick={() => {
                if (!runId) {
                  return;
                }

                setLoading(true);
                void fetchRunDetailApi(runId)
                  .then((detail) => {
                    setRunDetail(detail);
                    setErrorMessage("");
                  })
                  .catch((error) => {
                    setErrorMessage(error instanceof Error ? error.message : "Failed to refresh run.");
                  })
                  .finally(() => {
                    setLoading(false);
                  });
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] hover:border-[var(--accent)]/30"
            >
              <RefreshCw className="size-4" />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--danger)] hover:border-[var(--danger)]/50 hover:bg-[var(--danger)]/10 disabled:opacity-50"
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Delete
            </button>
          </div>
        }
      />

      {loading && !runDetail ? (
        <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--text-muted)]">
          <Loader2 className="size-4 animate-spin" />
          Loading run details...
        </div>
      ) : (
        <RunResultsPanel runDetail={runDetail} filePreviewUrl={filePreviewUrl} fileMimeType={fileMimeType} />
      )}

      {errorMessage ? <p className="text-sm text-[var(--danger)]">{errorMessage}</p> : null}
    </section>
  );
}

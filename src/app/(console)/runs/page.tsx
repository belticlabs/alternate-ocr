"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/console/page-header";
import { RunDto } from "@/lib/api-types";
import { deleteRunApi, listRunsApi } from "@/lib/client/api";

function formatDate(iso: string): string {
  if (!iso) {
    return "-";
  }

  return new Date(iso).toLocaleString();
}

export default function RunsPage(): React.JSX.Element {
  const [runs, setRuns] = useState<RunDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadRuns(): Promise<void> {
    setErrorMessage("");
    setLoading(true);
    try {
      setRuns(await listRunsApi());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load runs.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(e: React.MouseEvent, run: RunDto): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete run "${run.filename}"?`)) {
      return;
    }
    setDeletingId(run.id);
    setErrorMessage("");
    try {
      await deleteRunApi(run.id);
      await loadRuns();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to delete run.");
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    void loadRuns();
  }, []);

  return (
    <section className="space-y-5">
      <PageHeader
        title="Runs"
        description="Past OCR executions from in-memory storage or SpaceTimeDB."
        rightSlot={
          <button
            type="button"
            onClick={() => void loadRuns()}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] hover:border-[var(--accent)]/30"
          >
            <RefreshCw className="size-4" />
            Refresh
          </button>
        }
      />

      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="grid grid-cols-[1.2fr_0.8fr_0.8fr_0.9fr_1fr_5rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          <span className="min-w-0 truncate">Run</span>
          <span className="min-w-0 truncate">Status</span>
          <span className="min-w-0 truncate">Mode</span>
          <span className="min-w-0 truncate">Pages</span>
          <span className="min-w-0 truncate">Created</span>
          <span className="truncate text-center">Actions</span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-[var(--text-muted)]">
            <Loader2 className="size-4 animate-spin" />
            Loading runs...
          </div>
        ) : null}

        {!loading && runs.length === 0 ? (
          <div className="px-4 py-8 text-sm text-[var(--text-muted)]">No runs yet.</div>
        ) : null}

        {!loading &&
          runs.map((run) => (
            <div
              key={run.id}
              className="grid grid-cols-[1.2fr_0.8fr_0.8fr_0.9fr_1fr_5rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-sm transition-colors hover:bg-[var(--surface-raised)]"
            >
              <Link href={`/runs/${run.id}`} className="contents">
                <span className="truncate text-[var(--text-strong)]">{run.filename}</span>
                <span className="capitalize text-[var(--text)]">{run.status}</span>
                <span className="capitalize text-[var(--text-muted)]">{run.mode}</span>
                <span className="text-[var(--text)]">{run.pageCount}</span>
                <span className="text-[var(--text-muted)]">{formatDate(run.createdAt)}</span>
              </Link>
              <div className="flex min-w-0 items-center justify-center">
                <button
                  type="button"
                  onClick={(e) => void handleDelete(e, run)}
                  disabled={deletingId === run.id}
                  className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--danger)]/10 hover:text-[var(--danger)] disabled:opacity-50"
                  title="Delete run"
                >
                  {deletingId === run.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
      </div>

      {errorMessage ? <p className="text-sm text-[var(--danger)]">{errorMessage}</p> : null}
    </section>
  );
}

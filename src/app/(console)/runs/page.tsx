"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/console/page-header";
import { RunDto } from "@/lib/api-types";
import { listRunsApi } from "@/lib/client/api";

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

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="grid grid-cols-[1.2fr_0.8fr_0.8fr_0.9fr_1fr] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          <span>Run</span>
          <span>Status</span>
          <span>Mode</span>
          <span>Pages</span>
          <span>Created</span>
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
            <Link
              key={run.id}
              href={`/runs/${run.id}`}
              className="grid grid-cols-[1.2fr_0.8fr_0.8fr_0.9fr_1fr] gap-3 border-b border-[var(--border)] px-4 py-3 text-sm transition-colors hover:bg-[var(--surface-raised)]"
            >
              <span className="truncate text-[var(--text-strong)]">{run.filename}</span>
              <span className="capitalize text-[var(--text)]">{run.status}</span>
              <span className="capitalize text-[var(--text-muted)]">{run.mode}</span>
              <span className="text-[var(--text)]">{run.pageCount}</span>
              <span className="text-[var(--text-muted)]">{formatDate(run.createdAt)}</span>
            </Link>
          ))}
      </div>

      {errorMessage ? <p className="text-sm text-[var(--danger)]">{errorMessage}</p> : null}
    </section>
  );
}

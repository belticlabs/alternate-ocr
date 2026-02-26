"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileScan, History, LayoutTemplate, Search } from "lucide-react";
import clsx from "clsx";

const navItems = [
  {
    href: "/evaluate",
    label: "Evaluate",
    description: "Run OCR extractions",
    icon: Search,
  },
  {
    href: "/templates",
    label: "Templates",
    description: "Define target fields",
    icon: LayoutTemplate,
  },
  {
    href: "/runs",
    label: "Runs",
    description: "Past extractions",
    icon: History,
  },
] as const;

export function SidebarNav(): React.JSX.Element {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 h-screen w-full max-w-[264px] border-r border-[var(--border)] bg-[var(--surface-raised)]/95 backdrop-blur">
      <div className="flex h-full flex-col px-4 py-5">
        <div className="mb-6 flex items-center gap-3 px-2">
          <div className="flex size-9 items-center justify-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent)]">
            <FileScan className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide text-[var(--text-strong)]">
              GLM OCR
            </p>
            <p className="text-xs text-[var(--text-muted)]">Document Intelligence</p>
          </div>
        </div>

        <nav className="space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              (item.href !== "/evaluate" && pathname.startsWith(`${item.href}/`));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "group block rounded-xl border px-3 py-2.5 transition-colors",
                  isActive
                    ? "border-[var(--accent)]/30 bg-[var(--accent)]/10"
                    : "border-transparent hover:border-[var(--border)] hover:bg-[var(--surface)]"
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={clsx(
                      "mt-0.5 rounded-lg p-1.5 transition-colors",
                      isActive
                        ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                        : "bg-[var(--surface)] text-[var(--text-muted)] group-hover:text-[var(--text-strong)]"
                    )}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div>
                    <p
                      className={clsx(
                        "text-sm font-medium",
                        isActive ? "text-[var(--text-strong)]" : "text-[var(--text)]"
                      )}
                    >
                      {item.label}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">{item.description}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--text-muted)]">
          Configure `SPACETIMEDB_*` in `.env.local` to persist history across restarts.
        </div>
      </div>
    </aside>
  );
}

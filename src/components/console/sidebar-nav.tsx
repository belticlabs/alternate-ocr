"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { History, LayoutTemplate, PanelLeftClose, PanelLeft, Search } from "lucide-react";
import clsx from "clsx";
import { useState } from "react";

const navItems = [
  { href: "/evaluate", label: "Evaluate", description: "Run OCR extractions", icon: Search },
  { href: "/templates", label: "Templates", description: "Define target fields", icon: LayoutTemplate },
  { href: "/runs", label: "Runs", description: "Past extractions", icon: History },
] as const;

export function SidebarNav(): React.JSX.Element {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={clsx(
        "sticky top-0 h-screen shrink-0 border-r border-[var(--border)] bg-[var(--surface-raised)]/95 backdrop-blur transition-[width] duration-300 ease-in-out",
        collapsed ? "w-[72px]" : "w-[264px]"
      )}
    >
      <div className="flex h-full min-w-0 flex-col px-3 py-5">
        <div className={clsx("mb-6 flex items-start gap-3", collapsed ? "justify-center px-0" : "px-2")}>
          <div className="relative size-10 shrink-0 overflow-hidden rounded-lg">
            <Image
              src="/logo.png"
              alt="Beltic OCR"
              width={40}
              height={40}
              className="object-contain"
            />
          </div>
          {!collapsed && (
            <h1 className="min-w-0 font-serif text-lg font-semibold leading-tight text-[var(--text-strong)]">
              <span className="block">Beltic OCR</span>
              <span className="block">Playground</span>
            </h1>
          )}
        </div>

        <nav className="space-y-1.5">
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
                  "flex items-center gap-3 rounded-lg border px-2.5 py-2 transition-colors",
                  collapsed ? "justify-center px-2" : "",
                  isActive
                    ? "border-[var(--accent)] bg-[var(--accent)]/8 text-[var(--text-strong)]"
                    : "border-transparent text-[var(--text-muted)] hover:border-[var(--border)] hover:bg-[var(--surface)] hover:text-[var(--text-strong)]"
                )}
                title={collapsed ? item.label : undefined}
              >
                <Icon className="size-4 shrink-0" />
                {!collapsed && (
                  <div className="min-w-0">
                    <p className={clsx("text-sm font-medium", isActive && "text-[var(--text-strong)]")}>
                      {item.label}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">{item.description}</p>
                  </div>
                )}
              </Link>
            );
          })}
        </nav>

        <div className={clsx("mt-auto pt-4", collapsed ? "flex justify-center" : "px-2")}>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-[var(--text-muted)] transition-colors hover:text-[var(--text-strong)]"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeft className="size-5" /> : <PanelLeftClose className="size-5" />}
            {!collapsed && <span className="text-xs font-medium">Collapse</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}

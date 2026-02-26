import { SidebarNav } from "@/components/console/sidebar-nav";

export default function ConsoleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--background)]">
      <div className="pointer-events-none absolute -top-32 left-1/3 h-96 w-96 rounded-full bg-[var(--accent)]/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-80 w-80 rounded-full bg-[#f6e4bc]/35 blur-3xl" />

      <div className="relative mx-auto flex max-w-[1720px]">
        <SidebarNav />
        <main className="min-h-screen flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

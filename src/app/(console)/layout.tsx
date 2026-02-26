import { SidebarNav } from "@/components/console/sidebar-nav";

export default function ConsoleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--background)]">
      <div className="relative mx-auto flex max-w-[1720px]">
        <SidebarNav />
        <main className="min-h-screen flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

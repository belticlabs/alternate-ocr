interface PageHeaderProps {
  title: string;
  description: string;
  rightSlot?: React.ReactNode;
}

export function PageHeader({ title, description, rightSlot }: PageHeaderProps): React.JSX.Element {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border)] pb-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-strong)]">{title}</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{description}</p>
      </div>
      {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
    </header>
  );
}

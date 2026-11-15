import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1.5 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
            <ChevronLeft className="size-4" /> {back.label}
          </Link>
        )}
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "neutral" | "primary" | "success" | "warning" | "critical";
  href?: string;
}) {
  const toneCls = {
    neutral: "bg-surface-muted text-muted",
    primary: "bg-primary-soft text-primary-soft-foreground",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    critical: "bg-critical-soft text-critical",
  }[tone];
  const body = (
    <div className="flex h-full items-start justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-card transition-colors hover:border-border-strong">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <p className="tabular mt-1.5 truncate text-2xl font-semibold">{value}</p>
        {hint && <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>}
      </div>
      <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", toneCls)}>
        <Icon className="size-[18px]" />
      </div>
    </div>
  );
  return href ? <Link href={href} className="block rounded-[var(--radius-card)]">{body}</Link> : body;
}

export function DataTable({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] text-left text-sm [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-xs [&_th]:font-medium [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted [&_thead]:border-b [&_thead]:border-border [&_tbody_tr]:border-b [&_tbody_tr]:border-border last:[&_tbody_tr]:border-0 [&_tbody_tr:hover]:bg-surface-muted/60">
        {children}
      </table>
    </div>
  );
}

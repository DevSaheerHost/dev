import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-muted motion-reduce:animate-none", className)} aria-hidden />;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      <div className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
        <Icon className="size-6" />
      </div>
      <div className="max-w-sm">
        <p className="font-semibold">{title}</p>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const alertTone = {
  info: { cls: "border-primary/20 bg-primary-soft text-primary-soft-foreground", Icon: Info },
  success: { cls: "border-success/25 bg-success-soft text-success", Icon: CheckCircle2 },
  warning: { cls: "border-warning/25 bg-warning-soft text-warning", Icon: AlertTriangle },
  critical: { cls: "border-critical/25 bg-critical-soft text-critical", Icon: XCircle },
};

export function Alert({ tone = "info", title, children, className }: { tone?: keyof typeof alertTone; title?: string; children?: React.ReactNode; className?: string }) {
  const { cls, Icon } = alertTone[tone];
  return (
    <div role={tone === "critical" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border px-3.5 py-3 text-sm", cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-0.5">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-foreground/85 [&_a]:underline">{children}</div>}
      </div>
    </div>
  );
}

export function Confidence({ value, label = "Confidence" }: { value: number | null | undefined; label?: string }) {
  if (value === null || value === undefined) return null;
  const pct = Math.round(value * 100);
  const tone = pct >= 95 ? "bg-success" : pct >= 80 ? "bg-primary" : "bg-warning";
  return (
    <div className="flex items-center gap-2" title={`${label}: ${pct}%`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular text-xs text-muted">{pct}%</span>
    </div>
  );
}

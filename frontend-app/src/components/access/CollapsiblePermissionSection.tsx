import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';

type CollapsiblePermissionSectionProps = {
  title: string;
  totalCount: number;
  activeCount: number;
  summaryLabel?: string;
  children: ReactNode;
  headerAction?: ReactNode;
  className?: string;
  contentClassName?: string;
};

export function CollapsiblePermissionSection({
  title,
  totalCount,
  activeCount,
  summaryLabel = 'Selected',
  children,
  headerAction,
  className,
  contentClassName,
}: CollapsiblePermissionSectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <section className={cn('rounded-lg border border-border', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:text-foreground"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
        >
          {open ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-foreground">{title}</h4>
            <p className="text-xs text-muted">{open ? 'Collapse' : 'Expand'}</p>
          </div>
        </button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {headerAction}
          <Badge variant={activeCount > 0 ? 'success' : 'neutral'}>
            {summaryLabel} {activeCount}/{totalCount}
          </Badge>
        </div>
      </div>

      {open ? (
        <div className={cn('border-t border-border px-3 py-3', contentClassName)}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

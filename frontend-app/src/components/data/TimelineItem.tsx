import { format } from 'date-fns';
import type { PropsWithChildren } from 'react';
import { Badge } from '@/components/ui/Badge';

export function TimelineItem({
  title,
  timestamp,
  badge,
  children,
}: PropsWithChildren<{ title: string; timestamp: string; badge?: string }>) {
  return (
    <li className="relative rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h4 className="font-medium text-foreground">{title}</h4>
        {badge ? <Badge variant="info">{badge}</Badge> : null}
        <time className="ml-auto text-xs text-muted">{format(new Date(timestamp), 'dd MMM yyyy, HH:mm')}</time>
      </div>
      <div className="text-sm text-muted">{children}</div>
    </li>
  );
}

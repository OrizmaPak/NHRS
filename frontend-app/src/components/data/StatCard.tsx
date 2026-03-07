import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';

export function StatCard({
  label,
  value,
  delta,
  trend = 'up',
}: {
  label: string;
  value: string;
  delta: string;
  trend?: 'up' | 'down';
}) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold text-foreground">{value}</p>
      <div className={cn('mt-3 inline-flex items-center gap-1 text-xs font-medium', trend === 'up' ? 'text-success' : 'text-danger')}>
        {trend === 'up' ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
        <span>{delta}</span>
      </div>
    </Card>
  );
}

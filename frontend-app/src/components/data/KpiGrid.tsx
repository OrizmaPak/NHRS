import type { PropsWithChildren } from 'react';
import { StatCard } from '@/components/data/StatCard';

const metrics = [
  { label: 'Active contexts', value: '6', delta: '+2 this week' },
  { label: 'Daily requests', value: '18.4k', delta: '+8.4%' },
  { label: 'Pending approvals', value: '27', delta: '-12 today', trend: 'down' as const },
  { label: 'Emergency alerts', value: '4', delta: '+1 in last hour' },
];

export function KpiGrid({ children }: PropsWithChildren) {
  if (children) {
    return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <StatCard key={metric.label} label={metric.label} value={metric.value} delta={metric.delta} trend={metric.trend} />
      ))}
    </div>
  );
}

import { Badge } from '@/components/ui/Badge';

const map = {
  active: 'success',
  pending: 'warning',
  suspended: 'danger',
  draft: 'neutral',
  verified: 'success',
  available: 'success',
  unavailable: 'danger',
  in_progress: 'warning',
  resolved: 'success',
  open: 'info',
  low: 'warning',
  high: 'danger',
  critical: 'danger',
} as const;

export function StatusBadge({ status }: { status: keyof typeof map | string }) {
  const key = String(status).toLowerCase() as keyof typeof map;
  const variant = map[key] ?? 'neutral';
  return <Badge variant={variant}>{String(status).replace('_', ' ')}</Badge>;
}

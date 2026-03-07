import { cn } from '@/lib/cn';

export function LoadingSkeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulseSoft rounded-md bg-muted/20', className)} />;
}

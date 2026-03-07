import type { PropsWithChildren } from 'react';
import { cn } from '@/lib/cn';

export function Timeline({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <ol className={cn('space-y-4', className)}>{children}</ol>;
}

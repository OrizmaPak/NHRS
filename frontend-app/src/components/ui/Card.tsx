import type { PropsWithChildren } from 'react';
import { cn } from '@/lib/cn';

export function Card({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <section className={cn('rounded-lg border border-border bg-surface p-5 shadow-soft', className)}>{children}</section>;
}

export function CardHeader({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <header className={cn('mb-4 flex items-start justify-between gap-3', className)}>{children}</header>;
}

export function CardTitle({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <h3 className={cn('font-display text-lg font-semibold text-foreground', className)}>{children}</h3>;
}

export function CardDescription({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <p className={cn('text-sm text-muted', className)}>{children}</p>;
}

import * as Label from '@radix-ui/react-label';
import type { PropsWithChildren } from 'react';
import { cn } from '@/lib/cn';

export function FormField({
  label,
  hint,
  error,
  className,
  children,
}: PropsWithChildren<{ label: string; hint?: string; error?: string; className?: string }>) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label.Root className="text-sm font-medium text-foreground">{label}</Label.Root>
      {children}
      {error ? <p className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

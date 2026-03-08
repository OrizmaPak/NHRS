import type { PropsWithChildren } from 'react';

export function FilterBar({ children }: PropsWithChildren) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 md:flex-row md:flex-wrap md:items-center">
      {children}
    </div>
  );
}

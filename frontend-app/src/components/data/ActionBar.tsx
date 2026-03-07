import type { PropsWithChildren } from 'react';

export function ActionBar({ children }: PropsWithChildren) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

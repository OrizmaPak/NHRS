import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { PropsWithChildren } from 'react';
import { cn } from '@/lib/cn';

export function Drawer({
  open,
  onOpenChange,
  title,
  side = 'right',
  children,
}: PropsWithChildren<{ open: boolean; onOpenChange: (open: boolean) => void; title: string; side?: 'left' | 'right' }>) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          className={cn(
            'fixed inset-y-0 z-50 w-[min(460px,94vw)] border-l border-border bg-surface p-5 shadow-soft',
            side === 'right' ? 'right-0' : 'left-0 border-r border-l-0',
          )}
        >
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="font-display text-lg font-semibold text-foreground">{title}</Dialog.Title>
            <Dialog.Close className="rounded-md p-1 text-muted hover:bg-muted/10 hover:text-foreground">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

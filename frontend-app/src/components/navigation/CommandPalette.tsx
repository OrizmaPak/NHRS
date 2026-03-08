import * as Dialog from '@radix-ui/react-dialog';
import { Command as CommandIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { navigationItems } from '@/routes/navigation';
import { usePermissionsStore } from '@/stores/permissionsStore';
import { useContextStore } from '@/stores/contextStore';
import { useUIStore } from '@/stores/uiStore';

export function CommandPalette() {
  const navigate = useNavigate();
  const open = useUIStore((state) => state.commandPaletteOpen);
  const setOpen = useUIStore((state) => state.setCommandPaletteOpen);
  const hasPermission = usePermissionsStore((state) => state.hasPermission);
  const hasAny = usePermissionsStore((state) => state.hasAny);
  const _permissionsVersion = usePermissionsStore((state) => state.version);
  void _permissionsVersion;
  const activeContext = useContextStore((state) => state.activeContext);

  const items = (activeContext?.id === 'app:citizen' ? [] : navigationItems).filter((item) => {
    if (!item.permission) return true;
    return Array.isArray(item.permission) ? hasAny(item.permission) : hasPermission(item.permission);
  });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-[18vh] z-50 w-[min(640px,94vw)] -translate-x-1/2 rounded-xl border border-border bg-surface p-2 shadow-soft">
          <Command className="w-full">
            <div className="mb-2 flex items-center gap-2 border-b border-border px-3 py-2">
              <CommandIcon className="h-4 w-4 text-muted" />
              <Command.Input className="w-full bg-transparent text-sm outline-none" placeholder="Jump to page, action or module" />
            </div>
            <Command.List className="max-h-80 overflow-auto p-1">
              <Command.Empty className="px-3 py-4 text-sm text-muted">No command found</Command.Empty>
              <Command.Group heading="Navigation" className="text-xs text-muted">
                {items.map((item) => (
                  <Command.Item
                    key={item.to}
                    value={item.label}
                    onSelect={() => {
                      navigate(item.to);
                      setOpen(false);
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground aria-selected:bg-primary/10"
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

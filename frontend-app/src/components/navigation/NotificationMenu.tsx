import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Bell } from 'lucide-react';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { Button } from '@/components/ui/Button';

export function NotificationMenu() {
  const items = useNotificationsStore((state) => state.items);
  const markAllRead = useNotificationsStore((state) => state.markAllRead);
  const unread = items.filter((item) => !item.read).length;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="h-5 w-5" />
          {unread > 0 ? (
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger" aria-hidden />
          ) : null}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" className="z-50 w-80 rounded-lg border border-border bg-surface p-2 shadow-soft">
          <div className="mb-2 flex items-center justify-between px-2 py-1">
            <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
            <button type="button" className="text-xs text-primary" onClick={markAllRead}>
              Mark all read
            </button>
          </div>
          <div className="max-h-80 space-y-1 overflow-auto">
            {items.map((item) => (
              <div key={item.id} className="rounded-md border border-border px-3 py-2">
                <p className="text-sm font-medium text-foreground">{item.title}</p>
                {item.message ? <p className="text-xs text-muted">{item.message}</p> : null}
              </div>
            ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

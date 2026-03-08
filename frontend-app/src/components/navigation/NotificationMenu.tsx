import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useNotifications, useMarkNotificationRead } from '@/api/hooks/useNotifications';
import { Button } from '@/components/ui/Button';

export function NotificationMenu() {
  const notificationsQuery = useNotifications();
  const markReadMutation = useMarkNotificationRead();
  const items = [...(notificationsQuery.data ?? [])].sort((a, b) => {
    const rank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    const pA = rank[a.priority] ?? 9;
    const pB = rank[b.priority] ?? 9;
    if (pA !== pB) return pA - pB;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  const unread = items.filter((item) => !item.read).length;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="h-5 w-5" />
          {unread > 0 ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger" aria-hidden /> : null}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" className="z-50 w-80 rounded-lg border border-border bg-surface p-2 shadow-soft">
          <div className="mb-2 flex items-center justify-between px-2 py-1">
            <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
            <button
              type="button"
              disabled={markReadMutation.isPending}
              className="text-xs text-primary disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => markReadMutation.mutate({ all: true })}
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-80 space-y-1 overflow-auto">
            {items.slice(0, 12).map((item) => (
              <div
                key={item.id}
                className="cursor-pointer rounded-md border border-border px-3 py-2"
                onClick={() => markReadMutation.mutate({ id: item.id })}
              >
                <p className="text-sm font-medium text-foreground">
                  {item.title}
                  {!item.read ? <span className="ml-2 inline-block h-2 w-2 rounded-full bg-primary" aria-hidden /> : null}
                </p>
                {item.message ? <p className="text-xs text-muted">{item.message}</p> : null}
                <p className="mt-1 text-[11px] text-muted">
                  {item.sourceModule} - {item.priority.toUpperCase()} - {new Date(item.createdAt).toLocaleTimeString()}
                </p>
              </div>
            ))}
            {!notificationsQuery.isLoading && items.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted">No notifications available.</p>
            ) : null}
          </div>
          <div className="mt-2 border-t border-border pt-2 text-right">
            <DropdownMenu.Item asChild>
              <Link to="/app/settings" className="text-xs text-primary">
                Open settings
              </Link>
            </DropdownMenu.Item>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

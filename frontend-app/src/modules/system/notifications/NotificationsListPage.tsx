import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SmartSelect } from '@/components/data/SmartSelect';
import { ActionBar } from '@/components/data/ActionBar';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useNotifications, useMarkNotificationRead } from '@/api/hooks/useNotifications';

const notificationTypes = ['general', 'emergency', 'complaint', 'case', 'patient', 'system', 'announcement'];
const priorityRank: Record<string, number> = { critical: 0, warning: 1, info: 2 };

export function NotificationsListPage() {
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [announcementsOnly, setAnnouncementsOnly] = useState(false);
  const notificationsQuery = useNotifications({ type: typeFilter || undefined, unread: unreadOnly || undefined });
  const markRead = useMarkNotificationRead();

  const sortedItems = useMemo(
    () =>
      [...(notificationsQuery.data ?? [])]
        .filter((item) => (announcementsOnly ? item.type === 'announcement' || item.type === 'system_announcement' : true))
        .sort((a, b) => {
          const pA = priorityRank[a.priority] ?? 9;
          const pB = priorityRank[b.priority] ?? 9;
          if (pA !== pB) return pA - pB;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }),
    [announcementsOnly, notificationsQuery.data],
  );

  const grouped = useMemo(
    () =>
      sortedItems.reduce<Record<string, typeof sortedItems>>((acc, item) => {
        const key = item.priority.toUpperCase();
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
      }, {}),
    [sortedItems],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Track alerts, escalations, dispatch updates, and system announcements."
        breadcrumbs={[{ label: 'System' }, { label: 'Notifications' }]}
      />

      <FilterBar>
        <div className="w-full md:max-w-xs">
          <SmartSelect
            value={typeFilter}
            onChange={setTypeFilter}
            placeholder="Notification type"
            loadOptions={async (input) =>
              notificationTypes
                .filter((item) => item.includes(input.toLowerCase()))
                .map((item) => ({ value: item, label: item }))
            }
          />
        </div>
        <ActionBar>
          <Button variant={unreadOnly ? 'default' : 'outline'} onClick={() => setUnreadOnly((prev) => !prev)}>
            {unreadOnly ? 'Showing unread' : 'Unread only'}
          </Button>
          <Button variant={announcementsOnly ? 'default' : 'outline'} onClick={() => setAnnouncementsOnly((prev) => !prev)}>
            {announcementsOnly ? 'Announcements only' : 'Filter announcements'}
          </Button>
          <Button variant="outline" onClick={() => markRead.mutate({ all: true })}>
            Mark all read
          </Button>
        </ActionBar>
      </FilterBar>

      {notificationsQuery.isLoading ? (
        <div className="space-y-3">
          <LoadingSkeleton className="h-16 w-full" />
          <LoadingSkeleton className="h-16 w-full" />
          <LoadingSkeleton className="h-16 w-full" />
        </div>
      ) : null}

      {notificationsQuery.isError ? (
        <ErrorState title="Unable to load notifications" description="Please retry." onRetry={() => notificationsQuery.refetch()} />
      ) : null}

      {!notificationsQuery.isLoading && !notificationsQuery.isError && sortedItems.length === 0 ? (
        <EmptyState title="No notifications" description="You are fully up to date." />
      ) : null}

      {!notificationsQuery.isLoading && !notificationsQuery.isError && sortedItems.length > 0 ? (
        <div className="space-y-4">
          {Object.entries(grouped).map(([group, items]) => (
            <section key={group} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{group} priority</h3>
              {items.map((item) => (
                <article
                  key={item.id}
                  className="rounded-lg border border-border bg-surface p-4 shadow-soft"
                  onClick={() => {
                    if (!item.read) {
                      markRead.mutate({ id: item.id });
                    }
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                      <p className="text-xs text-muted">{item.sourceModule} - {new Date(item.createdAt).toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={item.priority} />
                      {!item.read ? <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">Unread</span> : null}
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-foreground">{item.message || 'No description provided.'}</p>
                </article>
              ))}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

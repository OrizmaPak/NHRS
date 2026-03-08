import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endpoints } from '@/api/endpoints';
import { apiClient } from '@/api/apiClient';
import { useNotificationsStore, type AppNotification } from '@/stores/notificationsStore';

export type NotificationItem = AppNotification & {
  sourceModule: string;
  priority: 'info' | 'warning' | 'critical';
  type: string;
};

export type NotificationsParams = {
  type?: string;
  unread?: boolean;
};

function normalizeNotification(item: Record<string, unknown>): NotificationItem {
  return {
    id: String(item.id ?? item.notificationId ?? crypto.randomUUID()),
    title: String(item.title ?? 'Notification'),
    message: String(item.description ?? item.message ?? ''),
    read: Boolean(item.read ?? item.isRead ?? false),
    createdAt: String(item.createdAt ?? new Date().toISOString()),
    sourceModule: String(item.sourceModule ?? item.module ?? 'system'),
    priority: String(item.priority ?? 'info').toLowerCase() as NotificationItem['priority'],
    type: String(item.type ?? item.eventType ?? 'general'),
  };
}

export function useNotifications(params: NotificationsParams = {}) {
  const storeItems = useNotificationsStore((state) => state.items);

  return useQuery({
    queryKey: ['system', 'notifications', params],
    queryFn: async (): Promise<NotificationItem[]> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.notifications.list, {
          query: { eventType: params.type, page: 1, limit: 50 },
        });

        const items =
          (Array.isArray(response.events) ? response.events : null) ??
          (Array.isArray(response.items) ? response.items : null) ??
          (Array.isArray(response.data) ? response.data : null) ??
          [];

        const mapped = items
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((item) => {
            const metadata = item.metadata && typeof item.metadata === 'object' ? (item.metadata as Record<string, unknown>) : null;
            const id = String(item.id ?? item.eventId ?? crypto.randomUUID());
            const existing = storeItems.find((entry) => entry.id === id);
            return normalizeNotification({
              id,
              title: item.eventType ?? item.action ?? 'Notification',
              description: item.message ?? metadata?.message ?? '',
              read: existing?.read ?? false,
              createdAt: item.createdAt,
              sourceModule: item.action ?? item.permissionKey ?? 'system',
              priority: 'info',
              type: item.eventType ?? 'general',
            });
          });

        if (!params.unread) return mapped;
        return mapped.filter((entry) => !entry.read);
      } catch {
        return storeItems.map((item) => ({
          ...item,
          sourceModule: 'system',
          priority: 'info',
          type: 'general',
        }));
      }
    },
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  const markReadLocal = useNotificationsStore((state) => state.markRead);
  const markAllReadLocal = useNotificationsStore((state) => state.markAllRead);

  return useMutation({
    mutationFn: async (payload: { id?: string; all?: boolean }) => {
      if (payload.all) {
        markAllReadLocal();
        return;
      }

      if (!payload.id) return;
      markReadLocal(payload.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['system', 'notifications'] });
    },
  });
}


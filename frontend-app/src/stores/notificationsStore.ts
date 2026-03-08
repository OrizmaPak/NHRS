import { create } from 'zustand';

export type AppNotification = {
  id: string;
  title: string;
  message?: string;
  read: boolean;
  createdAt: string;
};

type NotificationsState = {
  items: AppNotification[];
  push: (item: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
};

export const useNotificationsStore = create<NotificationsState>((set) => ({
  items: [
    {
      id: 'notif-1',
      title: 'Welcome to NHRS',
      message: 'Your dashboard is ready.',
      read: false,
      createdAt: new Date().toISOString(),
    },
  ],
  push: (item) =>
    set((state) => ({
      items: [
        {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          read: false,
          ...item,
        },
        ...state.items,
      ],
    })),
  markRead: (id) =>
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, read: true } : item)),
    })),
  markAllRead: () =>
    set((state) => ({
      items: state.items.map((item) => ({ ...item, read: true })),
    })),
}));

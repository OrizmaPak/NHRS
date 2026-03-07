import { create } from 'zustand';

type PermissionsState = {
  permissions: Set<string>;
  replace: (permissions: string[]) => void;
  clear: () => void;
  hasPermission: (permission: string) => boolean;
  hasAny: (required: string[]) => boolean;
};

export const usePermissionsStore = create<PermissionsState>((set, get) => ({
  permissions: new Set<string>(),
  replace: (permissions) => set({ permissions: new Set(permissions) }),
  clear: () => set({ permissions: new Set<string>() }),
  hasPermission: (permission) => {
    const current = get().permissions;
    return current.has('*') || current.has(permission);
  },
  hasAny: (required) => {
    const current = get().permissions;
    if (current.has('*')) return true;
    return required.some((permission) => current.has(permission));
  },
}));

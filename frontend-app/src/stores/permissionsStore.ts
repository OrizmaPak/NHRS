import { create } from 'zustand';
import { useContextStore } from '@/stores/contextStore';

export type PermissionSource = 'role' | 'override_allow' | 'override_deny';

export type EffectivePermission = {
  key: string;
  source: PermissionSource;
  granted: boolean;
};

type PermissionsState = {
  version: number;
  permissions: Set<string>;
  roles: string[];
  overrides: Record<string, 'allow' | 'deny'>;
  effective: Record<string, EffectivePermission>;
  replace: (permissions: string[]) => void;
  setRoles: (roles: string[]) => void;
  setOverrides: (overrides: Record<string, 'allow' | 'deny'>) => void;
  setEffectivePermissions: (items: EffectivePermission[]) => void;
  clear: () => void;
  hasPermission: (permission: string) => boolean;
  hasAny: (required: string[]) => boolean;
};

export const usePermissionsStore = create<PermissionsState>((set, get) => ({
  version: 0,
  permissions: new Set<string>(),
  roles: [],
  overrides: {},
  effective: {},
  replace: (permissions) => set((state) => ({ permissions: new Set(permissions), version: state.version + 1 })),
  setRoles: (roles) => set((state) => ({ roles, version: state.version + 1 })),
  setOverrides: (overrides) => set((state) => ({ overrides, version: state.version + 1 })),
  setEffectivePermissions: (items) =>
    set((state) => ({
      effective: Object.fromEntries(items.map((item) => [item.key, item])),
      permissions: new Set(items.filter((item) => item.granted).map((item) => item.key)),
      version: state.version + 1,
    })),
  clear: () =>
    set((state) => ({ permissions: new Set<string>(), roles: [], overrides: {}, effective: {}, version: state.version + 1 })),
  hasPermission: (permission) => {
    const activeContext = useContextStore.getState().activeContext;
    if (activeContext?.id === 'app:citizen') return false;
    const current = get().permissions;
    const roleSet = new Set<string>(get().roles.map((role) => role.toLowerCase()));
    const isSuperAdmin = Array.from(roleSet).some((role) =>
      ['superadmin', 'super_admin', 'platform_admin', 'app_admin'].includes(role),
    );
    if (isSuperAdmin) return true;
    if (permission === 'superadmin.only') return isSuperAdmin || current.has('*');
    const effective = get().effective[permission];
    if (effective) return effective.granted;
    return current.has('*') || current.has(permission);
  },
  hasAny: (required) => {
    const activeContext = useContextStore.getState().activeContext;
    if (activeContext?.id === 'app:citizen') return false;
    const current = get().permissions;
    const roleSet = new Set<string>(get().roles.map((role) => role.toLowerCase()));
    const isSuperAdmin = Array.from(roleSet).some((role) =>
      ['superadmin', 'super_admin', 'platform_admin', 'app_admin'].includes(role),
    );
    if (isSuperAdmin) return true;
    if (required.includes('superadmin.only')) return isSuperAdmin || current.has('*');
    const effective = get().effective;
    if (Object.keys(effective).length > 0) {
      const grantedFromEffective = required.some((permission) => effective[permission]?.granted);
      if (grantedFromEffective) return true;
      if (current.has('*')) return true;
    }
    if (current.has('*')) return true;
    return required.some((permission) => current.has(permission));
  },
}));

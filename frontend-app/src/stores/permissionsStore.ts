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

function permissionRuleMatches(ruleKey: string, permissionKey: string): boolean {
  if (ruleKey === '*') return true;
  if (ruleKey.endsWith('.*')) {
    return permissionKey.startsWith(ruleKey.slice(0, -1));
  }
  return ruleKey === permissionKey;
}

function permissionRuleSpecificity(ruleKey: string): number {
  if (ruleKey === '*') return 0;
  if (ruleKey.endsWith('.*')) return ruleKey.length;
  return 10_000 + ruleKey.length;
}

function isSuperContext(contextId?: string, contextName?: string): boolean {
  const id = String(contextId ?? '').trim().toLowerCase();
  const name = String(contextName ?? '').trim().toLowerCase();
  if (id === 'app:super') return true;
  if (id.startsWith('app:role:')) {
    const role = id.replace('app:role:', '');
    if (['super', 'superadmin', 'super_admin', 'platform_admin', 'app_admin', 'admin'].includes(role)) return true;
  }
  return ['super', 'superadmin', 'super admin', 'platform admin', 'app admin', 'admin'].includes(name);
}

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
    const current = get().permissions;
    const activeContext = useContextStore.getState().activeContext;
    const isSuperActive = isSuperContext(activeContext?.id, activeContext?.name);

    if (permission === 'superadmin.only') return isSuperActive;
    if (isSuperActive) return true;

    const effectiveEntries = Object.values(get().effective)
      .filter((entry) => permissionRuleMatches(entry.key, permission))
      .sort((a, b) => {
        const specificityDelta = permissionRuleSpecificity(b.key) - permissionRuleSpecificity(a.key);
        if (specificityDelta !== 0) return specificityDelta;
        if (a.source === b.source) return 0;
        if (a.source === 'override_deny') return -1;
        if (b.source === 'override_deny') return 1;
        if (a.source === 'override_allow') return -1;
        if (b.source === 'override_allow') return 1;
        return 0;
      });

    if (effectiveEntries.length > 0) {
      return Boolean(effectiveEntries[0].granted);
    }

    if (current.has('*') || current.has(permission)) return true;
    return Array.from(current).some((entry) => permissionRuleMatches(entry, permission));
  },
  hasAny: (required) => {
    return required.some((permission) => get().hasPermission(permission));
  },
}));

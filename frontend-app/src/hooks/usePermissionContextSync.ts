import { useEffect, useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useContextStore } from '@/stores/contextStore';
import { usePermissionsStore, type EffectivePermission } from '@/stores/permissionsStore';
import { resolveSyntheticContextPermissions } from '@/api/hooks/useSwitchContext';

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function overrideMapsEqual(
  left: Record<string, 'allow' | 'deny'>,
  right: Record<string, 'allow' | 'deny'>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

function toEffectiveEntries(
  permissions: string[],
  overrides: Record<string, 'allow' | 'deny'>,
): EffectivePermission[] {
  return [
    ...permissions.map((key) => ({
      key,
      source: (overrides[key] === 'allow' ? 'override_allow' : 'role') as 'role' | 'override_allow' | 'override_deny',
      granted: true,
    })),
    ...Object.entries(overrides)
      .filter(([, effect]) => effect === 'deny')
      .map(([key]) => ({
        key,
        source: 'override_deny' as const,
        granted: false,
      })),
  ];
}

function applyOverridesToPermissions(
  basePermissions: string[],
  overrides: Record<string, 'allow' | 'deny'>,
): string[] {
  const next = new Set(basePermissions);
  Object.entries(overrides).forEach(([key, effect]) => {
    if (effect === 'deny') {
      next.delete(key);
    } else if (effect === 'allow') {
      next.add(key);
    }
  });
  return Array.from(next);
}

export function usePermissionContextSync() {
  const user = useAuthStore((state) => state.user);
  const activeContext = useContextStore((state) => state.activeContext);
  const setOverrides = usePermissionsStore((state) => state.setOverrides);
  const setEffectivePermissions = usePermissionsStore((state) => state.setEffectivePermissions);

  const dependencyKey = useMemo(() => {
    const ctxPermissions = Array.isArray(activeContext?.permissions) ? activeContext.permissions.join('|') : '';
    return `${user?.id ?? 'nouser'}::${activeContext?.id ?? 'noctx'}::${activeContext?.name ?? ''}::${ctxPermissions}`;
  }, [user?.id, activeContext?.id, activeContext?.name, activeContext?.permissions]);

  useEffect(() => {
    let cancelled = false;

    const applyResolved = (permissions: string[], overrides: Record<string, 'allow' | 'deny'>) => {
      if (cancelled) return;

      const state = usePermissionsStore.getState();
      const nextPermissions = new Set<string>(permissions);
      const samePermissions = setsEqual(state.permissions, nextPermissions);
      const sameOverrides = overrideMapsEqual(state.overrides, overrides);

      if (!sameOverrides) {
        setOverrides(overrides);
      }

      if (!samePermissions || !sameOverrides) {
        setEffectivePermissions(toEffectiveEntries(permissions, overrides));
      }
    };

    const run = async () => {
      if (!activeContext) {
        applyResolved([], {});
        return;
      }

      if (activeContext.id.startsWith('app:') && user?.id) {
        try {
          const resolved = await resolveSyntheticContextPermissions(String(user.id), activeContext.id, activeContext.name);
          const contextFallbackPermissions = Array.isArray(activeContext.permissions) ? activeContext.permissions : [];
          const resolvedPermissions =
            resolved.permissions.length > 0
              ? resolved.permissions
              : applyOverridesToPermissions(contextFallbackPermissions, resolved.overrides);
          applyResolved(resolvedPermissions, resolved.overrides);
          return;
        } catch {
          const fallbackPermissions = Array.isArray(activeContext.permissions) ? activeContext.permissions : [];
          applyResolved(fallbackPermissions, {});
          return;
        }
      }

      const scopedPermissions = Array.isArray(activeContext.permissions) ? activeContext.permissions : [];
      applyResolved(scopedPermissions, {});
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [dependencyKey, setOverrides, setEffectivePermissions]);
}

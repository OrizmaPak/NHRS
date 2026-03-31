import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from '@/components/feedback/Spinner';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { useAuthStore } from '@/stores/authStore';
import { useContextStore } from '@/stores/contextStore';
import { usePermissionsStore } from '@/stores/permissionsStore';
import { getOrganizationIdFromContext } from '@/lib/organizationContext';

type EffectivePermission = { key: string; granted: boolean };

function deriveGrantedSet(effectivePermissions: EffectivePermission[]): Set<string> {
  return new Set(effectivePermissions.filter((entry) => entry.granted).map((entry) => entry.key));
}

function normalizeEffectivePermissions(raw: unknown): EffectivePermission[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const row = entry as Record<string, unknown>;
      const key = String(row.key ?? row.permissionKey ?? '');
      const granted = Boolean(row.granted ?? row.effect === 'allow');
      if (!key) return null;
      return { key, granted };
    })
    .filter((entry): entry is EffectivePermission => Boolean(entry));
}

export function InterfaceAccessGate({
  permission,
  children,
  fallback,
}: {
  permission: string | string[];
  children: React.ReactNode;
  fallback: React.ReactNode;
}) {
  const user = useAuthStore((state) => state.user);
  const activeContext = useContextStore((state) => state.activeContext);
  const hasPermissionLocal = usePermissionsStore((state) => state.hasPermission);
  const hasAnyLocal = usePermissionsStore((state) => state.hasAny);

  const required = useMemo(() => (Array.isArray(permission) ? permission : [permission]), [permission]);
  const localAllowed = Array.isArray(permission) ? hasAnyLocal(permission) : hasPermissionLocal(permission);

  const isSyntheticAppContext = Boolean(activeContext?.id?.startsWith('app:'));
  const shouldUseOrgScope = Boolean(activeContext?.organizationId || (activeContext?.type === 'organization' && activeContext?.id));
  const organizationId = getOrganizationIdFromContext(activeContext);

  const query = useQuery({
    queryKey: ['route-access', user?.id, activeContext?.id ?? 'none', organizationId ?? 'app', required.join('|')],
    enabled: Boolean(user?.id) && required.length > 0 && !isSyntheticAppContext,
    staleTime: 15_000,
    queryFn: async () => {
      const path = shouldUseOrgScope && organizationId
        ? endpoints.rbac.orgUserAccess(organizationId, String(user?.id))
        : endpoints.rbac.userAccess(String(user?.id));
      const response = await apiClient.get<Record<string, unknown>>(path);
      const effectivePermissions = normalizeEffectivePermissions(response.effectivePermissions);
      const roles = Array.isArray(response.roles)
        ? response.roles.map((entry) => (typeof entry === 'string' ? entry : String((entry as Record<string, unknown>).name ?? '')))
        : [];
      return { effectivePermissions, roles };
    },
  });

  if (localAllowed) {
    return <>{children}</>;
  }

  if (query.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted">
        <Spinner className="h-5 w-5" />
        <span className="ml-2 text-sm">Validating interface access...</span>
      </div>
    );
  }

  if (query.data) {
    const granted = deriveGrantedSet(query.data.effectivePermissions);
    const allowed = required.some((key) => granted.has(key) || granted.has('*'));
    return <>{allowed ? children : fallback}</>;
  }

  return <>{localAllowed ? children : fallback}</>;
}

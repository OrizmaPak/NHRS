import type { PropsWithChildren, ReactNode } from 'react';
import { usePermissionsStore } from '@/stores/permissionsStore';

type PermissionGateProps = PropsWithChildren<{
  permission: string | string[];
  fallback?: ReactNode;
  mode?: 'hide' | 'disable';
}>;

export function PermissionGate({
  permission,
  fallback = null,
  mode = 'hide',
  children,
}: PermissionGateProps) {
  const hasPermission = usePermissionsStore((state) => state.hasPermission);
  const hasAny = usePermissionsStore((state) => state.hasAny);

  const allowed = Array.isArray(permission)
    ? hasAny(permission)
    : hasPermission(permission);

  if (allowed) return <>{children}</>;

  if (mode === 'disable' && children) {
    return (
      <span aria-disabled className="pointer-events-none opacity-50">
        {children}
      </span>
    );
  }

  return <>{fallback}</>;
}

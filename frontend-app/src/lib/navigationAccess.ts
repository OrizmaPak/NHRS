import type { NavigationItem } from '@/routes/navigation';
import type { AppContext } from '@/types/auth';
import { getOrganizationScopeKind } from '@/lib/organizationContext';

export function isNavigationItemVisibleInContext(
  item: NavigationItem,
  activeContext: AppContext | null,
): boolean {
  if (!item.contextTypes || item.contextTypes.length === 0) return true;
  if (!activeContext) return false;
  if (!item.contextTypes.includes(activeContext.type)) return false;
  if (activeContext.type !== 'organization' || !item.organizationScopes || item.organizationScopes.length === 0) {
    return true;
  }
  const scopeKind = getOrganizationScopeKind(activeContext);
  return Boolean(scopeKind && item.organizationScopes.includes(scopeKind));
}

export function getFirstAllowedNavigationPath(
  items: NavigationItem[],
  hasPermission: (permission: string) => boolean,
  hasAny: (permissions: string[]) => boolean,
  activeContext: AppContext | null = null,
): string | null {
  const firstAllowed = items.find((item) => {
    if (!isNavigationItemVisibleInContext(item, activeContext)) return false;
    if (!item.permission) return true;
    return Array.isArray(item.permission) ? hasAny(item.permission) : hasPermission(item.permission);
  });

  return firstAllowed?.to ?? null;
}

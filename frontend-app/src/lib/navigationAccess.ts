import type { NavigationItem } from '@/routes/navigation';
import type { AppContext } from '@/types/auth';

export function isNavigationItemVisibleInContext(
  item: NavigationItem,
  activeContext: AppContext | null,
): boolean {
  if (!item.contextTypes || item.contextTypes.length === 0) return true;
  if (!activeContext) return false;
  return item.contextTypes.includes(activeContext.type);
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

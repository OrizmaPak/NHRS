import type { NavigationItem } from '@/routes/navigation';

export function getFirstAllowedNavigationPath(
  items: NavigationItem[],
  hasPermission: (permission: string) => boolean,
  hasAny: (permissions: string[]) => boolean,
): string | null {
  const firstAllowed = items.find((item) => {
    if (!item.permission) return true;
    return Array.isArray(item.permission) ? hasAny(item.permission) : hasPermission(item.permission);
  });

  return firstAllowed?.to ?? null;
}

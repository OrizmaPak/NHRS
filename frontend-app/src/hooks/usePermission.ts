import { usePermissionsStore } from '@/stores/permissionsStore';

export function usePermission(permission: string): boolean {
  return usePermissionsStore((state) => state.hasPermission(permission));
}

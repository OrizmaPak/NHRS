import type { AppContext } from '@/types/auth';

export function getOrganizationIdFromContext(context: AppContext | null | undefined): string | undefined {
  if (!context) return undefined;
  if (context.organizationId) return context.organizationId;
  if (context.type === 'organization') {
    if (context.id.startsWith('org:')) {
      const parts = context.id.split(':');
      if (parts.length >= 2 && parts[1]) return parts[1];
    }
    return context.id;
  }
  return undefined;
}

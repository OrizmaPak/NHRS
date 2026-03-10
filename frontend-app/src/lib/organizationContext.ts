import type { AppContext } from '@/types/auth';

export function getOrganizationIdFromContext(context: AppContext | null | undefined): string | undefined {
  if (!context) return undefined;
  if (context.organizationId) return context.organizationId;
  if (context.type === 'organization') return context.id;
  return undefined;
}


import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import type { AuditEventRow } from '@/api/hooks/taskforceTypes';

export type AuditEventsParams = {
  actor?: string;
  actorType?: string;
  module?: string;
  action?: string;
  institution?: string;
  state?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
};

type Result = {
  rows: AuditEventRow[];
  total: number;
};

export function useAuditEvents(params: AuditEventsParams) {
  return useQuery({
    queryKey: ['governance', 'audit', params],
    queryFn: async (): Promise<Result> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.governance.auditEvents, {
        query: {
          userId: params.actor,
          eventType: params.action,
          module: params.module,
          organizationId: params.institution,
          state: params.state,
          actorType: params.actorType,
          from: params.from,
          to: params.to,
          page: params.page,
          limit: params.limit,
        },
      });
      const items =
        (Array.isArray(response.items) ? response.items : null) ??
        (Array.isArray(response.events) ? response.events : null) ??
        (Array.isArray(response.data) ? response.data : null) ??
        [];
      const rows = items.map((item, index) => {
        const event = item as Record<string, unknown>;
        const resource = (event.resource as Record<string, unknown> | undefined) ?? {};
        return {
          id: String(event.eventId ?? event.id ?? index),
          eventId: String(event.eventId ?? event.id ?? index),
          actor: String(event.userId ?? event.actor ?? 'System'),
          actorType: String(event.actorType ?? 'user'),
          actorRole: String(event.actorRole ?? event.role ?? 'N/A'),
          action: String(event.action ?? event.eventType ?? 'event'),
          module: String(event.module ?? resource.type ?? 'general'),
          targetType: String(resource.type ?? event.targetType ?? 'N/A'),
          targetId: String(resource.id ?? event.targetId ?? 'N/A'),
          institution: String(event.organizationId ?? event.institution ?? 'N/A'),
          state: String(event.state ?? 'N/A'),
          outcome: String(event.outcome ?? 'N/A'),
          summary: String(event.summary ?? event.metadataSummary ?? ''),
          timestamp: String(event.createdAt ?? event.timestamp ?? new Date().toISOString()),
        } as AuditEventRow;
      });
      return {
        rows,
        total: Number(response.total ?? rows.length),
      };
    },
  });
}

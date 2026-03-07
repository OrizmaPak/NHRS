import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import type { OversightSummary } from '@/api/hooks/taskforceTypes';

export function useOversightSummary() {
  return useQuery({
    queryKey: ['governance', 'oversight', 'summary'],
    queryFn: async (): Promise<OversightSummary> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.governance.oversight, {
        query: { page: 1, limit: 300 },
      });
      const items =
        (Array.isArray(response.items) ? response.items : null) ??
        (Array.isArray(response.data) ? response.data : null) ??
        [];
      const rows = items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
      return {
        institutionsFlagged: new Set(rows.map((row) => String(row.organizationId ?? row.institution ?? ''))).size,
        unresolvedHighPriorityComplaints: rows.filter((row) => {
          const status = String(row.status ?? '').toLowerCase();
          const priority = String(row.priority ?? row.urgency ?? '').toLowerCase();
          return status !== 'resolved' && status !== 'closed' && (priority === 'high' || priority === 'critical');
        }).length,
        overdueCases: rows.filter((row) => String(row.stage ?? row.currentStage ?? '').toLowerCase() === 'overdue').length,
        recentEscalations: rows.filter((row) => String(row.status ?? '').toLowerCase() === 'escalated').length,
      };
    },
  });
}

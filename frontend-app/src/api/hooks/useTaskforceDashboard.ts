import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import type { ScopeLevel, TaskforceKpis } from '@/api/hooks/taskforceTypes';

type Params = {
  scopeLevel?: ScopeLevel;
  state?: string;
  lga?: string;
};

export function useTaskforceDashboard(params: Params) {
  return useQuery({
    queryKey: ['taskforce', 'dashboard', params],
    queryFn: async (): Promise<TaskforceKpis> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.taskforce.dashboard, {
        query: {
          page: 1,
          limit: 200,
          status: 'open',
          scopeLevel: params.scopeLevel,
          state: params.state,
          lga: params.lga,
        },
      });

      const items =
        (Array.isArray(response.items) ? response.items : null) ??
        (Array.isArray(response.data) ? response.data : null) ??
        [];

      const rows = items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
      const openCases = rows.length;
      const escalatedCases = rows.filter((row) => String(row.status ?? '').toLowerCase() === 'escalated').length;
      const overdueComplaints = rows.filter((row) => String(row.priority ?? '').toLowerCase() === 'high').length;
      const institutions = new Set(rows.map((row) => String(row.institution ?? row.organizationId ?? '')));

      return {
        activeComplaints: Number(response.total ?? rows.length),
        openCases,
        escalatedCases,
        overdueComplaints,
        institutionsUnderReview: Array.from(institutions).filter(Boolean).length,
        recentAuditEvents: Math.min(25, openCases + escalatedCases),
      };
    },
  });
}

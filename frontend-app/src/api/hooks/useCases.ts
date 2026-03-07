import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import type { CaseRow } from '@/api/hooks/taskforceTypes';

export type CasesParams = {
  q?: string;
  stage?: string;
  severity?: string;
  status?: string;
  institution?: string;
  assignedOfficer?: string;
  state?: string;
  lga?: string;
  page: number;
  limit: number;
};

type CasesResult = {
  rows: CaseRow[];
  total: number;
};

function mapCase(item: Record<string, unknown>): CaseRow {
  const id = String(item.caseId ?? item.id ?? crypto.randomUUID());
  const location = (item.location as Record<string, unknown> | undefined) ?? {};
  return {
    id,
    caseId: id,
    sourceComplaint: String(item.sourceComplaint ?? item.originComplaintId ?? item.relatedComplaintId ?? 'N/A'),
    institution: String(item.institution ?? item.organizationId ?? 'N/A'),
    state: String(location.state ?? item.state ?? 'N/A'),
    lga: String(location.lga ?? item.lga ?? 'N/A'),
    assignedOfficer: String(item.assignedOfficer ?? item.assignedTo ?? 'Unassigned'),
    severity: String(item.severity ?? item.priority ?? 'medium'),
    stage: String(item.currentStage ?? item.stage ?? 'intake'),
    status: String(item.status ?? 'open'),
    openedAt: String(item.createdAt ?? item.openedAt ?? new Date().toISOString()),
    updatedAt: String(item.updatedAt ?? item.createdAt ?? new Date().toISOString()),
  };
}

export function useCases(params: CasesParams) {
  return useQuery({
    queryKey: ['taskforce', 'cases', params],
    queryFn: async (): Promise<CasesResult> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.taskforce.cases, {
        query: {
          q: params.q,
          stage: params.stage,
          severity: params.severity,
          status: params.status,
          institution: params.institution,
          assignedOfficer: params.assignedOfficer,
          state: params.state,
          lga: params.lga,
          page: params.page,
          limit: params.limit,
        },
      });
      const items =
        (Array.isArray(response.items) ? response.items : null) ??
        (Array.isArray(response.data) ? response.data : null) ??
        [];
      const rows = items
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map(mapCase);
      return {
        rows,
        total: Number(response.total ?? rows.length),
      };
    },
  });
}

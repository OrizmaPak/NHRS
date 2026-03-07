import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import type { ComplaintRow } from '@/api/hooks/taskforceTypes';

export type ComplaintsParams = {
  q?: string;
  status?: string;
  priority?: string;
  institution?: string;
  state?: string;
  lga?: string;
  page: number;
  limit: number;
};

type ComplaintsResult = {
  rows: ComplaintRow[];
  total: number;
};

function mapComplaint(item: Record<string, unknown>): ComplaintRow {
  const id = String(item.complaintId ?? item.caseId ?? item.id ?? crypto.randomUUID());
  const reporter = String(item.complainant ?? item.createdByUserId ?? 'Anonymous');
  const isAnonymous = Boolean(item.anonymous ?? reporter.toLowerCase() === 'anonymous');
  return {
    id,
    complaintId: id,
    complainant: reporter,
    anonymous: isAnonymous,
    institution: String(item.institution ?? item.organizationId ?? 'N/A'),
    provider: String(item.provider ?? item.providerUserId ?? 'N/A'),
    state: String((item.location as Record<string, unknown> | undefined)?.state ?? item.state ?? 'N/A'),
    lga: String((item.location as Record<string, unknown> | undefined)?.lga ?? item.lga ?? 'N/A'),
    complaintType: String(item.caseType ?? item.complaintType ?? 'GENERAL'),
    priority: String(item.urgency ?? item.priority ?? 'medium'),
    status: String(item.status ?? 'open'),
    createdAt: String(item.createdAt ?? new Date().toISOString()),
    assignedTo: String(item.assignedOfficer ?? item.assignedTo ?? 'Unassigned'),
    linkedCaseId: item.linkedCaseId ? String(item.linkedCaseId) : undefined,
  };
}

export function useComplaints(params: ComplaintsParams) {
  return useQuery({
    queryKey: ['taskforce', 'complaints', params],
    queryFn: async (): Promise<ComplaintsResult> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.taskforce.complaints, {
        query: {
          q: params.q,
          status: params.status,
          priority: params.priority,
          institution: params.institution,
          state: params.state,
          lga: params.lga,
          page: params.page,
          limit: params.limit,
          caseType: 'CITIZEN_COMPLAINT',
        },
      });
      const items =
        (Array.isArray(response.items) ? response.items : null) ??
        (Array.isArray(response.data) ? response.data : null) ??
        [];
      const rows = items
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map(mapComplaint);
      return {
        rows,
        total: Number(response.total ?? rows.length),
      };
    },
  });
}

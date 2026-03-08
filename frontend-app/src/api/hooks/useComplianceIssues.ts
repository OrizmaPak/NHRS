import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type ComplianceIssue = {
  id: string;
  institution: string;
  issueType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recordsAffected: number;
  lastDetected: string;
  status: string;
};

export function useComplianceIssues(filters: {
  severity?: string;
  institution?: string;
  issueType?: string;
  page: number;
  limit: number;
}) {
  return useQuery({
    queryKey: ['compliance', 'issues', filters],
    queryFn: async (): Promise<{ rows: ComplianceIssue[]; total: number }> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.compliance.dataQuality, {
          query: {
            severity: filters.severity,
            institution: filters.institution,
            issueType: filters.issueType,
            page: filters.page,
            limit: filters.limit,
          },
        });

        const items =
          (Array.isArray(response.items) ? response.items : null) ??
          (Array.isArray(response.data) ? response.data : null) ??
          [];

        const rows = items
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((item) => ({
            id: String(item.id ?? crypto.randomUUID()),
            institution: String(item.institution ?? 'Unknown institution'),
            issueType: String(item.issueType ?? 'unknown_issue'),
            severity: String(item.severity ?? 'low').toLowerCase() as ComplianceIssue['severity'],
            recordsAffected: Number(item.recordsAffected ?? 0),
            lastDetected: String(item.lastDetected ?? new Date().toISOString()),
            status: String(item.status ?? 'open'),
          }));

        return { rows, total: Number(response.total ?? rows.length) };
      } catch {
        return { rows: [], total: 0 };
      }
    },
  });
}

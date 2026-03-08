import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type ComplianceSummary = {
  institutionsCompliant: number;
  institutionsWarning: number;
  institutionsUnderReview: number;
  complianceScore: number;
  institutionsWithViolations: Array<{ id: string; institution: string; status: string; severity: string }>;
  overdueComplaints: Array<{ id: string; complaintId: string; institution: string; overdueByDays: number }>;
  unresolvedCases: Array<{ id: string; caseId: string; institution: string; stage: string }>;
};

export function useComplianceSummary() {
  return useQuery({
    queryKey: ['compliance', 'summary'],
    queryFn: async (): Promise<ComplianceSummary> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.compliance.summary);
        const mapRows = (value: unknown): Array<Record<string, unknown>> =>
          Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : [];

        return {
          institutionsCompliant: Number(response.institutionsCompliant ?? 0),
          institutionsWarning: Number(response.institutionsWarning ?? 0),
          institutionsUnderReview: Number(response.institutionsUnderReview ?? 0),
          complianceScore: Number(response.complianceScore ?? 0),
          institutionsWithViolations: mapRows(response.institutionsWithViolations).map((item) => ({
            id: String(item.id ?? crypto.randomUUID()),
            institution: String(item.institution ?? 'Unknown institution'),
            status: String(item.status ?? 'violation'),
            severity: String(item.severity ?? 'high'),
          })),
          overdueComplaints: mapRows(response.overdueComplaints).map((item) => ({
            id: String(item.id ?? crypto.randomUUID()),
            complaintId: String(item.complaintId ?? item.id ?? 'N/A'),
            institution: String(item.institution ?? 'Unknown institution'),
            overdueByDays: Number(item.overdueByDays ?? 0),
          })),
          unresolvedCases: mapRows(response.unresolvedCases).map((item) => ({
            id: String(item.id ?? crypto.randomUUID()),
            caseId: String(item.caseId ?? item.id ?? 'N/A'),
            institution: String(item.institution ?? 'Unknown institution'),
            stage: String(item.stage ?? 'in_review'),
          })),
        };
      } catch {
        return {
          institutionsCompliant: 0,
          institutionsWarning: 0,
          institutionsUnderReview: 0,
          complianceScore: 0,
          institutionsWithViolations: [],
          overdueComplaints: [],
          unresolvedCases: [],
        };
      }
    },
  });
}

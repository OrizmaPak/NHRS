import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type AnalyticsFilters = {
  from?: string;
  to?: string;
  state?: string;
  institutionType?: string;
};

export type TrendPoint = { date: string; value: number; label?: string };

export type AnalyticsDashboardData = {
  patientsRegistered: number;
  encountersPerDay: TrendPoint[];
  labRequestsPerDay: TrendPoint[];
  prescriptionsDispensed: TrendPoint[];
  activeComplaints: number;
  emergencyIncidents: number;
  caseEscalations: number;
  institutionTypeBreakdown: Array<{ name: string; value: number }>;
};

export function useAnalyticsDashboard(filters: AnalyticsFilters = {}) {
  return useQuery({
    queryKey: ['analytics', 'dashboard', filters],
    queryFn: async (): Promise<AnalyticsDashboardData> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.analytics.dashboard, {
          query: {
            from: filters.from,
            to: filters.to,
            state: filters.state,
            institutionType: filters.institutionType,
          },
        });

        const toPoints = (value: unknown): TrendPoint[] =>
          Array.isArray(value)
            ? value
                .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
                .map((item) => ({
                  date: String(item.date ?? item.label ?? ''),
                  value: Number(item.value ?? item.count ?? 0),
                  label: item.label ? String(item.label) : undefined,
                }))
            : [];

        return {
          patientsRegistered: Number(response.patientsRegistered ?? 0),
          encountersPerDay: toPoints(response.encountersPerDay),
          labRequestsPerDay: toPoints(response.labRequestsPerDay),
          prescriptionsDispensed: toPoints(response.prescriptionsDispensed),
          activeComplaints: Number(response.activeComplaints ?? 0),
          emergencyIncidents: Number(response.emergencyIncidents ?? 0),
          caseEscalations: Number(response.caseEscalations ?? 0),
          institutionTypeBreakdown: Array.isArray(response.institutionTypeBreakdown)
            ? (response.institutionTypeBreakdown as Array<Record<string, unknown>>).map((item) => ({
                name: String(item.name ?? 'Unknown'),
                value: Number(item.value ?? 0),
              }))
            : [],
        };
      } catch {
        return {
          patientsRegistered: 0,
          encountersPerDay: [],
          labRequestsPerDay: [],
          prescriptionsDispensed: [],
          activeComplaints: 0,
          emergencyIncidents: 0,
          caseEscalations: 0,
          institutionTypeBreakdown: [],
        };
      }
    },
  });
}

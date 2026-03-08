import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type ReportItem = {
  id: string;
  name: string;
  description: string;
  lastGeneratedAt?: string;
};

export function useReports() {
  return useQuery({
    queryKey: ['reports', 'list'],
    queryFn: async (): Promise<ReportItem[]> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.reports.list);
        const items =
          (Array.isArray(response.items) ? response.items : null) ??
          (Array.isArray(response.data) ? response.data : null) ??
          [];

        return items
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((item) => ({
            id: String(item.reportId ?? item.id ?? crypto.randomUUID()),
            name: String(item.name ?? 'Report'),
            description: String(item.description ?? ''),
            lastGeneratedAt: item.lastGeneratedAt ? String(item.lastGeneratedAt) : undefined,
          }));
      } catch {
        return [];
      }
    },
  });
}

export type ReportDetails = {
  id: string;
  name: string;
  description: string;
  columns: string[];
  rows: Record<string, unknown>[];
};

export function useReportDetails(reportId: string, filters: { from?: string; to?: string; state?: string; institution?: string }) {
  return useQuery({
    queryKey: ['reports', 'details', reportId, filters],
    enabled: Boolean(reportId),
    queryFn: async (): Promise<ReportDetails> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.reports.byId(reportId), {
          query: {
            from: filters.from,
            to: filters.to,
            state: filters.state,
            institution: filters.institution,
          },
        });
        const rows =
          (Array.isArray(response.rows) ? response.rows : null) ??
          (Array.isArray(response.items) ? response.items : null) ??
          [];

        const normalizedRows = rows
          .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'));

        const columns =
          normalizedRows.length > 0
            ? Object.keys(normalizedRows[0])
            : [];

        return {
          id: String(response.reportId ?? response.id ?? reportId),
          name: String(response.name ?? 'Report'),
          description: String(response.description ?? ''),
          columns,
          rows: normalizedRows,
        };
      } catch {
        return { id: reportId, name: 'Report', description: '', columns: [], rows: [] };
      }
    },
  });
}

export function useGenerateReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { reportId: string; filters: { from?: string; to?: string; state?: string; institution?: string } }) =>
      apiClient.post(endpoints.reports.generate(payload.reportId), payload.filters),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reports', 'list'] }),
        queryClient.invalidateQueries({ queryKey: ['reports', 'details', variables.reportId] }),
      ]);
    },
  });
}

export function useDownloadReport() {
  return useMutation({
    mutationFn: async (payload: { reportId: string; format: 'csv' | 'excel' | 'pdf' }) =>
      apiClient.post(endpoints.reports.download(payload.reportId), { format: payload.format }),
  });
}

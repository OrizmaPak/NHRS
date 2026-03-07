import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type TimelineFilters = {
  from?: string;
  to?: string;
  type?: string;
  provider?: string;
};

export type TimelineEntry = {
  id: string;
  recordType: string;
  date: string;
  providerName: string;
  description: string;
  status: string;
};

function mapTimelineEntry(item: Record<string, unknown>): TimelineEntry {
  const createdBy = (item.createdBy as Record<string, unknown> | undefined) ?? {};
  return {
    id: String(item.entryId ?? item.id ?? crypto.randomUUID()),
    recordType: String(item.entryType ?? item.recordType ?? 'record'),
    date: String(item.createdAt ?? item.date ?? new Date().toISOString()),
    providerName: String(
      createdBy.organizationName ??
        createdBy.organizationId ??
        item.providerName ??
        item.organizationName ??
        'Personal',
    ),
    description: String(
      item.summary ??
        (item.payload && typeof item.payload === 'object' && (item.payload as Record<string, unknown>).notes) ??
        item.description ??
        'Health record activity',
    ),
    status: String(item.status ?? 'active'),
  };
}

export function useTimeline(filters: TimelineFilters) {
  return useQuery({
    queryKey: ['timeline', 'me', filters],
    queryFn: async (): Promise<TimelineEntry[]> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.records.me, {
        query: {
          from: filters.from,
          to: filters.to,
          type: filters.type,
          provider: filters.provider,
        },
      });

      const entriesRaw =
        (Array.isArray(response.entries) ? response.entries : null) ??
        (Array.isArray(response.data) ? response.data : null) ??
        [];

      return entriesRaw
        .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
        .map(mapTimelineEntry);
    },
  });
}

export function useAddPersonalEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { symptoms: string; notes?: string; occurredAt?: string }) =>
      apiClient.post(endpoints.records.addSymptom, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['timeline', 'me'] });
    },
  });
}

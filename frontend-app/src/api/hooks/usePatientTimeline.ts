import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type PatientTimelineEntry = {
  id: string;
  recordType: string;
  date: string;
  sourceLabel: string;
  description: string;
  status: string;
};

function mapPatientTimelineEntry(item: Record<string, unknown>): PatientTimelineEntry {
  const createdBy = (item.createdBy as Record<string, unknown> | undefined) ?? {};
  const payload = (item.payload as Record<string, unknown> | undefined) ?? {};
  const organizationName = String(createdBy.organizationName ?? '').trim();
  const institutionName = String(createdBy.institutionName ?? '').trim();
  const branchName = String(createdBy.branchName ?? '').trim();
  const sourceLabel =
    branchName
      ? `${branchName}${institutionName ? ` / ${institutionName}` : ''}`
      : institutionName
        ? institutionName
        : organizationName || String(createdBy.organizationId ?? 'Care record');

  return {
    id: String(item.entryId ?? item.id ?? crypto.randomUUID()),
    recordType: String(item.entryType ?? 'record'),
    date: String(item.createdAt ?? item.updatedAt ?? new Date().toISOString()),
    sourceLabel,
    description: String(
      payload.summary ??
      payload.notes ??
      payload.note ??
      item.summary ??
      item.description ??
      'Timeline activity recorded',
    ),
    status: String(payload.status ?? item.status ?? 'recorded'),
  };
}

export function usePatientTimeline(nin: string, enabled = true) {
  return useQuery({
    queryKey: ['care', 'patient-timeline', nin],
    enabled: Boolean(nin) && enabled,
    queryFn: async (): Promise<PatientTimelineEntry[]> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.records.byNin(nin));
      const entriesRaw =
        (Array.isArray(response.entries) ? response.entries : null) ??
        (Array.isArray(response.data) ? response.data : null) ??
        [];

      return entriesRaw
        .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
        .map(mapPatientTimelineEntry)
        .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
    },
  });
}

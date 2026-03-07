import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import type { ProviderRecordParams } from '@/api/hooks/useEncounters';

export type LabRow = {
  id: string;
  labRequestId: string;
  patientName: string;
  nin: string;
  date: string;
  testName: string;
  interpretation: string;
  provider: string;
  facility: string;
  status: string;
  urgency: string;
};

type LabResult = {
  rows: LabRow[];
  total: number;
};

export function useLabs(nin: string, params: ProviderRecordParams) {
  return useQuery({
    queryKey: ['provider', 'labs', nin, params],
    enabled: Boolean(nin),
    queryFn: async (): Promise<LabResult> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.provider.labsByNin(nin), {
        query: { page: params.page, limit: params.limit, from: params.from, to: params.to },
      });
      const items =
        (Array.isArray(response.items) ? response.items : null) ??
        (Array.isArray(response.data) ? response.data : null) ??
        [];
      const rows = items
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item) => ({
          id: String(item.resultId ?? item.id ?? crypto.randomUUID()),
          labRequestId: String(item.resultId ?? item.requestId ?? item.id ?? crypto.randomUUID()),
          patientName: String(item.patientName ?? item.fullName ?? 'Patient'),
          nin: String(item.nin ?? nin),
          date: String(item.createdAt ?? new Date().toISOString()),
          testName: String(item.testName ?? 'Lab result'),
          interpretation: String(item.interpretation ?? 'Pending interpretation'),
          provider: String(item.providerUserId ?? item.requestingProvider ?? 'Provider'),
          facility: String(item.organizationId ?? item.labFacility ?? 'Lab facility'),
          status: String(item.status ?? 'pending'),
          urgency: String(item.urgency ?? 'routine'),
        }));
      const filtered = rows.filter((row) => {
        const matchesQ = params.q
          ? `${row.patientName} ${row.nin} ${row.testName}`.toLowerCase().includes(params.q.toLowerCase())
          : true;
        const matchesStatus = params.status ? row.status.toLowerCase() === params.status.toLowerCase() : true;
        const matchesType = params.encounterType ? row.testName.toLowerCase().includes(params.encounterType.toLowerCase()) : true;
        const matchesFacility = params.facility ? row.facility.toLowerCase().includes(params.facility.toLowerCase()) : true;
        const matchesClinician = params.clinician ? row.provider.toLowerCase().includes(params.clinician.toLowerCase()) : true;
        return matchesQ && matchesStatus && matchesType && matchesFacility && matchesClinician;
      });
      return { rows: filtered, total: Number(response.total ?? filtered.length) };
    },
  });
}

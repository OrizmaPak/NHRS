import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type ProviderRecordParams = {
  page: number;
  limit: number;
  from?: string;
  to?: string;
  q?: string;
  status?: string;
  encounterType?: string;
  clinician?: string;
  facility?: string;
};

export type EncounterRow = {
  id: string;
  encounterId: string;
  patientName: string;
  nin: string;
  date: string;
  visitType: string;
  diagnosis: string;
  provider: string;
  clinician: string;
  facility: string;
  status: string;
};

type EncounterResult = {
  rows: EncounterRow[];
  total: number;
};

export function useEncounters(nin: string, params: ProviderRecordParams, enabled = true) {
  return useQuery({
    queryKey: ['provider', 'encounters', nin, params],
    enabled: Boolean(nin) && enabled,
    queryFn: async (): Promise<EncounterResult> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.provider.encountersByNin(nin), {
        query: { page: params.page, limit: params.limit, from: params.from, to: params.to },
      });
      const items =
        (Array.isArray(response.items) ? response.items : null) ??
        (Array.isArray(response.data) ? response.data : null) ??
        [];
      const rows = items
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item) => ({
          id: String(item.encounterId ?? item.id ?? crypto.randomUUID()),
          encounterId: String(item.encounterId ?? item.id ?? crypto.randomUUID()),
          patientName: String(item.patientName ?? item.fullName ?? 'Patient'),
          nin: String(item.nin ?? nin),
          date: String(item.createdAt ?? item.updatedAt ?? new Date().toISOString()),
          visitType: String(item.visitType ?? 'outpatient'),
          diagnosis: String(item.diagnosisText ?? item.chiefComplaint ?? 'N/A'),
          provider: String(item.organizationId ?? item.provider ?? 'provider'),
          clinician: String(item.providerUserId ?? item.attendingClinician ?? 'Assigned clinician'),
          facility: String(item.organizationId ?? item.facility ?? 'Facility'),
          status: String(item.status ?? 'draft'),
        }));
      const filtered = rows.filter((row) => {
        const matchesQ = params.q
          ? `${row.patientName} ${row.nin} ${row.diagnosis}`.toLowerCase().includes(params.q.toLowerCase())
          : true;
        const matchesStatus = params.status ? row.status.toLowerCase() === params.status.toLowerCase() : true;
        const matchesType = params.encounterType ? row.visitType.toLowerCase() === params.encounterType.toLowerCase() : true;
        const matchesClinician = params.clinician ? row.clinician.toLowerCase().includes(params.clinician.toLowerCase()) : true;
        const matchesFacility = params.facility ? row.facility.toLowerCase().includes(params.facility.toLowerCase()) : true;
        return matchesQ && matchesStatus && matchesType && matchesClinician && matchesFacility;
      });
      return { rows: filtered, total: Number(response.total ?? filtered.length) };
    },
  });
}

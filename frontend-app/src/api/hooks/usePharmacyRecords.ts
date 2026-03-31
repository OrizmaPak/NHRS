import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import type { ProviderRecordParams } from '@/api/hooks/useEncounters';

export type PharmacyRow = {
  id: string;
  prescriptionId: string;
  patientName: string;
  nin: string;
  date: string;
  medication: string;
  dosage: string;
  provider: string;
  facility: string;
  status: string;
};

type PharmacyResult = {
  rows: PharmacyRow[];
  total: number;
};

export function usePharmacyRecords(nin: string, params: ProviderRecordParams, enabled = true) {
  return useQuery({
    queryKey: ['provider', 'pharmacy', nin, params],
    enabled: Boolean(nin) && enabled,
    queryFn: async (): Promise<PharmacyResult> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.provider.pharmacyByNin(nin), {
        query: { page: params.page, limit: params.limit, from: params.from, to: params.to },
      });
      const items =
        (Array.isArray(response.items) ? response.items : null) ??
        (Array.isArray(response.data) ? response.data : null) ??
        [];
      const rows = items
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item) => {
          const firstItem =
            Array.isArray(item.items) && item.items.length > 0 && typeof item.items[0] === 'object'
              ? (item.items[0] as Record<string, unknown>)
              : null;
          return {
            id: String(item.dispenseId ?? item.id ?? crypto.randomUUID()),
            prescriptionId: String(item.dispenseId ?? item.prescriptionId ?? item.id ?? crypto.randomUUID()),
            patientName: String(item.patientName ?? item.fullName ?? 'Patient'),
            nin: String(item.nin ?? nin),
            date: String(item.createdAt ?? new Date().toISOString()),
            medication: String(firstItem?.drugName ?? 'Medication'),
            dosage: String(firstItem?.dosage ?? firstItem?.frequency ?? 'As prescribed'),
            provider: String(item.providerUserId ?? item.prescriber ?? 'Provider'),
            facility: String(item.organizationId ?? item.pharmacy ?? 'Pharmacy'),
            status: String(item.status ?? 'pending'),
          };
        });
      const filtered = rows.filter((row) => {
        const matchesQ = params.q
          ? `${row.patientName} ${row.nin} ${row.medication}`.toLowerCase().includes(params.q.toLowerCase())
          : true;
        const matchesStatus = params.status ? row.status.toLowerCase() === params.status.toLowerCase() : true;
        const matchesFacility = params.facility ? row.facility.toLowerCase().includes(params.facility.toLowerCase()) : true;
        const matchesClinician = params.clinician ? row.provider.toLowerCase().includes(params.clinician.toLowerCase()) : true;
        return matchesQ && matchesStatus && matchesFacility && matchesClinician;
      });
      return { rows: filtered, total: Number(response.total ?? filtered.length) };
    },
  });
}

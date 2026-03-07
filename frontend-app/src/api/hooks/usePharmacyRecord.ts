import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type PharmacyDetail = {
  id: string;
  prescriptionId: string;
  nin: string;
  patientName: string;
  linkedEncounterId?: string;
  medicationName: string;
  dosage: string;
  route: string;
  frequency: string;
  duration: string;
  quantity: string;
  instructions: string;
  prescriber: string;
  prescribedDate: string;
  facility: string;
  dispenseStatus: string;
  quantityDispensed?: string;
  dispensedBy?: string;
  dispensedDate?: string;
  dispenseNotes?: string;
};

export function usePharmacyRecord(id: string) {
  return useQuery({
    queryKey: ['provider', 'pharmacy-record', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<PharmacyDetail> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.provider.pharmacyById(id));
      const firstItem =
        Array.isArray(response.items) && response.items.length > 0 && typeof response.items[0] === 'object'
          ? (response.items[0] as Record<string, unknown>)
          : {};
      return {
        id: String(response.dispenseId ?? response.prescriptionId ?? response.id ?? id),
        prescriptionId: String(response.dispenseId ?? response.prescriptionId ?? response.id ?? id),
        nin: String(response.nin ?? ''),
        patientName: String(response.patientName ?? response.fullName ?? 'Patient'),
        linkedEncounterId: response.encounterId ? String(response.encounterId) : undefined,
        medicationName: String(firstItem.drugName ?? 'Medication'),
        dosage: String(firstItem.dosage ?? ''),
        route: String(firstItem.route ?? ''),
        frequency: String(firstItem.frequency ?? ''),
        duration: String(firstItem.durationDays ?? ''),
        quantity: String(firstItem.quantity ?? ''),
        instructions: String(response.instructions ?? ''),
        prescriber: String(response.providerUserId ?? 'Provider'),
        prescribedDate: String(response.createdAt ?? new Date().toISOString()),
        facility: String(response.organizationId ?? 'Pharmacy'),
        dispenseStatus: String(response.status ?? 'pending'),
        quantityDispensed: response.quantityDispensed ? String(response.quantityDispensed) : undefined,
        dispensedBy: response.dispensedBy ? String(response.dispensedBy) : undefined,
        dispensedDate: response.dispensedDate ? String(response.dispensedDate) : undefined,
        dispenseNotes: response.dispenseNotes ? String(response.dispenseNotes) : undefined,
      };
    },
  });
}

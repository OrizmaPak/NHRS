import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type EncounterDetail = {
  id: string;
  encounterId: string;
  nin: string;
  patientName: string;
  encounterType: string;
  visitDate: string;
  presentingComplaint: string;
  historyNotes: string;
  diagnosis: string;
  vitalSigns: {
    bp?: string;
    temp?: string;
    pulse?: string;
    weight?: string;
  };
  clinicianNotes: string;
  followUpRecommendation: string;
  status: string;
  provider: string;
  clinician: string;
  linkedLabs: string[];
  linkedPrescriptions: string[];
  updatedAt: string;
};

export function useEncounter(id: string) {
  return useQuery({
    queryKey: ['provider', 'encounter', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<EncounterDetail> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.provider.encounterById(id));
      return {
        id: String(response.encounterId ?? response.id ?? id),
        encounterId: String(response.encounterId ?? response.id ?? id),
        nin: String(response.nin ?? ''),
        patientName: String(response.patientName ?? response.fullName ?? 'Patient'),
        encounterType: String(response.visitType ?? 'outpatient'),
        visitDate: String(response.createdAt ?? new Date().toISOString()),
        presentingComplaint: String(response.chiefComplaint ?? ''),
        historyNotes: String(response.notes ?? ''),
        diagnosis: String(response.diagnosisText ?? ''),
        vitalSigns: {
          bp: String((response.vitals as Record<string, unknown> | undefined)?.bp ?? ''),
          temp: String((response.vitals as Record<string, unknown> | undefined)?.temp ?? ''),
          pulse: String((response.vitals as Record<string, unknown> | undefined)?.pulse ?? ''),
          weight: String((response.vitals as Record<string, unknown> | undefined)?.weight ?? ''),
        },
        clinicianNotes: String(response.notes ?? ''),
        followUpRecommendation: String(response.treatmentPlan ?? ''),
        status: String(response.status ?? 'draft'),
        provider: String(response.organizationId ?? 'Facility'),
        clinician: String(response.providerUserId ?? 'Clinician'),
        linkedLabs: Array.isArray(response.linkedLabs) ? response.linkedLabs.map((v) => String(v)) : [],
        linkedPrescriptions: Array.isArray(response.linkedPrescriptions)
          ? response.linkedPrescriptions.map((v) => String(v))
          : [],
        updatedAt: String(response.updatedAt ?? response.createdAt ?? new Date().toISOString()),
      };
    },
  });
}

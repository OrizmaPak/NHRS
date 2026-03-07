import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type CreateEncounterPayload = {
  nin: string;
  encounterType: string;
  visitDate: string;
  presentingComplaint: string;
  historyNotes?: string;
  diagnosis?: string;
  vitalSigns?: { bp?: string; temp?: string; pulse?: string; weight?: string };
  clinicianNotes?: string;
  followUpRecommendation?: string;
  status?: string;
};

export function useCreateEncounter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateEncounterPayload) =>
      apiClient.post(endpoints.provider.createEncounterByNin(payload.nin), {
        visitType: payload.encounterType,
        createdAt: payload.visitDate,
        chiefComplaint: payload.presentingComplaint,
        notes: payload.historyNotes || payload.clinicianNotes || '',
        diagnosisText: payload.diagnosis || '',
        vitals: payload.vitalSigns || {},
        treatmentPlan: payload.followUpRecommendation || '',
        status: payload.status || 'draft',
      }),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['provider', 'encounters', variables.nin] }),
        queryClient.invalidateQueries({ queryKey: ['provider', 'patient-profile', variables.nin] }),
      ]);
    },
  });
}

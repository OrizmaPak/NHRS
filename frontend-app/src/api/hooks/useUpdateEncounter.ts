import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import type { CreateEncounterPayload } from '@/api/hooks/useCreateEncounter';

export function useUpdateEncounter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateEncounterPayload & { encounterId: string }) =>
      apiClient.patch(endpoints.provider.updateEncounterById(payload.encounterId), {
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
        queryClient.invalidateQueries({ queryKey: ['provider', 'encounter', variables.encounterId] }),
        queryClient.invalidateQueries({ queryKey: ['provider', 'encounters', variables.nin] }),
      ]);
    },
  });
}

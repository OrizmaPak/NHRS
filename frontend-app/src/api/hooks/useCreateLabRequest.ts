import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type CreateLabRequestPayload = {
  nin: string;
  linkedEncounterId?: string;
  testCategory: string;
  testType: string;
  urgency: string;
  notes?: string;
  requestedDate: string;
  specimenInfo?: string;
};

export function useCreateLabRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateLabRequestPayload) =>
      apiClient.post(endpoints.provider.createLabByNin(payload.nin), {
        testCategory: payload.testCategory,
        testName: payload.testType,
        urgency: payload.urgency,
        notes: payload.notes || '',
        createdAt: payload.requestedDate,
        specimenType: payload.specimenInfo || '',
        encounterId: payload.linkedEncounterId,
      }),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['provider', 'labs', variables.nin] }),
        queryClient.invalidateQueries({ queryKey: ['provider', 'patient-profile', variables.nin] }),
      ]);
    },
  });
}

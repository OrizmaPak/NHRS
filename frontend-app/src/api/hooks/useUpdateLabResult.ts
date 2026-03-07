import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type UpdateLabResultPayload = {
  labId: string;
  nin: string;
  resultSummary: string;
  observations: string;
  interpretation: string;
  completedDate?: string;
  status?: string;
};

export function useUpdateLabResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateLabResultPayload) =>
      apiClient.patch(endpoints.provider.updateLabById(payload.labId), {
        resultSummary: payload.resultSummary,
        observations: payload.observations,
        interpretation: payload.interpretation,
        completedAt: payload.completedDate,
        status: payload.status || 'in_progress',
      }),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['provider', 'lab', variables.labId] }),
        queryClient.invalidateQueries({ queryKey: ['provider', 'labs', variables.nin] }),
      ]);
    },
  });
}

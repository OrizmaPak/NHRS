import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export function useCompleteLab() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ labId, nin }: { labId: string; nin: string }) => {
      try {
        return await apiClient.post(endpoints.provider.completeLabById(labId), {});
      } catch {
        return apiClient.patch(endpoints.provider.updateLabById(labId), { status: 'completed', completedAt: new Date().toISOString() });
      }
    },
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['provider', 'lab', variables.labId] }),
        queryClient.invalidateQueries({ queryKey: ['provider', 'labs', variables.nin] }),
      ]);
    },
  });
}

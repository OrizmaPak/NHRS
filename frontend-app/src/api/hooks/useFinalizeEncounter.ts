import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export function useFinalizeEncounter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ encounterId, nin }: { encounterId: string; nin: string }) => {
      try {
        return await apiClient.post(endpoints.provider.finalizeEncounterById(encounterId), {});
      } catch {
        return apiClient.patch(endpoints.provider.updateEncounterById(encounterId), { status: 'finalized' });
      }
    },
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['provider', 'encounter', variables.encounterId] }),
        queryClient.invalidateQueries({ queryKey: ['provider', 'encounters', variables.nin] }),
      ]);
    },
  });
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

type Payload = {
  caseId: string;
  message: string;
};

export function useAddCaseNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Payload) => apiClient.post(endpoints.taskforce.caseNotes(payload.caseId), { message: payload.message }),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['taskforce', 'case', variables.caseId] }),
        queryClient.invalidateQueries({ queryKey: ['taskforce', 'case', variables.caseId, 'notes'] }),
      ]);
    },
  });
}

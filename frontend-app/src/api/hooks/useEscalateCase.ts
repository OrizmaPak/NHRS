import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

type EscalatePayload = {
  caseId: string;
  targetLevel: 'STATE' | 'NATIONAL';
  targetUnit: string;
  reason: string;
  priority: string;
  notes?: string;
};

export function useEscalateCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: EscalatePayload) =>
      apiClient.post(endpoints.taskforce.escalateCase(payload.caseId), {
        targetLevel: payload.targetLevel,
        targetUnit: payload.targetUnit,
        reason: payload.reason,
        priority: payload.priority,
        notes: payload.notes,
      }),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['taskforce', 'cases'] }),
        queryClient.invalidateQueries({ queryKey: ['taskforce', 'case', variables.caseId] }),
      ]);
    },
  });
}

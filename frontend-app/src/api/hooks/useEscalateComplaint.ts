import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

type EscalatePayload = {
  complaintId: string;
  targetLevel: 'STATE' | 'NATIONAL';
  targetUnit: string;
  reason: string;
  priority: string;
  notes?: string;
};

export function useEscalateComplaint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: EscalatePayload) =>
      apiClient.post(endpoints.taskforce.escalateComplaint(payload.complaintId), {
        targetLevel: payload.targetLevel,
        targetUnit: payload.targetUnit,
        reason: payload.reason,
        priority: payload.priority,
        notes: payload.notes,
      }),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['taskforce', 'complaints'] }),
        queryClient.invalidateQueries({ queryKey: ['taskforce', 'complaint', variables.complaintId] }),
      ]);
    },
  });
}

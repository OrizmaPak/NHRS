import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

type AssignPayload = {
  complaintId: string;
  assigneeId: string;
  dueDate?: string;
  priority?: string;
  comment?: string;
};

export function useAssignComplaint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AssignPayload) =>
      apiClient.patch(endpoints.taskforce.assignComplaint(payload.complaintId), {
        assignedOfficer: payload.assigneeId,
        dueDate: payload.dueDate,
        priority: payload.priority,
        comment: payload.comment,
      }),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['taskforce', 'complaints'] }),
        queryClient.invalidateQueries({ queryKey: ['taskforce', 'complaint', variables.complaintId] }),
      ]);
    },
  });
}

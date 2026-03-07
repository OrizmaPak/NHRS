import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

type AssignPayload = {
  caseId: string;
  assigneeId: string;
  dueDate?: string;
  priority?: string;
  comment?: string;
};

export function useAssignCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AssignPayload) =>
      apiClient.patch(endpoints.taskforce.assignCase(payload.caseId), {
        assignedOfficer: payload.assigneeId,
        dueDate: payload.dueDate,
        priority: payload.priority,
        comment: payload.comment,
      }),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['taskforce', 'cases'] }),
        queryClient.invalidateQueries({ queryKey: ['taskforce', 'case', variables.caseId] }),
      ]);
    },
  });
}

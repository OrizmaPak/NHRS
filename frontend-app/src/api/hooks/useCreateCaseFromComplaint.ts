import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export function useCreateCaseFromComplaint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (complaintId: string) => apiClient.post(endpoints.taskforce.convertComplaintToCase(complaintId), {}),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['taskforce', 'complaints'] }),
        queryClient.invalidateQueries({ queryKey: ['taskforce', 'cases'] }),
      ]);
    },
  });
}

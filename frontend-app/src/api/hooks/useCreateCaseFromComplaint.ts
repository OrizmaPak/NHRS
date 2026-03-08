import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export function useCreateCaseFromComplaint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (complaintId: string) =>
      apiClient.post(endpoints.taskforce.convertComplaintToCase(), {
        caseType: 'CITIZEN_COMPLAINT',
        subject: `Complaint ${complaintId}`,
        description: `Case created from complaint ${complaintId}`,
        related: {
          pointers: {
            service: 'complaints-ui',
            resourceId: complaintId,
          },
        },
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['taskforce', 'complaints'] }),
        queryClient.invalidateQueries({ queryKey: ['taskforce', 'cases'] }),
      ]);
    },
  });
}

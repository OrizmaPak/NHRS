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
    mutationFn: async (payload: Payload) => {
      const roomResponse = await apiClient.get<Record<string, unknown>>(endpoints.taskforce.caseRoom(payload.caseId));
      const room = roomResponse.room && typeof roomResponse.room === 'object' ? (roomResponse.room as Record<string, unknown>) : null;
      const roomId = String(room?.roomId ?? '');
      if (!roomId) throw new Error('Case room not found');
      return apiClient.post(endpoints.taskforce.caseRoomMessages(roomId), { body: payload.message });
    },
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['taskforce', 'case', variables.caseId] }),
        queryClient.invalidateQueries({ queryKey: ['taskforce', 'case', variables.caseId, 'notes'] }),
        queryClient.invalidateQueries({ queryKey: ['taskforce', 'case', variables.caseId, 'room'] }),
      ]);
    },
  });
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type DispensePayload = {
  prescriptionId: string;
  nin: string;
  quantityDispensed: string;
  dispensedBy: string;
  dispensedDate: string;
  notes?: string;
  status?: string;
};

export function useDispensePrescription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: DispensePayload) => {
      try {
        return await apiClient.post(endpoints.provider.dispensePharmacyById(payload.prescriptionId), {
          quantityDispensed: payload.quantityDispensed,
          dispensedBy: payload.dispensedBy,
          dispensedDate: payload.dispensedDate,
          dispenseNotes: payload.notes,
          status: payload.status || 'dispensed',
        });
      } catch {
        return apiClient.patch(endpoints.provider.updatePharmacyById(payload.prescriptionId), {
          quantityDispensed: payload.quantityDispensed,
          dispensedBy: payload.dispensedBy,
          dispensedDate: payload.dispensedDate,
          dispenseNotes: payload.notes,
          status: payload.status || 'dispensed',
        });
      }
    },
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['provider', 'pharmacy-record', variables.prescriptionId] }),
        queryClient.invalidateQueries({ queryKey: ['provider', 'pharmacy', variables.nin] }),
      ]);
    },
  });
}

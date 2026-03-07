import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import type { CreatePrescriptionPayload } from '@/api/hooks/useCreatePrescription';

export function useUpdatePrescription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreatePrescriptionPayload & { prescriptionId: string }) =>
      apiClient.patch(endpoints.provider.updatePharmacyById(payload.prescriptionId), {
        encounterId: payload.linkedEncounterId,
        providerUserId: payload.prescribingProvider,
        createdAt: payload.prescribedDate,
        instructions: payload.instructions || '',
        items: [
          {
            drugName: payload.medicationName,
            dosage: payload.dosage,
            route: payload.route,
            frequency: payload.frequency,
            durationDays: payload.duration,
            quantity: payload.quantity,
          },
        ],
      }),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['provider', 'pharmacy-record', variables.prescriptionId] }),
        queryClient.invalidateQueries({ queryKey: ['provider', 'pharmacy', variables.nin] }),
      ]);
    },
  });
}

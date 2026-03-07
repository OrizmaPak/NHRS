import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type CreatePrescriptionPayload = {
  nin: string;
  linkedEncounterId?: string;
  medicationName: string;
  dosage: string;
  route: string;
  frequency: string;
  duration: string;
  quantity: string;
  instructions?: string;
  prescribingProvider?: string;
  prescribedDate: string;
};

export function useCreatePrescription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreatePrescriptionPayload) =>
      apiClient.post(endpoints.provider.createPharmacyByNin(payload.nin), {
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
        status: 'prescribed',
      }),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['provider', 'pharmacy', variables.nin] }),
        queryClient.invalidateQueries({ queryKey: ['provider', 'patient-profile', variables.nin] }),
      ]);
    },
  });
}

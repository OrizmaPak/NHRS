import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type LabDetail = {
  id: string;
  labRequestId: string;
  nin: string;
  patientName: string;
  linkedEncounterId?: string;
  testCategory: string;
  testType: string;
  urgency: string;
  notes: string;
  requestedDate: string;
  specimenInfo: string;
  resultSummary: string;
  observations: string;
  interpretation: string;
  completedDate?: string;
  status: string;
  facility: string;
  provider: string;
};

export function useLab(id: string) {
  return useQuery({
    queryKey: ['provider', 'lab', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<LabDetail> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.provider.labById(id));
      return {
        id: String(response.resultId ?? response.requestId ?? response.id ?? id),
        labRequestId: String(response.resultId ?? response.requestId ?? response.id ?? id),
        nin: String(response.nin ?? ''),
        patientName: String(response.patientName ?? response.fullName ?? 'Patient'),
        linkedEncounterId: response.encounterId ? String(response.encounterId) : undefined,
        testCategory: String(response.testCategory ?? 'general'),
        testType: String(response.testName ?? 'test'),
        urgency: String(response.urgency ?? 'routine'),
        notes: String(response.notes ?? ''),
        requestedDate: String(response.createdAt ?? new Date().toISOString()),
        specimenInfo: String(response.specimenType ?? ''),
        resultSummary: String(response.resultSummary ?? ''),
        observations: String(response.observations ?? ''),
        interpretation: String(response.interpretation ?? ''),
        completedDate: response.completedAt ? String(response.completedAt) : undefined,
        status: String(response.status ?? 'pending'),
        facility: String(response.organizationId ?? 'Lab facility'),
        provider: String(response.providerUserId ?? 'Provider'),
      };
    },
  });
}

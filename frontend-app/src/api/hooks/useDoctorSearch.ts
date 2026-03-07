import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type DoctorSearchParams = {
  q?: string;
  specialization?: string;
  state?: string;
  hospital?: string;
  page: number;
  limit: number;
};

export type DoctorSearchRow = {
  doctorId: string;
  doctorName: string;
  specialty: string;
  institution: string;
  state: string;
  verificationStatus: string;
};

type DoctorSearchResult = {
  rows: DoctorSearchRow[];
  total: number;
};

function mapDoctor(row: Record<string, unknown>): DoctorSearchRow {
  return {
    doctorId: String(row.doctorId ?? row.id ?? row.userId ?? crypto.randomUUID()),
    doctorName: String(row.fullName ?? row.name ?? 'Unknown doctor'),
    specialty: String(row.specialization ?? row.specialty ?? 'General practice'),
    institution: String(
      (Array.isArray(row.affiliations) && (row.affiliations[0] as Record<string, unknown> | undefined)?.orgId) ??
        row.institution ??
        'Unassigned',
    ),
    state: String(row.state ?? row.locationState ?? 'N/A'),
    verificationStatus: String(row.status ?? 'pending'),
  };
}

export function useDoctorSearch(params: DoctorSearchParams) {
  return useQuery({
    queryKey: ['doctor-registry', params],
    queryFn: async (): Promise<DoctorSearchResult> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.doctorRegistry.search, {
        query: {
          q: params.q,
          specialization: params.specialization,
          state: params.state,
          hospital: params.hospital,
          page: params.page,
          limit: params.limit,
        },
        skipAuth: true,
      });

      const items =
        (Array.isArray(response.data) ? response.data : null) ??
        (Array.isArray(response.items) ? response.items : null) ??
        [];
      const rows = items
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map(mapDoctor);

      return {
        rows,
        total: Number(response.total ?? rows.length),
      };
    },
  });
}

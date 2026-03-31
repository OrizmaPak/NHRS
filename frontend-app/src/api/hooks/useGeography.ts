import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type GeoStatus = 'active' | 'inactive';

export type GeoRegionRow = {
  regionId: string;
  name: string;
  code: string;
  status: GeoStatus | string;
  order?: number;
};

export type GeoStateRow = {
  stateId: string;
  name: string;
  code: string;
  regionId: string;
  regionCode?: string;
  regionName?: string;
  status: GeoStatus | string;
};

export type GeoLgaRow = {
  lgaId: string;
  name: string;
  code: string;
  stateId: string;
  stateCode?: string;
  stateName?: string;
  regionId?: string;
  regionCode?: string;
  regionName?: string;
  status: GeoStatus | string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function mapRegion(raw: unknown): GeoRegionRow | null {
  const row = asRecord(raw);
  if (!row) return null;
  const regionId = asString(row.regionId || row.id);
  if (!regionId) return null;
  return {
    regionId,
    name: asString(row.name, 'Region'),
    code: asString(row.code, regionId),
    status: asString(row.status, 'active'),
    order: typeof row.order === 'number' ? row.order : undefined,
  };
}

function mapState(raw: unknown): GeoStateRow | null {
  const row = asRecord(raw);
  if (!row) return null;
  const stateId = asString(row.stateId || row.id);
  if (!stateId) return null;
  return {
    stateId,
    name: asString(row.name, 'State'),
    code: asString(row.code, stateId),
    regionId: asString(row.regionId),
    regionCode: asString(row.regionCode) || undefined,
    regionName: asString(row.regionName) || undefined,
    status: asString(row.status, 'active'),
  };
}

function mapLga(raw: unknown): GeoLgaRow | null {
  const row = asRecord(raw);
  if (!row) return null;
  const lgaId = asString(row.lgaId || row.id);
  if (!lgaId) return null;
  return {
    lgaId,
    name: asString(row.name, 'LGA'),
    code: asString(row.code, lgaId),
    stateId: asString(row.stateId),
    stateCode: asString(row.stateCode) || undefined,
    stateName: asString(row.stateName) || undefined,
    regionId: asString(row.regionId) || undefined,
    regionCode: asString(row.regionCode) || undefined,
    regionName: asString(row.regionName) || undefined,
    status: asString(row.status, 'active'),
  };
}

export function useGeoRegions(params?: { q?: string; includeInactive?: boolean }) {
  return useQuery({
    queryKey: ['geo', 'regions', params ?? {}],
    queryFn: async (): Promise<GeoRegionRow[]> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.geo.regions, {
        query: {
          q: params?.q || undefined,
          includeInactive: params?.includeInactive || undefined,
        },
      });
      const items = Array.isArray(response.items) ? response.items : [];
      return items.map(mapRegion).filter((entry): entry is GeoRegionRow => Boolean(entry));
    },
  });
}

export function useGeoStates(params?: {
  q?: string;
  regionId?: string;
  regionCode?: string;
  includeInactive?: boolean;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['geo', 'states', params ?? {}],
    enabled: params?.enabled ?? true,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<GeoStateRow[]> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.geo.states, {
        query: {
          q: params?.q || undefined,
          regionId: params?.regionId || undefined,
          regionCode: params?.regionCode || undefined,
          includeInactive: params?.includeInactive || undefined,
        },
      });
      const items = Array.isArray(response.items) ? response.items : [];
      return items.map(mapState).filter((entry): entry is GeoStateRow => Boolean(entry));
    },
  });
}

export function useGeoLgas(params?: {
  q?: string;
  stateId?: string;
  stateCode?: string;
  regionId?: string;
  includeInactive?: boolean;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['geo', 'lgas', params ?? {}],
    enabled: params?.enabled ?? true,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<GeoLgaRow[]> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.geo.lgas, {
        query: {
          q: params?.q || undefined,
          stateId: params?.stateId || undefined,
          stateCode: params?.stateCode || undefined,
          regionId: params?.regionId || undefined,
          includeInactive: params?.includeInactive || undefined,
        },
      });
      const items = Array.isArray(response.items) ? response.items : [];
      return items.map(mapLga).filter((entry): entry is GeoLgaRow => Boolean(entry));
    },
  });
}

export function useGeoHierarchy(enabled = true) {
  return useQuery({
    queryKey: ['geo', 'hierarchy'],
    enabled,
    queryFn: async (): Promise<Array<GeoRegionRow & { states: Array<GeoStateRow & { lgas: GeoLgaRow[] }> }>> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.geo.hierarchy);
      const items = Array.isArray(response.items) ? response.items : [];
      return items
        .map((rawRegion) => {
          const region = mapRegion(rawRegion);
          if (!region) return null;
          const regionRow = asRecord(rawRegion);
          const states = Array.isArray(regionRow?.states)
            ? regionRow.states
                .map((rawState) => {
                  const state = mapState(rawState);
                  if (!state) return null;
                  const stateRow = asRecord(rawState);
                  const lgas = Array.isArray(stateRow?.lgas)
                    ? stateRow.lgas.map(mapLga).filter((entry): entry is GeoLgaRow => Boolean(entry))
                    : [];
                  return { ...state, lgas };
                })
                .filter((entry): entry is GeoStateRow & { lgas: GeoLgaRow[] } => Boolean(entry))
            : [];
          return { ...region, states };
        })
        .filter((entry): entry is GeoRegionRow & { states: Array<GeoStateRow & { lgas: GeoLgaRow[] }> } => Boolean(entry));
    },
  });
}

function invalidateGeo(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['geo', 'regions'] });
  queryClient.invalidateQueries({ queryKey: ['geo', 'states'] });
  queryClient.invalidateQueries({ queryKey: ['geo', 'lgas'] });
  queryClient.invalidateQueries({ queryKey: ['geo', 'hierarchy'] });
}

export function useCreateGeoRegion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { name: string; code?: string; status?: GeoStatus }) =>
      apiClient.post<Record<string, unknown>>(endpoints.geo.regions, payload),
    onSuccess: () => invalidateGeo(queryClient),
  });
}

export function useUpdateGeoRegion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { regionId: string; name?: string; code?: string; status?: GeoStatus }) => {
      const { regionId, ...body } = payload;
      return apiClient.patch<Record<string, unknown>>(endpoints.geo.regionById(regionId), body);
    },
    onSuccess: () => invalidateGeo(queryClient),
  });
}

export function useCreateGeoState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { name: string; code?: string; regionId: string; status?: GeoStatus }) =>
      apiClient.post<Record<string, unknown>>(endpoints.geo.states, payload),
    onSuccess: () => invalidateGeo(queryClient),
  });
}

export function useUpdateGeoState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { stateId: string; name?: string; code?: string; regionId?: string; status?: GeoStatus }) => {
      const { stateId, ...body } = payload;
      return apiClient.patch<Record<string, unknown>>(endpoints.geo.stateById(stateId), body);
    },
    onSuccess: () => invalidateGeo(queryClient),
  });
}

export function useCreateGeoLga() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { name: string; code?: string; stateId: string; status?: GeoStatus }) =>
      apiClient.post<Record<string, unknown>>(endpoints.geo.lgas, payload),
    onSuccess: () => invalidateGeo(queryClient),
  });
}

export function useUpdateGeoLga() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { lgaId: string; name?: string; code?: string; stateId?: string; status?: GeoStatus }) => {
      const { lgaId, ...body } = payload;
      return apiClient.patch<Record<string, unknown>>(endpoints.geo.lgaById(lgaId), body);
    },
    onSuccess: () => invalidateGeo(queryClient),
  });
}

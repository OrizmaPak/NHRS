import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type OrganizationType = 'hospital' | 'laboratory' | 'pharmacy' | 'government' | 'emergency' | 'catalog';
export type BranchCapability = 'hospital' | 'clinic' | 'laboratory' | 'pharmacy';

export type BranchRow = {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  type: string | null;
  capabilities: BranchCapability[];
  state: string;
  lga: string;
  status: string;
  updatedAt?: string;
};

export type InstitutionRow = {
  id: string;
  organizationId: string;
  name: string;
  type: string;
  description: string;
  registrationNumber: string;
  state: string;
  lga: string;
  status: string;
  ownerUserId?: string;
  ownerNin?: string;
  createdAt?: string;
  updatedAt?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function mapOrganizationRow(raw: unknown): InstitutionRow | null {
  const row = asRecord(raw);
  if (!row) return null;
  const location = asRecord(row.location);
  const organizationId = asString(row.organizationId || row.id);
  if (!organizationId) return null;
  return {
    id: organizationId,
    organizationId,
    name: asString(row.name, 'Institution'),
    type: asString(row.type, 'general'),
    description: asString(row.description),
    registrationNumber: asString(row.registrationNumber),
    state: asString(location?.state, 'N/A'),
    lga: asString(location?.lga, 'N/A'),
    status: asString(row.status, 'active'),
    ownerUserId: asString(row.ownerUserId) || undefined,
    ownerNin: asString(row.ownerNin) || undefined,
    createdAt: asString(row.createdAt) || undefined,
    updatedAt: asString(row.updatedAt) || undefined,
  };
}

function mapBranchRow(raw: unknown): BranchRow | null {
  const row = asRecord(raw);
  if (!row) return null;
  const location = asRecord(row.location);
  const branchId = asString(row.branchId || row.id);
  if (!branchId) return null;
  const capabilitiesRaw = Array.isArray(row.capabilities) ? row.capabilities : [];
  const capabilities = capabilitiesRaw
    .map((item) => asString(item).trim().toLowerCase())
    .filter((item): item is BranchCapability =>
      ['hospital', 'clinic', 'laboratory', 'pharmacy'].includes(item)
    );

  return {
    id: branchId,
    organizationId: asString(row.organizationId),
    name: asString(row.name, 'Branch'),
    code: asString(row.code, 'N/A'),
    type: asString(row.type) || null,
    capabilities,
    state: asString(location?.state, 'N/A'),
    lga: asString(location?.lga, 'N/A'),
    status: asString(row.status, 'active'),
    updatedAt: asString(row.updatedAt) || undefined,
  };
}

type InstitutionsParams = {
  page: number;
  limit: number;
  q?: string;
};

export function useInstitutions(params: InstitutionsParams) {
  return useQuery({
    queryKey: ['org', 'institutions', params],
    queryFn: async (): Promise<{ rows: InstitutionRow[]; total: number }> => {
      const hasQuery = Boolean(params.q && params.q.trim().length > 0);
      const path = hasQuery ? endpoints.org.search : endpoints.org.list;
      const response = await apiClient.get<Record<string, unknown>>(path, {
        query: {
          page: params.page,
          limit: params.limit,
          q: hasQuery ? params.q : undefined,
        },
      });

      const items = (Array.isArray(response.items) ? response.items : [])
        .map(mapOrganizationRow)
        .filter((row): row is InstitutionRow => Boolean(row));

      return { rows: items, total: Number(response.total ?? items.length) };
    },
  });
}

export function useCreateInstitution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      name: string;
      type: OrganizationType;
      description?: string;
      registrationNumber?: string;
      location?: { state?: string; lga?: string; addressText?: string };
      ownerNin?: string;
      ownerUserId?: string;
    }) => apiClient.post<{ organization?: unknown }>(endpoints.org.list, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org', 'institutions'] });
    },
  });
}

export function useUpdateInstitution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      orgId: string;
      name?: string;
      description?: string;
      registrationNumber?: string;
      status?: 'active' | 'suspended';
      location?: { state?: string; lga?: string; addressText?: string };
    }) => apiClient.patch<{ organization?: unknown }>(endpoints.org.byId(payload.orgId), payload),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['org', 'institutions'] });
      queryClient.invalidateQueries({ queryKey: ['org', 'institution', variables.orgId] });
    },
  });
}

export function useInstitutionBranches(orgId?: string) {
  return useQuery({
    queryKey: ['org', 'branches', orgId ?? 'none'],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<BranchRow[]> => {
      if (!orgId) return [];
      const response = await apiClient.get<Record<string, unknown>>(endpoints.org.branches(orgId));
      const items = Array.isArray(response.items) ? response.items : [];
      return items.map(mapBranchRow).filter((row): row is BranchRow => Boolean(row));
    },
  });
}

export function useCreateBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      orgId: string;
      name: string;
      code: string;
      capabilities: BranchCapability[];
      type?: BranchCapability;
      location?: { state?: string; lga?: string; addressText?: string };
      address?: Record<string, unknown>;
      contact?: Record<string, unknown>;
    }) => {
      const body = {
        name: payload.name,
        code: payload.code,
        type: payload.type,
        capabilities: payload.capabilities,
        location: payload.location,
        address: payload.address,
        contact: payload.contact,
      };
      return apiClient.post<{ branch?: unknown }>(endpoints.org.branches(payload.orgId), body);
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['org', 'branches', variables.orgId] });
    },
  });
}

export function useUpdateBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      orgId: string;
      branchId: string;
      name?: string;
      code?: string;
      status?: 'active' | 'closed';
      capabilities?: BranchCapability[];
      type?: BranchCapability;
      location?: { state?: string; lga?: string; addressText?: string };
    }) => {
      const { orgId, branchId, ...body } = payload;
      return apiClient.patch<{ branch?: unknown }>(endpoints.org.branchById(orgId, branchId), body);
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['org', 'branches', variables.orgId] });
    },
  });
}


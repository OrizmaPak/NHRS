import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type OrganizationType = 'hospital' | 'laboratory' | 'pharmacy' | 'government' | 'emergency' | 'catalog';
export type InstitutionType = OrganizationType | 'clinic';
export type BranchCapability = 'hospital' | 'clinic' | 'laboratory' | 'pharmacy';

export type OrganizationRow = {
  id: string;
  organizationId: string;
  name: string;
  type: string;
  description: string;
  registrationNumber: string;
  ownerType?: string;
  foundedAt?: string;
  openedAt?: string;
  website?: string;
  logoUrl?: string;
  cacDocumentUrl?: string;
  cscDocumentUrl?: string;
  documents?: Array<{
    documentId: string;
    title: string | null;
    type: string;
    url: string;
    uploadedAt: string;
    notes: string | null;
  }>;
  metadata?: Record<string, unknown>;
  state: string;
  lga: string;
  status: string;
  approvalStatus?: 'pending' | 'approved' | 'declined' | 'revoked';
  lifecycleStatus?: 'active' | 'suspended' | 'delete_pending' | 'deleted';
  hqInstitutionId?: string;
  ownerUserId?: string;
  ownerNin?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
  deletionReason?: string;
  deletionRequestedAt?: string;
  viewerScopeLevel?: 'organization' | 'institution' | 'branch' | 'none';
  viewerBranchIds?: string[];
};

export type InstitutionRow = {
  id: string;
  institutionId: string;
  organizationId: string;
  name: string;
  code: string;
  type: string;
  description: string;
  state: string;
  lga: string;
  status: 'active' | 'inactive' | 'suspended' | 'deleted' | string;
  isHeadquarters: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type BranchRow = {
  id: string;
  branchId: string;
  institutionId: string;
  organizationId: string;
  name: string;
  code: string;
  type: string | null;
  capabilities: BranchCapability[];
  state: string;
  lga: string;
  status: 'active' | 'closed' | 'suspended' | 'deleted' | string;
  updatedAt?: string;
};

export type ViewerScope = {
  level?: 'organization' | 'institution' | 'branch' | 'none';
  reason?: string;
  message?: string;
  institutionIds?: string[];
  branchIds?: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function mapOrganizationRow(raw: unknown): OrganizationRow | null {
  const row = asRecord(raw);
  if (!row) return null;
  const location = asRecord(row.location);
  const viewerScope = asRecord(row.viewerScope);
  const organizationId = asString(row.organizationId || row.id);
  if (!organizationId) return null;
  return {
    id: organizationId,
    organizationId,
    name: asString(row.name, 'Organization'),
    type: asString(row.type, 'general'),
    description: asString(row.description),
    registrationNumber: asString(row.registrationNumber),
    ownerType: asString(row.ownerType) || undefined,
    foundedAt: asString(row.foundedAt) || undefined,
    openedAt: asString(row.openedAt) || undefined,
    website: asString(row.website) || undefined,
    logoUrl: asString(row.logoUrl) || undefined,
    cacDocumentUrl: asString(row.cacDocumentUrl || row.cscDocumentUrl) || undefined,
    cscDocumentUrl: asString(row.cscDocumentUrl) || undefined,
    documents: Array.isArray(row.documents)
      ? row.documents
          .map((entry) => asRecord(entry))
          .filter((entry): entry is Record<string, unknown> => Boolean(entry))
          .map((entry) => ({
            documentId: asString(entry.documentId || entry.id) || crypto.randomUUID(),
            title: asString(entry.title) || null,
            type: asString(entry.type, 'other'),
            url: asString(entry.url),
            uploadedAt: asString(entry.uploadedAt) || new Date().toISOString(),
            notes: asString(entry.notes) || null,
          }))
          .filter((entry) => Boolean(entry.url))
      : [],
    metadata: asRecord(row.metadata) ?? undefined,
    state: asString(location?.state, 'N/A'),
    lga: asString(location?.lga, 'N/A'),
    status: asString(row.status, 'active'),
    approvalStatus: (asString(row.approvalStatus) || undefined) as OrganizationRow['approvalStatus'],
    lifecycleStatus: (asString(row.lifecycleStatus) || undefined) as OrganizationRow['lifecycleStatus'],
    hqInstitutionId: asString(row.hqInstitutionId) || undefined,
    ownerUserId: asString(row.ownerUserId) || undefined,
    ownerNin: asString(row.ownerNin) || undefined,
    createdAt: asString(row.createdAt) || undefined,
    updatedAt: asString(row.updatedAt) || undefined,
    deletedAt: asString(row.deletedAt) || undefined,
    deletionReason: asString(row.deletionReason) || undefined,
    deletionRequestedAt: asString(row.deletionRequestedAt) || undefined,
    viewerScopeLevel: asString(viewerScope?.level) as OrganizationRow['viewerScopeLevel'],
    viewerBranchIds: Array.isArray(viewerScope?.branchIds)
      ? viewerScope.branchIds.map((entry) => String(entry)).filter(Boolean)
      : undefined,
  };
}

function mapInstitutionRow(raw: unknown): InstitutionRow | null {
  const row = asRecord(raw);
  if (!row) return null;
  const location = asRecord(row.location);
  const institutionId = asString(row.institutionId || row.id);
  if (!institutionId) return null;
  return {
    id: institutionId,
    institutionId,
    organizationId: asString(row.organizationId),
    name: asString(row.name, 'Institution'),
    code: asString(row.code, 'N/A'),
    type: asString(row.type, 'hospital'),
    description: asString(row.description),
    state: asString(location?.state, 'N/A'),
    lga: asString(location?.lga, 'N/A'),
    status: asString(row.status, 'active'),
    isHeadquarters: Boolean(row.isHeadquarters),
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
    branchId,
    institutionId: asString(row.institutionId),
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

type OrganizationsParams = {
  page: number;
  limit: number;
  q?: string;
};

export function useOrganizations(params: OrganizationsParams) {
  return useQuery({
    queryKey: ['org', 'organizations', params],
    queryFn: async (): Promise<{ rows: OrganizationRow[]; total: number }> => {
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
        .filter((row): row is OrganizationRow => Boolean(row));

      return { rows: items, total: Number(response.total ?? items.length) };
    },
  });
}

export function useOrgInstitutions(orgId?: string) {
  return useQuery({
    queryKey: ['org', 'institutions', orgId ?? 'none'],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<{ rows: InstitutionRow[]; viewerScope?: Record<string, unknown> }> => {
      if (!orgId) return { rows: [] };
      const response = await apiClient.get<Record<string, unknown>>(endpoints.org.institutions(orgId));
      const items = Array.isArray(response.items) ? response.items : [];
      return {
        rows: items.map(mapInstitutionRow).filter((row): row is InstitutionRow => Boolean(row)),
        viewerScope: asRecord(response.viewerScope) ?? undefined,
      };
    },
  });
}

export function useOrgDetails(orgId?: string) {
  return useQuery({
    queryKey: ['org', 'organization', orgId ?? 'none'],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<{ organization: OrganizationRow | null; viewerScope?: ViewerScope }> => {
      if (!orgId) return { organization: null };
      const response = await apiClient.get<Record<string, unknown>>(endpoints.org.byId(orgId));
      return {
        organization: mapOrganizationRow(response.organization),
        viewerScope: (asRecord(response.viewerScope) as ViewerScope | null) ?? undefined,
      };
    },
  });
}

export function useInstitutionBranches(orgId?: string, institutionId?: string) {
  return useQuery({
    queryKey: ['org', 'branches', orgId ?? 'none', institutionId ?? 'none'],
    enabled: Boolean(orgId && institutionId),
    queryFn: async (): Promise<BranchRow[]> => {
      if (!orgId || !institutionId) return [];
      const response = await apiClient.get<Record<string, unknown>>(endpoints.org.institutionBranches(orgId, institutionId));
      const items = Array.isArray(response.items) ? response.items : [];
      return items.map(mapBranchRow).filter((row): row is BranchRow => Boolean(row));
    },
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      name: string;
      type: OrganizationType;
      description?: string;
      registrationNumber?: string;
      ownerType?: string;
      foundedAt?: string;
      openedAt?: string;
      website?: string;
      logoUrl?: string;
      cacDocumentUrl?: string;
      documents?: Array<Record<string, unknown>>;
      metadata?: Record<string, unknown>;
      location?: { state?: string; lga?: string; addressText?: string };
      ownerNin?: string;
      ownerUserId?: string;
    }) => apiClient.post<{ organization?: unknown }>(endpoints.org.list, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org', 'organizations'] });
    },
  });
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      orgId: string;
      name?: string;
      description?: string;
      registrationNumber?: string;
      ownerType?: string;
      foundedAt?: string;
      openedAt?: string;
      website?: string;
      logoUrl?: string;
      cacDocumentUrl?: string;
      documents?: Array<Record<string, unknown>>;
      metadata?: Record<string, unknown>;
      status?: 'active' | 'suspended' | 'delete_pending' | 'deleted' | 'pending_approval' | 'declined';
      lifecycleStatus?: 'active' | 'suspended' | 'delete_pending' | 'deleted';
      location?: { state?: string; lga?: string; addressText?: string };
    }) => apiClient.patch<{ organization?: unknown }>(endpoints.org.byId(payload.orgId), payload),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['org', 'organizations'] });
      queryClient.invalidateQueries({ queryKey: ['org', 'organization', variables.orgId] });
    },
  });
}

export function useDeletedOrganizations(params: { page: number; limit: number }) {
  return useQuery({
    queryKey: ['org', 'deleted-organizations', params],
    queryFn: async (): Promise<{ rows: Array<OrganizationRow & { institutions: InstitutionRow[]; branches: BranchRow[] }>; total: number }> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.org.deleted, {
        query: {
          page: params.page,
          limit: params.limit,
        },
      });
      const items = Array.isArray(response.items) ? response.items : [];
      const rows = items.reduce<Array<OrganizationRow & { institutions: InstitutionRow[]; branches: BranchRow[] }>>((acc, entry) => {
          const org = mapOrganizationRow(entry);
          if (!org) return acc;
          const row = asRecord(entry);
          const institutions = Array.isArray(row?.institutions)
            ? row.institutions.map(mapInstitutionRow).filter((v): v is InstitutionRow => Boolean(v))
            : [];
          const branches = Array.isArray(row?.branches)
            ? row.branches.map(mapBranchRow).filter((v): v is BranchRow => Boolean(v))
            : [];
          acc.push({ ...org, institutions, branches });
          return acc;
        }, []);
      return { rows, total: Number(response.total ?? rows.length) };
    },
  });
}

export function useReviewOrganizationApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      orgId: string;
      decision: 'approve' | 'decline' | 'revoke';
      notes?: string;
    }) => apiClient.post<{ organization?: unknown }>(endpoints.org.approval(payload.orgId), {
      decision: payload.decision,
      notes: payload.notes || undefined,
    }),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['org', 'organizations'] });
      await queryClient.invalidateQueries({ queryKey: ['org', 'organization', variables.orgId] });
      await queryClient.invalidateQueries({ queryKey: ['org', 'scoped-institutions'] });
      await queryClient.invalidateQueries({ queryKey: ['org', 'scoped-branches'] });
    },
  });
}

export function useRequestOrganizationDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { orgId: string; reason?: string }) =>
      apiClient.post<{ organization?: unknown }>(endpoints.org.deletionRequest(payload.orgId), {
        reason: payload.reason || undefined,
      }),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['org', 'organizations'] });
      await queryClient.invalidateQueries({ queryKey: ['org', 'organization', variables.orgId] });
    },
  });
}

export function useReviewOrganizationDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      orgId: string;
      decision: 'approve' | 'decline';
      notes?: string;
    }) =>
      apiClient.post<{ organization?: unknown }>(endpoints.org.deletionReview(payload.orgId), {
        decision: payload.decision,
        notes: payload.notes || undefined,
      }),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['org', 'organizations'] });
      await queryClient.invalidateQueries({ queryKey: ['org', 'deleted-organizations'] });
      await queryClient.invalidateQueries({ queryKey: ['org', 'organization', variables.orgId] });
      await queryClient.invalidateQueries({ queryKey: ['org', 'scoped-institutions'] });
      await queryClient.invalidateQueries({ queryKey: ['org', 'scoped-branches'] });
    },
  });
}

export function useRestoreOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { orgId: string; reason?: string }) =>
      apiClient.post<{ organization?: unknown }>(endpoints.org.restore(payload.orgId), {
        reason: payload.reason || undefined,
      }),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['org', 'organizations'] });
      await queryClient.invalidateQueries({ queryKey: ['org', 'deleted-organizations'] });
      await queryClient.invalidateQueries({ queryKey: ['org', 'organization', variables.orgId] });
      await queryClient.invalidateQueries({ queryKey: ['org', 'scoped-institutions'] });
      await queryClient.invalidateQueries({ queryKey: ['org', 'scoped-branches'] });
    },
  });
}

async function fileToBase64(file: File): Promise<string> {
  const raw = await file.arrayBuffer();
  const bytes = new Uint8Array(raw);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function useUploadOrganizationFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { orgId: string; kind: 'logo' | 'cac'; file: File }) => {
      const contentBase64 = await fileToBase64(payload.file);
      return apiClient.post<Record<string, unknown>>(endpoints.org.uploadFile(payload.orgId), {
        kind: payload.kind,
        upload: {
          filename: payload.file.name,
          contentType: payload.file.type,
          contentBase64,
        },
      });
    },
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['org', 'organizations'] });
      await queryClient.invalidateQueries({ queryKey: ['org', 'organization', variables.orgId] });
    },
  });
}

export function useCreateOrgInstitution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      orgId: string;
      name: string;
      code?: string;
      type?: InstitutionType;
      description?: string;
      status?: 'active' | 'inactive' | 'suspended';
      location?: { state?: string; lga?: string; addressText?: string };
      contact?: Record<string, unknown>;
    }) => {
      const { orgId, ...body } = payload;
      return apiClient.post<{ institution?: unknown }>(endpoints.org.institutions(orgId), body);
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['org', 'institutions', variables.orgId] });
    },
  });
}

export function useUpdateOrgInstitution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      orgId: string;
      institutionId: string;
      name?: string;
      code?: string;
      type?: InstitutionType;
      description?: string;
      status?: 'active' | 'inactive' | 'suspended';
      location?: { state?: string; lga?: string; addressText?: string };
      contact?: Record<string, unknown>;
    }) => {
      const { orgId, institutionId, ...body } = payload;
      return apiClient.patch<{ institution?: unknown }>(endpoints.org.institutionById(orgId, institutionId), body);
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['org', 'institutions', variables.orgId] });
    },
  });
}

export function useCreateBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      orgId: string;
      institutionId: string;
      name: string;
      code: string;
      capabilities: BranchCapability[];
      type?: BranchCapability;
      location?: { state?: string; lga?: string; addressText?: string };
      address?: Record<string, unknown>;
      contact?: Record<string, unknown>;
    }) => {
      const { orgId, institutionId, ...body } = payload;
      return apiClient.post<{ branch?: unknown }>(endpoints.org.institutionBranches(orgId, institutionId), body);
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['org', 'branches', variables.orgId, variables.institutionId] });
    },
  });
}

export function useUpdateBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      orgId: string;
      institutionId: string;
      branchId: string;
      name?: string;
      code?: string;
      status?: 'active' | 'closed' | 'suspended';
      capabilities?: BranchCapability[];
      type?: BranchCapability;
      location?: { state?: string; lga?: string; addressText?: string };
    }) => {
      const { orgId, institutionId, branchId, ...body } = payload;
      return apiClient.patch<{ branch?: unknown }>(endpoints.org.institutionBranchById(orgId, institutionId, branchId), body);
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['org', 'branches', variables.orgId, variables.institutionId] });
    },
  });
}

type ScopedInstitutionsParams = {
  page: number;
  limit: number;
  orgId?: string;
  q?: string;
  status?: string;
  type?: string;
  state?: string;
  lga?: string;
};

export function useScopedInstitutions(params: ScopedInstitutionsParams) {
  return useQuery({
    queryKey: ['org', 'scoped-institutions', params],
    queryFn: async (): Promise<{ rows: InstitutionRow[]; total: number }> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.org.globalInstitutions, {
        query: {
          page: params.page,
          limit: params.limit,
          orgId: params.orgId || undefined,
          q: params.q || undefined,
          status: params.status || undefined,
          type: params.type || undefined,
          state: params.state || undefined,
          lga: params.lga || undefined,
        },
      });
      const items = Array.isArray(response.items) ? response.items : [];
      const rows = items.map(mapInstitutionRow).filter((row): row is InstitutionRow => Boolean(row));
      return { rows, total: Number(response.total ?? rows.length) };
    },
  });
}

export function useInstitutionById(institutionId?: string) {
  return useQuery({
    queryKey: ['org', 'institution', institutionId ?? 'none'],
    enabled: Boolean(institutionId),
    queryFn: async (): Promise<{ institution: InstitutionRow | null; viewerScope?: ViewerScope }> => {
      if (!institutionId) return { institution: null };
      const response = await apiClient.get<Record<string, unknown>>(endpoints.org.globalInstitutionById(institutionId));
      return {
        institution: mapInstitutionRow(response.institution),
        viewerScope: (asRecord(response.viewerScope) as ViewerScope | null) ?? undefined,
      };
    },
  });
}

type ScopedBranchesParams = {
  page: number;
  limit: number;
  orgId?: string;
  institutionId?: string;
  q?: string;
  status?: string;
  type?: string;
  capability?: string;
  state?: string;
  lga?: string;
};

export function useScopedBranches(params: ScopedBranchesParams) {
  return useQuery({
    queryKey: ['org', 'scoped-branches', params],
    queryFn: async (): Promise<{ rows: BranchRow[]; total: number }> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.org.globalBranches, {
        query: {
          page: params.page,
          limit: params.limit,
          orgId: params.orgId || undefined,
          institutionId: params.institutionId || undefined,
          q: params.q || undefined,
          status: params.status || undefined,
          type: params.type || undefined,
          capability: params.capability || undefined,
          state: params.state || undefined,
          lga: params.lga || undefined,
        },
      });
      const items = Array.isArray(response.items) ? response.items : [];
      const rows = items.map(mapBranchRow).filter((row): row is BranchRow => Boolean(row));
      return { rows, total: Number(response.total ?? rows.length) };
    },
  });
}

export function useBranchById(branchId?: string) {
  return useQuery({
    queryKey: ['org', 'branch', branchId ?? 'none'],
    enabled: Boolean(branchId),
    queryFn: async (): Promise<{ branch: BranchRow | null; viewerScope?: ViewerScope }> => {
      if (!branchId) return { branch: null };
      const response = await apiClient.get<Record<string, unknown>>(endpoints.org.globalBranchById(branchId));
      return {
        branch: mapBranchRow(response.branch),
        viewerScope: (asRecord(response.viewerScope) as ViewerScope | null) ?? undefined,
      };
    },
  });
}

// Backward-compatible aliases used by existing module imports.
export type { OrganizationRow as InstitutionRowLegacy };
export const useInstitutions = useOrganizations;
export const useCreateInstitution = useCreateOrganization;
export const useUpdateInstitution = useUpdateOrganization;

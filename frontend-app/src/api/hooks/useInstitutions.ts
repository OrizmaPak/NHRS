import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiClientError, apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { mergeGlobalServiceNames, normalizeGlobalServiceName } from '@/api/hooks/useGlobalServices';

export type InstitutionType = 'hospital' | 'laboratory' | 'pharmacy' | 'government' | 'emergency' | 'catalog' | 'clinic';
export type BranchCapability = 'hospital' | 'clinic' | 'laboratory' | 'pharmacy';
export type BranchType = BranchCapability;

export type OrganizationRow = {
  id: string;
  organizationId: string;
  name: string;
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
  organizationName?: string;
  name: string;
  code: string;
  type: string;
  description: string;
  address?: Record<string, unknown> | null;
  contact?: Record<string, unknown> | null;
  documents?: Array<{
    documentId: string;
    title: string | null;
    type: string;
    url: string;
    uploadedAt: string;
    notes: string | null;
  }>;
  metadata?: Record<string, unknown>;
  additionalServices: string[];
  openingHours?: string;
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
  organizationName?: string;
  institutionName?: string;
  name: string;
  code: string;
  type: BranchType | null;
  capabilities: BranchCapability[];
  address?: Record<string, unknown> | null;
  contact?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  additionalServices: string[];
  openingHours?: string;
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

export type PublicOrganizationRow = OrganizationRow & {
  publicInfo?: string | null;
  openingHours?: string | null;
  institutionsCount?: number;
  institutions?: Array<{
    institutionId: string;
    name: string;
    type: string;
    status: string;
    state: string | null;
    lga: string | null;
  }>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeAdditionalServices(value: unknown): string[] {
  return mergeGlobalServiceNames(Array.isArray(value) ? value : []);
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
  const address = asRecord(row.address);
  const organization = asRecord(row.organization);
  const metadata = asRecord(row.metadata);
  const institutionId = asString(row.institutionId || row.id);
  if (!institutionId) return null;
  return {
    id: institutionId,
    institutionId,
    organizationId: asString(row.organizationId),
    organizationName: asString(row.organizationName || organization?.name) || undefined,
    name: asString(row.name, 'Institution'),
    code: asString(row.code, 'N/A'),
    type: asString(row.type, 'hospital'),
    description: asString(row.description),
    address: address ?? null,
    contact: asRecord(row.contact) ?? null,
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
    metadata: metadata ?? undefined,
    additionalServices: normalizeAdditionalServices(metadata?.additionalServices),
    openingHours: asString(metadata?.openingHours) || undefined,
    state: asString(location?.state || address?.state, 'N/A'),
    lga: asString(location?.lga || address?.lga, 'N/A'),
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
  const organization = asRecord(row.organization);
  const institution = asRecord(row.institution);
  const address = asRecord(row.address);
  const contact = asRecord(row.contact);
  const metadata = asRecord(row.metadata);
  const branchId = asString(row.branchId || row.id);
  if (!branchId) return null;
  const capabilitiesRaw = Array.isArray(row.capabilities) ? row.capabilities : [];
  const capabilities = capabilitiesRaw
    .map((item) => asString(item).trim().toLowerCase())
    .filter((item): item is BranchCapability =>
      ['hospital', 'clinic', 'laboratory', 'pharmacy'].includes(item)
    );
  const derivedType = asString(row.type).trim().toLowerCase()
    || capabilities[0]
    || '';
  const additionalServices = mergeGlobalServiceNames([
    ...normalizeAdditionalServices(metadata?.additionalServices),
    ...capabilities.map((entry) => normalizeGlobalServiceName(entry)),
  ]);

  return {
    id: branchId,
    branchId,
    institutionId: asString(row.institutionId || institution?.institutionId || institution?.id),
    organizationId: asString(row.organizationId || organization?.organizationId || organization?.id),
    organizationName: asString(row.organizationName || organization?.name) || undefined,
    institutionName: asString(row.institutionName || institution?.name) || undefined,
    name: asString(row.name, 'Branch'),
    code: asString(row.code, 'N/A'),
    type: derivedType && ['hospital', 'clinic', 'laboratory', 'pharmacy'].includes(derivedType)
      ? derivedType as BranchType
      : null,
    capabilities,
    address: address ?? null,
    contact: contact ?? null,
    metadata: metadata ?? undefined,
    additionalServices,
    openingHours: asString(metadata?.openingHours) || undefined,
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
  scope?: 'affiliated' | 'all';
  approvalStatus?: 'pending' | 'approved' | 'declined' | 'revoked';
  lifecycleStatus?: 'active' | 'suspended' | 'delete_pending' | 'deleted';
};

export function useOrganizations(params: OrganizationsParams) {
  return useQuery({
    queryKey: ['org', 'organizations', params],
    queryFn: async (): Promise<{ rows: OrganizationRow[]; total: number; scope: 'affiliated' | 'all'; canListAll: boolean }> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.org.list, {
        query: {
          page: params.page,
          limit: params.limit,
          q: params.q && params.q.trim().length > 0 ? params.q : undefined,
          scope: params.scope || 'affiliated',
          approvalStatus: params.approvalStatus,
          lifecycleStatus: params.lifecycleStatus,
        },
      });

      const items = (Array.isArray(response.items) ? response.items : [])
        .map(mapOrganizationRow)
        .filter((row): row is OrganizationRow => Boolean(row));

      const scope = asString(response.scope, 'affiliated').toLowerCase() === 'all' ? 'all' : 'affiliated';
      return {
        rows: items,
        total: Number(response.total ?? items.length),
        scope,
        canListAll: Boolean(response.canListAll),
      };
    },
  });
}

export function usePublicOrganizations(params: {
  page: number;
  limit: number;
  q?: string;
  state?: string;
  lga?: string;
  institutionType?: InstitutionType;
}) {
  return useQuery({
    queryKey: ['org', 'public-organizations', params],
    queryFn: async (): Promise<{ rows: PublicOrganizationRow[]; total: number }> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.org.publicList, {
        query: {
          page: params.page,
          limit: params.limit,
          q: params.q && params.q.trim().length > 0 ? params.q : undefined,
          state: params.state || undefined,
          lga: params.lga || undefined,
          institutionType: params.institutionType || undefined,
        },
      });
      const items = Array.isArray(response.items) ? response.items : [];
      const rows = items
        .map((entry) => {
          const mapped = mapOrganizationRow(entry);
          if (!mapped) return null;
          const record = asRecord(entry);
          const institutions = Array.isArray(record?.institutions)
            ? record.institutions
                .map((rawInstitution) => asRecord(rawInstitution))
                .filter((rawInstitution): rawInstitution is Record<string, unknown> => Boolean(rawInstitution))
                .map((rawInstitution) => ({
                  institutionId: asString(rawInstitution.institutionId),
                  name: asString(rawInstitution.name, 'Institution'),
                  type: asString(rawInstitution.type, 'hospital'),
                  status: asString(rawInstitution.status, 'active'),
                  state: asString(rawInstitution.state) || null,
                  lga: asString(rawInstitution.lga) || null,
                }))
            : [];
          return {
            ...mapped,
            publicInfo: asString(record?.publicInfo) || null,
            openingHours: asString(record?.openingHours) || null,
            institutionsCount: Number(record?.institutionsCount ?? institutions.length),
            institutions,
          } as PublicOrganizationRow;
        })
        .filter((row): row is PublicOrganizationRow => Boolean(row));
      return {
        rows,
        total: Number(response.total ?? rows.length),
      };
    },
  });
}

export function usePublicOrganizationDetails(orgId?: string) {
  return useQuery({
    queryKey: ['org', 'public-organization', orgId ?? 'none'],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<{
      organization: PublicOrganizationRow | null;
      institutions: InstitutionRow[];
      branches: BranchRow[];
    }> => {
      if (!orgId) return { organization: null, institutions: [], branches: [] };
      const response = await apiClient.get<Record<string, unknown>>(endpoints.org.publicById(orgId));
      const mappedOrganization = mapOrganizationRow(response.organization);
      const organizationRecord = asRecord(response.organization);
      const organization = mappedOrganization
        ? ({
            ...mappedOrganization,
            publicInfo: asString(organizationRecord?.publicInfo) || null,
            openingHours: asString(organizationRecord?.openingHours) || null,
          } as PublicOrganizationRow)
        : null;
      const institutions = Array.isArray(response.institutions)
        ? response.institutions.map(mapInstitutionRow).filter((row): row is InstitutionRow => Boolean(row))
        : [];
      const branches = Array.isArray(response.branches)
        ? response.branches.map(mapBranchRow).filter((row): row is BranchRow => Boolean(row))
        : [];
      return { organization, institutions, branches };
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
    staleTime: 60_000,
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
    }) => {
      try {
        return await apiClient.post<{ organization?: unknown }>(endpoints.org.list, payload);
      } catch (error) {
        // Backward compatibility for older organization-service builds that still require `type`.
        if (
          error instanceof ApiClientError
          && error.status === 400
          && /required property 'type'|missing property 'type'|invalid organization type/i.test(error.message)
        ) {
          return apiClient.post<{ organization?: unknown }>(endpoints.org.list, {
            ...payload,
            type: 'government',
          });
        }
        throw error;
      }
    },
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
    }) => {
      try {
        return await apiClient.patch<{ organization?: unknown }>(endpoints.org.byId(payload.orgId), payload);
      } catch (error) {
        // Backward compatibility for older organization-service builds with strict PATCH schema.
        if (
          error instanceof ApiClientError
          && error.status === 400
          && /additional properties|must not have additional properties/i.test(error.message)
        ) {
          const legacyPayload = {
            orgId: payload.orgId,
            name: payload.name,
            description: payload.description,
            registrationNumber: payload.registrationNumber,
            location: payload.location,
            status: payload.status === 'suspended' ? 'suspended' : payload.status === 'active' ? 'active' : undefined,
          };
          return apiClient.patch<{ organization?: unknown }>(endpoints.org.byId(payload.orgId), legacyPayload);
        }
        throw error;
      }
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['org', 'organizations'] });
      queryClient.invalidateQueries({ queryKey: ['org', 'organization', variables.orgId] });
    },
  });
}

export function useDeletedOrganizations(params: { page: number; limit: number; scope?: 'affiliated' | 'all' }) {
  return useQuery({
    queryKey: ['org', 'deleted-organizations', params],
    queryFn: async (): Promise<{ rows: Array<OrganizationRow & { institutions: InstitutionRow[]; branches: BranchRow[] }>; total: number }> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.org.deleted, {
        query: {
          page: params.page,
          limit: params.limit,
          scope: params.scope || 'affiliated',
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
      await queryClient.invalidateQueries({ queryKey: ['identity', 'me'] });
      await queryClient.invalidateQueries({ queryKey: ['identity', 'contexts'] });
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
      address?: Record<string, unknown>;
      location?: { state?: string; lga?: string; addressText?: string };
      contact?: Record<string, unknown>;
      documents?: Array<Record<string, unknown>>;
      metadata?: Record<string, unknown>;
    }) => {
      const { orgId, ...body } = payload;
      return apiClient.post<{ institution?: unknown }>(endpoints.org.institutions(orgId), body);
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['org', 'institutions', variables.orgId] });
      queryClient.invalidateQueries({ queryKey: ['org', 'scoped-institutions'] });
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
      address?: Record<string, unknown>;
      location?: { state?: string; lga?: string; addressText?: string };
      contact?: Record<string, unknown>;
      documents?: Array<Record<string, unknown>>;
      metadata?: Record<string, unknown>;
    }) => {
      const { orgId, institutionId, ...body } = payload;
      return apiClient.patch<{ institution?: unknown }>(endpoints.org.institutionById(orgId, institutionId), body);
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['org', 'institutions', variables.orgId] });
      queryClient.invalidateQueries({ queryKey: ['org', 'scoped-institutions'] });
      queryClient.invalidateQueries({ queryKey: ['org', 'institution', variables.institutionId] });
    },
  });
}

export function useUploadInstitutionFiles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { orgId: string; institutionId: string; files: File[] }) => {
      const uploads = await Promise.all(
        payload.files.map(async (file) => ({
          filename: file.name,
          contentType: file.type,
          contentBase64: await fileToBase64(file),
          title: file.name,
          type: 'government_document',
        })),
      );

      return apiClient.post<Record<string, unknown>>(endpoints.org.institutionFilesUpload(payload.orgId, payload.institutionId), {
        uploads,
      });
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['org', 'institutions', variables.orgId] });
      queryClient.invalidateQueries({ queryKey: ['org', 'scoped-institutions'] });
      queryClient.invalidateQueries({ queryKey: ['org', 'institution', variables.institutionId] });
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
      capabilities?: BranchCapability[];
      type?: BranchType;
      location?: { state?: string; lga?: string; addressText?: string };
      address?: Record<string, unknown>;
      contact?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }) => {
      const { orgId, institutionId, ...body } = payload;
      return apiClient.post<{ branch?: unknown }>(endpoints.org.institutionBranches(orgId, institutionId), body);
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['org', 'branches', variables.orgId, variables.institutionId] });
      queryClient.invalidateQueries({ queryKey: ['org', 'scoped-branches'] });
      queryClient.invalidateQueries({ queryKey: ['org', 'institution', variables.institutionId] });
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
      type?: BranchType;
      location?: { state?: string; lga?: string; addressText?: string };
      address?: Record<string, unknown>;
      contact?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }) => {
      const { orgId, institutionId, branchId, ...body } = payload;
      return apiClient.patch<{ branch?: unknown }>(endpoints.org.institutionBranchById(orgId, institutionId, branchId), body);
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['org', 'branches', variables.orgId, variables.institutionId] });
      queryClient.invalidateQueries({ queryKey: ['org', 'branch', variables.branchId] });
      queryClient.invalidateQueries({ queryKey: ['org', 'scoped-branches'] });
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
      if (params.orgId) {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.org.institutions(params.orgId));
        const items = Array.isArray(response.items) ? response.items : [];
        const normalizedQuery = params.q?.trim().toLowerCase() || '';
        const normalizedStatus = params.status?.trim().toLowerCase() || '';
        const normalizedType = params.type?.trim().toLowerCase() || '';
        const normalizedState = params.state?.trim().toLowerCase() || '';
        const normalizedLga = params.lga?.trim().toLowerCase() || '';
        const filteredRows = items
          .map(mapInstitutionRow)
          .filter((row): row is InstitutionRow => Boolean(row))
          .filter((row) => {
            if (normalizedQuery) {
              const searchTarget = `${row.name} ${row.code} ${row.institutionId} ${row.organizationId}`.toLowerCase();
              if (!searchTarget.includes(normalizedQuery)) return false;
            }
            if (normalizedStatus && String(row.status || '').toLowerCase() !== normalizedStatus) return false;
            if (normalizedType && String(row.type || '').toLowerCase() !== normalizedType) return false;
            if (normalizedState && String(row.state || '').toLowerCase() !== normalizedState) return false;
            if (normalizedLga && String(row.lga || '').toLowerCase() !== normalizedLga) return false;
            return true;
          });
        const total = filteredRows.length;
        const start = Math.max(params.page - 1, 0) * params.limit;
        return {
          rows: filteredRows.slice(start, start + params.limit),
          total,
        };
      }

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
    staleTime: 60_000,
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

function extractCachedBranchRows(value: unknown): BranchRow[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is BranchRow => Boolean(asRecord(entry)));
  }
  const record = asRecord(value);
  if (!record) return [];
  if (Array.isArray(record.rows)) {
    return record.rows.filter((entry): entry is BranchRow => Boolean(asRecord(entry)));
  }
  if (Array.isArray(record.branches)) {
    return record.branches.filter((entry): entry is BranchRow => Boolean(asRecord(entry)));
  }
  return [];
}

function findCachedBranchRow(queryClient: QueryClient, branchId: string): BranchRow | null {
  const cachedBranch = queryClient.getQueryData<{ branch: BranchRow | null }>(['org', 'branch', branchId])?.branch;
  if (cachedBranch) return cachedBranch;

  const cachedSources = [
    ...queryClient.getQueriesData({ queryKey: ['org', 'scoped-branches'] }),
    ...queryClient.getQueriesData({ queryKey: ['org', 'branches'] }),
    ...queryClient.getQueriesData({ queryKey: ['org', 'public-organization'] }),
    ...queryClient.getQueriesData({ queryKey: ['org', 'deleted-organizations'] }),
  ];

  for (const [, cachedValue] of cachedSources) {
    const match = extractCachedBranchRows(cachedValue).find((entry) => entry.branchId === branchId || entry.id === branchId);
    if (match) return match;
  }

  return null;
}

export function useBranchById(branchId?: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['org', 'branch', branchId ?? 'none'],
    enabled: Boolean(branchId),
    staleTime: 60_000,
    placeholderData: () => {
      if (!branchId) return undefined;
      const cachedBranch = findCachedBranchRow(queryClient, branchId);
      return cachedBranch ? { branch: cachedBranch } : undefined;
    },
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

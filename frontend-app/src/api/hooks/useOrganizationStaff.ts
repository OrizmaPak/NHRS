import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type StaffAssignment = {
  assignmentId: string;
  organizationId: string;
  membershipId: string;
  institutionId: string | null;
  branchId: string | null;
  roles: string[];
  departments: string[];
  status: string;
  activeFrom?: string;
  activeTo?: string | null;
};

export type OrganizationMemberRow = {
  membershipId: string;
  organizationId: string;
  userId: string | null;
  nin: string;
  status: string;
  roles: string[];
  addedByUserId?: string | null;
  createdAt?: string;
  assignments: StaffAssignment[];
};

type MembersParams = {
  page: number;
  limit: number;
  q?: string;
  status?: string;
  branchId?: string;
  institutionId?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function toAssignment(raw: unknown): StaffAssignment | null {
  const entry = asRecord(raw);
  if (!entry) return null;
  return {
    assignmentId: asString(entry.assignmentId || entry.id),
    organizationId: asString(entry.organizationId),
    membershipId: asString(entry.membershipId),
    institutionId: asString(entry.institutionId) || null,
    branchId: asString(entry.branchId) || null,
    roles: Array.isArray(entry.roles) ? entry.roles.map((item) => String(item)) : [],
    departments: Array.isArray(entry.departments) ? entry.departments.map((item) => String(item)) : [],
    status: asString(entry.status, 'active'),
    activeFrom: asString(entry.activeFrom) || undefined,
    activeTo: asString(entry.activeTo) || null,
  };
}

function toMember(raw: unknown): OrganizationMemberRow | null {
  const row = asRecord(raw);
  if (!row) return null;
  const membershipId = asString(row.membershipId || row.id);
  if (!membershipId) return null;
  const assignmentsRaw = Array.isArray(row.assignments) ? row.assignments : [];
  return {
    membershipId,
    organizationId: asString(row.organizationId),
    userId: asString(row.userId) || null,
    nin: asString(row.nin),
    status: asString(row.status, 'active'),
    roles: Array.isArray(row.roles) ? row.roles.map((item) => String(item)) : [],
    addedByUserId: asString(row.addedByUserId) || null,
    createdAt: asString(row.createdAt) || undefined,
    assignments: assignmentsRaw.map(toAssignment).filter((entry): entry is StaffAssignment => Boolean(entry)),
  };
}

export function useOrganizationMembers(orgId?: string, params?: MembersParams) {
  return useQuery({
    queryKey: ['org', 'members', orgId ?? 'none', params],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<{ rows: OrganizationMemberRow[]; total: number }> => {
      if (!orgId) return { rows: [], total: 0 };
      const response = await apiClient.get<Record<string, unknown>>(endpoints.org.members(orgId), {
        query: {
          page: params?.page ?? 1,
          limit: params?.limit ?? 20,
          q: params?.q || undefined,
          status: params?.status || undefined,
          branchId: params?.branchId || undefined,
          institutionId: params?.institutionId || undefined,
          includeAssignments: true,
        },
      });
      const items = Array.isArray(response.items) ? response.items : [];
      const rows = items.map(toMember).filter((entry): entry is OrganizationMemberRow => Boolean(entry));
      return { rows, total: Number(response.total ?? rows.length) };
    },
  });
}

export function useAddOrganizationMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      orgId: string;
      nin: string;
      initialRoles?: string[];
      initialAssignments?: Array<{
        institutionId?: string;
        branchId?: string;
        roles?: string[];
        departments?: string[];
      }>;
    }) => {
      const { orgId, initialAssignments, ...rest } = payload;
      return apiClient.post(endpoints.org.members(orgId), {
        ...rest,
        initialBranchAssignments: initialAssignments ?? [],
      });
    },
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['org', 'members', variables.orgId] });
    },
  });
}

export function useAssignMemberScope() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      orgId: string;
      memberId: string;
      institutionId?: string;
      branchId?: string;
      roles?: string[];
      departments?: string[];
      isPrimary?: boolean;
    }) => {
      const { orgId, memberId, ...body } = payload;
      return apiClient.post(endpoints.org.memberBranchAssignments(orgId, memberId), body);
    },
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['org', 'members', variables.orgId] });
    },
  });
}


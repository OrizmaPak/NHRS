import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { toIdentityResponse } from '@/api/hooks/identityMapper';
import { useAuthStore } from '@/stores/authStore';
import { useContextStore } from '@/stores/contextStore';
import type { AppContext } from '@/types/auth';

const contextsQueryKey = ['identity', 'contexts'] as const;
const orgStatusQueryKey = ['identity', 'org-status'] as const;

async function fetchContexts(): Promise<AppContext[]> {
  try {
    const response = await apiClient.get<unknown>(endpoints.identity.contexts);
    const payload = response && typeof response === 'object' ? (response as Record<string, unknown>) : {};
    if (Array.isArray(payload.contexts)) {
      return toIdentityResponse({ ...payload, availableContexts: payload.contexts }).availableContexts;
    }
    return toIdentityResponse(payload).availableContexts;
  } catch {
    const fallback = await apiClient.get<unknown>(endpoints.identity.me);
    return toIdentityResponse(fallback).availableContexts;
  }
}

type OrgStatusEntry = {
  organizationId: string;
  name: string;
  approvalStatus: string;
  lifecycleStatus: string;
};

type OrgStatusSnapshot = {
  entries: Record<string, OrgStatusEntry>;
  hasPending: boolean;
};

function toOrgStatusSnapshot(payload: unknown): OrgStatusSnapshot {
  if (!payload || typeof payload !== 'object') {
    return { entries: {}, hasPending: false };
  }

  const record = payload as Record<string, unknown>;
  const rows = Array.isArray(record.items) ? record.items : [];
  const entries: Record<string, OrgStatusEntry> = {};
  let hasPending = false;

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const organizationId = String(item.organizationId ?? item.id ?? '').trim();
    if (!organizationId) continue;

    const approvalStatus = String(item.approvalStatus ?? 'pending').trim().toLowerCase();
    const lifecycleStatus = String(item.lifecycleStatus ?? item.status ?? 'active').trim().toLowerCase();
    const name = String(item.name ?? organizationId);

    if (approvalStatus === 'pending' || lifecycleStatus === 'delete_pending') {
      hasPending = true;
    }

    entries[organizationId] = {
      organizationId,
      name,
      approvalStatus,
      lifecycleStatus,
    };
  }

  return { entries, hasPending };
}

async function fetchOrgStatusSnapshot(): Promise<OrgStatusSnapshot> {
  try {
    const response = await apiClient.get<Record<string, unknown>>(endpoints.org.list, {
      query: {
        page: 1,
        limit: 200,
        scope: 'affiliated',
      },
      suppressGlobalErrors: true,
    });
    return toOrgStatusSnapshot(response);
  } catch {
    return { entries: {}, hasPending: false };
  }
}

export function useContexts() {
  const initialized = useAuthStore((state) => state.initialized);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const availableContexts = useContextStore((state) => state.availableContexts);
  const activeContext = useContextStore((state) => state.activeContext);
  const setAvailableContexts = useContextStore((state) => state.setAvailableContexts);
  const previousContextIds = useRef<Set<string>>(new Set());
  const previousContextsById = useRef<Map<string, AppContext>>(new Map());
  const hasInitializedContextSnapshot = useRef(false);
  const previousOrgStatuses = useRef<Record<string, OrgStatusEntry>>({});
  const hasInitializedOrgStatusSnapshot = useRef(false);

  const orgStatusQuery = useQuery({
    queryKey: orgStatusQueryKey,
    queryFn: fetchOrgStatusSnapshot,
    enabled: initialized && isAuthenticated,
    retry: false,
    staleTime: 10_000,
    refetchInterval: initialized && isAuthenticated
      ? ((query) => (query.state.data?.hasPending ? 4_000 : 20_000))
      : false,
    refetchOnWindowFocus: false,
  });

  const query = useQuery({
    queryKey: contextsQueryKey,
    queryFn: fetchContexts,
    enabled: initialized && isAuthenticated,
    retry: false,
    staleTime: 60_000,
    refetchInterval: initialized && isAuthenticated
      ? (orgStatusQuery.data?.hasPending ? 4_000 : 15_000)
      : false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!orgStatusQuery.data) return;
    const next = orgStatusQuery.data.entries;

    if (hasInitializedOrgStatusSnapshot.current) {
      for (const [organizationId, current] of Object.entries(next)) {
        const previous = previousOrgStatuses.current[organizationId];
        if (!previous) continue;

        if (previous.approvalStatus !== current.approvalStatus) {
          if (current.approvalStatus === 'approved') {
            toast.success(`${current.name} has been approved.`);
          } else if (current.approvalStatus === 'declined') {
            toast.error(`${current.name} approval was declined.`);
          } else if (current.approvalStatus === 'revoked') {
            toast.error(`${current.name} approval was revoked.`);
          }
        }

        if (previous.lifecycleStatus !== current.lifecycleStatus) {
          if (current.lifecycleStatus === 'delete_pending') {
            toast.message(`${current.name} deletion request is pending review.`);
          } else if (current.lifecycleStatus === 'deleted') {
            toast.error(`${current.name} was deleted.`);
          } else if (current.lifecycleStatus === 'active' && previous.lifecycleStatus !== 'active') {
            toast.success(`${current.name} is active again.`);
          }
        }
      }
    }

    previousOrgStatuses.current = next;
    hasInitializedOrgStatusSnapshot.current = true;
  }, [orgStatusQuery.data]);

  useEffect(() => {
    if (!Array.isArray(query.data)) return;
    const nextIds = new Set(query.data.map((context) => context.id));
    const nextMap = new Map(query.data.map((context) => [context.id, context] as const));
    if (hasInitializedContextSnapshot.current) {
      for (const context of query.data) {
        if (!context.id.startsWith('org:')) continue;
        if (previousContextIds.current.has(context.id)) continue;
        toast.success(`${context.name} is now available in your context switcher.`);
      }
      for (const previousId of previousContextIds.current) {
        if (!previousId.startsWith('org:')) continue;
        if (nextIds.has(previousId)) continue;
        const previousContext = previousContextsById.current.get(previousId);
        toast.message(`${previousContext?.name ?? 'Organization'} is no longer available in your context switcher.`);
      }
    }
    previousContextIds.current = nextIds;
    previousContextsById.current = nextMap;
    hasInitializedContextSnapshot.current = true;
    setAvailableContexts(query.data);
  }, [query.data, setAvailableContexts]);

  return {
    availableContexts,
    activeContext,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

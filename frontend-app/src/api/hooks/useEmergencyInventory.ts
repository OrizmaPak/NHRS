import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type EmergencyInventoryParams = {
  q?: string;
  itemType?: string;
  state?: string;
  page: number;
  limit: number;
};

export type EmergencyInventoryRow = {
  id: string;
  resourceName: string;
  provider: string;
  state: string;
  availability: string;
  lastUpdated: string;
};

type EmergencyInventoryResult = {
  rows: EmergencyInventoryRow[];
  total: number;
};

function mapInventoryItem(item: Record<string, unknown>): EmergencyInventoryRow {
  return {
    id: String(item.inventoryId ?? item.id ?? crypto.randomUUID()),
    resourceName: String(item.name ?? item.itemName ?? item.resourceName ?? 'Resource'),
    provider: String(item.providerOrgName ?? item.providerOrgId ?? item.provider ?? 'Unknown provider'),
    state: String(item.state ?? item.locationState ?? 'N/A'),
    availability: String(item.quantityStatus ?? item.availability ?? 'unknown'),
    lastUpdated: String(item.updatedAt ?? item.lastUpdated ?? new Date().toISOString()),
  };
}

export function useEmergencyInventory(params: EmergencyInventoryParams) {
  return useQuery({
    queryKey: ['emergency', 'inventory', params],
    queryFn: async (): Promise<EmergencyInventoryResult> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.emergency.inventorySearch, {
        query: {
          q: params.q,
          itemType: params.itemType,
          state: params.state,
          page: params.page,
          limit: params.limit,
        },
      });

      const items =
        (Array.isArray(response.items) ? response.items : null) ??
        (Array.isArray(response.data) ? response.data : null) ??
        [];
      const rows = items
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map(mapInventoryItem);

      return {
        rows,
        total: Number(response.total ?? rows.length),
      };
    },
  });
}

export function useCreateEmergencyRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      resourceType: string;
      quantity: number;
      location: string;
      urgency: 'critical' | 'high' | 'medium';
      notes?: string;
    }) =>
      apiClient.post(endpoints.emergency.requests, {
        title: `${payload.resourceType} request (${payload.quantity})`,
        description: payload.notes ?? `Need ${payload.quantity} of ${payload.resourceType}`,
        category: payload.resourceType,
        urgency: payload.urgency,
        scope: { level: 'STATE', state: payload.location },
        location: { state: payload.location, lga: payload.location },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['emergency', 'inventory'] });
    },
  });
}

export function useEmergencyRequestsSummary() {
  return useQuery({
    queryKey: ['emergency', 'requests', 'summary'],
    queryFn: async () => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.emergency.requests, {
        query: { page: 1, limit: 100, status: 'open' },
      });
      const items =
        (Array.isArray(response.items) ? response.items : null) ??
        (Array.isArray(response.data) ? response.data : null) ??
        [];

      const openRequests = items.filter((item) => {
        if (!item || typeof item !== 'object') return false;
        const status = String((item as Record<string, unknown>).status ?? '').toLowerCase();
        return status === 'open' || status === 'in_progress';
      });
      const pendingLabResults = openRequests.filter((item) => {
        const category = String((item as Record<string, unknown>).category ?? '').toLowerCase();
        return category === 'test' || category === 'lab' || category === 'laboratory';
      }).length;
      const pendingPharmacyOrders = openRequests.filter((item) => {
        const category = String((item as Record<string, unknown>).category ?? '').toLowerCase();
        return category === 'drug' || category === 'pharmacy';
      }).length;

      return {
        total: Number(response.total ?? items.length),
        openRequests: openRequests.length,
        pendingLabResults,
        pendingPharmacyOrders,
      };
    },
  });
}
